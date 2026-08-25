"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectGeneralTargets = selectGeneralTargets;
exports.selectGeneralTarget = selectGeneralTarget;
exports.initializeGeneralCombatTimers = initializeGeneralCombatTimers;
exports.planGeneralEffectActions = planGeneralEffectActions;
exports.planGeneralPassiveTrigger = planGeneralPassiveTrigger;
exports.planGeneralCombatFrame = planGeneralCombatFrame;
exports.validateGeneralCombatDefinition = validateGeneralCombatDefinition;
const catalog_1 = require("./catalog");
function patchedTargeting(targeting, effectId, level, resolve) {
    if (!resolve || targeting.scope === 'self')
        return targeting;
    const targetLimit = Math.max(1, Math.floor(resolve(effectId, 'targetLimit', targeting.targetLimit)));
    if (targeting.scope === 'enemies_around_primary') {
        const curve = [...targeting.radiusMilliCellsByLevel];
        curve[level - 1] = Math.max(0, Math.floor(resolve(effectId, 'radiusMilliCells', curve[level - 1])));
        return { ...targeting, targetLimit, radiusMilliCellsByLevel: curve };
    }
    if (targeting.scope === 'enemies_in_line_from_caster') {
        const length = [...targeting.lengthMilliCellsByLevel];
        const halfWidth = [...targeting.halfWidthMilliCellsByLevel];
        length[level - 1] = Math.max(1, Math.floor(resolve(effectId, 'lengthMilliCells', length[level - 1])));
        halfWidth[level - 1] = Math.max(0, Math.floor(resolve(effectId, 'halfWidthMilliCells', halfWidth[level - 1])));
        return { ...targeting, targetLimit,
            lengthMilliCellsByLevel: length,
            halfWidthMilliCellsByLevel: halfWidth };
    }
    if (targeting.scope === 'chain_from_primary') {
        const bounceRange = [...targeting.bounceRangeMilliCellsByLevel];
        bounceRange[level - 1] = Math.max(0, Math.floor(resolve(effectId, 'bounceRangeMilliCells', bounceRange[level - 1])));
        return { ...targeting, targetLimit, bounceRangeMilliCellsByLevel: bounceRange };
    }
    if (targeting.scope === 'all_targetable_enemies')
        return { ...targeting, targetLimit };
    // 单体 targeting 的 targetLimit 在类型与规则上恒为 1。
    return targeting;
}
const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;
const furthest = (a, b) => b.pathProgressMilli - a.pathProgressMilli
    || a.spawnSequence - b.spawnSequence || a.id.localeCompare(b.id);
