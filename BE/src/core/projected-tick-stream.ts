import type { GameEngine } from './game-engine'
import type { PerformanceTelemetry } from './performance-telemetry'
import {
  projectFrontendGameState,
  projectFrontendGameStatePatch,
  projectFrontendNoticeUpdate,
  projectFrontendUiStateUpdate,
} from './state-projection'
import type { ServerConfig } from '../config/server-config'
import type { FrontendGameState } from '../domain/frontend-game-state'
import type { GameState } from '../domain/game-state'
import type { GameNoticeUpdate, GameStatePatch, GameUiStateUpdate } from '../../../shared/contracts/game'
import type { CombatEventBatch } from '../../../shared/contracts/game'
import { applyPveDeltaToGameState } from '../../../shared/contracts/pve-state-delta'
import { CombatEventJournal } from './combat-event-journal'

export interface ProjectedTickBroadcast {
  patch: GameStatePatch
  legacyPatch: GameStatePatch
  checkpoint: GameStatePatch
  combatEventBatch: CombatEventBatch | null
  baseRevision: number
  uiUpdate: GameUiStateUpdate
  noticeUpdate: GameNoticeUpdate | null
}

export interface ProjectedTickEvent {
  state: GameState
  fullState: FrontendGameState
  broadcast: ProjectedTickBroadcast | null
  shouldSocketBroadcast: boolean
  shouldFullSnapshot: boolean
}

type ProjectedTickListener = (event: ProjectedTickEvent) => void

export class ProjectedTickStream {
  private readonly tickListeners = new Set<ProjectedTickListener>()

  private readonly broadcastListeners = new Set<ProjectedTickListener>()

  private readonly broadcastEveryTicks: number

  private readonly fullSnapshotEveryTicks: number

  private latestFullState: FrontendGameState | null = null

  private lastBroadcastState: FrontendGameState | null = null

  private lastStatus: GameState['status'] | null = null

  private readonly combatEventJournal = new CombatEventJournal()

  private readonly unsubscribeEngineTick: () => void

  constructor(
    private readonly engine: GameEngine,
    private readonly config: ServerConfig,
    private readonly telemetry: PerformanceTelemetry,
  ) {
    this.broadcastEveryTicks = Math.max(1, Math.round(config.broadcastIntervalMs / Math.max(1, config.tickRateMs)))
    const fullSnapshotEveryBroadcasts = Math.max(
      1,
      Math.round(config.fullSnapshotIntervalMs / Math.max(1, config.broadcastIntervalMs)),
    )
    this.fullSnapshotEveryTicks = this.broadcastEveryTicks * fullSnapshotEveryBroadcasts

    this.unsubscribeEngineTick = this.engine.onTick((state) => {
      this.handleTick(state)
    }, { label: 'projected-tick-stream' })
  }

  subscribeTick(listener: ProjectedTickListener) {
    this.tickListeners.add(listener)
    this.updateListenerGauges()

    return () => {
      this.tickListeners.delete(listener)
      this.updateListenerGauges()
    }
  }

  subscribeBroadcast(listener: ProjectedTickListener) {
    this.broadcastListeners.add(listener)
    this.updateListenerGauges()

    return () => {
      this.broadcastListeners.delete(listener)
      this.updateListenerGauges()
    }
  }

  getCurrentFullState(options?: { initializeBroadcastBaseline?: boolean }) {
    if (!this.latestFullState) {
      const state = this.engine.getStateSnapshot()
      this.latestFullState = this.telemetry.measure('projection.full', () => projectFrontendGameState(state, this.config))
    }

    if (options?.initializeBroadcastBaseline && !this.lastBroadcastState) {
      this.lastBroadcastState = this.latestFullState
      this.baselineCombatEvents(this.latestFullState)
    }

    return this.latestFullState
  }

  getPresentationCursor() {
    return this.combatEventJournal.cursor()
  }

  getCombatEventBatchAfter(fromSeq: number) {
    return this.combatEventJournal.replayFrom(fromSeq)
  }

  dispose() {
    this.unsubscribeEngineTick()
    this.tickListeners.clear()
    this.broadcastListeners.clear()
    this.updateListenerGauges()
  }

