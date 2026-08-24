"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeGeneralCombatTimers = initializeGeneralCombatTimers;
exports.selectGeneralTarget = selectGeneralTarget;
exports.planGeneralCombatFrame = planGeneralCombatFrame;
const catalog_1 = require("./catalog");
const distanceSquared = (leftX, leftY, rightX, rightY) => {
    const deltaX = rightX - leftX;
    const deltaY = rightY - leftY;
    return deltaX * deltaX + deltaY * deltaY;
};
const compareFurthestProgress = (left, right) => {
    return right.pathProgressMilli - left.pathProgressMilli
        || left.spawnSequence - right.spawnSequence
        || left.id.localeCompare(right.id);
};
const compareHighestCurrentHp = (left, right) => {
    return right.currentHp - left.currentHp
        || compareFurthestProgress(left, right);
};
function initializeGeneralCombatTimers(definition, progress, currentTick, tickRateMs) {
    const stats = (0, catalog_1.resolveGeneralStats)(definition, progress.level);
    return {
        ...progress,
        nextBasicAttackTick: progress.nextBasicAttackTick > 0
            ? progress.nextBasicAttackTick
            : currentTick + Math.ceil(stats.attackIntervalMs / tickRateMs),
        activeSkillReadyAtTick: progress.activeSkillReadyAtTick > 0
            ? progress.activeSkillReadyAtTick
            : currentTick
                + Math.ceil((0, catalog_1.getGeneralLevelValue)(definition.activeSkill.cooldownMsByLevel, progress.level) / tickRateMs),
    };
}
function selectGeneralTarget(formation, enemies, stats, priority) {
    const rangeSquared = stats.attackRangeMilliCells * stats.attackRangeMilliCells;
    const candidates = enemies.filter((enemy) => enemy.targetable
        && enemy.currentHp > 0
        && distanceSquared(formation.anchorMilli.x, formation.anchorMilli.y, enemy.xMilli, enemy.yMilli) <= rangeSquared);
    candidates.sort(priority === 'furthest_progress' ? compareFurthestProgress : compareHighestCurrentHp);
    return candidates[0] ?? null;
}
function planGeneralCombatFrame(input) {
    const { definition, formation, currentTick, tickRateMs, enemies, modifiers = [], } = input;
    if (definition.generalId !== formation.generalId
        || definition.generalId !== input.progress.generalId
        || formation.ownerPlayerId !== input.progress.ownerPlayerId) {
        throw new Error('General combat identity mismatch');
    }
    if (!Number.isSafeInteger(currentTick) || currentTick < 0 || tickRateMs <= 0) {
        throw new Error('Invalid general combat time');
    }
    let nextProgress = initializeGeneralCombatTimers(definition, input.progress, currentTick, tickRateMs);
    if (input.progress.nextBasicAttackTick === 0 && input.progress.activeSkillReadyAtTick === 0) {
        return { actions: [], nextProgress };
    }
    const rangeStats = (0, catalog_1.resolveGeneralStats)(definition, nextProgress.level, modifiers);
    const actions = [];
    if (currentTick >= nextProgress.activeSkillReadyAtTick) {
        const target = selectGeneralTarget(formation, enemies, rangeStats, definition.activeSkill.targeting.priority);
        if (target) {
            const targetStats = (0, catalog_1.resolveGeneralStats)(definition, nextProgress.level, modifiers, target.tags);
            for (const effect of definition.activeSkill.effects) {
                actions.push({
                    sourceGeneralId: definition.generalId,
                    sourceProgressId: nextProgress.progressId,
                    sourceFormationId: formation.formationId,
                    ownerPlayerId: formation.ownerPlayerId,
                    actionKind: 'active_skill',
                    actionId: `${definition.activeSkill.skillId}:${currentTick}`,
                    targetEnemyId: target.id,
                    damage: {
                        effectId: effect.effectId,
                        damageType: effect.damageType,
                        baseAttack: targetStats.attack,
                        coefficientBps: (0, catalog_1.getGeneralLevelValue)(effect.coefficientBpsByLevel, nextProgress.level),
                        flatDamage: (0, catalog_1.getGeneralLevelValue)(effect.flatDamageByLevel, nextProgress.level),
                        criticalPolicy: effect.criticalPolicy,
                        damageDealtRatioBps: targetStats.damageDealtRatioBps,
                    },
                });
            }
            nextProgress = {
                ...nextProgress,
                activeSkillReadyAtTick: currentTick + Math.ceil((0, catalog_1.getGeneralLevelValue)(definition.activeSkill.cooldownMsByLevel, nextProgress.level) / tickRateMs),
            };
        }
    }
    if (currentTick >= nextProgress.nextBasicAttackTick) {
        const target = selectGeneralTarget(formation, enemies, rangeStats, definition.basicAttack.targeting.priority);
        if (target) {
            const targetStats = (0, catalog_1.resolveGeneralStats)(definition, nextProgress.level, modifiers, target.tags);
            const effect = definition.basicAttack.effect;
            actions.push({
                sourceGeneralId: definition.generalId,
                sourceProgressId: nextProgress.progressId,
                sourceFormationId: formation.formationId,
                ownerPlayerId: formation.ownerPlayerId,
                actionKind: 'basic_attack',
                actionId: `${definition.basicAttack.attackId}:${currentTick}`,
                targetEnemyId: target.id,
                damage: {
                    effectId: effect.effectId,
                    damageType: effect.damageType,
                    baseAttack: targetStats.attack,
                    coefficientBps: (0, catalog_1.getGeneralLevelValue)(effect.coefficientBpsByLevel, nextProgress.level),
                    flatDamage: (0, catalog_1.getGeneralLevelValue)(effect.flatDamageByLevel, nextProgress.level),
                    criticalPolicy: effect.criticalPolicy,
                    damageDealtRatioBps: targetStats.damageDealtRatioBps,
                },
            });
            nextProgress = {
                ...nextProgress,
                nextBasicAttackTick: currentTick + Math.ceil(targetStats.attackIntervalMs / tickRateMs),
            };
        }
    }
    return { actions, nextProgress };
}
