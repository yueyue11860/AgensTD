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

export interface ProjectedTickBroadcast {
  patch: GameStatePatch
  uiUpdate: GameUiStateUpdate
  noticeUpdate: GameNoticeUpdate | null
}

export interface ProjectedTickEvent {
  state: GameState
  fullState: FrontendGameState
  broadcast: ProjectedTickBroadcast | null
  shouldSocketBroadcast: boolean
}

type ProjectedTickListener = (event: ProjectedTickEvent) => void

export class ProjectedTickStream {
  private readonly tickListeners = new Set<ProjectedTickListener>()

  private readonly broadcastListeners = new Set<ProjectedTickListener>()

  private readonly broadcastEveryTicks: number

  private latestFullState: FrontendGameState | null = null

  private lastBroadcastState: FrontendGameState | null = null

  constructor(
    private readonly engine: GameEngine,
    private readonly config: ServerConfig,
    private readonly telemetry: PerformanceTelemetry,
  ) {
    this.broadcastEveryTicks = Math.max(1, Math.round(config.broadcastIntervalMs / Math.max(1, config.tickRateMs)))

    this.engine.onTick((state) => {
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

  getCurrentFullState() {
    if (!this.latestFullState) {
      const state = this.engine.getStateSnapshot()
      this.latestFullState = this.telemetry.measure('projection.full', () => projectFrontendGameState(state, this.config))
    }

    this.lastBroadcastState = this.latestFullState
    return this.latestFullState
  }

  private handleTick(state: GameState) {
    const fullState = this.telemetry.measure('projection.full', () => projectFrontendGameState(state, this.config))
    const shouldSocketBroadcast = state.status === 'finished' || state.tick % this.broadcastEveryTicks === 0
    const shouldComputeBroadcast = this.broadcastListeners.size > 0 || shouldSocketBroadcast

    this.latestFullState = fullState

    let broadcast: ProjectedTickBroadcast | null = null
    if (shouldComputeBroadcast) {
      const previousState = this.lastBroadcastState ?? fullState
      const uiUpdate = this.telemetry.measure('projection.ui', () => projectFrontendUiStateUpdate(state, this.config, previousState))
      const noticeUpdate = this.telemetry.measure('projection.notice', () => projectFrontendNoticeUpdate(state, previousState))
      const patch = this.telemetry.measure('projection.patch', () => projectFrontendGameStatePatch(state, this.config, previousState))

      broadcast = {
        patch,
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
    }

    const event: ProjectedTickEvent = {
      state,
      fullState,
      broadcast,
      shouldSocketBroadcast,
    }

    for (const listener of this.tickListeners) {
      listener(event)
    }

    for (const listener of this.broadcastListeners) {
      listener(event)
    }
  }

  private updateListenerGauges() {
    this.telemetry.setGauge('projection.tickListeners', this.tickListeners.size)
    this.telemetry.setGauge('projection.broadcastListeners', this.broadcastListeners.size)
    this.telemetry.setGauge('projection.listeners', this.tickListeners.size + this.broadcastListeners.size)
  }
}

function mergeFrontendGameStatePatch(previousState: FrontendGameState, patch: GameStatePatch) {
  return {
    ...previousState,
    ...patch,
    towers: patch.towers ?? applyEntityDelta(previousState.towers, patch.towerDelta),
    enemies: patch.enemies ?? applyEntityDelta(previousState.enemies, patch.enemyDelta),
    map: patch.map ?? previousState.map,
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