import { Router, type Request, type Response } from 'express'
import { buildLiveLeaderboards, buildReplaySummary } from '../core/competition-projection'
import { projectFrontendGameState } from '../core/state-projection'
import type { ReplayRecorder } from '../core/replay-recorder'
import { GameEngine } from '../core/game-engine'
import type { ServerConfig } from '../config/server-config'
import type { ReplaySummary } from '../domain/competition'
import { submitAction } from './action-submission'
import { ActionRateLimiter } from './action-rate-limiter'
import { authenticateGatewayToken, extractHttpToken } from './gateway-auth'
import type { SupabaseCompetitionStore } from '../data/supabase-competition-store'

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

export function createRestApiRouter(
  engine: GameEngine,
  config: ServerConfig,
  limiter: ActionRateLimiter,
  replayRecorder: ReplayRecorder,
  competitionStore: SupabaseCompetitionStore | null,
) {
  const router = Router()

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

  return router
}