  private handleTick(state: GameState) {
    const justFinished = state.status === 'finished' && this.lastStatus !== 'finished'
    const shouldSocketBroadcast = justFinished || state.tick % this.broadcastEveryTicks === 0
    const shouldNotifyTickListeners = this.tickListeners.size > 0
    this.lastStatus = state.status

    if (!shouldSocketBroadcast && !shouldNotifyTickListeners) {
      return
    }

    const fullState = this.telemetry.measure('projection.full', () => projectFrontendGameState(state, this.config))
    const shouldFullSnapshot = this.lastBroadcastState === null
      || justFinished
      || state.tick % this.fullSnapshotEveryTicks === 0

    this.latestFullState = fullState

    let broadcast: ProjectedTickBroadcast | null = null
    if (shouldSocketBroadcast) {
      const previousState = this.lastBroadcastState ?? fullState
      const uiUpdate = this.telemetry.measure('projection.ui', () => projectFrontendUiStateUpdate(state, this.config, previousState))
      const noticeUpdate = this.telemetry.measure('projection.notice', () => projectFrontendNoticeUpdate(state, previousState))
      const patch = this.telemetry.measure('projection.patch', () => projectFrontendGameStatePatch(state, this.config, previousState))
      this.observeCombatEvents(fullState)

      broadcast = {
        patch,
        legacyPatch: createLegacyPatch(patch, fullState),
        checkpoint: createCheckpointPatch(fullState),
        combatEventBatch: this.combatEventJournal.drain(),
        baseRevision: previousState.tick,
        uiUpdate,
        noticeUpdate,
      }

      this.lastBroadcastState = mergeFrontendNoticeUpdate(
        mergeFrontendUiStateUpdate(
          mergeFrontendGameStatePatch(previousState, patch),
          uiUpdate,
        ),
        noticeUpdate,
      )

      if (shouldFullSnapshot) {
        this.lastBroadcastState = fullState
      }
    }

    const event: ProjectedTickEvent = {
      state,
      fullState,
      broadcast,
      shouldSocketBroadcast,
      shouldFullSnapshot,
    }

    for (const listener of this.tickListeners) {
      listener(event)
    }

    if (shouldSocketBroadcast) {
      for (const listener of this.broadcastListeners) {
        listener(event)
      }
    }
  }

  private updateListenerGauges() {
    this.telemetry.setGauge('projection.tickListeners', this.tickListeners.size)
    this.telemetry.setGauge('projection.broadcastListeners', this.broadcastListeners.size)
    this.telemetry.setGauge('projection.listeners', this.tickListeners.size + this.broadcastListeners.size)
  }

  private baselineCombatEvents(state: FrontendGameState) {
    if (state.matchId && state.pve) this.combatEventJournal.baseline(state.matchId, state.pve.recentEvents)
  }

  private observeCombatEvents(state: FrontendGameState) {
    if (state.matchId && state.pve) this.combatEventJournal.observe(state.matchId, state.pve.recentEvents)
  }
}

function createLegacyPatch(patch: GameStatePatch, state: FrontendGameState): GameStatePatch {
  if (!patch.pvePatch) return patch
  const { pvePatch: _pvePatch, ...legacyPatch } = patch
  return { ...legacyPatch, pve: state.pve }
}

function createCheckpointPatch(state: FrontendGameState): GameStatePatch {
  return {
    tick: state.tick,
    status: state.status,
    result: state.result,
    resources: state.resources,
    room: state.room,
    towers: state.towers,
    enemies: state.enemies,
    wave: state.wave,
    score: state.score,
    updatedAt: state.updatedAt,
    pve: state.pve,
  }
}

function mergeFrontendGameStatePatch(previousState: FrontendGameState, patch: GameStatePatch) {
  return {
    ...previousState,
    ...patch,
    towers: patch.towers ?? applyEntityDelta(previousState.towers, patch.towerDelta),
    enemies: patch.enemies ?? applyEntityDelta(previousState.enemies, patch.enemyDelta),
    map: patch.map ?? previousState.map,
    pve: applyPveDeltaToGameState(previousState, patch),
  }
}

function mergeFrontendUiStateUpdate(previousState: FrontendGameState, update: GameUiStateUpdate) {
  return {
    ...previousState,
    buildPalette: update.buildPalette ?? previousState.buildPalette,
    actionBar: update.actionBar ?? previousState.actionBar,
  }
}

function mergeFrontendNoticeUpdate(previousState: FrontendGameState, update: GameNoticeUpdate | null) {
  if (!update) {
    return previousState
  }

  return {
    ...previousState,
    notices: update.notices,
  }
}

function applyEntityDelta<T extends { id: string }>(currentEntities: T[], delta?: { upsert: T[]; remove: string[] }) {
  if (!delta || (delta.upsert.length === 0 && delta.remove.length === 0)) {
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
