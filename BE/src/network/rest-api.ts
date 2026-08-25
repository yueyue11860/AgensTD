import { Router, type Request, type Response } from 'express'
import { buildLiveLeaderboards, buildReplaySummary } from '../core/competition-projection'
import { projectFrontendGameState } from '../core/state-projection'
import type { ReplayRecorder } from '../core/replay-recorder'
import { GameEngine } from '../core/game-engine'
import { RoomManager, type RoomSummarySnapshot } from '../core/Room'
import type { ServerConfig } from '../config/server-config'
import type { ReplaySummary } from '../domain/competition'
import { submitAction } from './action-submission'
import { ActionRateLimiter } from './action-rate-limiter'
import { authenticateGatewayToken, extractHttpToken } from './gateway-auth'
import type { CompetitionStore } from '../data/competition-store'
import type { ProgressStore } from '../data/progress-store'
import type { PlayerType } from '../domain/progress'
import { checkUnlock } from '../core/unlock-logic'
import { AccountDomainError, type PlayerAccountRecord } from '../account-v1/types'
import type { PlayerAccountService } from '../account-v1/service'
import { ACCOUNT_CATALOGS } from '../data/player-account-adapters'
import { ITEM_CATALOG_VERSION, type ActiveItemSlots, type PassiveItemSlots, type PlayerItemAccount } from '../item-v1/types'
import { validateItemLoadout } from '../item-v1/account'
import { getWeaponDefinition } from '../weapon-v1/catalog'
import { validateWeaponLoadout } from '../weapon-v1/account'
import { WeaponDomainError, type PlayerWeaponAccount } from '../weapon-v1/types'

function resolvePrincipal(request: Request, config: ServerConfig) {
  return authenticateGatewayToken(config, extractHttpToken(request))
}

function rejectUnauthorized(response: Response) {
  response.status(401).json({ ok: false, code: 'UNAUTHORIZED', message: 'Missing or invalid gateway token' })
}

function parseLimit(value: unknown, fallback: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }

  return Math.floor(parsed)
}

