import { Router, type Request, type Response } from 'express'
import type { PvpLoadAckRequest, PvpMode, PvpQueueJoinRequest } from '../../../shared/contracts/pvp'
import type { ServerConfig } from '../config/server-config'
import { PvpPlatformService } from '../pvp-platform-v1/service'
import { isHumanGatewayPrincipal, PvpPlatformError, type HumanGatewayPrincipal } from '../pvp-platform-v1/types'
import { authenticateGatewayTokenAsync, extractHttpToken } from './gateway-auth'

async function principalFrom(request: Request, config: ServerConfig): Promise<HumanGatewayPrincipal> {
  const token = extractHttpToken(request)
  // PVP 竞技边界不继承 PVE 本地“免鉴权回退到首个账号”的便利行为，
  // 否则 agent/anonymous 请求会被错认成默认真人。PVP 始终要求显式有效 token。
  const principal = await authenticateGatewayTokenAsync({ ...config, authRequired: true }, token)
  if (!principal) throw new PvpPlatformError('UNAUTHORIZED', 'Missing or invalid gateway token', 401)
  if (process.env.NODE_ENV === 'production' && principal.authSource !== 'supabase') {
    throw new PvpPlatformError('SUPABASE_SESSION_REQUIRED', '正式 PVP 只接受 Supabase 真人会话', 401)
  }
  if (!isHumanGatewayPrincipal(principal)) throw new PvpPlatformError('HUMAN_ACCOUNT_REQUIRED', 'PVP 只允许真人账号进入', 403)
  return principal
}

function recordBody(request: Request): Record<string, unknown> {
  return typeof request.body === 'object' && request.body !== null && !Array.isArray(request.body)
    ? request.body as Record<string, unknown>
    : {}
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new PvpPlatformError('BAD_PAYLOAD', `${field} is required`, 400)
  return value.trim()
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function requiredInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new PvpPlatformError('BAD_PAYLOAD', `${field} must be a non-negative integer`, 400)
  return Number(value)
}

function numberQuery(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : undefined
}

function sendError(response: Response, error: unknown): void {
  if (error instanceof PvpPlatformError) {
    response.status(error.status).json({ ok: false, code: error.code, message: error.message })
    return
  }
  const message = error instanceof Error ? error.message : String(error)
  console.error(`PVP REST failure: ${message}`)
  response.status(503).json({ ok: false, code: 'PVP_SERVICE_UNAVAILABLE', message: 'PVP service is temporarily unavailable' })
}

function route(handler: (request: Request, response: Response, principal: HumanGatewayPrincipal) => unknown | Promise<unknown>, config: ServerConfig) {
  return async (request: Request, response: Response) => {
    try {
      const principal = await principalFrom(request, config)
      await handler(request, response, principal)
    }
    catch (error) {
      sendError(response, error)
    }
  }
}