function comparator(priority, formation) {
    if (priority === 'highest_current_hp')
        return (a, b) => b.currentHp - a.currentHp || furthest(a, b);
    if (priority === 'lowest_current_hp')
        return (a, b) => a.currentHp - b.currentHp || furthest(a, b);
    if (priority === 'nearest_to_caster')
        return (a, b) => dist2(formation.anchorMilli.x, formation.anchorMilli.y, a.xMilli, a.yMilli)
            - dist2(formation.anchorMilli.x, formation.anchorMilli.y, b.xMilli, b.yMilli) || furthest(a, b);
    return furthest;
}
const inRange = (formation, enemy, range) => dist2(formation.anchorMilli.x, formation.anchorMilli.y, enemy.xMilli, enemy.yMilli) <= range ** 2;
/** 所有集合都显式排序，相同输入必然得到相同目标顺序。 */
function selectGeneralTargets(input) {
    const { formation, stats, targeting, level } = input;
    const enemies = input.enemies.filter((enemy) => enemy.targetable && enemy.currentHp > 0);
    if (targeting.scope === 'self')
        return [];
    const compare = comparator(targeting.priority, formation);
    const take = (values) => values.slice(0, targeting.targetLimit);
    if (targeting.scope === 'enemies_in_radius' || targeting.scope === 'enemies_in_attack_range') {
        return take(enemies.filter((enemy) => inRange(formation, enemy, stats.attackRangeMilliCells)).sort(compare));
    }
    if (targeting.scope === 'all_targetable_enemies')
        return take(enemies.sort(compare));
    if (targeting.scope === 'enemies_around_primary') {
        const pool = targeting.primarySearch === 'attack_range'
            ? enemies.filter((enemy) => inRange(formation, enemy, stats.attackRangeMilliCells)) : enemies;
        const primary = pool.sort(compare)[0];
        if (!primary)
            return [];
        const radius = (0, catalog_1.getGeneralLevelValue)(targeting.radiusMilliCellsByLevel, level);
        return take(enemies.filter((enemy) => dist2(primary.xMilli, primary.yMilli, enemy.xMilli, enemy.yMilli) <= radius ** 2)
            .sort((a, b) => a.id === primary.id ? -1 : b.id === primary.id ? 1 : compare(a, b)));
    }
    if (targeting.scope === 'enemies_in_line_from_caster') {
        const length = (0, catalog_1.getGeneralLevelValue)(targeting.lengthMilliCellsByLevel, level);
        const width = (0, catalog_1.getGeneralLevelValue)(targeting.halfWidthMilliCellsByLevel, level);
        const searchRange = targeting.primarySearch === 'attack_range' ? stats.attackRangeMilliCells : length;
        const primary = enemies.filter((enemy) => inRange(formation, enemy, searchRange)).sort(compare)[0];
        if (!primary)
            return [];
        const dx = primary.xMilli - formation.anchorMilli.x;
        const dy = primary.yMilli - formation.anchorMilli.y;
        const direction2 = dx ** 2 + dy ** 2;
        if (direction2 === 0)
            return [primary];
        return take(enemies.filter((enemy) => {
            const rx = enemy.xMilli - formation.anchorMilli.x;
            const ry = enemy.yMilli - formation.anchorMilli.y;
            const dot = rx * dx + ry * dy;
            const cross = rx * dy - ry * dx;
            return dot >= 0 && dot ** 2 <= length ** 2 * direction2 && cross ** 2 <= width ** 2 * direction2;
        }).sort((a, b) => {
            const ap = (a.xMilli - formation.anchorMilli.x) * dx + (a.yMilli - formation.anchorMilli.y) * dy;
            const bp = (b.xMilli - formation.anchorMilli.x) * dx + (b.yMilli - formation.anchorMilli.y) * dy;
            return ap - bp || compare(a, b);
        }));
    }
    if (targeting.scope !== 'chain_from_primary')
        return [];
    const pool = targeting.primarySearch === 'attack_range'
        ? enemies.filter((enemy) => inRange(formation, enemy, stats.attackRangeMilliCells)) : enemies;
    const primary = pool.sort(compare)[0];
    if (!primary)
        return [];
    const chosen = [primary];
    const ids = new Set([primary.id]);
    const range = (0, catalog_1.getGeneralLevelValue)(targeting.bounceRangeMilliCellsByLevel, level);
    while (chosen.length < targeting.targetLimit) {
        const previous = chosen[chosen.length - 1];
        const next = enemies.filter((enemy) => !ids.has(enemy.id)
            && dist2(previous.xMilli, previous.yMilli, enemy.xMilli, enemy.yMilli) <= range ** 2)
            .sort((a, b) => dist2(previous.xMilli, previous.yMilli, a.xMilli, a.yMilli)
            - dist2(previous.xMilli, previous.yMilli, b.xMilli, b.yMilli) || compare(a, b))[0];
        if (!next)
            break;
        chosen.push(next);
        ids.add(next.id);
    }
    return chosen;
}
function selectGeneralTarget(formation, enemies, stats, priority) {
    return selectGeneralTargets({
        formation, enemies, stats, level: 1,
        targeting: { kind: 'single', scope: 'enemies_in_attack_range', priority, targetLimit: 1 },
    })[0] ?? null;
}
function initializeGeneralCombatTimers(definition, progress, currentTick, tickRateMs) {
    const stats = (0, catalog_1.resolveGeneralStats)(definition, progress.level);
    const passive = definition.passiveSkill.trigger;
    const periodicMs = passive?.kind === 'periodic'
        ? (passive.initialDelayMs ?? (0, catalog_1.getGeneralLevelValue)(passive.intervalMsByLevel, progress.level)) : 0;
    return {
        ...progress,
        nextBasicAttackTick: progress.nextBasicAttackTick || currentTick + Math.ceil(stats.attackIntervalMs / tickRateMs),
        activeSkillReadyAtTick: progress.activeSkillReadyAtTick || currentTick
            + Math.ceil((0, catalog_1.getGeneralLevelValue)(definition.activeSkill.cooldownMsByLevel, progress.level) / tickRateMs),
        basicAttackCount: progress.basicAttackCount ?? 0,
        nextPassiveTriggerTick: progress.nextPassiveTriggerTick || (periodicMs > 0
            ? currentTick + Math.ceil(periodicMs / tickRateMs) : 0),
    };
}
function common(input) {
    const first = input.targets[0];
    return {
        sourceGeneralId: input.definition.generalId,
        sourceProgressId: input.progress.progressId,
        sourceFormationId: input.formation.formationId,
        ownerPlayerId: input.formation.ownerPlayerId,
        actionKind: input.actionKind,
        actionId: input.actionId,
        effectId: input.effectId,
        primaryTargetEnemyId: first?.id ?? null,
        targetEnemyIds: input.targets.map((target) => target.id),
        targetPointMilli: first ? { x: first.xMilli, y: first.yMilli } : { ...input.formation.anchorMilli },
    };
}
/** 仅规划，不做伤害/状态/位移/召唤的具体结算。 */
function planGeneralEffectActions(input) {
    const actions = [];
    for (const effect of input.effects) {
        const targeting = patchedTargeting(effect.targeting ?? input.defaultTargeting, effect.effectId, input.progress.level, input.parameterResolver);
        const targets = selectGeneralTargets({ ...input, targeting, level: input.progress.level });
        if (targeting.scope !== 'self' && targets.length === 0)
            continue;
        const base = common({ ...input, effectId: effect.effectId, targets });
        const level = input.progress.level;
        if (effect.type === 'damage') {
            const resolve = (parameter, value) => input.parameterResolver
                ? input.parameterResolver(effect.effectId, parameter, value) : value;
            const hits = Math.max(1, Math.floor(resolve('hitCount', effect.hitCountByLevel ? (0, catalog_1.getGeneralLevelValue)(effect.hitCountByLevel, level) : 1)));
            for (const [targetIndex, target] of targets.entries())
                for (let hitIndex = 0; hitIndex < hits; hitIndex += 1) {
                    const stats = (0, catalog_1.resolveGeneralStats)(input.definition, level, input.modifiers ?? [], target.tags);
                    actions.push({ ...base, effectType: 'damage', targetEnemyId: target.id, targetEnemyIds: [target.id],
                        targetPointMilli: { x: target.xMilli, y: target.yMilli }, hitIndex, hitCount: hits,
                        targetIndex, bounceDamageFalloffBps: targeting.scope === 'chain_from_primary' ? 1000 : 0,
                        delayMs: hitIndex * (effect.hitIntervalMs ?? 0), damage: { effectId: effect.effectId,
                            damageType: effect.damageType, baseAttack: stats.attack,
                            coefficientBps: resolve('coefficientBps', (0, catalog_1.getGeneralLevelValue)(effect.coefficientBpsByLevel, level)),
                            flatDamage: resolve('flatDamage', (0, catalog_1.getGeneralLevelValue)(effect.flatDamageByLevel, level)),
                            criticalPolicy: effect.criticalPolicy, damageDealtRatioBps: stats.damageDealtRatioBps } });
                }
        }
        else if (effect.type === 'damage_over_time') {
            const resolve = (parameter, value) => input.parameterResolver ? input.parameterResolver(effect.effectId, parameter, value) : value;
            actions.push({ ...base, effectType: effect.type, damageType: effect.damageType,
                coefficientBpsPerTick: resolve('coefficientBpsPerTick', (0, catalog_1.getGeneralLevelValue)(effect.coefficientBpsPerTickByLevel, level)),
                flatDamagePerTick: resolve('flatDamagePerTick', (0, catalog_1.getGeneralLevelValue)(effect.flatDamagePerTickByLevel, level)), tickIntervalMs: effect.tickIntervalMs,
                durationMs: resolve('durationMs', (0, catalog_1.getGeneralLevelValue)(effect.durationMsByLevel, level)), criticalPolicy: effect.criticalPolicy, stacking: effect.stacking });
        }
        else if (effect.type === 'status_apply') {
            const resolve = (parameter, value) => input.parameterResolver ? input.parameterResolver(effect.effectId, parameter, value) : value;
            actions.push({ ...base, effectType: effect.type, statusId: effect.statusId,
                magnitude: resolve('magnitude', (0, catalog_1.getGeneralLevelValue)(effect.magnitudeByLevel, level)),
                durationMs: resolve('durationMs', (0, catalog_1.getGeneralLevelValue)(effect.durationMsByLevel, level)),
                chanceBps: resolve('chanceBps', (0, catalog_1.getGeneralLevelValue)(effect.chanceBpsByLevel, level)), stacking: effect.stacking });
        }
        else if (effect.type === 'path_displacement')
            actions.push({ ...base, effectType: effect.type, direction: effect.direction,
                distanceMilliCells: input.parameterResolver ? input.parameterResolver(effect.effectId, 'distanceMilliCells', (0, catalog_1.getGeneralLevelValue)(effect.distanceMilliCellsByLevel, level)) : (0, catalog_1.getGeneralLevelValue)(effect.distanceMilliCellsByLevel, level), bossDistanceRatioBps: effect.bossDistanceRatioBps });
        else if (effect.type === 'summon_unit')
            actions.push({ ...base, effectType: effect.type, summonUnitId: effect.summonUnitId,
                count: input.parameterResolver ? input.parameterResolver(effect.effectId, 'count', (0, catalog_1.getGeneralLevelValue)(effect.countByLevel, level)) : (0, catalog_1.getGeneralLevelValue)(effect.countByLevel, level),
                durationMs: input.parameterResolver ? input.parameterResolver(effect.effectId, 'durationMs', (0, catalog_1.getGeneralLevelValue)(effect.durationMsByLevel, level)) : (0, catalog_1.getGeneralLevelValue)(effect.durationMsByLevel, level),
                maxOwnedAlive: input.parameterResolver ? input.parameterResolver(effect.effectId, 'maxOwnedAlive', (0, catalog_1.getGeneralLevelValue)(effect.maxOwnedAliveByLevel, level)) : (0, catalog_1.getGeneralLevelValue)(effect.maxOwnedAliveByLevel, level),
                spawnRadiusMilliCells: input.parameterResolver
                    ? input.parameterResolver(effect.effectId, 'spawnRadiusMilliCells', effect.spawnRadiusMilliCellsByLevel
                        ? (0, catalog_1.getGeneralLevelValue)(effect.spawnRadiusMilliCellsByLevel, level) : 1000)
                    : effect.spawnRadiusMilliCellsByLevel ? (0, catalog_1.getGeneralLevelValue)(effect.spawnRadiusMilliCellsByLevel, level) : 1000,
                spawnPattern: effect.spawnPattern,
                inheritStatRatiosBps: effect.inheritStatRatiosBps, sourceInactivePolicy: effect.sourceInactivePolicy });
        else if (effect.type === 'spawn_zone')
            actions.push({ ...base, effectType: effect.type, zoneId: effect.zoneId,
                shape: effect.shape.kind === 'circle'
                    ? { kind: 'circle', radiusMilliCells: input.parameterResolver ? input.parameterResolver(effect.effectId, 'radiusMilliCells', (0, catalog_1.getGeneralLevelValue)(effect.shape.radiusMilliCellsByLevel, level)) : (0, catalog_1.getGeneralLevelValue)(effect.shape.radiusMilliCellsByLevel, level) }
                    : { kind: 'line', lengthMilliCells: input.parameterResolver ? input.parameterResolver(effect.effectId, 'lengthMilliCells', (0, catalog_1.getGeneralLevelValue)(effect.shape.lengthMilliCellsByLevel, level)) : (0, catalog_1.getGeneralLevelValue)(effect.shape.lengthMilliCellsByLevel, level),
                        halfWidthMilliCells: input.parameterResolver ? input.parameterResolver(effect.effectId, 'halfWidthMilliCells', (0, catalog_1.getGeneralLevelValue)(effect.shape.halfWidthMilliCellsByLevel, level)) : (0, catalog_1.getGeneralLevelValue)(effect.shape.halfWidthMilliCellsByLevel, level) },
                durationMs: input.parameterResolver ? input.parameterResolver(effect.effectId, 'durationMs', (0, catalog_1.getGeneralLevelValue)(effect.durationMsByLevel, level)) : (0, catalog_1.getGeneralLevelValue)(effect.durationMsByLevel, level), tickIntervalMs: effect.tickIntervalMs,
                tickEffects: effect.tickEffects, sourceInactivePolicy: effect.sourceInactivePolicy });
        else if (effect.type === 'cooldown_modify')
            actions.push({ ...base, effectType: effect.type,
                targetSkill: effect.targetSkill, operation: effect.operation,
                value: input.parameterResolver ? input.parameterResolver(effect.effectId, 'value', (0, catalog_1.getGeneralLevelValue)(effect.valueByLevel, level)) : (0, catalog_1.getGeneralLevelValue)(effect.valueByLevel, level),
                maxTriggersPerCast: input.parameterResolver ? input.parameterResolver(effect.effectId, 'maxTriggersPerCast', effect.maxTriggersPerCast) : effect.maxTriggersPerCast });
        else
            actions.push({ ...base, effectType: effect.type, targetEffectId: effect.targetEffectId,
                parameter: effect.parameter, operation: effect.operation, value: (0, catalog_1.getGeneralLevelValue)(effect.valueByLevel, level) });
    }
    return actions;
}
function planGeneralPassiveTrigger(input) {
    const trigger = input.definition.passiveSkill.trigger ?? { kind: 'always' };
    const structured = input.definition.passiveSkill.structuredEffects ?? [];
    const priorCount = input.progress.basicAttackCount ?? 0;
    const nextCount = input.event === 'basic_attack' ? priorCount + 1 : priorCount;
    const due = trigger.kind === 'always' ? input.event === 'initialize'
        : trigger.kind === 'periodic' ? input.currentTick >= (input.progress.nextPassiveTriggerTick ?? 0)
            : trigger.kind === 'on_basic_attack' ? input.event === 'basic_attack'
                : trigger.kind === 'on_nth_basic_attack' ? input.event === 'basic_attack' && nextCount % trigger.every === 0
                    : trigger.kind === 'on_skill_hit' ? input.event === 'skill_hit'
                        : trigger.kind === 'on_displacement_success' ? input.event === 'displacement_success'
                            : trigger.kind === 'on_enemy_killed' ? input.event === 'enemy_killed' : false;
    const stats = (0, catalog_1.resolveGeneralStats)(input.definition, input.progress.level, input.modifiers ?? []);
    const actions = due ? planGeneralEffectActions({ ...input, stats, actionKind: 'passive',
        actionId: `${input.definition.passiveSkill.skillId}:${input.currentTick}:${nextCount}`,
        defaultTargeting: { kind: 'self', scope: 'self', targetLimit: 0 }, effects: structured }) : [];
    const interval = trigger.kind === 'periodic' ? (0, catalog_1.getGeneralLevelValue)(trigger.intervalMsByLevel, input.progress.level) : 0;
    return { actions, nextBasicAttackCount: nextCount,
        nextPassiveTriggerTick: due && interval > 0 ? input.currentTick + Math.ceil(interval / input.tickRateMs)
            : input.progress.nextPassiveTriggerTick ?? 0 };
}
const legacy = (action) => ({ sourceGeneralId: action.sourceGeneralId,
    sourceProgressId: action.sourceProgressId, sourceFormationId: action.sourceFormationId,
    ownerPlayerId: action.ownerPlayerId, actionKind: action.actionKind === 'passive' ? 'active_skill' : action.actionKind,
    actionId: action.actionId, targetEnemyId: action.targetEnemyId, damage: action.damage });
