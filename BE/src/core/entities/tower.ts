import type { TowerState, TowerTargetingStrategy } from '../../domain/game-state'
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

  readonly range: number

  readonly damage: number

  readonly fireRateTicks: number

  readonly targetingStrategy: TowerTargetingStrategy

  fireCooldown: number

  constructor(state: TowerState) {
    this.id = state.id
    this.ownerId = state.ownerId
    this.type = state.type
    this.x = state.x
    this.y = state.y
    this.range = state.range
    this.damage = state.damage
    this.fireRateTicks = state.fireRateTicks
    this.fireCooldown = state.cooldownTicks
    this.targetingStrategy = state.targetingStrategy
  }

  fire(enemies: Enemy[]) {
    if (this.fireCooldown > 0) {
      this.fireCooldown -= 1
      return null
    }

    const target = this.findTarget(enemies)
    if (!target) {
      return null
    }

    target.receiveDamage(this.damage, this.ownerId)
    this.fireCooldown = this.fireRateTicks
    return target
  }

  toState(): TowerState {
    return {
      id: this.id,
      ownerId: this.ownerId,
      type: this.type,
      x: this.x,
      y: this.y,
      damage: this.damage,
      range: this.range,
      fireRateTicks: this.fireRateTicks,
      cooldownTicks: this.fireCooldown,
      targetingStrategy: this.targetingStrategy,
    }
  }

  private findTarget(enemies: Enemy[]) {
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
}