export function createPvpRestApiRouter(config: ServerConfig, platform: PvpPlatformService): Router {
  const router = Router()

  router.get('/profile', route(async (_request, response, principal) => {
    response.json({ ok: true, profile: await platform.profile(principal) })
  }, config))

  router.get('/seasons/current', route(async (request, response) => {
    const rawMode = optionalString(request.query.mode)
    const mode: PvpMode = rawMode === 'casual_1v1' || rawMode === 'custom_1v1' ? rawMode : 'ranked_1v1'
    response.json({ ok: true, season: await platform.currentSeason(mode) })
  }, config))

  router.get('/leaderboard', route(async (request, response, principal) => {
    const leaderboard = await platform.leaderboard(
      principal,
      numberQuery(request.query.limit),
      optionalString(request.query.cursor),
    )
    response.json({ ok: true, leaderboard })
  }, config))

  router.get('/matches', route(async (request, response, principal) => {
    const history = await platform.history(principal, numberQuery(request.query.limit), optionalString(request.query.cursor))
    response.json({ ok: true, matches: history.entries, history })
  }, config))

  router.get('/matches/:matchId', route(async (request, response, principal) => {
    const detail = await platform.matchDetail(principal, requiredString(request.params.matchId, 'matchId'))
    response.json({ ok: true, detail })
  }, config))

  router.get('/matches/:matchId/state', route((request, response, principal) => {
    const state = platform.matchState(principal, requiredString(request.params.matchId, 'matchId'))
    response.json({ ok: true, state })
  }, config))

  router.get('/matches/:matchId/events', route((request, response, principal) => {
    const matchId = requiredString(request.params.matchId, 'matchId')
    response.status(200)
    response.setHeader('Content-Type', 'text/event-stream')
    response.setHeader('Cache-Control', 'no-cache, no-transform')
    response.setHeader('Connection', 'keep-alive')
    response.flushHeaders()
    const unsubscribe = platform.subscribeMatchState(principal, matchId, envelope => {
      response.write(`id: ${envelope.seq}\nevent: pvp-state\ndata: ${JSON.stringify(envelope)}\n\n`)
    })
    const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 15_000)
    request.on('close', () => { clearInterval(heartbeat); unsubscribe() })
  }, config))

  router.post('/matches/:matchId/load-ack', route((request, response, principal) => {
    const body = recordBody(request)
    const input: PvpLoadAckRequest = {
      requestId: requiredString(body.requestId, 'requestId'),
      rulesetVersion: requiredString(body.rulesetVersion, 'rulesetVersion'),
      mapId: requiredString(body.mapId, 'mapId'),
      mapVersion: Number.isSafeInteger(body.mapVersion) ? body.mapVersion as number : -1,
      routeHash: requiredString(body.routeHash, 'routeHash'),
      assetsVersion: requiredString(body.assetsVersion, 'assetsVersion'),
      status: body.status === 'loaded' ? 'loaded' : body.status === 'failed' ? 'failed' : (() => { throw new PvpPlatformError('BAD_PAYLOAD', 'status must be loaded or failed', 400) })(),
      ...(typeof body.failureCode === 'string' ? { failureCode: body.failureCode } : {}),
    }
    const result = platform.acknowledgeLoad(principal, requiredString(request.params.matchId, 'matchId'), input)
    response.status(result.ok ? 200 : 409).json(result)
  }, config))

  router.post('/queue', route(async (request, response, principal) => {
    const body = recordBody(request)
    const mode = body.mode === 'casual_1v1' ? 'casual_1v1' : body.mode === 'ranked_1v1' ? 'ranked_1v1' : null
    if (!mode) throw new PvpPlatformError('UNSUPPORTED_MODE', 'mode must be ranked_1v1 or casual_1v1', 422)
    const join: PvpQueueJoinRequest = {
      requestId: requiredString(body.requestId, 'requestId'),
      mode,
      // 身份、MMR、区域与规则最终值均由服务端确定；这里只做版本意图输入。
      region: optionalString(body.region) ?? 'auto',
      rulesetVersion: optionalString(body.rulesetVersion) ?? 'current',
      loadoutVersion: Number.isSafeInteger(body.loadoutVersion) && (body.loadoutVersion as number) >= 0
        ? body.loadoutVersion as number
        : 0,
    }
    response.status(201).json({ ok: true, ...await platform.joinQueue(principal, join) })
  }, config))

  router.get('/queue/:ticketId', route((request, response, principal) => {
    response.json({ ok: true, ...platform.queueStatus(principal, requiredString(request.params.ticketId, 'ticketId')) })
  }, config))

  router.delete('/queue/:ticketId', route((request, response, principal) => {
    const body = recordBody(request)
    response.json({
      ok: true,
      ...platform.cancelQueue(
        principal,
        requiredString(request.params.ticketId, 'ticketId'),
        requiredString(body.requestId, 'requestId'),
      ),
    })
  }, config))

  router.post('/proposals/:proposalId/accept', route(async (request, response, principal) => {
    const body = recordBody(request)
    response.json({
      ok: true,
      ...await platform.acceptProposal(
        principal,
        requiredString(request.params.proposalId, 'proposalId'),
        requiredString(body.requestId, 'requestId'),
      ),
    })
  }, config))

  router.post('/matches/:matchId/pressure', route((request, response, principal) => {
    const body = recordBody(request)
    const result = platform.sendPressure(
      principal,
      requiredString(request.params.matchId, 'matchId'),
      requiredString(body.requestId, 'requestId'),
    )
    response.status(result.ok ? 200 : 409).json({ ...result })
  }, config))

  router.post('/matches/:matchId/recruit', route((request, response, principal) => {
    const body = recordBody(request)
    const result = platform.recruit(principal, requiredString(request.params.matchId, 'matchId'), {
      requestId: requiredString(body.requestId, 'requestId'),
      expectedTrayRevision: requiredInteger(body.expectedTrayRevision, 'expectedTrayRevision'),
    })
    response.status(result.ok ? 200 : 409).json(result)
  }, config))

  router.post('/matches/:matchId/deploy', route((request, response, principal) => {
    const body = recordBody(request)
    const result = platform.deploy(principal, requiredString(request.params.matchId, 'matchId'), {
      requestId: requiredString(body.requestId, 'requestId'), unitId: requiredString(body.unitId, 'unitId'),
      x: requiredInteger(body.x, 'x'), y: requiredInteger(body.y, 'y'),
      expectedTrayRevision: requiredInteger(body.expectedTrayRevision, 'expectedTrayRevision'),
      expectedBoardRevision: requiredInteger(body.expectedBoardRevision, 'expectedBoardRevision'),
    })
    response.status(result.ok ? 200 : 409).json(result)
  }, config))

  router.post('/matches/:matchId/move-or-merge', route((request, response, principal) => {
    const body = recordBody(request)
    const result = platform.moveOrMerge(principal, requiredString(request.params.matchId, 'matchId'), {
      requestId: requiredString(body.requestId, 'requestId'), entityId: requiredString(body.entityId, 'entityId'),
      x: requiredInteger(body.x, 'x'), y: requiredInteger(body.y, 'y'),
      expectedBoardRevision: requiredInteger(body.expectedBoardRevision, 'expectedBoardRevision'),
    })
    response.status(result.ok ? 200 : 409).json(result)
  }, config))

  router.post('/matches/:matchId/surrender', route(async (request, response, principal) => {
    const body = recordBody(request)
    const result = await platform.surrender(
      principal,
      requiredString(request.params.matchId, 'matchId'),
      requiredString(body.requestId, 'requestId'),
    )
    response.status(result.ok ? 200 : 409).json({ ...result })
  }, config))

  router.get('/rooms', route(async (_request, response) => {
    response.json({ ok: true, rooms: await platform.listRooms() })
  }, config))

  router.post('/rooms', route((request, response, principal) => {
    const body = recordBody(request)
    const room = platform.createRoom(principal, {
      roomName: requiredString(body.roomName, 'roomName'),
      password: optionalString(body.password),
      spectatorsAllowed: body.spectatorsAllowed === true,
    })
    response.status(201).json({ ok: true, room })
  }, config))

  router.get('/rooms/:roomId', route((request, response) => {
    response.json({ ok: true, room: platform.getRoom(requiredString(request.params.roomId, 'roomId')) })
  }, config))

  router.post('/rooms/:roomId/join', route(async (request, response, principal) => {
    const body = recordBody(request)
    const room = await platform.joinRoom(
      principal,
      requiredString(request.params.roomId, 'roomId'),
      optionalString(body.password) ?? '',
    )
    response.json({ ok: true, room })
  }, config))

  router.post('/rooms/:roomId/ready', route(async (request, response, principal) => {
    const body = recordBody(request)
    if (typeof body.ready !== 'boolean') throw new PvpPlatformError('BAD_PAYLOAD', 'ready must be boolean', 400)
    const room = await platform.setRoomReady(principal, requiredString(request.params.roomId, 'roomId'), body.ready)
    response.json({ ok: true, room })
  }, config))

  return router
}
