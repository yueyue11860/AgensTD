import { Router, type Request, type Response } from 'express'
import { buildReplaySummary } from '../core/competition-projection'
import { projectFrontendGameState } from '../core/state-projection'
import type { GameEngine } from '../core/game-engine'
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
  engine: GameEngine,
  config: ServerConfig,
  replayRecorder: ReplayRecorder,
  competitionStore: SupabaseCompetitionStore | null,
) {
  const router = Router()

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

    response.write(`event: ready\n`)
    response.write(`data: ${JSON.stringify({ ok: true, playerId: principal.playerId, playerKind: principal.playerKind })}\n\n`)

    response.write(`event: tick_update\n`)
    response.write(`data: ${JSON.stringify(projectFrontendGameState(engine.getStateSnapshot(), config))}\n\n`)

    const unsubscribe = engine.onTick((state) => {
      response.write(`event: tick_update\n`)
      response.write(`data: ${JSON.stringify(projectFrontendGameState(state, config))}\n\n`)
    })

    const heartbeat = setInterval(() => {
      response.write(`event: heartbeat\n`)
      response.write(`data: ${JSON.stringify({ now: new Date().toISOString() })}\n\n`)
    }, 15000)

    request.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
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