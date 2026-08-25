"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GENERAL_CATALOG = exports.HOUYI_DEFINITION = exports.ALL_GENERAL_DEFINITIONS = exports.GENERAL_EXPERIENCE_POINT_SCALE = exports.HOUYI_GENERAL_ID = void 0;
exports.getGeneralLevelValue = getGeneralLevelValue;
exports.getGeneralDefinition = getGeneralDefinition;
exports.cumulativeExperienceRequiredForLevel = cumulativeExperienceRequiredForLevel;
exports.fullRankExperienceRequired = fullRankExperienceRequired;
exports.levelForExperience = levelForExperience;
exports.resolveGeneralStats = resolveGeneralStats;
exports.patchableEffectParameters = patchableEffectParameters;
exports.validateSynergyEffectParameterPatches = validateSynergyEffectParameterPatches;
exports.validateGeneralDefinition = validateGeneralDefinition;
exports.validateGeneralCatalog = validateGeneralCatalog;
const catalog_data_1 = require("./catalog-data");
Object.defineProperty(exports, "ALL_GENERAL_DEFINITIONS", { enumerable: true, get: function () { return catalog_data_1.ALL_GENERAL_DEFINITIONS; } });
Object.defineProperty(exports, "HOUYI_DEFINITION", { enumerable: true, get: function () { return catalog_data_1.HOUYI_DEFINITION; } });
const catalog_1 = require("../../synergy-v1/catalog");
const roster_1 = require("./roster");
const summon_catalog_1 = require("./summon-catalog");
exports.HOUYI_GENERAL_ID = roster_1.GENERAL_IDS.HOUYI;
/** 1000 内部点 = UI 1.0 经验。 */
exports.GENERAL_EXPERIENCE_POINT_SCALE = 1000;
exports.GENERAL_CATALOG = Object.freeze(Object.fromEntries(catalog_data_1.ALL_GENERAL_DEFINITIONS.map((definition) => [definition.generalId, definition])));
function getGeneralLevelValue(curve, level) {
    return curve[level - 1];
}
function getGeneralDefinition(generalId) {
    return exports.GENERAL_CATALOG[generalId] ?? null;
}
function cumulativeExperienceRequiredForLevel(definition, level) {
    let total = 0;
    for (let index = 0; index < level - 1; index += 1) {
        total += definition.levelRules.experienceRequiredPoints[index];
    }
    return total;
}
function fullRankExperienceRequired(definition) {
    return definition.levelRules.experienceRequiredPoints.reduce((sum, value) => sum + value, 0);
}
function levelForExperience(definition, experiencePoints, maxLevel) {
    let level = 1;
    while (level < maxLevel && experiencePoints >= cumulativeExperienceRequiredForLevel(definition, (level + 1))) {
        level = (level + 1);
    }
    return level;
}
function resolveGeneralStats(definition, level, modifiers = [], targetTags = []) {
    let attackFlat = 0;
    let attackRatio = 0;
    let attackSpeedRatio = 0;
    let attackRangeFlat = 0;
    let attackRangeRatio = 0;
    let critRateFlat = 0;
    let critRateRatio = 0;
    let critDamageFlat = 0;
    let critDamageRatio = 0;
    let damageDealtRatio = 0;
    for (const modifier of [...definition.passiveSkill.effects, ...modifiers]) {
        if (modifier.target.scope === 'synergy_members'
            && modifier.target.generalIds
            && !modifier.target.generalIds.includes(definition.generalId))
            continue;
        if (modifier.condition?.targetTagsAny
            && !modifier.condition.targetTagsAny.some((tag) => targetTags.includes(tag)))
            continue;
        if (modifier.stat === 'attack') {
            modifier.operation === 'add_flat' ? attackFlat += modifier.value : attackRatio += modifier.value;
        }
        else if (modifier.stat === 'attackSpeed' && modifier.operation === 'add_ratio')
            attackSpeedRatio += modifier.value;
        else if (modifier.stat === 'attackRange') {
            modifier.operation === 'add_flat' ? attackRangeFlat += modifier.value : attackRangeRatio += modifier.value;
        }
        else if (modifier.stat === 'critRate') {
            modifier.operation === 'add_flat' ? critRateFlat += modifier.value : critRateRatio += modifier.value;
        }
        else if (modifier.stat === 'critDamage') {
            modifier.operation === 'add_flat' ? critDamageFlat += modifier.value : critDamageRatio += modifier.value;
        }
        else if (modifier.stat === 'damageDealt' && modifier.operation === 'add_ratio')
            damageDealtRatio += modifier.value;
    }
    const baseAttack = getGeneralLevelValue(definition.baseStats.attackByLevel, level);
    const baseInterval = getGeneralLevelValue(definition.baseStats.attackIntervalMsByLevel, level);
    const baseRange = getGeneralLevelValue(definition.baseStats.attackRangeMilliCellsByLevel, level);
    return {
        attack: Math.max(1, Math.floor((baseAttack + attackFlat) * (10000 + attackRatio) / 10000)),
        attackIntervalMs: Math.max(200, Math.ceil(baseInterval * 10000 / Math.max(1, 10000 + attackSpeedRatio))),
        attackRangeMilliCells: Math.max(0, Math.floor((baseRange + attackRangeFlat) * (10000 + attackRangeRatio) / 10000)),
        critChanceBps: Math.min(10000, Math.max(0, Math.floor((getGeneralLevelValue(definition.baseStats.critChanceBpsByLevel, level) + critRateFlat)
            * (10000 + critRateRatio) / 10000))),
        critDamageBps: Math.max(10000, Math.floor((getGeneralLevelValue(definition.baseStats.critDamageBpsByLevel, level) + critDamageFlat)
            * (10000 + critDamageRatio) / 10000)),
        damageDealtRatioBps: Math.max(0, 10000 + damageDealtRatio),
    };
}
function validateCurve(curve, path, minimum) {
    if (curve.length !== 5 || curve.some((value) => !Number.isSafeInteger(value)
        || (minimum !== undefined && value < minimum))) {
        throw new Error(`Invalid five-level curve: ${path}`);
    }
}
function validateTargeting(targeting, path) {
    if (targeting.scope === 'self') {
        if (targeting.targetLimit !== 0)
            throw new Error(`Self targeting must use targetLimit 0: ${path}`);
        return;
    }
    if (!Number.isSafeInteger(targeting.targetLimit) || targeting.targetLimit < 1) {
        throw new Error(`Invalid targetLimit: ${path}`);
    }
    if (targeting.scope === 'enemies_around_primary')
        validateCurve(targeting.radiusMilliCellsByLevel, `${path}.radius`, 0);
    if (targeting.scope === 'enemies_in_line_from_caster') {
        validateCurve(targeting.lengthMilliCellsByLevel, `${path}.length`, 1);
        validateCurve(targeting.halfWidthMilliCellsByLevel, `${path}.halfWidth`, 0);
    }
    if (targeting.scope === 'chain_from_primary')
        validateCurve(targeting.bounceRangeMilliCellsByLevel, `${path}.bounceRange`, 0);
}
function validateEffectCurves(effect, path) {
    if (effect.targeting)
        validateTargeting(effect.targeting, `${path}.targeting`);
    if (effect.type === 'damage') {
        validateCurve(effect.coefficientBpsByLevel, `${path}.coefficient`, 0);
        validateCurve(effect.flatDamageByLevel, `${path}.flatDamage`, 0);
        if (effect.hitCountByLevel)
            validateCurve(effect.hitCountByLevel, `${path}.hitCount`, 1);
    }
    else if (effect.type === 'damage_over_time') {
        validateCurve(effect.coefficientBpsPerTickByLevel, `${path}.coefficient`, 0);
        validateCurve(effect.flatDamagePerTickByLevel, `${path}.flatDamage`, 0);
        validateCurve(effect.durationMsByLevel, `${path}.duration`, 1);
        if (!Number.isSafeInteger(effect.tickIntervalMs) || effect.tickIntervalMs < 1)
            throw new Error(`Invalid DOT interval: ${path}`);
    }
    else if (effect.type === 'status_apply') {
        validateCurve(effect.magnitudeByLevel, `${path}.magnitude`, 0);
        validateCurve(effect.durationMsByLevel, `${path}.duration`, 1);
        validateCurve(effect.chanceBpsByLevel, `${path}.chance`, 0);
        if (effect.chanceBpsByLevel.some((value) => value > 10000))
            throw new Error(`Status chance exceeds 100%: ${path}`);
    }
    else if (effect.type === 'path_displacement')
        validateCurve(effect.distanceMilliCellsByLevel, `${path}.distance`, 0);
    else if (effect.type === 'summon_unit') {
        validateCurve(effect.countByLevel, `${path}.count`, 1);
        validateCurve(effect.durationMsByLevel, `${path}.duration`, 1);
        validateCurve(effect.maxOwnedAliveByLevel, `${path}.maxOwnedAlive`, 1);
        if (effect.spawnRadiusMilliCellsByLevel)
            validateCurve(effect.spawnRadiusMilliCellsByLevel, `${path}.spawnRadius`, 0);
        if (!summon_catalog_1.SUMMON_UNIT_CATALOG[effect.summonUnitId]) {
            throw new Error(`Unknown summon reference ${effect.summonUnitId}: ${path}`);
        }
    }
    else if (effect.type === 'spawn_zone') {
        validateCurve(effect.durationMsByLevel, `${path}.duration`, 1);
        if (effect.shape.kind === 'circle')
            validateCurve(effect.shape.radiusMilliCellsByLevel, `${path}.radius`, 0);
        else {
            validateCurve(effect.shape.lengthMilliCellsByLevel, `${path}.length`, 1);
            validateCurve(effect.shape.halfWidthMilliCellsByLevel, `${path}.halfWidth`, 0);
        }
        for (const tickEffect of effect.tickEffects)
            validateEffectCurves(tickEffect, `${path}.tickEffects.${tickEffect.effectId}`);
    }
    else if (effect.type === 'cooldown_modify')
        validateCurve(effect.valueByLevel, `${path}.value`);
    else
        validateCurve(effect.valueByLevel, `${path}.value`);
}
/**
 * 参数补丁只能写统一效果规划器实际产出的数值字段。形状字段还要与区域形状一致，
 * 从而在构建期阻止“给召唤物写半径”这类能通过字符串校验、运行时却无效的配置。
 */
