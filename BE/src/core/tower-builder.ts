import type { TowerState } from '../domain/game-state'
import type { TowerCatalogEntry, TowerKind, TowerLevel } from '../domain/tower-catalog'
import { getNextTowerCatalogEntryById, getTowerCatalogEntry, parseTowerCatalogSelection } from '../domain/tower-catalog'
import { Tower } from './entities/tower'
import { TowerFactory } from './tower-factory'

interface TowerPlacementOptions {
  ownerId: string
  x: number
  y: number
  tick: number
  sequence: number
}

export class TowerBuilder {
  static getConfig(kind: TowerKind, level: TowerLevel) {
    return getTowerCatalogEntry(kind, level)
  }

  static getConfigBySelection(selection: string) {
    return parseTowerCatalogSelection(selection)
  }

  static getNextConfigBySelection(selection: string) {
    return getNextTowerCatalogEntryById(selection)
  }

  static createState(kind: TowerKind, level: TowerLevel, options: TowerPlacementOptions): TowerState | null {
    const config = this.getConfig(kind, level)
    if (!config) {
      return null
    }

    return this.createStateFromConfig(config, options)
  }

  static createFromSelection(selection: string, options: TowerPlacementOptions) {
    const config = this.getConfigBySelection(selection)
    if (!config) {
      return null
    }

    const state = this.createStateFromConfig(config, options)
    return {
      config,
      state,
      tower: TowerFactory.create(state),
    }
  }

  static upgradeTower(currentTower: Tower, nextConfig: TowerCatalogEntry) {
    const currentState = currentTower.toState()
    const nextState: TowerState = {
      ...currentState,
      type: nextConfig.type,
      width: nextConfig.width,
      height: nextConfig.height,
      behaviorKind: nextConfig.behavior.kind,
      behavior: nextConfig.behavior,
      attackEffects: nextConfig.attackEffects.map((effect) => ({ ...effect })),
      damage: nextConfig.damage,
      range: nextConfig.range,
      fireRateTicks: nextConfig.fireRateTicks,
      cooldownTicks: typeof nextConfig.fireRateTicks === 'number'
        ? Math.min(currentState.cooldownTicks, nextConfig.fireRateTicks)
        : 0,
      targetingStrategy: nextConfig.targetingStrategy,
      currentTargetId: nextConfig.behavior.kind === 'beam' ? currentState.currentTargetId : null,
      lockTimeMs: nextConfig.behavior.kind === 'beam' ? currentState.lockTimeMs : 0,
      incomeProgressMs: nextConfig.behavior.kind === 'economy' ? currentState.incomeProgressMs : 0,
    }

    return {
      config: nextConfig,
      state: nextState,
      tower: TowerFactory.create(nextState),
    }
  }

  private static createStateFromConfig(config: TowerCatalogEntry, options: TowerPlacementOptions): TowerState {
    return {
      id: `tower-${options.tick}-${options.sequence}`,
      ownerId: options.ownerId,
      type: config.type,
      x: options.x,
      y: options.y,
      width: config.width,
      height: config.height,
      behaviorKind: config.behavior.kind,
      behavior: config.behavior,
      attackEffects: config.attackEffects.map((effect) => ({ ...effect })),
      damage: config.damage,
      range: config.range,
      fireRateTicks: config.fireRateTicks,
      cooldownTicks: 0,
      targetingStrategy: config.targetingStrategy,
      currentTargetId: null,
      lockTimeMs: 0,
      incomeProgressMs: 0,
    }
  }
}