function logCompetitionStoreFailure(operation: string, error: unknown) {
  const details = error instanceof Error ? error.message : String(error)
  console.error(`Competition store ${operation} failed; falling back to memory: ${details}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function publicAccount(account: PlayerAccountRecord) {
  const {
    idempotencyByRequestId: _idempotencyByRequestId,
    buildSnapshotsByMatchId: _buildSnapshotsByMatchId,
    ...safe
  } = account
  return safe
}

class RequestPayloadError extends Error {}

function requireString(payload: Record<string, unknown>, field: string): string {
  const value = payload[field]
  if (typeof value !== 'string' || value.length === 0) throw new RequestPayloadError(`${field} is required`)
  return value
}

function requireVersion(payload: Record<string, unknown>, field: string): number {
  const value = payload[field]
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new RequestPayloadError(`${field} must be a non-negative integer`)
  return value as number
}

function asNullableStringSlots(value: unknown, length: number, field: string): Array<string | null> {
  if (!Array.isArray(value) || value.length !== length || value.some(slot => slot !== null && typeof slot !== 'string')) {
    throw new RequestPayloadError(`${field} must contain exactly ${length} string-or-null slots`)
  }
  return [...value] as Array<string | null>
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
    .join(',')}}`
}

function readStoredSubsystemReplay(
  account: PlayerAccountRecord,
  requestId: string,
  operation: string,
  expectedAccountVersion: number,
  context: Record<string, unknown>,
): Record<string, unknown> | null {
  const stored = account.idempotencyByRequestId[requestId]
  if (!stored) return null
  const result = isRecord(stored.result) ? stored.result : null
  const storedContext = result && isRecord(result.context) ? result.context : null
  if (stored.operation !== operation
    || !result
    || result.expectedAccountVersion !== expectedAccountVersion
    || !storedContext
    || stableStringify(storedContext) !== stableStringify(context)) {
    throw new AccountDomainError('REQUEST_ID_CONFLICT', 'requestId was already used with a different payload')
  }
  return result
}

function sendAccountError(response: Response, error: unknown) {
  if (error instanceof AccountDomainError) {
    const status = error.code === 'STALE_ACCOUNT_VERSION'
      || error.code === 'REQUEST_ID_CONFLICT'
      || error.code === 'ENTITLEMENT_ALREADY_CONSUMED'
      || error.code === 'SHOP_REWARD_CONFLICT'
      ? 409
      : error.code === 'OFFER_NOT_FOUND' || error.code === 'ACCOUNT_NOT_FOUND'
        ? 404
        : error.code === 'ACCOUNT_WRITE_CONFLICT'
          ? 503
          : 422
    response.status(status).json({ ok: false, code: error.code, message: error.message })
    return
  }
  if (error instanceof WeaponDomainError) {
    const status = error.code.startsWith('STALE_') || error.code === 'REQUEST_ID_CONFLICT'
      ? 409
      : error.code === 'WEAPON_NOT_FOUND'
        ? 404
        : 422
    response.status(status).json({ ok: false, code: error.code, message: error.message })
    return
  }
  if (error instanceof RequestPayloadError) {
    response.status(400).json({ ok: false, code: 'BAD_PAYLOAD', message: error.message })
    return
  }
  const details = error instanceof Error ? error.message : String(error)
  console.error(`Account REST operation failed: ${details}`)
  response.status(503).json({ ok: false, code: 'ACCOUNT_SERVICE_UNAVAILABLE', message: 'Account service is temporarily unavailable' })
}

function normalizeRoomStatus(room: RoomSummarySnapshot) {
  if (room.phase === 'playing') {
    return 'IN_MATCH' as const
  }

  if (room.phase === 'countdown' || room.phase === 'waiting_for_level') {
    return 'DRAFTING' as const
  }

  return 'OPEN' as const
}

function serializeRoomSummary(room: RoomSummarySnapshot) {
  return {
    id: room.id,
    name: room.name,
    hasPassword: room.hasPassword,
    players: room.players,
    maxPlayers: room.maxPlayers,
    status: normalizeRoomStatus(room),
    pingMs: null,
    slots: room.slots,
  }
}

function generateRoomId(roomManager: RoomManager) {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const roomId = `RM-${Math.floor(1000 + Math.random() * 9000)}`
    if (!roomManager.getRoom(roomId)) {
      return roomId
    }
  }

  throw new Error('Failed to allocate room id')
}