function planGeneralCombatFrame(input) {
    const { definition, formation, currentTick, tickRateMs, enemies, modifiers = [] } = input;
    if (definition.generalId !== formation.generalId || definition.generalId !== input.progress.generalId
        || formation.ownerPlayerId !== input.progress.ownerPlayerId)
        throw new Error('General combat identity mismatch');
    if (!Number.isSafeInteger(currentTick) || currentTick < 0 || !Number.isSafeInteger(tickRateMs) || tickRateMs < 1)
        throw new Error('Invalid general combat time');
    validateGeneralCombatDefinition(definition);
    let nextProgress = initializeGeneralCombatTimers(definition, input.progress, currentTick, tickRateMs);
    if (input.progress.nextBasicAttackTick === 0 && input.progress.activeSkillReadyAtTick === 0)
        return { actions: [], combatActions: [], nextProgress };
    const stats = (0, catalog_1.resolveGeneralStats)(definition, nextProgress.level, modifiers);
    const combatActions = [];
    if (currentTick >= nextProgress.activeSkillReadyAtTick) {
        const planned = planGeneralEffectActions({ definition, formation, progress: nextProgress, stats,
            actionKind: 'active_skill', actionId: `${definition.activeSkill.skillId}:${currentTick}`,
            defaultTargeting: definition.activeSkill.targeting, effects: definition.activeSkill.effects, enemies, modifiers,
            parameterResolver: input.parameterResolver });
        const requiresEnemyTarget = definition.activeSkill.effects.some((effect) => ((effect.targeting ?? definition.activeSkill.targeting).scope !== 'self'));
        const hasEnemyTarget = planned.some((action) => action.targetEnemyIds.length > 0);
        if (planned.length && (!requiresEnemyTarget || hasEnemyTarget)) {
            combatActions.push(...planned);
            nextProgress = { ...nextProgress,
                activeSkillReadyAtTick: currentTick + Math.ceil((0, catalog_1.getGeneralLevelValue)(definition.activeSkill.cooldownMsByLevel, nextProgress.level) / tickRateMs) };
        }
    }
    if (currentTick >= nextProgress.nextBasicAttackTick) {
        const planned = planGeneralEffectActions({ definition, formation, progress: nextProgress, stats,
            actionKind: 'basic_attack', actionId: `${definition.basicAttack.attackId}:${currentTick}`,
            defaultTargeting: { kind: 'single', ...definition.basicAttack.targeting }, effects: [definition.basicAttack.effect], enemies, modifiers,
            parameterResolver: input.parameterResolver });
        if (planned.length) {
            combatActions.push(...planned);
            nextProgress = { ...nextProgress,
                nextBasicAttackTick: currentTick + Math.ceil(stats.attackIntervalMs / tickRateMs) };
        }
    }
    return { actions: combatActions.filter((a) => a.effectType === 'damage').map(legacy),
        combatActions, nextProgress };
}
function curve(value, path, min, max) {
    if (value.length !== 5 || value.some((entry) => !Number.isSafeInteger(entry)
        || (min !== undefined && entry < min) || (max !== undefined && entry > max)))
        throw new Error(`Invalid curve: ${path}`);
}
function validateTargeting(value, path) {
    if (value.scope === 'self') {
        if (value.targetLimit !== 0)
            throw new Error(`Invalid self targetLimit: ${path}`);
        return;
    }
    if (!Number.isSafeInteger(value.targetLimit) || value.targetLimit < 1)
        throw new Error(`Invalid targetLimit: ${path}`);
    if (value.scope === 'enemies_around_primary')
        curve(value.radiusMilliCellsByLevel, path, 0);
    if (value.scope === 'enemies_in_line_from_caster') {
        curve(value.lengthMilliCellsByLevel, path, 1);
        curve(value.halfWidthMilliCellsByLevel, path, 0);
    }
    if (value.scope === 'chain_from_primary')
        curve(value.bounceRangeMilliCellsByLevel, path, 0);
}
function validateEffect(effect, ids) {
    if (!effect.effectId || ids.has(effect.effectId))
        throw new Error(`Duplicate/empty effectId: ${effect.effectId}`);
    ids.add(effect.effectId);
    if (effect.targeting)
        validateTargeting(effect.targeting, effect.effectId);
    if (effect.type === 'damage') {
        curve(effect.coefficientBpsByLevel, effect.effectId, 0);
        curve(effect.flatDamageByLevel, effect.effectId, 0);
        if (effect.hitCountByLevel)
            curve(effect.hitCountByLevel, effect.effectId, 1);
    }
    else if (effect.type === 'damage_over_time') {
        curve(effect.coefficientBpsPerTickByLevel, effect.effectId, 0);
        curve(effect.durationMsByLevel, effect.effectId, 1);
        if (effect.tickIntervalMs < 1)
            throw new Error('Invalid DOT interval');
    }
    else if (effect.type === 'status_apply') {
        curve(effect.durationMsByLevel, effect.effectId, 1);
        curve(effect.chanceBpsByLevel, effect.effectId, 0, 10000);
    }
    else if (effect.type === 'path_displacement')
        curve(effect.distanceMilliCellsByLevel, effect.effectId, 0);
    else if (effect.type === 'summon_unit') {
        curve(effect.countByLevel, effect.effectId, 1);
        curve(effect.maxOwnedAliveByLevel, effect.effectId, 1);
    }
    else if (effect.type === 'spawn_zone') {
        curve(effect.durationMsByLevel, effect.effectId, 1);
        effect.tickEffects.forEach((entry) => validateEffect(entry, ids));
    }
    else
        curve(effect.valueByLevel, effect.effectId);
}
function validateGeneralCombatDefinition(definition) {
    validateTargeting({ kind: 'single', ...definition.basicAttack.targeting }, 'basicAttack');
    validateTargeting(definition.activeSkill.targeting, 'activeSkill');
    curve(definition.activeSkill.cooldownMsByLevel, 'cooldown', 1);
    const ids = new Set();
    validateEffect(definition.basicAttack.effect, ids);
    if (!definition.activeSkill.effects.length)
        throw new Error('Active skill requires effects');
    definition.activeSkill.effects.forEach((effect) => validateEffect(effect, ids));
    const trigger = definition.passiveSkill.trigger;
    if (trigger?.kind === 'on_nth_basic_attack' && (!Number.isSafeInteger(trigger.every) || trigger.every < 1))
        throw new Error('Invalid passive every');
    if (trigger?.kind === 'periodic')
        curve(trigger.intervalMsByLevel, 'passive interval', 1);
    definition.passiveSkill.structuredEffects?.forEach((effect) => validateEffect(effect, ids));
}
