"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Tower = void 0;
function distanceBetween(tower, enemy) {
    return Math.hypot(enemy.x - tower.x, enemy.y - tower.y);
}
class Tower {
    id;
    ownerId;
    type;
    x;
    y;
    width;
    height;
    behaviorKind;
    behavior;
    attackEffects;
    range;
    damage;
    fireRateTicks;
    targetingStrategy;
    fireCooldown;
    currentTargetId;
    lockTimeMs;
    incomeProgressMs;
    fireRateMultiplier = 1;
    runtimeBehavior;
    constructor(state, runtimeBehavior) {
        this.id = state.id;
        this.ownerId = state.ownerId;
        this.type = state.type;
        this.x = state.x;
        this.y = state.y;
        this.width = state.width;
        this.height = state.height;
        this.behaviorKind = state.behaviorKind;
        this.behavior = state.behavior;
        this.attackEffects = state.attackEffects.map((effect) => ({ ...effect }));
        this.range = state.range;
        this.damage = state.damage;
        this.fireRateTicks = state.fireRateTicks;
        this.fireCooldown = state.cooldownTicks;
        this.targetingStrategy = state.targetingStrategy;
        this.currentTargetId = state.currentTargetId;
        this.lockTimeMs = state.lockTimeMs;
        this.incomeProgressMs = state.incomeProgressMs;
        this.runtimeBehavior = runtimeBehavior;
    }
    beginTick() {
        this.fireRateMultiplier = 1;
    }
    getPhase() {
        return this.runtimeBehavior.phase;
    }
    tick(context) {
        return this.runtimeBehavior.execute(this, context);
    }
    applyFireRateBuff(multiplier) {
        this.fireRateMultiplier *= Math.max(0, multiplier);
    }
    consumeAttackWindow() {
        if (this.fireRateTicks === 'infinite') {
            return true;
        }
        if (this.fireCooldown > 0) {
            this.fireCooldown -= this.fireRateMultiplier;
            if (this.fireCooldown > 0) {
                return false;
            }
            this.fireCooldown = 0;
        }
        return true;
    }
    completeAttackCycle(targetId) {
        if (typeof this.fireRateTicks === 'number') {
            this.fireCooldown = this.fireRateTicks;
        }
        this.currentTargetId = targetId;
    }
    updateLock(targetId, lockTimeMs) {
        this.currentTargetId = targetId;
        this.lockTimeMs = lockTimeMs;
    }
    resetLock() {
        this.currentTargetId = null;
        this.lockTimeMs = 0;
    }
    resetLockIfTargetInvalid(enemies) {
        const trackedTarget = this.currentTargetId
            ? enemies.find((enemy) => enemy.id === this.currentTargetId) ?? null
            : null;
        if (!trackedTarget || !trackedTarget.isAlive() || !this.isEnemyInRange(trackedTarget)) {
            this.resetLock();
        }
    }
    getLockStackCount(tickRateMs) {
        if (tickRateMs <= 0) {
            return 0;
        }
        return this.lockTimeMs / tickRateMs;
    }
    toState() {
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
        };
    }
    findTarget(enemies) {
        let winner = null;
        for (const enemy of enemies) {
            if (!enemy.isAlive() || distanceBetween(this, enemy) > this.range) {
                continue;
            }
            if (!winner || this.isBetterTarget(enemy, winner)) {
                winner = enemy;
            }
        }
        return winner;
    }
    isEnemyInRange(enemy) {
        return enemy.isAlive() && distanceBetween(this, enemy) <= this.range;
    }
    isTowerInRange(tower) {
        return Math.abs(tower.x - this.x) <= this.range && Math.abs(tower.y - this.y) <= this.range;
    }
    applyAttackEffects(enemy) {
        for (const effectTemplate of this.attackEffects) {
            enemy.addEffect(this.createStatusEffect(effectTemplate));
        }
    }
    isBetterTarget(candidate, incumbent) {
        switch (this.targetingStrategy) {
            case 'first':
                return candidate.getRemainingPathDistance() < incumbent.getRemainingPathDistance() || (candidate.getRemainingPathDistance() === incumbent.getRemainingPathDistance()
                    && candidate.hp > incumbent.hp);
            case 'strongest':
                return candidate.hp > incumbent.hp || (candidate.hp === incumbent.hp
                    && candidate.getRemainingPathDistance() < incumbent.getRemainingPathDistance());
            case 'nearest':
            default:
                return distanceBetween(this, candidate) < distanceBetween(this, incumbent);
        }
    }
    createStatusEffect(effectTemplate) {
        return {
            ...effectTemplate,
            id: `${this.id}-${effectTemplate.kind}`,
            sourcePlayerId: this.ownerId,
        };
    }
}
exports.Tower = Tower;