export function createRestApiRouter(
  engine: GameEngine,
  roomManager: RoomManager,
  config: ServerConfig,
  limiter: ActionRateLimiter,
  replayRecorder: ReplayRecorder,
  competitionStore: CompetitionStore | null,
  progressStore: ProgressStore,
  accountService?: PlayerAccountService,
) {
  const router = Router()

  // ── 局外账户 / 道具 / 武器 ───────────────────────────────────────────

  router.get('/account', async (request, response) => {
    const principal = resolvePrincipal(request, config)
    if (!principal) return rejectUnauthorized(response)
    if (!accountService) return response.status(503).json({ ok: false, code: 'ACCOUNT_SERVICE_UNAVAILABLE' })
    try {
      const account = await accountService.getOrCreate(principal.playerId)
      response.json({ ok: true, account: publicAccount(account), catalogs: ACCOUNT_CATALOGS })
    }
    catch (error) {
      sendAccountError(response, error)
    }
  })

  router.put('/loadouts/items', async (request, response) => {
    const principal = resolvePrincipal(request, config)
    if (!principal) return rejectUnauthorized(response)
    if (!accountService) return response.status(503).json({ ok: false, code: 'ACCOUNT_SERVICE_UNAVAILABLE' })
    try {
      const payload = isRecord(request.body) ? request.body : {}
      const loadout = isRecord(payload.loadout) ? payload.loadout : payload
      const requestId = requireString(payload, 'requestId')
      const expectedAccountVersion = requireVersion(payload, 'expectedAccountVersion')
      const submittedLoadoutVersion = payload.expectedLoadoutVersion === undefined
        ? null
        : requireVersion(payload, 'expectedLoadoutVersion')
      const expectedCatalogVersion = payload.expectedCatalogVersion === undefined
        ? ITEM_CATALOG_VERSION
        : requireVersion(payload, 'expectedCatalogVersion')
      if (expectedCatalogVersion !== ITEM_CATALOG_VERSION) {
        return response.status(409).json({ ok: false, code: 'ITEM_CATALOG_VERSION_MISMATCH' })
      }
      const activeSlots = asNullableStringSlots(loadout.activeSlots, 2, 'activeSlots') as unknown as ActiveItemSlots
      const passiveSlots = asNullableStringSlots(loadout.passiveSlots, 6, 'passiveSlots') as unknown as PassiveItemSlots
      const current = await accountService.getOrCreate(principal.playerId)
      const storedReplay = current.idempotencyByRequestId[requestId]
      const storedReplayResult = storedReplay && isRecord(storedReplay.result) ? storedReplay.result : null
      const storedReplayContext = storedReplayResult && isRecord(storedReplayResult.context) ? storedReplayResult.context : null
      // V1 前端可省略道具子版本；服务端仍以外层账户 CAS 防止并发覆盖。
      const expectedLoadoutVersion = submittedLoadoutVersion
        ?? (storedReplayContext && typeof storedReplayContext.expectedLoadoutVersion === 'number'
          ? storedReplayContext.expectedLoadoutVersion
          : current.item.loadout.version)
      if (current.idempotencyByRequestId[requestId]) {
        readStoredSubsystemReplay(current, requestId, 'save_item_payload', expectedAccountVersion, {
          kind: 'item_loadout', expectedLoadoutVersion, activeSlots, passiveSlots,
        })
        return response.json({ ok: true, duplicate: true, account: publicAccount(current) })
      }
      if (current.version !== expectedAccountVersion) {
        throw new AccountDomainError('STALE_ACCOUNT_VERSION', `expected ${expectedAccountVersion}, got ${current.version}`)
      }
      if (current.item.loadout.version !== expectedLoadoutVersion) {
        return response.status(409).json({ ok: false, code: 'ITEM_ACCOUNT_VERSION_MISMATCH', message: 'stale item loadout version' })
      }
      const itemAccount: PlayerItemAccount = {
        playerId: principal.playerId,
        version: current.item.version,
        unlockedActiveItemIds: [...current.item.unlockedActiveItemIds],
        unlockedPassiveItemIds: [...current.item.unlockedPassiveItemIds],
        loadout: structuredClone(current.item.loadout),
      }
      const validationError = validateItemLoadout(itemAccount, activeSlots, passiveSlots)
      if (validationError) return response.status(422).json({ ok: false, code: validationError })
      const now = new Date().toISOString()
      const saved = await accountService.saveItemPayload({
        requestId,
        playerId: principal.playerId,
        expectedAccountVersion,
        idempotencyContext: {
          kind: 'item_loadout',
          expectedLoadoutVersion,
          activeSlots: [...activeSlots],
          passiveSlots: [...passiveSlots],
        },
        payload: {
          ...structuredClone(current.item),
          version: current.item.version + 1,
          loadout: {
            activeSlots: [...activeSlots] as [string | null, string | null],
            passiveSlots: [...passiveSlots] as [string | null, string | null, string | null, string | null, string | null, string | null],
            version: expectedLoadoutVersion + 1,
            updatedAt: now,
          },
        },
      })
      response.json({ ok: true, duplicate: false, account: publicAccount(saved) })
    }
    catch (error) {
      sendAccountError(response, error)
    }
  })

  router.put('/loadouts/weapons/:generalId', async (request, response) => {
    const principal = resolvePrincipal(request, config)
    if (!principal) return rejectUnauthorized(response)
    if (!accountService) return response.status(503).json({ ok: false, code: 'ACCOUNT_SERVICE_UNAVAILABLE' })
    try {
      const payload = isRecord(request.body) ? request.body : {}
      const requestId = requireString(payload, 'requestId')
      const expectedAccountVersion = requireVersion(payload, 'expectedAccountVersion')
      const expectedLoadoutVersion = requireVersion(payload, 'expectedLoadoutVersion')
      const slots = asNullableStringSlots(payload.slots, 2, 'slots') as [string | null, string | null]
      const generalId = request.params.generalId
      const current = await accountService.getOrCreate(principal.playerId)
      if (current.idempotencyByRequestId[requestId]) {
        readStoredSubsystemReplay(current, requestId, 'save_weapon_payload', expectedAccountVersion, {
          kind: 'weapon_loadout', generalId, expectedLoadoutVersion, slots,
        })
        return response.json({ ok: true, duplicate: true, account: publicAccount(current) })
      }
      if (current.version !== expectedAccountVersion) {
        throw new AccountDomainError('STALE_ACCOUNT_VERSION', `expected ${expectedAccountVersion}, got ${current.version}`)
      }
      const oldLoadout = current.weapon.loadoutsByGeneralId[generalId]
      if ((oldLoadout?.version ?? 0) !== expectedLoadoutVersion) {
        throw new WeaponDomainError('STALE_WEAPON_LOADOUT_VERSION', 'stale weapon loadout version')
      }
      const weaponAccount: PlayerWeaponAccount = {
        playerId: principal.playerId,
        version: current.weapon.version,
        fragmentBalances: structuredClone(current.weapon.fragmentBalances),
        unlockedWeaponIds: [...current.weapon.unlockedWeaponIds],
        loadoutsByGeneralId: structuredClone(current.weapon.loadoutsByGeneralId),
      }
      validateWeaponLoadout(weaponAccount, generalId, slots)
      const nextWeapon = structuredClone(current.weapon)
      nextWeapon.version += 1
      nextWeapon.loadoutsByGeneralId[generalId] = {
        slots,
        version: expectedLoadoutVersion + 1,
        updatedAt: new Date().toISOString(),
      }
      const saved = await accountService.saveWeaponPayload({
        requestId,
        playerId: principal.playerId,
        expectedAccountVersion,
        payload: nextWeapon,
        idempotencyContext: { kind: 'weapon_loadout', generalId, expectedLoadoutVersion, slots },
      })
      response.json({ ok: true, duplicate: false, account: publicAccount(saved) })
    }
    catch (error) {
      sendAccountError(response, error)
    }
  })

  router.post('/weapons/:weaponId/craft', async (request, response) => {
    const principal = resolvePrincipal(request, config)
    if (!principal) return rejectUnauthorized(response)
    if (!accountService) return response.status(503).json({ ok: false, code: 'ACCOUNT_SERVICE_UNAVAILABLE' })
    try {
      const payload = isRecord(request.body) ? request.body : {}
      const requestId = requireString(payload, 'requestId')
      const expectedAccountVersion = requireVersion(payload, 'expectedAccountVersion')
      const weaponId = request.params.weaponId
      const definition = getWeaponDefinition(weaponId)
      if (!definition) throw new WeaponDomainError('WEAPON_NOT_FOUND', `Unknown weapon ${weaponId}`)
      const current = await accountService.getOrCreate(principal.playerId)
      if (current.idempotencyByRequestId[requestId]) {
        const replay = readStoredSubsystemReplay(current, requestId, 'save_weapon_payload', expectedAccountVersion, {
          kind: 'craft_weapon', weaponId,
        })
        const storedWeapon = replay && isRecord(replay.payload) ? replay.payload : null
        const storedBalances = storedWeapon && isRecord(storedWeapon.fragmentBalances) ? storedWeapon.fragmentBalances : null
        return response.json({
          ok: true,
          duplicate: true,
          craft: {
            weaponId,
            spentFragments: definition.fragmentRequirement,
            fragmentBalance: storedBalances && typeof storedBalances[weaponId] === 'number'
              ? storedBalances[weaponId]
              : current.weapon.fragmentBalances[weaponId] ?? 0,
          },
          account: publicAccount(current),
        })
      }
      if (current.version !== expectedAccountVersion) {
        throw new AccountDomainError('STALE_ACCOUNT_VERSION', `expected ${expectedAccountVersion}, got ${current.version}`)
      }
      if (current.weapon.unlockedWeaponIds.includes(weaponId)) {
        throw new WeaponDomainError('WEAPON_ALREADY_UNLOCKED', `${weaponId} is already unlocked`)
      }
      const balance = current.weapon.fragmentBalances[weaponId] ?? 0
      if (balance < definition.fragmentRequirement) {
        throw new WeaponDomainError('INSUFFICIENT_FRAGMENTS', `${weaponId} requires ${definition.fragmentRequirement} fragments`)
      }
      const nextWeapon = structuredClone(current.weapon)
      nextWeapon.version += 1
      nextWeapon.fragmentBalances[weaponId] = balance - definition.fragmentRequirement
      nextWeapon.unlockedWeaponIds = [...nextWeapon.unlockedWeaponIds, weaponId].sort()
      const saved = await accountService.saveWeaponPayload({
        requestId,
        playerId: principal.playerId,
        expectedAccountVersion,
        payload: nextWeapon,
        idempotencyContext: { kind: 'craft_weapon', weaponId },
      })
      response.json({
        ok: true,
        duplicate: false,
        craft: {
          weaponId,
          spentFragments: definition.fragmentRequirement,
          fragmentBalance: nextWeapon.fragmentBalances[weaponId],
        },
        account: publicAccount(saved),
      })
    }
    catch (error) {
      sendAccountError(response, error)
    }
  })

  router.post('/shop/offers', async (request, response) => {
    const principal = resolvePrincipal(request, config)
    if (!principal) return rejectUnauthorized(response)
    if (!accountService) return response.status(503).json({ ok: false, code: 'ACCOUNT_SERVICE_UNAVAILABLE' })
    try {
      const payload = isRecord(request.body) ? request.body : {}
      const entitlementId = requireString(payload, 'entitlementId')
      const recentActiveGeneralIds = Array.isArray(payload.recentActiveGeneralIds)
        && payload.recentActiveGeneralIds.every(value => typeof value === 'string')
        ? payload.recentActiveGeneralIds as string[]
        : []
      const offerSet = await accountService.generateFixedOffers({ playerId: principal.playerId, entitlementId, recentActiveGeneralIds })
      response.json({ ok: true, offerSet, offers: offerSet.offers })
    }
    catch (error) {
      sendAccountError(response, error)
    }
  })

  router.post('/shop/purchase', async (request, response) => {
    const principal = resolvePrincipal(request, config)
    if (!principal) return rejectUnauthorized(response)
    if (!accountService) return response.status(503).json({ ok: false, code: 'ACCOUNT_SERVICE_UNAVAILABLE' })
    try {
      const payload = isRecord(request.body) ? request.body : {}
      const purchaseInput = {
        requestId: requireString(payload, 'requestId'),
        playerId: principal.playerId,
        entitlementId: requireString(payload, 'entitlementId'),
        offerId: requireString(payload, 'offerId'),
        expectedAccountVersion: requireVersion(payload, 'expectedAccountVersion'),
      }
      const before = await accountService.getOrCreate(principal.playerId)
      const duplicate = Boolean(before.idempotencyByRequestId[purchaseInput.requestId])
      const receipt = await accountService.purchaseOffer(purchaseInput)
      response.json({ ok: true, duplicate, receipt })
    }
    catch (error) {
      sendAccountError(response, error)
    }
  })

  router.get('/settlements/:matchId', async (request, response) => {
    const principal = resolvePrincipal(request, config)
    if (!principal) return rejectUnauthorized(response)
    if (!accountService) return response.status(503).json({ ok: false, code: 'ACCOUNT_SERVICE_UNAVAILABLE' })
    try {
      const account = await accountService.getOrCreate(principal.playerId)
      const settlement = account.settlementsById[`${request.params.matchId}:${principal.playerId}`]
      if (!settlement) return response.status(404).json({ ok: false, code: 'SETTLEMENT_NOT_FOUND' })
      response.json({ ok: true, settlement })
    }
    catch (error) {
      sendAccountError(response, error)
    }
  })

  router.get('/rooms', (request, response) => {
    const principal = resolvePrincipal(request, config)
    if (!principal) {
      rejectUnauthorized(response)
      return
    }

    const rooms = roomManager
      .listRooms({ includeEmpty: false })
      .map((room) => serializeRoomSummary(room.getSummary()))

    response.json({ ok: true, rooms })
  })

  router.post('/rooms', (request, response) => {
    const principal = resolvePrincipal(request, config)
    if (!principal) {
      rejectUnauthorized(response)
      return
    }

    const payload = isRecord(request.body) ? request.body : {}
    const requestedName = typeof payload.name === 'string' ? payload.name.trim().slice(0, 12) : ''
    const password = typeof payload.password === 'string' ? payload.password : ''
    const roomId = generateRoomId(roomManager)
    const room = roomManager.createRoom(roomId, {
      displayName: requestedName || roomId,
      hasPassword: password.length > 0,
    })

    response.status(201).json({
      ok: true,
      room: serializeRoomSummary(room.getSummary()),
    })
  })

  router.get('/state', (request, response) => {
    const principal = resolvePrincipal(request, config)
    if (!principal) {
      rejectUnauthorized(response)
      return
    }

    response.json({
      ok: true,
      player: {
        playerId: principal.playerId,
        playerName: principal.playerName,
        playerKind: principal.playerKind,
      },
      gameState: projectFrontendGameState(engine.getStateSnapshot(), config),
    })
  })

  router.post('/actions', (request, response) => {
    const principal = resolvePrincipal(request, config)
    if (!principal) {
      rejectUnauthorized(response)
      return
    }

    const submission = submitAction({
      engine,
      limiter,
      player: principal,
      payload: request.body,
    })

    if (!submission.ok) {
      response.status(submission.status).json({
        ok: false,
        code: submission.code,
        message: submission.message,
        retryAfterMs: submission.retryAfterMs,
      })
      return
    }

    response.status(202).json({
      ok: true,
      accepted: true,
      action: submission.action,
      rateLimitRemaining: submission.rateLimitRemaining,
      duplicate: submission.duplicate,
      gameState: projectFrontendGameState(engine.getStateSnapshot(), config),
    })
  })

  router.get('/leaderboard', async (request, response) => {
    const principal = resolvePrincipal(request, config)
    if (!principal) {
      rejectUnauthorized(response)
      return
    }

    const limit = parseLimit(request.query.limit, 10)
    const liveLeaderboards = buildLiveLeaderboards(engine.getStateSnapshot())
    let persistedLeaderboards = null

    if (competitionStore?.isEnabled()) {
      try {
        persistedLeaderboards = await competitionStore.getDualLeaderboards(limit)
      }
      catch (error) {
        logCompetitionStoreFailure('getDualLeaderboards', error)
      }
    }

    let usingPersistedLeaderboards = false
    let leaderboards = liveLeaderboards

    if (persistedLeaderboards) {
      usingPersistedLeaderboards = persistedLeaderboards.all.length > 0
        || persistedLeaderboards.human.length > 0
        || persistedLeaderboards.agent.length > 0

      if (usingPersistedLeaderboards) {
        leaderboards = persistedLeaderboards
      }
    }

    response.json({
      ok: true,
      source: usingPersistedLeaderboards ? 'supabase' : 'memory',
      leaderboards,
    })
  })

  router.get('/replays', async (request, response) => {
    const principal = resolvePrincipal(request, config)
    if (!principal) {
      rejectUnauthorized(response)
      return
    }

    const limit = parseLimit(request.query.limit, 10)
    const currentReplay = replayRecorder.getCurrentReplay()
    let persisted: ReplaySummary[] = []

    if (competitionStore?.isEnabled()) {
      try {
        persisted = await competitionStore.listRecentReplays(limit)
      }
      catch (error) {
        logCompetitionStoreFailure('listRecentReplays', error)
      }
    }

    const summaries = persisted.length > 0
      ? persisted
      : currentReplay
        ? [buildReplaySummary(currentReplay)]
        : []

    response.json({
      ok: true,
      source: persisted.length > 0 ? 'supabase' : 'memory',
      replays: summaries,
    })
  })

  // ── POST /replays — 仅存储胜利录像 ─────────────────────────────────────────
  // 收到失败数据包时，直接丢弃并返回 200 OK，不占用数据库空间。
  router.post('/replays', (request, response) => {
    const principal = resolvePrincipal(request, config)
    if (!principal) {
      rejectUnauthorized(response)
      return
    }

    const body: unknown = request.body
    if (
      typeof body !== 'object'
      || body === null
      || !(body as Record<string, unknown>).isVictory
    ) {
      // 非胜利数据直接丢弃，返回 200 OK
      response.status(200).json({ ok: true, stored: false, reason: 'defeat_discarded' })
      return
    }

    const payload = body as Record<string, unknown>
    const level = typeof payload.level === 'number' ? payload.level : null

    if (level === null || !Number.isFinite(level)) {
      response.status(400).json({ ok: false, code: 'MISSING_LEVEL', message: 'level (number) is required' })
      return
    }

    const playerType: PlayerType = principal.playerKind === 'human' ? 'HUMAN' : 'AGENT'
    const progress = progressStore.recordLevelClear(principal.playerId, level, playerType)

    response.status(201).json({ ok: true, stored: true, progress })
  })

  router.get('/replays/current', async (request, response) => {
    const principal = resolvePrincipal(request, config)
    if (!principal) {
      rejectUnauthorized(response)
      return
    }

    const currentReplay = replayRecorder.getCurrentReplay()
    if (!currentReplay) {
      response.status(404).json({ ok: false, code: 'REPLAY_NOT_FOUND', message: 'No replay available yet' })
      return
    }

    response.json({ ok: true, replay: currentReplay })
  })

  router.get('/replays/:matchId', async (request, response) => {
    const principal = resolvePrincipal(request, config)
    if (!principal) {
      rejectUnauthorized(response)
      return
    }

    const { matchId } = request.params
    const currentReplay = replayRecorder.getCurrentReplay()
    if (currentReplay?.matchId === matchId) {
      response.json({ ok: true, replay: currentReplay })
      return
    }

    let persistedReplay = null

    if (competitionStore?.isEnabled()) {
      try {
        persistedReplay = await competitionStore.getReplay(matchId)
      }
      catch (error) {
        logCompetitionStoreFailure('getReplay', error)
      }
    }

    if (!persistedReplay) {
      response.status(404).json({ ok: false, code: 'REPLAY_NOT_FOUND', message: 'Replay not found' })
      return
    }

    response.json({ ok: true, replay: persistedReplay })
  })

  // ── GET /leaderboard/level5 — Level 5 大师排行榜 ───────────────────────────
  // 只返回 level5ClearCount > 0 的玩家，按通关次数降序，包含名次与硅基/碳基标识。
  router.get('/leaderboard/level5', async (request, response) => {
    const principal = resolvePrincipal(request, config)
    if (!principal) {
      rejectUnauthorized(response)
      return
    }

    const leaderboard = await progressStore.getLevel5LeaderboardAsync()
    response.json({ ok: true, leaderboard })
  })

  // ── GET /progress/:playerId — 查询玩家进度 ────────────────────────────────────
  router.get('/progress/:playerId', (request, response) => {
    const principal = resolvePrincipal(request, config)
    if (!principal) {
      rejectUnauthorized(response)
      return
    }

    const { playerId } = request.params
    const existing = progressStore.getProgress(playerId)
    if (!existing) {
      response.status(404).json({ ok: false, code: 'PROGRESS_NOT_FOUND', message: `No progress record for player ${playerId}` })
      return
    }

    response.json({ ok: true, progress: existing })
  })

  // ── GET /progress/:playerId/unlock/:level — 检查关卡解锁状态 ─────────────────
  router.get('/progress/:playerId/unlock/:level', (request, response) => {
    const principal = resolvePrincipal(request, config)
    if (!principal) {
      rejectUnauthorized(response)
      return
    }

    const targetLevel = Number(request.params.level)
    if (!Number.isFinite(targetLevel)) {
      response.status(400).json({ ok: false, code: 'INVALID_LEVEL', message: 'level must be a valid number' })
      return
    }

    const playerType: PlayerType = principal.playerKind === 'human' ? 'HUMAN' : 'AGENT'
    const progress = progressStore.getOrCreate(request.params.playerId, playerType)
    const result = checkUnlock(progress, targetLevel)

    response.json({ ok: true, targetLevel, ...result })
  })

  return router
}
