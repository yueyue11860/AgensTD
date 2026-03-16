import type { TowerBehaviorDefinition } from '../domain/tower-behavior'
import { Enemy } from './entities/enemy'
import type { Tower } from './entities/tower'

export interface TowerAttackReport {
  enemyId: string
  damage: number
  mode: 'single-target' | 'aoe-primary' | 'aoe-splash' | 'beam'
}

export interface TowerTickReport {
  attacks: TowerAttackReport[]
  buffedTowerIds: string[]
  grantedGold: number
}

export interface TowerTickContext {
  enemies: Enemy[]
  towers: Tower[]
  tickRateMs: number
}

export interface TowerRuntimeBehavior {
  readonly phase: 'support' | 'action'
  execute(tower: Tower, context: TowerTickContext): TowerTickReport
}

function createEmptyReport(): TowerTickReport {
  return {
    attacks: [],
    buffedTowerIds: [],
    grantedGold: 0,
  }
}

function findTrackedTarget(tower: Tower, enemies: Enemy[]) {
  if (!tower.currentTargetId) {
    return null
  }

  return enemies.find((enemy) => enemy.id === tower.currentTargetId) ?? null
}

function isInSplashArea(primaryTarget: Enemy, candidate: Enemy, splashRadius: number) {
  return Math.abs(candidate.x - primaryTarget.x) <= splashRadius
    && Math.abs(candidate.y - primaryTarget.y) <= splashRadius
}

class SingleTargetTowerBehavior implements TowerRuntimeBehavior {
  readonly phase = 'action' as const

  execute(tower: Tower, context: TowerTickContext) {
    const report = createEmptyReport()
    if (!tower.consumeAttackWindow()) {
      return report
    }

    const target = tower.findTarget(context.enemies)
    if (!target) {
      return report
    }

    const appliedDamage = target.receiveDamage(tower.damage, tower.ownerId)
    tower.applyAttackEffects(target)
    tower.completeAttackCycle(target.id)
    report.attacks.push({
      enemyId: target.id,
      damage: appliedDamage,
      mode: 'single-target',
    })
    return report
  }
}

class AoeTowerBehavior implements TowerRuntimeBehavior {
  readonly phase = 'action' as const

  constructor(private readonly splashRadius: number, private readonly splashDamageRatio: number) {}

  execute(tower: Tower, context: TowerTickContext) {
    const report = createEmptyReport()
    if (!tower.consumeAttackWindow()) {
      return report
    }

    const primaryTarget = tower.findTarget(context.enemies)
    if (!primaryTarget) {
      return report
    }

    report.attacks.push({
      enemyId: primaryTarget.id,
      damage: primaryTarget.receiveDamage(tower.damage, tower.ownerId),
      mode: 'aoe-primary',
    })
    tower.applyAttackEffects(primaryTarget)

    for (const enemy of context.enemies) {
      if (!enemy.isAlive() || enemy.id === primaryTarget.id || !isInSplashArea(primaryTarget, enemy, this.splashRadius)) {
        continue
      }

      report.attacks.push({
        enemyId: enemy.id,
        damage: enemy.receiveDamage(tower.damage * this.splashDamageRatio, tower.ownerId),
        mode: 'aoe-splash',
      })
      tower.applyAttackEffects(enemy)
    }

    tower.completeAttackCycle(primaryTarget.id)
    return report
  }
}

class BeamTowerBehavior implements TowerRuntimeBehavior {
  readonly phase = 'action' as const

  constructor(private readonly lockBonusPerTick: number, private readonly maxLockBonus: number) {}

  execute(tower: Tower, context: TowerTickContext) {
    const report = createEmptyReport()
    if (!tower.consumeAttackWindow()) {
      tower.resetLockIfTargetInvalid(context.enemies)
      return report
    }

    const trackedTarget = findTrackedTarget(tower, context.enemies)
    const target = trackedTarget && tower.isEnemyInRange(trackedTarget)
      ? trackedTarget
      : tower.findTarget(context.enemies)

    if (!target) {
      tower.resetLock()
      return report
    }

    const isContinuingLock = tower.currentTargetId === target.id
    const lockBonus = isContinuingLock
      ? Math.min(this.maxLockBonus, tower.getLockStackCount(context.tickRateMs) * this.lockBonusPerTick)
      : 0

    report.attacks.push({
      enemyId: target.id,
      damage: target.receiveDamage(tower.damage * (1 + lockBonus), tower.ownerId),
      mode: 'beam',
    })
    tower.applyAttackEffects(target)

    tower.completeAttackCycle(target.id)
    tower.updateLock(target.id, isContinuingLock ? tower.lockTimeMs + context.tickRateMs : 0)
    return report
  }
}

class AuraTowerBehavior implements TowerRuntimeBehavior {
  readonly phase = 'support' as const

  constructor(private readonly fireRateBoostRatio: number) {}

  execute(tower: Tower, context: TowerTickContext) {
    const report = createEmptyReport()

    for (const allyTower of context.towers) {
      if (allyTower.id === tower.id || allyTower.ownerId !== tower.ownerId || !tower.isTowerInRange(allyTower)) {
        continue
      }

      allyTower.applyFireRateBuff(1 + this.fireRateBoostRatio)
      report.buffedTowerIds.push(allyTower.id)
    }

    return report
  }
}

class EconomyTowerBehavior implements TowerRuntimeBehavior {
  readonly phase = 'action' as const

  constructor(private readonly intervalMs: number, private readonly goldPerCycle: number) {}

  execute(tower: Tower, context: TowerTickContext) {
    const report = createEmptyReport()
    const nextProgress = tower.incomeProgressMs + context.tickRateMs
    const completedCycles = Math.floor(nextProgress / this.intervalMs)

    tower.incomeProgressMs = nextProgress % this.intervalMs
    if (completedCycles > 0) {
      report.grantedGold = completedCycles * this.goldPerCycle
    }

    return report
  }
}

export function createTowerBehavior(definition: TowerBehaviorDefinition): TowerRuntimeBehavior {
  switch (definition.kind) {
    case 'aoe':
      return new AoeTowerBehavior(definition.splashRadius, definition.splashDamageRatio)
    case 'beam':
      return new BeamTowerBehavior(definition.lockBonusPerTick, definition.maxLockBonus)
    case 'aura':
      return new AuraTowerBehavior(definition.fireRateBoostRatio)
    case 'economy':
      return new EconomyTowerBehavior(definition.intervalMs, definition.goldPerCycle)
    case 'single-target':
    default:
      return new SingleTargetTowerBehavior()
  }
}