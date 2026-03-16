import type { GameEngine } from './game-engine'
import { buildMatchResults, buildReplaySummary } from './competition-projection'
import { projectFrontendGameState } from './state-projection'
import type { ServerConfig } from '../config/server-config'
import type { MatchReplay, ReplayActionRecord, ReplayFrame } from '../domain/replay'
import type { QueuedAction } from '../domain/actions'
import type { SupabaseCompetitionStore } from '../data/supabase-competition-store'

export class ReplayRecorder {
  private replay: MatchReplay | null = null

  private isPersisting = false

  private hasLoggedPersistenceFailure = false

  constructor(
    engine: GameEngine,
    private readonly config: ServerConfig,
    private readonly store: SupabaseCompetitionStore | null = null,
    private readonly maxFrames: number = config.replayMaxFrames,
    private readonly maxActions: number = config.replayMaxActions,
  ) {
    engine.onTick((state) => {
      this.recordFrame({
        tick: state.tick,
        recordedAt: new Date().toISOString(),
        gameState: projectFrontendGameState(state, this.config),
      })

      if (state.tick > 0 && state.tick % this.config.persistenceFlushEveryTicks === 0) {
        void this.flush(state).catch((error: unknown) => {
          this.logPersistenceFailure('periodic flush', error)
        })
      }
    })

    engine.onActionQueued((queuedAction) => {
      this.recordAction({
        id: queuedAction.id,
        receivedAt: queuedAction.receivedAt,
        player: queuedAction.player,
        action: queuedAction.action,
      })
    })
  }

  getCurrentReplay() {
    return this.replay ? structuredClone(this.replay) : null
  }

  async flushLatest() {
    if (!this.store?.isEnabled()) {
      return
    }

    const replay = this.getCurrentReplay()
    if (!replay) {
      return
    }

    await this.flushReplay(replay)
  }

  private ensureReplay(matchId: string) {
    if (!this.replay || this.replay.matchId !== matchId) {
      const now = new Date().toISOString()
      this.replay = {
        matchId,
        createdAt: now,
        updatedAt: now,
        actions: [],
        frames: [],
      }
    }

    return this.replay
  }

  private recordFrame(frame: ReplayFrame) {
    const replay = this.ensureReplay(frame.gameState.matchId ?? 'unknown-match')
    replay.frames.push(frame)
    replay.frames = replay.frames.slice(-this.maxFrames)
    replay.updatedAt = frame.recordedAt
  }

  private recordAction(action: ReplayActionRecord) {
    const replay = this.ensureReplay(this.config.matchId)
    replay.actions.push(action)
    replay.actions = replay.actions.slice(-this.maxActions)
    replay.updatedAt = new Date(action.receivedAt).toISOString()
  }

  private async flush(state: Parameters<GameEngine['onTick']>[0] extends (state: infer State) => void ? State : never) {
    if (!this.store?.isEnabled() || this.isPersisting) {
      return
    }

    const replay = this.getCurrentReplay()
    if (!replay) {
      return
    }

    this.isPersisting = true
    try {
      await this.flushReplay(replay)
      await this.store.persistMatchResults(buildMatchResults(state, this.config))
      this.hasLoggedPersistenceFailure = false
    }
    finally {
      this.isPersisting = false
    }
  }

  private async flushReplay(replay: MatchReplay) {
    if (!this.store?.isEnabled()) {
      return
    }

    await this.store.upsertReplay(replay, buildReplaySummary(replay))
  }

  private logPersistenceFailure(operation: string, error: unknown) {
    const details = error instanceof Error ? error.message : String(error)

    if (this.hasLoggedPersistenceFailure) {
      return
    }

    this.hasLoggedPersistenceFailure = true
    console.error(`Replay persistence ${operation} failed; continuing without persisted sync: ${details}`)
  }
}
