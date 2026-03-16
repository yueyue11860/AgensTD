import { Router, type Request, type Response } from 'express'
import { buildReplaySummary } from '../core/competition-projection'
import { projectFrontendGameState, projectFrontendGameStatePatch, projectFrontendNoticeUpdate, projectFrontendUiStateUpdate } from '../core/state-projection'
import type { GameEngine } from '../core/game-engine'
import type { ReplayRecorder } from '../core/replay-recorder'
import type { ServerConfig } from '../config/server-config'
import type { ReplaySummary } from '../domain/competition'
import type { FrontendGameState } from '../domain/frontend-game-state'
import type { GameNoticeUpdate, GameStatePatch, GameUiStateUpdate } from '../../../shared/contracts/game'
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

    const initialState = projectFrontendGameState(engine.getStateSnapshot(), config)
    let lastStreamState: FrontendGameState | null = initialState

    response.write(`event: tick_update\n`)
    response.write(`data: ${JSON.stringify({ mode: 'full', gameState: initialState })}\n\n`)

    const unsubscribe = engine.onTick((state) => {
      const uiUpdate = projectFrontendUiStateUpdate(state, config, lastStreamState)
      const noticeUpdate = projectFrontendNoticeUpdate(state, lastStreamState)
      const patch = projectFrontendGameStatePatch(state, config, lastStreamState)
      lastStreamState = mergeFrontendNoticeUpdate(
        mergeFrontendUiStateUpdate(
          mergeFrontendGameStatePatch(lastStreamState, patch),
          uiUpdate,
        ),
        noticeUpdate,
      )

      response.write(`event: tick_update\n`)
      response.write(`data: ${JSON.stringify({ mode: 'patch', patch })}\n\n`)

      if (Object.keys(uiUpdate).length > 0) {
        response.write(`event: ui_state_update\n`)
        response.write(`data: ${JSON.stringify(uiUpdate)}\n\n`)
      }

      if (noticeUpdate) {
        response.write(`event: notice_update\n`)
        response.write(`data: ${JSON.stringify(noticeUpdate)}\n\n`)
      }
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

function mergeFrontendGameStatePatch(previousState: FrontendGameState | null, patch: GameStatePatch) {
  if (!previousState) {
    return null
  }

  return {
    ...previousState,
    ...patch,
    towers: patch.towers ?? applyEntityDelta(previousState.towers, patch.towerDelta),
    enemies: patch.enemies ?? applyEntityDelta(previousState.enemies, patch.enemyDelta),
    map: patch.map ?? previousState.map,
  }
}

function mergeFrontendUiStateUpdate(previousState: FrontendGameState | null, update: GameUiStateUpdate) {
  if (!previousState) {
    return null
  }

  return {
    ...previousState,
    buildPalette: update.buildPalette ?? previousState.buildPalette,
    actionBar: update.actionBar ?? previousState.actionBar,
  }
}

function mergeFrontendNoticeUpdate(previousState: FrontendGameState | null, update: GameNoticeUpdate | null) {
  if (!previousState || !update) {
    return previousState
  }

  return {
    ...previousState,
    notices: update.notices,
  }
}

function applyEntityDelta<T extends { id: string }>(currentEntities: T[], delta?: { upsert: T[]; remove: string[] }) {
  if (!delta) {
    return currentEntities
  }

  const removeIds = new Set(delta.remove)
  const upsertById = new Map(delta.upsert.map((entity) => [entity.id, entity]))
  const nextEntities: T[] = []

  for (const entity of currentEntities) {
    if (removeIds.has(entity.id)) {
      continue
    }

    nextEntities.push(upsertById.get(entity.id) ?? entity)
    upsertById.delete(entity.id)
  }

  for (const entity of delta.upsert) {
    if (upsertById.has(entity.id)) {
      nextEntities.push(entity)
      upsertById.delete(entity.id)
    }
  }

  return nextEntities
}