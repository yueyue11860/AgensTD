"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTowerBehavior = createTowerBehavior;
function createEmptyReport() {
    return {
        attacks: [],
        buffedTowerIds: [],
        grantedGold: 0,
    };
}
function findTrackedTarget(tower, enemies) {
    if (!tower.currentTargetId) {
        return null;
    }
    return enemies.find((enemy) => enemy.id === tower.currentTargetId) ?? null;
}
function isInSplashArea(primaryTarget, candidate, splashRadius) {
    return Math.abs(candidate.x - primaryTarget.x) <= splashRadius
        && Math.abs(candidate.y - primaryTarget.y) <= splashRadius;
}
class SingleTargetTowerBehavior {
    phase = 'action';
    execute(tower, context) {
        const report = createEmptyReport();
        if (!tower.consumeAttackWindow()) {
            return report;
        }
        const target = tower.findTarget(context.enemies);
        if (!target) {
            return report;
        }
        const appliedDamage = target.takeDamage(tower.damage, 'physical', tower.ownerId);
        tower.applyAttackEffects(target);
        tower.completeAttackCycle(target.id);
        report.attacks.push({
            enemyId: target.id,
            damage: appliedDamage,
            mode: 'single-target',
        });
        return report;
    }
}
class AoeTowerBehavior {
    splashRadius;
    splashDamageRatio;
    phase = 'action';
    constructor(splashRadius, splashDamageRatio) {
        this.splashRadius = splashRadius;
        this.splashDamageRatio = splashDamageRatio;
    }
    execute(tower, context) {
        const report = createEmptyReport();
        if (!tower.consumeAttackWindow()) {
            return report;
        }
        const primaryTarget = tower.findTarget(context.enemies);
        if (!primaryTarget) {
            return report;
        }
        report.attacks.push({
            enemyId: primaryTarget.id,
            damage: primaryTarget.takeDamage(tower.damage, 'physical', tower.ownerId),
            mode: 'aoe-primary',
        });
        tower.applyAttackEffects(primaryTarget);
        for (const enemy of context.enemies) {
            if (!enemy.isAlive() || enemy.id === primaryTarget.id || !isInSplashArea(primaryTarget, enemy, this.splashRadius)) {
                continue;
            }
            report.attacks.push({
                enemyId: enemy.id,
                damage: enemy.takeDamage(tower.damage * this.splashDamageRatio, 'physical', tower.ownerId),
                mode: 'aoe-splash',
            });
            tower.applyAttackEffects(enemy);
        }
        tower.completeAttackCycle(primaryTarget.id);
        return report;
    }
}
class BeamTowerBehavior {
    lockBonusPerTick;
    maxLockBonus;
    phase = 'action';
    constructor(lockBonusPerTick, maxLockBonus) {
        this.lockBonusPerTick = lockBonusPerTick;
        this.maxLockBonus = maxLockBonus;
    }
    execute(tower, context) {
        const report = createEmptyReport();
        if (!tower.consumeAttackWindow()) {
            tower.resetLockIfTargetInvalid(context.enemies);
            return report;
        }
        const trackedTarget = findTrackedTarget(tower, context.enemies);
        const target = trackedTarget && tower.isEnemyInRange(trackedTarget)
            ? trackedTarget
            : tower.findTarget(context.enemies);
        if (!target) {
            tower.resetLock();
            return report;
        }
        const isContinuingLock = tower.currentTargetId === target.id;
        const lockBonus = isContinuingLock
            ? Math.min(this.maxLockBonus, tower.getLockStackCount(context.tickRateMs) * this.lockBonusPerTick)
            : 0;
        report.attacks.push({
            enemyId: target.id,
            damage: target.takeDamage(tower.damage * (1 + lockBonus), 'physical', tower.ownerId),
            mode: 'beam',
        });
        tower.applyAttackEffects(target);
        tower.completeAttackCycle(target.id);
        tower.updateLock(target.id, isContinuingLock ? tower.lockTimeMs + context.tickRateMs : 0);
        return report;
    }
}
class AuraTowerBehavior {
    fireRateBoostRatio;
    phase = 'support';
    constructor(fireRateBoostRatio) {
        this.fireRateBoostRatio = fireRateBoostRatio;
    }
    execute(tower, context) {
        const report = createEmptyReport();
        for (const allyTower of context.towers) {
            if (allyTower.id === tower.id || allyTower.ownerId !== tower.ownerId || !tower.isTowerInRange(allyTower)) {
                continue;
            }
            allyTower.applyFireRateBuff(1 + this.fireRateBoostRatio);
            report.buffedTowerIds.push(allyTower.id);
        }
        return report;
    }
}
class EconomyTowerBehavior {
    intervalMs;
    goldPerCycle;
    phase = 'action';
    constructor(intervalMs, goldPerCycle) {
        this.intervalMs = intervalMs;
        this.goldPerCycle = goldPerCycle;
    }
    execute(tower, context) {
        const report = createEmptyReport();
        const nextProgress = tower.incomeProgressMs + context.tickRateMs;
        const completedCycles = Math.floor(nextProgress / this.intervalMs);
        tower.incomeProgressMs = nextProgress % this.intervalMs;
        if (completedCycles > 0) {
            report.grantedGold = completedCycles * this.goldPerCycle;
        }
        return report;
    }
}
function createTowerBehavior(definition) {
    switch (definition.kind) {
        case 'aoe':
            return new AoeTowerBehavior(definition.splashRadius, definition.splashDamageRatio);
        case 'beam':
            return new BeamTowerBehavior(definition.lockBonusPerTick, definition.maxLockBonus);
        case 'aura':
            return new AuraTowerBehavior(definition.fireRateBoostRatio);
        case 'economy':
            return new EconomyTowerBehavior(definition.intervalMs, definition.goldPerCycle);
        case 'single-target':
        default:
            return new SingleTargetTowerBehavior();
    }
}
