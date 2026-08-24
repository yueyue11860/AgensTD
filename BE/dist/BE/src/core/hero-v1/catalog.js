"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GENERAL_CATALOG = exports.HOUYI_DEFINITION = exports.GENERAL_EXPERIENCE_POINT_SCALE = exports.HOUYI_GENERAL_ID = void 0;
exports.getGeneralLevelValue = getGeneralLevelValue;
exports.getGeneralDefinition = getGeneralDefinition;
exports.cumulativeExperienceRequiredForLevel = cumulativeExperienceRequiredForLevel;
exports.fullRankExperienceRequired = fullRankExperienceRequired;
exports.levelForExperience = levelForExperience;
exports.resolveGeneralStats = resolveGeneralStats;
exports.validateGeneralDefinition = validateGeneralDefinition;
exports.HOUYI_GENERAL_ID = 'houyi';
/** 1000 内部点 = UI 1.0 经验。 */
exports.GENERAL_EXPERIENCE_POINT_SCALE = 1000;
exports.HOUYI_DEFINITION = {
    schemaVersion: 1,
    generalId: exports.HOUYI_GENERAL_ID,
    name: '后羿',
    quality: 'purple',
    recipe: {
        glyphs: ['后', '羿'],
        orientation: 'horizontal_left_to_right',
        priority: 100,
    },
    formation: {
        cellCount: 2,
        anchor: 'footprint_center',
        visual: 'character_tiles',
    },
    uniqueness: {
        scope: 'player',
        maxPerMatch: 1,
    },
    archetype: 'physical',
    factions: ['mythic', 'moon_palace'],
    combatTags: ['ranged', 'single_target', 'critical', 'boss_hunter'],
    levelRules: {
        initialLevel: 1,
        defaultMaxLevel: 3,
        breakthroughMaxLevel: 5,
        experienceRequiredPoints: [10000, 20000, 30000, 60000, 100000],
    },
    baseStats: {
        attackByLevel: [34, 43, 55, 71, 92],
        attackIntervalMsByLevel: [1350, 1250, 1150, 1050, 950],
        attackRangeMilliCellsByLevel: [3000, 3000, 3000, 3000, 3000],
        critChanceBpsByLevel: [1000, 1200, 1400, 1600, 2000],
        critDamageBpsByLevel: [17500, 18000, 18500, 19000, 20000],
    },
    basicAttack: {
        attackId: 'houyi_basic_arrow',
        targeting: {
            scope: 'enemies_in_radius',
            priority: 'furthest_progress',
            targetLimit: 1,
        },
        effect: {
            effectId: 'houyi_basic_arrow_damage',
            type: 'damage',
            damageType: 'physical',
            coefficientBpsByLevel: [10000, 10000, 10000, 10000, 10000],
            flatDamageByLevel: [0, 0, 0, 0, 0],
            criticalPolicy: 'can_crit',
            targetLimit: 1,
            tags: ['direct', 'basic_attack', 'projectile'],
        },
    },
    activeSkill: {
        skillId: 'chuanyun_zhurijian',
        skillName: '穿云逐日箭',
        trigger: 'auto',
        cooldownMsByLevel: [12000, 11600, 11200, 10600, 10000],
        targeting: {
            scope: 'enemies_in_attack_range',
            priority: 'highest_current_hp',
            targetLimit: 1,
        },
        effects: [{
                effectId: 'houyi_chuanyun_zhurijian_damage',
                type: 'damage',
                damageType: 'physical',
                coefficientBpsByLevel: [22000, 24000, 26000, 28500, 32000],
                flatDamageByLevel: [0, 0, 0, 0, 0],
                criticalPolicy: 'can_crit',
                targetLimit: 1,
                tags: ['direct', 'active_skill', 'single_target', 'projectile'],
            }],
    },
    passiveSkill: {
        skillId: 'shenshe_zhunxin',
        skillName: '神射准心',
        effects: [{
                source: { kind: 'passive', sourceId: 'shenshe_zhunxin' },
                target: { scope: 'self' },
                stat: 'damageDealt',
                operation: 'add_ratio',
                value: 2000,
                stackGroup: 'houyi_boss_damage_bonus',
                condition: { targetTagsAny: ['boss'] },
            }],
    },
    relatedSynergyIds: [
        'moon_palace_companions',
        'piercing_cloud_duo',
        'physical_heavenly_venerates',
    ],
};
exports.GENERAL_CATALOG = {
    [exports.HOUYI_GENERAL_ID]: exports.HOUYI_DEFINITION,
};
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
    let critDamageFlat = 0;
    let damageDealtRatio = 0;
    for (const modifier of [...definition.passiveSkill.effects, ...modifiers]) {
        if (modifier.target.scope === 'synergy_members'
            && modifier.target.generalIds
            && !modifier.target.generalIds.includes(definition.generalId)) {
            continue;
        }
        if (modifier.condition?.targetTagsAny
            && !modifier.condition.targetTagsAny.some((tag) => targetTags.includes(tag))) {
            continue;
        }
        if (modifier.stat === 'attack') {
            modifier.operation === 'add_flat' ? attackFlat += modifier.value : attackRatio += modifier.value;
        }
        else if (modifier.stat === 'attackSpeed' && modifier.operation === 'add_ratio') {
            attackSpeedRatio += modifier.value;
        }
        else if (modifier.stat === 'attackRange') {
            modifier.operation === 'add_flat' ? attackRangeFlat += modifier.value : attackRangeRatio += modifier.value;
        }
        else if (modifier.stat === 'critRate' && modifier.operation === 'add_flat') {
            critRateFlat += modifier.value;
        }
        else if (modifier.stat === 'critDamage' && modifier.operation === 'add_flat') {
            critDamageFlat += modifier.value;
        }
        else if (modifier.stat === 'damageDealt' && modifier.operation === 'add_ratio') {
            damageDealtRatio += modifier.value;
        }
    }
    const baseAttack = getGeneralLevelValue(definition.baseStats.attackByLevel, level);
    const baseInterval = getGeneralLevelValue(definition.baseStats.attackIntervalMsByLevel, level);
    const baseRange = getGeneralLevelValue(definition.baseStats.attackRangeMilliCellsByLevel, level);
    return {
        attack: Math.max(1, Math.floor((baseAttack + attackFlat) * (10000 + attackRatio) / 10000)),
        attackIntervalMs: Math.max(200, Math.ceil(baseInterval * 10000 / Math.max(1, 10000 + attackSpeedRatio))),
        attackRangeMilliCells: Math.max(0, Math.floor((baseRange + attackRangeFlat) * (10000 + attackRangeRatio) / 10000)),
        critChanceBps: Math.min(10000, Math.max(0, getGeneralLevelValue(definition.baseStats.critChanceBpsByLevel, level) + critRateFlat)),
        critDamageBps: Math.max(10000, getGeneralLevelValue(definition.baseStats.critDamageBpsByLevel, level) + critDamageFlat),
        damageDealtRatioBps: Math.max(0, 10000 + damageDealtRatio),
    };
}
function validateGeneralDefinition(definition) {
    const expectedQuality = definition.recipe.glyphs.length === 2
        ? 'purple'
        : definition.recipe.glyphs.length === 3 ? 'orange' : 'red';
    if (definition.generalId.length === 0 || definition.quality !== expectedQuality) {
        throw new Error(`Invalid identity or quality for general ${definition.generalId}`);
    }
    if (definition.recipe.glyphs.some((glyph) => [...glyph].length !== 1)) {
        throw new Error(`General ${definition.generalId} recipe must contain single glyphs`);
    }
    if (definition.formation.cellCount !== definition.recipe.glyphs.length) {
        throw new Error(`General ${definition.generalId} formation footprint mismatch`);
    }
    const curves = [
        definition.levelRules.experienceRequiredPoints,
        definition.baseStats.attackByLevel,
        definition.baseStats.attackIntervalMsByLevel,
        definition.baseStats.attackRangeMilliCellsByLevel,
        definition.baseStats.critChanceBpsByLevel,
        definition.baseStats.critDamageBpsByLevel,
        definition.activeSkill.cooldownMsByLevel,
        ...definition.activeSkill.effects.flatMap((effect) => [effect.coefficientBpsByLevel, effect.flatDamageByLevel]),
    ];
    if (curves.some((curve) => curve.length !== 5 || curve.some((value) => !Number.isSafeInteger(value)))) {
        throw new Error(`General ${definition.generalId} must define integer five-level curves`);
    }
    if (definition.baseStats.attackRangeMilliCellsByLevel.some((range) => range < 0)) {
        throw new Error(`General ${definition.generalId} attack range cannot be negative`);
    }
    if (definition.generalId === exports.HOUYI_GENERAL_ID
        && definition.baseStats.attackRangeMilliCellsByLevel.some((range) => range !== 3000)) {
        throw new Error('Houyi attack radius must remain exactly three cells');
    }
}
for (const definition of Object.values(exports.GENERAL_CATALOG)) {
    validateGeneralDefinition(definition);
}