function patchableEffectParameters(effect) {
    const targeting = ['targetLimit'];
    if (effect.targeting?.scope === 'chain_from_primary')
        targeting.push('bounceRangeMilliCells');
    if (effect.targeting?.scope === 'enemies_around_primary')
        targeting.push('radiusMilliCells');
    if (effect.targeting?.scope === 'enemies_in_line_from_caster')
        targeting.push('lengthMilliCells', 'halfWidthMilliCells');
    if (effect.type === 'damage')
        return new Set([...targeting, 'coefficientBps', 'flatDamage', 'hitCount', 'bounceDamageFalloffBps']);
    if (effect.type === 'damage_over_time')
        return new Set([...targeting, 'coefficientBpsPerTick', 'flatDamagePerTick', 'durationMs', 'ownerAttackCoefficientBpsPerTick']);
    if (effect.type === 'status_apply')
        return new Set([...targeting, 'magnitude', 'durationMs', 'chanceBps']);
    if (effect.type === 'path_displacement')
        return new Set([...targeting, 'distanceMilliCells']);
    if (effect.type === 'summon_unit')
        return new Set([...targeting, 'count', 'durationMs', 'maxOwnedAlive',
            'spawnRadiusMilliCells', 'summonAttackBps', 'summonCritRateBps', 'bossCritDamageBps', 'summonAllStatsBps']);
    if (effect.type === 'spawn_zone')
        return effect.shape.kind === 'circle'
            ? new Set([...targeting, 'radiusMilliCells', 'durationMs'])
            : new Set([...targeting, 'lengthMilliCells', 'halfWidthMilliCells', 'durationMs']);
    if (effect.type === 'cooldown_modify')
        return new Set([...targeting, 'value', 'maxTriggersPerCast']);
    return new Set();
}
function buildGeneralEffectIndex(catalog) {
    const index = new Map();
    for (const definition of Object.values(catalog)) {
        const effects = [
            definition.basicAttack.effect,
            ...(0, catalog_data_1.collectNestedEffects)(definition.activeSkill.effects),
            ...(0, catalog_data_1.collectNestedEffects)(definition.passiveSkill.structuredEffects ?? []),
        ];
        for (const effect of effects)
            index.set(effect.effectId, effect);
    }
    return index;
}
function validateSynergyEffectParameterPatches(synergies = catalog_1.SYNERGY_V1_CATALOG, catalog = exports.GENERAL_CATALOG) {
    const effectIndex = buildGeneralEffectIndex(catalog);
    for (const synergy of synergies) {
        for (const level of synergy.levels) {
            for (const patch of level.effects) {
                if (patch.type !== 'effect_parameter_patch')
                    continue;
                const target = effectIndex.get(patch.targetEffectId);
                if (!target) {
                    throw new Error(`Unresolved synergy parameter patch target ${patch.targetEffectId} from ${patch.effectId}`);
                }
                if (!patchableEffectParameters(target).has(patch.parameter)) {
                    throw new Error(`Invalid parameter patch ${patch.parameter} for ${target.type} effect ${patch.targetEffectId} from ${patch.effectId}`);
                }
            }
        }
    }
}
function validateGeneralDefinition(definition) {
    const roster = (0, roster_1.getGeneralRosterEntry)(definition.generalId);
    if (!roster || definition.name !== roster.displayName
        || definition.quality !== roster.quality
        || definition.archetype !== roster.profession
        || definition.recipe.glyphs.join('\u0000') !== roster.glyphs.join('\u0000')) {
        throw new Error(`General identity does not match roster: ${definition.generalId}`);
    }
    if (![2, 3, 4].includes(definition.recipe.glyphs.length)) {
        throw new Error(`General recipe must contain exactly 2, 3, or 4 glyphs: ${definition.generalId}`);
    }
    const expectedQuality = definition.recipe.glyphs.length === 2
        ? 'purple'
        : definition.recipe.glyphs.length === 3 ? 'orange' : 'red';
    if (definition.quality !== expectedQuality
        || definition.formation.cellCount !== definition.recipe.glyphs.length) {
        throw new Error(`Invalid quality or footprint: ${definition.generalId}`);
    }
    const curves = [
        ['experience', definition.levelRules.experienceRequiredPoints, 0],
        ['attack', definition.baseStats.attackByLevel, 1],
        ['attackInterval', definition.baseStats.attackIntervalMsByLevel, 1],
        ['attackRange', definition.baseStats.attackRangeMilliCellsByLevel, 0],
        ['critChance', definition.baseStats.critChanceBpsByLevel, 0],
        ['critDamage', definition.baseStats.critDamageBpsByLevel, 10000],
        ['activeCooldown', definition.activeSkill.cooldownMsByLevel, 1000],
    ];
    for (const [name, value, minimum] of curves)
        validateCurve(value, `${definition.generalId}.${name}`, minimum);
    validateTargeting(definition.activeSkill.targeting, `${definition.generalId}.activeSkill.targeting`);
    validateEffectCurves(definition.basicAttack.effect, `${definition.generalId}.basicAttack`);
    for (const effect of definition.activeSkill.effects)
        validateEffectCurves(effect, `${definition.generalId}.activeSkill.${effect.effectId}`);
    for (const effect of definition.passiveSkill.structuredEffects ?? [])
        validateEffectCurves(effect, `${definition.generalId}.passiveSkill.${effect.effectId}`);
    if (definition.generalId === exports.HOUYI_GENERAL_ID
        && definition.baseStats.attackRangeMilliCellsByLevel.some((range) => range !== 3000)) {
        throw new Error('Houyi attack radius must remain exactly three cells');
    }
}
function validateGeneralCatalog(catalog = exports.GENERAL_CATALOG) {
    const definitions = Object.values(catalog);
    if (definitions.length !== 21)
        throw new Error(`General catalog must contain exactly 21 definitions, received ${definitions.length}`);
    const rosterIds = new Set(roster_1.GENERAL_ROSTER.map((entry) => entry.generalId));
    const definitionIds = new Set();
    const skillAndAttackIds = new Set();
    const effectIds = new Set();
    const parameterPatches = [];
    for (const definition of definitions) {
        if (definitionIds.has(definition.generalId) || catalog[definition.generalId] !== definition) {
            throw new Error(`Duplicate or mismatched general definition: ${definition.generalId}`);
        }
        definitionIds.add(definition.generalId);
        validateGeneralDefinition(definition);
        for (const id of [definition.basicAttack.attackId, definition.activeSkill.skillId, definition.passiveSkill.skillId]) {
            if (!id || skillAndAttackIds.has(id))
                throw new Error(`Duplicate skill/attack ID: ${id}`);
            skillAndAttackIds.add(id);
        }
        const effects = [
            definition.basicAttack.effect,
            ...(0, catalog_data_1.collectNestedEffects)(definition.activeSkill.effects),
            ...(0, catalog_data_1.collectNestedEffects)(definition.passiveSkill.structuredEffects ?? []),
        ];
        for (const effect of effects) {
            if (!effect.effectId || effectIds.has(effect.effectId))
                throw new Error(`Duplicate effect ID: ${effect.effectId}`);
            effectIds.add(effect.effectId);
            if (effect.type === 'effect_parameter_patch') {
                parameterPatches.push({ sourceId: effect.effectId, targetEffectId: effect.targetEffectId });
            }
        }
        for (const summonUnitId of (0, catalog_data_1.collectSummonReferences)(definition)) {
            if (!summon_catalog_1.SUMMON_UNIT_CATALOG[summonUnitId]) {
                throw new Error(`Unknown summon reference ${summonUnitId} in ${definition.generalId}`);
            }
        }
    }
    if (definitionIds.size !== rosterIds.size || [...rosterIds].some((generalId) => !definitionIds.has(generalId))) {
        throw new Error('General catalog must define every roster identity exactly once');
    }
    const summonEffectIds = new Set();
    for (const template of Object.values(summon_catalog_1.SUMMON_UNIT_CATALOG)) {
        summonEffectIds.add(template.basicAttack.attackId);
        if (template.onHitDamageOverTime)
            summonEffectIds.add(template.onHitDamageOverTime.effectId);
    }
    for (const patch of parameterPatches) {
        if (!effectIds.has(patch.targetEffectId) && !summonEffectIds.has(patch.targetEffectId)) {
            throw new Error(`Unresolved parameter patch target ${patch.targetEffectId} from ${patch.sourceId}`);
        }
    }
    validateSynergyEffectParameterPatches(catalog_1.SYNERGY_V1_CATALOG, catalog);
}
validateGeneralCatalog();
