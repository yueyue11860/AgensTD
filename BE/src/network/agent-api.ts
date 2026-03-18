import { Router, type Request, type Response } from 'express'
import { buildReplaySummary } from '../core/competition-projection'
import type { PerformanceTelemetry } from '../core/performance-telemetry'
import type { ProjectedTickStream } from '../core/projected-tick-stream'
import type { ReplayRecorder } from '../core/replay-recorder'
import type { ServerConfig } from '../config/server-config'
import type { ReplaySummary } from '../domain/competition'
import { authenticateGatewayToken, extractHttpToken } from './gateway-auth'
import type { SupabaseCompetitionStore } from '../data/supabase-competition-store'

function resolveAgentPrincipal(request: Request, config: ServerConfig) {
  const principal = authenticateGatewayToken(config, extractHttpToken(request))
  if (!principal || principal.playerKind !== 'agent') {
    return null
  }

  return principal
}

function rejectAgentUnauthorized(response: Response) {
  response.status(403).json({ ok: false, code: 'FORBIDDEN', message: 'Agent token required' })
}

function logCompetitionStoreFailure(operation: string, error: unknown) {
  const details = error instanceof Error ? error.message : String(error)
  console.error(`Competition store ${operation} failed for agent API; falling back to memory: ${details}`)
}

export function createAgentApiRouter(
  projectedTickStream: ProjectedTickStream,
  config: ServerConfig,
  replayRecorder: ReplayRecorder,
  competitionStore: SupabaseCompetitionStore | null,
  telemetry: PerformanceTelemetry,
) {
  const router = Router()
  const sseConnections = new Set<Response>()

  router.get('/stream', (request, response) => {
    const principal = resolveAgentPrincipal(request, config)
    if (!principal) {
      rejectAgentUnauthorized(response)
      return
    }

    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    writeSseEvent(telemetry, 'agent.sse.ready', response, 'ready', {
      ok: true,
      playerId: principal.playerId,
      playerKind: principal.playerKind,
    })

    sseConnections.add(response)
    telemetry.setGauge('agent.sse.connections', sseConnections.size)

    writeSseEvent(telemetry, 'agent.sse.TICK_UPDATE.full', response, 'TICK_UPDATE', {
      mode: 'full',
      gameState: projectedTickStream.getCurrentFullState(),
    })

    const unsubscribe = projectedTickStream.subscribeBroadcast((event) => {
      if (!event.broadcast) {
        return
      }

      writeSseEvent(telemetry, 'agent.sse.TICK_UPDATE.patch', response, 'TICK_UPDATE', {
        mode: 'patch',
        patch: event.broadcast.patch,
      })

      if (Object.keys(event.broadcast.uiUpdate).length > 0) {
        writeSseEvent(telemetry, 'agent.sse.UI_STATE_UPDATE', response, 'UI_STATE_UPDATE', event.broadcast.uiUpdate)
      }

      if (event.broadcast.noticeUpdate) {
        writeSseEvent(telemetry, 'agent.sse.NOTICE_UPDATE', response, 'NOTICE_UPDATE', event.broadcast.noticeUpdate)
      }
    })

    const heartbeat = setInterval(() => {
      writeSseEvent(telemetry, 'agent.sse.heartbeat', response, 'heartbeat', {
        now: new Date().toISOString(),
      })
    }, 15000)

    request.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
      sseConnections.delete(response)
      telemetry.setGauge('agent.sse.connections', sseConnections.size)
      response.end()
    })
  })

  router.get('/replays/current', (request, response) => {
    const principal = resolveAgentPrincipal(request, config)
    if (!principal) {
      rejectAgentUnauthorized(response)
      return
    }

    const replay = replayRecorder.getCurrentReplay()
    if (!replay) {
      response.status(404).json({ ok: false, code: 'REPLAY_NOT_FOUND', message: 'No replay available yet' })
      return
    }

    response.json({
      ok: true,
      replay,
    })
  })

  router.get('/replays', async (request, response) => {
    const principal = resolveAgentPrincipal(request, config)
    if (!principal) {
      rejectAgentUnauthorized(response)
      return
    }

    let persistedReplays: ReplaySummary[] = []

    if (competitionStore?.isEnabled()) {
      try {
        persistedReplays = await competitionStore.listRecentReplays(20)
      }
      catch (error) {
        logCompetitionStoreFailure('listRecentReplays', error)
      }
    }

    if (persistedReplays.length > 0) {
      response.json({ ok: true, replays: persistedReplays })
      return
    }

    const currentReplay = replayRecorder.getCurrentReplay()
    response.json({
      ok: true,
      replays: currentReplay ? [buildReplaySummary(currentReplay)] : [],
    })
  })

  router.get('/replays/:matchId', async (request, response) => {
    const principal = resolveAgentPrincipal(request, config)
    if (!principal) {
      rejectAgentUnauthorized(response)
      return
    }

    const currentReplay = replayRecorder.getCurrentReplay()
    if (currentReplay?.matchId === request.params.matchId) {
      response.json({ ok: true, replay: currentReplay })
      return
    }

    let persistedReplay = null

    if (competitionStore?.isEnabled()) {
      try {
        persistedReplay = await competitionStore.getReplay(request.params.matchId)
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

  return router
}

function writeSseEvent(
  telemetry: PerformanceTelemetry,
  metricName: string,
  response: Response,
  eventName: string,
  payload: unknown,
) {
  response.write(`event: ${eventName}\n`)
  response.write(`data: ${JSON.stringify(payload)}\n\n`)

  const payloadBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8')
  telemetry.incrementCounter(`${metricName}.messages`, 1)
  telemetry.incrementCounter(`${metricName}.bytes`, payloadBytes)
  telemetry.setGauge(`${metricName}.lastPayloadBytes`, payloadBytes)
}