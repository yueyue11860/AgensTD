"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUMMON_UNIT_CATALOG = exports.SUMMON_UNIT_IDS = void 0;
exports.validateSummonUnitCatalog = validateSummonUnitCatalog;
exports.SUMMON_UNIT_IDS = {
    CELESTIAL_SOLDIER: 'celestial_soldier',
    MOON_RABBIT: 'moon_rabbit',
    MONKEY_SOLDIER: 'monkey_soldier',
    LOTUS_IMMORTAL_CHILD: 'lotus_immortal_child',
};
exports.SUMMON_UNIT_CATALOG = {
    [exports.SUMMON_UNIT_IDS.CELESTIAL_SOLDIER]: {
        schemaVersion: 1,
        summonUnitId: exports.SUMMON_UNIT_IDS.CELESTIAL_SOLDIER,
        displayName: '天兵',
        glyph: '兵',
        damageType: 'physical',
        combatTags: ['melee', 'summoned'],
        baseStats: {
            attackByOwnerLevel: [18, 23, 29, 37, 47],
            attackIntervalMsByOwnerLevel: [1200, 1140, 1080, 1020, 960],
            attackRangeMilliCellsByOwnerLevel: [1250, 1250, 1250, 1250, 1250],
            critChanceBpsByOwnerLevel: [500, 600, 700, 800, 1000],
            critDamageBpsByOwnerLevel: [15000, 15000, 15500, 15500, 16000],
        },
        basicAttack: {
            attackId: 'celestial_soldier_basic_attack',
            coefficientBps: 10000,
            criticalPolicy: 'can_crit',
        },
        onHitStatuses: [],
        onHitDamageOverTime: null,
        aura: null,
    },
    [exports.SUMMON_UNIT_IDS.MOON_RABBIT]: {
        schemaVersion: 1,
        summonUnitId: exports.SUMMON_UNIT_IDS.MOON_RABBIT,
        displayName: '月兔',
        glyph: '兔',
        damageType: 'magic',
        combatTags: ['ranged', 'summoned', 'slow', 'damage_over_time'],
        baseStats: {
            attackByOwnerLevel: [15, 19, 24, 31, 40],
            attackIntervalMsByOwnerLevel: [1350, 1280, 1210, 1140, 1070],
            attackRangeMilliCellsByOwnerLevel: [3000, 3000, 3000, 3000, 3000],
            critChanceBpsByOwnerLevel: [300, 400, 500, 600, 800],
            critDamageBpsByOwnerLevel: [15000, 15000, 15000, 15500, 16000],
        },
        basicAttack: {
            attackId: 'moon_rabbit_basic_attack',
            coefficientBps: 10000,
            criticalPolicy: 'can_crit',
        },
        onHitStatuses: [{
                statusId: 'slow',
                magnitudeBps: 2000,
                durationMs: 2000,
                chanceBps: 10000,
                stackGroup: 'moon_rabbit_slow',
            }],
        onHitDamageOverTime: {
            effectId: 'moon_rabbit_moonlight_dot',
            damageType: 'magic',
            ownerAttackCoefficientBpsPerTick: 1000,
            tickIntervalMs: 1000,
            durationMs: 2000,
            stackGroup: 'moon_rabbit_moonlight_dot',
        },
        aura: null,
    },
    [exports.SUMMON_UNIT_IDS.MONKEY_SOLDIER]: {
        schemaVersion: 1,
        summonUnitId: exports.SUMMON_UNIT_IDS.MONKEY_SOLDIER,
        displayName: '猴兵',
        glyph: '猴',
        damageType: 'physical',
        combatTags: ['melee', 'summoned', 'fast_attack', 'critical'],
        baseStats: {
            attackByOwnerLevel: [19, 24, 31, 40, 52],
            attackIntervalMsByOwnerLevel: [800, 760, 720, 680, 640],
            attackRangeMilliCellsByOwnerLevel: [1250, 1250, 1250, 1250, 1250],
            critChanceBpsByOwnerLevel: [800, 1000, 1200, 1500, 1800],
            critDamageBpsByOwnerLevel: [16000, 16500, 17000, 18000, 19000],
        },
        basicAttack: {
            attackId: 'monkey_soldier_basic_attack',
            coefficientBps: 10000,
            criticalPolicy: 'can_crit',
        },
        onHitStatuses: [],
        onHitDamageOverTime: null,
        aura: null,
    },
    [exports.SUMMON_UNIT_IDS.LOTUS_IMMORTAL_CHILD]: {
        schemaVersion: 1,
        summonUnitId: exports.SUMMON_UNIT_IDS.LOTUS_IMMORTAL_CHILD,
        displayName: '莲花仙童',
        glyph: '童',
        damageType: 'magic',
        combatTags: ['ranged', 'summoned', 'burn', 'attack_speed_aura'],
        baseStats: {
            attackByOwnerLevel: [24, 31, 40, 52, 68],
            attackIntervalMsByOwnerLevel: [1250, 1180, 1110, 1040, 970],
            attackRangeMilliCellsByOwnerLevel: [3000, 3000, 3000, 3000, 3000],
            critChanceBpsByOwnerLevel: [500, 600, 800, 1000, 1200],
            critDamageBpsByOwnerLevel: [15000, 15500, 16000, 16500, 17000],
        },
        basicAttack: {
            attackId: 'lotus_immortal_child_basic_attack',
            coefficientBps: 10000,
            criticalPolicy: 'can_crit',
        },
        onHitStatuses: [],
        onHitDamageOverTime: {
            effectId: 'lotus_immortal_child_burn',
            damageType: 'magic',
            ownerAttackCoefficientBpsPerTick: 1500,
            tickIntervalMs: 1000,
            durationMs: 3000,
            stackGroup: 'lotus_immortal_child_burn',
        },
        aura: {
            stat: 'attackSpeed',
            valueBps: 1500,
            radiusMilliCells: 2500,
            targetScope: 'owner_generals_and_soldiers',
        },
    },
};
function validateSummonUnitCatalog(catalog = exports.SUMMON_UNIT_CATALOG) {
    const entries = Object.values(catalog);
    if (entries.length !== 4) {
        throw new Error(`Summon unit catalog must contain exactly 4 entries, received ${entries.length}`);
    }
    const ids = new Set();
    const attackIds = new Set();
    for (const template of entries) {
        if (ids.has(template.summonUnitId) || catalog[template.summonUnitId] !== template) {
            throw new Error(`Duplicate or mismatched summonUnitId: ${template.summonUnitId}`);
        }
        ids.add(template.summonUnitId);
        if (attackIds.has(template.basicAttack.attackId)) {
            throw new Error(`Duplicate summon basic attack ID: ${template.basicAttack.attackId}`);
        }
        attackIds.add(template.basicAttack.attackId);
        if ([...template.glyph].length !== 1) {
            throw new Error(`Summon ${template.summonUnitId} glyph must be a single character`);
        }
        const curves = Object.values(template.baseStats);
        if (curves.some((curve) => curve.length !== 5
            || curve.some((value) => !Number.isSafeInteger(value)))) {
            throw new Error(`Summon ${template.summonUnitId} must define safe five-level curves`);
        }
    }
}
validateSummonUnitCatalog();
