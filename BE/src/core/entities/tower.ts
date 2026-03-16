import type { EnemyStatusEffectState, EnemyStatusEffectTemplate, TowerState, TowerTargetingStrategy } from '../../domain/game-state'
import type { TowerBehaviorDefinition, TowerFireRate } from '../../domain/tower-behavior'
import type { TowerRuntimeBehavior, TowerTickContext, TowerTickReport } from '../tower-behaviors'
import { Enemy } from './enemy'

function distanceBetween(tower: Tower, enemy: Enemy) {
  return Math.hypot(enemy.x - tower.x, enemy.y - tower.y)
}

export class Tower {
  readonly id: string

  readonly ownerId: string

  readonly type: string

  readonly x: number

  readonly y: number

  readonly width: number

  readonly height: number

  readonly behaviorKind: TowerState['behaviorKind']

  readonly behavior: TowerBehaviorDefinition

  readonly attackEffects: EnemyStatusEffectTemplate[]

  readonly range: number

  readonly damage: number

  readonly fireRateTicks: TowerFireRate

  readonly targetingStrategy: TowerTargetingStrategy

  fireCooldown: number

  currentTargetId: string | null

  lockTimeMs: number

  incomeProgressMs: number

  private fireRateMultiplier = 1

  private readonly runtimeBehavior: TowerRuntimeBehavior

  constructor(state: TowerState, runtimeBehavior: TowerRuntimeBehavior) {
    this.id = state.id
    this.ownerId = state.ownerId
    this.type = state.type
    this.x = state.x
    this.y = state.y
    this.width = state.width
    this.height = state.height
    this.behaviorKind = state.behaviorKind
    this.behavior = state.behavior
    this.attackEffects = state.attackEffects.map((effect) => ({ ...effect }))
    this.range = state.range
    this.damage = state.damage
    this.fireRateTicks = state.fireRateTicks
    this.fireCooldown = state.cooldownTicks
    this.targetingStrategy = state.targetingStrategy
    this.currentTargetId = state.currentTargetId
    this.lockTimeMs = state.lockTimeMs
    this.incomeProgressMs = state.incomeProgressMs
    this.runtimeBehavior = runtimeBehavior
  }

  beginTick() {
    this.fireRateMultiplier = 1
  }

  getPhase() {
    return this.runtimeBehavior.phase
  }

  tick(context: TowerTickContext): TowerTickReport {
    return this.runtimeBehavior.execute(this, context)
  }

  applyFireRateBuff(multiplier: number) {
    this.fireRateMultiplier *= Math.max(0, multiplier)
  }

  consumeAttackWindow() {
    if (this.fireRateTicks === 'infinite') {
      return true
    }

    if (this.fireCooldown > 0) {
      this.fireCooldown -= this.fireRateMultiplier
      if (this.fireCooldown > 0) {
        return false
      }

      this.fireCooldown = 0
    }

    return true
  }

  completeAttackCycle(targetId: string | null) {
    if (typeof this.fireRateTicks === 'number') {
      this.fireCooldown = this.fireRateTicks
    }

    this.currentTargetId = targetId
  }

  updateLock(targetId: string | null, lockTimeMs: number) {
    this.currentTargetId = targetId
    this.lockTimeMs = lockTimeMs
  }

  resetLock() {
    this.currentTargetId = null
    this.lockTimeMs = 0
  }

  resetLockIfTargetInvalid(enemies: Enemy[]) {
    const trackedTarget = this.currentTargetId
      ? enemies.find((enemy) => enemy.id === this.currentTargetId) ?? null
      : null

    if (!trackedTarget || !trackedTarget.isAlive() || !this.isEnemyInRange(trackedTarget)) {
      this.resetLock()
    }
  }

  getLockStackCount(tickRateMs: number) {
    if (tickRateMs <= 0) {
      return 0
    }

    return this.lockTimeMs / tickRateMs
  }

  toState(): TowerState {
    return {
      id: this.id,
      ownerId: this.ownerId,
      type: this.type,
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
      behaviorKind: this.behaviorKind,
      behavior: this.behavior,
      attackEffects: this.attackEffects.map((effect) => ({ ...effect })),
      damage: this.damage,
      range: this.range,
      fireRateTicks: this.fireRateTicks,
      cooldownTicks: this.fireCooldown,
      targetingStrategy: this.targetingStrategy,
      currentTargetId: this.currentTargetId,
      lockTimeMs: this.lockTimeMs,
      incomeProgressMs: this.incomeProgressMs,
    }
  }

  findTarget(enemies: Enemy[]) {
    let winner: Enemy | null = null

    for (const enemy of enemies) {
      if (!enemy.isAlive() || distanceBetween(this, enemy) > this.range) {
        continue
      }

      if (!winner || this.isBetterTarget(enemy, winner)) {
        winner = enemy
      }
    }

    return winner
  }

  isEnemyInRange(enemy: Enemy) {
    return enemy.isAlive() && distanceBetween(this, enemy) <= this.range
  }

  isTowerInRange(tower: Tower) {
    return Math.abs(tower.x - this.x) <= this.range && Math.abs(tower.y - this.y) <= this.range
  }

  applyAttackEffects(enemy: Enemy) {
    for (const effectTemplate of this.attackEffects) {
      enemy.addEffect(this.createStatusEffect(effectTemplate))
    }
  }

  private isBetterTarget(candidate: Enemy, incumbent: Enemy) {
    switch (this.targetingStrategy) {
      case 'first':
        return candidate.getRemainingPathDistance() < incumbent.getRemainingPathDistance() || (
          candidate.getRemainingPathDistance() === incumbent.getRemainingPathDistance()
          && candidate.hp > incumbent.hp
        )
      case 'strongest':
        return candidate.hp > incumbent.hp || (
          candidate.hp === incumbent.hp
          && candidate.getRemainingPathDistance() < incumbent.getRemainingPathDistance()
        )
      case 'nearest':
      default:
        return distanceBetween(this, candidate) < distanceBetween(this, incumbent)
    }
  }

  private createStatusEffect(effectTemplate: EnemyStatusEffectTemplate): EnemyStatusEffectState {
    return {
      ...effectTemplate,
      id: `${this.id}-${effectTemplate.kind}`,
      sourcePlayerId: this.ownerId,
    }
  }
}