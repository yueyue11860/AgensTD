import { Router, type Request, type Response } from 'express'
import { buildLiveLeaderboards, buildReplaySummary } from '../core/competition-projection'
import { projectFrontendGameState } from '../core/state-projection'
import type { ReplayRecorder } from '../core/replay-recorder'
import { GameEngine } from '../core/game-engine'
import type { ServerConfig } from '../config/server-config'
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
    const persistedLeaderboards = competitionStore?.isEnabled()
      ? await competitionStore.getDualLeaderboards(limit)
      : null

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
    const persisted = competitionStore?.isEnabled()
      ? await competitionStore.listRecentReplays(limit)
      : []

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

    const persistedReplay = competitionStore?.isEnabled()
      ? await competitionStore.getReplay(matchId)
      : null

    if (!persistedReplay) {
      response.status(404).json({ ok: false, code: 'REPLAY_NOT_FOUND', message: 'Replay not found' })
      return
    }

    response.json({ ok: true, replay: persistedReplay })
  })

  return router
}