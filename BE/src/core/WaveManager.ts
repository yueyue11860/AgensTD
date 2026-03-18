export type WaveManagerState = 'PREP' | 'SPAWNING' | 'CLEARING'
import type { WaveConfig } from '../../../shared/contracts/game'

export interface WaveManagerCallbacks {
  onSpawn: (enemyType: string) => void
  isMapClear: () => boolean
  onVictory?: () => void
}

export interface WaveManagerSnapshot {
  state: WaveManagerState
  currentWaveIndex: number
  currentWave: WaveConfig | null
  timer: number
  remainingSpawns: number
  victoryTriggered: boolean
  spawnMultiplier: number
}

interface SpawnGroupRuntimeState {
  spawnedCount: number
  lastSpawnTick: number | null
}

export class WaveManager {
  public state: WaveManagerState = 'PREP'

  public currentWaveIndex = 0

  public timer = 0

  private readonly waves: readonly WaveConfig[]

  private readonly callbacks: WaveManagerCallbacks

  private groupRuntime: SpawnGroupRuntimeState[] = []

  private currentWaveTick = 0

  private currentWaveElapsedTicks = 0

  private victoryTriggered = false

  private spawnMultiplier = 1

  constructor(waves: readonly WaveConfig[], callbacks: WaveManagerCallbacks, options?: { spawnMultiplier?: number }) {
    this.waves = waves
    this.callbacks = callbacks
    this.spawnMultiplier = this.normalizeSpawnMultiplier(options?.spawnMultiplier ?? 1)

    if (this.waves.length === 0) {
      this.triggerVictoryOnce()
      return
    }

    this.enterPrepStateForCurrentWave()
  }

  update() {
    if (this.victoryTriggered) {
      return
    }

    if (this.waves.length === 0) {
      this.triggerVictoryOnce()
      return
    }

    switch (this.state) {
      case 'PREP':
        this.updatePrepState()
        return
      case 'SPAWNING':
        this.updateSpawningState()
        return
      case 'CLEARING':
        this.updateClearingState()
        return
    }
  }

  getCurrentWave(): WaveConfig | null {
    if (this.currentWaveIndex < 0 || this.currentWaveIndex >= this.waves.length) {
      return null
    }

    return this.waves[this.currentWaveIndex]
  }

  getCurrentWaveElapsedTicks() {
    return this.currentWaveElapsedTicks
  }

  getRemainingSpawns() {
    const wave = this.getCurrentWave()
    if (!wave) {
      return 0
    }

    return wave.groups.reduce((total, group, groupIndex) => {
      const runtime = this.groupRuntime[groupIndex]
      const spawnedCount = runtime?.spawnedCount ?? 0
      return total + Math.max(0, this.getTargetSpawnCount(group.count) - spawnedCount)
    }, 0)
  }

  setSpawnMultiplier(spawnMultiplier: number) {
    this.spawnMultiplier = this.normalizeSpawnMultiplier(spawnMultiplier)
  }

  getSnapshot(): WaveManagerSnapshot {
    return {
      state: this.state,
      currentWaveIndex: this.currentWaveIndex,
      currentWave: this.getCurrentWave(),
      timer: this.timer,
      remainingSpawns: this.getRemainingSpawns(),
      victoryTriggered: this.victoryTriggered,
      spawnMultiplier: this.spawnMultiplier,
    }
  }

  private updatePrepState() {
    if (this.timer > 0) {
      this.timer -= 1
    }

    this.currentWaveElapsedTicks += 1

    if (this.timer <= 0) {
      this.enterSpawningState()
    }
  }

  private updateSpawningState() {
    const wave = this.getCurrentWave()
    if (!wave) {
      this.triggerVictoryOnce()
      return
    }

    for (let groupIndex = 0; groupIndex < wave.groups.length; groupIndex += 1) {
      const group = wave.groups[groupIndex]
      const runtime = this.groupRuntime[groupIndex]
      const targetSpawnCount = this.getTargetSpawnCount(group.count)

      if (runtime.spawnedCount >= targetSpawnCount) {
        continue
      }

      if (this.currentWaveTick < group.delay) {
        continue
      }

      const canSpawnNext =
        runtime.lastSpawnTick === null || this.currentWaveTick - runtime.lastSpawnTick >= group.interval

      if (!canSpawnNext) {
        continue
      }

      this.callbacks.onSpawn(group.enemyType)
      runtime.spawnedCount += 1
      runtime.lastSpawnTick = this.currentWaveTick
    }

    this.currentWaveElapsedTicks += 1

    if (this.areAllGroupsCompleted(wave)) {
      const hasNextWave = this.currentWaveIndex + 1 < this.waves.length
      if (!hasNextWave) {
        // 最后一波出完，进入清场模式等待場上怪物全部消灯再判定胜利
        this.state = 'CLEARING'
        return
      }

      this.currentWaveIndex += 1
      this.enterPrepStateForCurrentWave()
      return
    }

    this.currentWaveTick += 1
  }

  private areAllGroupsCompleted(wave: WaveConfig) {
    for (let groupIndex = 0; groupIndex < wave.groups.length; groupIndex += 1) {
      const runtime = this.groupRuntime[groupIndex]
      const group = wave.groups[groupIndex]
      if (runtime.spawnedCount < this.getTargetSpawnCount(group.count)) {
        return false
      }
    }

    return true
  }

  private updateClearingState() {
    if (this.callbacks.isMapClear()) {
      this.triggerVictoryOnce()
    }
  }

  private enterPrepStateForCurrentWave() {
    const wave = this.getCurrentWave()
    this.state = 'PREP'
    this.timer = wave?.prepTime ?? 0
    this.currentWaveTick = 0
    this.currentWaveElapsedTicks = 0
    this.groupRuntime = []
  }

  private enterSpawningState() {
    const wave = this.getCurrentWave()
    this.state = 'SPAWNING'
    this.timer = 0
    this.currentWaveTick = 0

    this.groupRuntime = (wave?.groups ?? []).map(() => ({
      spawnedCount: 0,
      lastSpawnTick: null,
    }))
  }

  private triggerVictoryOnce() {
    if (this.victoryTriggered) {
      return
    }

    this.victoryTriggered = true
    this.callbacks.onVictory?.()
  }

  private getTargetSpawnCount(baseCount: number) {
    return Math.max(1, Math.ceil(baseCount * this.spawnMultiplier))
  }

  private normalizeSpawnMultiplier(spawnMultiplier: number) {
    if (!Number.isFinite(spawnMultiplier) || spawnMultiplier <= 0) {
      return 1
    }

    return spawnMultiplier
  }
}
