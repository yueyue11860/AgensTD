"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WAVE_MINION_CATALOG = exports.SOLDIER_CATALOG = exports.SOLDIER_TYPES = void 0;
exports.getSoldierCatalogEntry = getSoldierCatalogEntry;
exports.getSoldierLevelValue = getSoldierLevelValue;
exports.getWaveMinionCatalogEntry = getWaveMinionCatalogEntry;
exports.validatePveV2Catalogs = validatePveV2Catalogs;
const economy_1 = require("./economy");
exports.SOLDIER_TYPES = ['blade', 'spear', 'bow', 'cavalry'];
const CRIT_DAMAGE = [15000, 15000, 15000, 15000, 15000];
const BASE_BOSS_DAMAGE = [10000, 10000, 10000, 10000, 10000];
const ONE_TARGET = [1, 1, 1, 1, 1];
const NO_SECONDARY = [0, 0, 0, 0, 0];
const NO_RADIUS = [0, 0, 0, 0, 0];
exports.SOLDIER_CATALOG = {
    blade: {
        soldierType: 'blade',
        glyph: '刀',
        displayName: '天刀兵',
        damageType: 'physical',
        attackShape: 'single',
        // 单体刀兵以较高的单点 DPS 和中近程覆盖换取“不会进攻第二目标”的明确弱点。
        attackByLevel: [21, 34, 57, 92, 153],
        attackIntervalMsByLevel: [1000, 950, 900, 850, 800],
        attackRangeMilliCellsByLevel: [2750, 2900, 3050, 3200, 3500],
        critChanceBpsByLevel: [500, 600, 700, 800, 1000],
        critDamageBpsByLevel: CRIT_DAMAGE,
        bossDamageBpsByLevel: [11500, 11500, 11500, 11500, 11500],
        maxTargetsByLevel: ONE_TARGET,
        secondaryDamageBpsByLevel: NO_SECONDARY,
        radiusMilliCellsByLevel: NO_RADIUS,
    },
    spear: {
        soldierType: 'spear',
        glyph: '枪',
        displayName: '天枪兵',
        damageType: 'physical',
        attackShape: 'line_pierce',
        attackByLevel: [19, 31, 52, 85, 139],
        attackIntervalMsByLevel: [1050, 1000, 950, 900, 850],
        attackRangeMilliCellsByLevel: [3250, 3400, 3550, 3700, 4000],
        critChanceBpsByLevel: [400, 500, 600, 700, 800],
        critDamageBpsByLevel: CRIT_DAMAGE,
        bossDamageBpsByLevel: BASE_BOSS_DAMAGE,
        maxTargetsByLevel: [2, 2, 3, 3, 4],
        secondaryDamageBpsByLevel: [8500, 8500, 8500, 8500, 8500],
        // line_pierce 使用该字段作为穿透带半宽；强项来自队列命中而非隐藏伤害乘区。
        radiusMilliCellsByLevel: [1100, 1200, 1300, 1400, 1500],
    },
    bow: {
        soldierType: 'bow',
        glyph: '弓',
        displayName: '天弓兵',
        damageType: 'physical',
        attackShape: 'single',
        attackByLevel: [14, 24, 40, 67, 112],
        attackIntervalMsByLevel: [1300, 1250, 1200, 1150, 1100],
        // 保留最长射程与补漏定位，但不再以 2–3 倍近战 uptime 覆盖大半张地图。
        attackRangeMilliCellsByLevel: [4400, 4650, 4900, 5150, 5400],
        critChanceBpsByLevel: [800, 1000, 1200, 1400, 1600],
        critDamageBpsByLevel: CRIT_DAMAGE,
        bossDamageBpsByLevel: BASE_BOSS_DAMAGE,
        maxTargetsByLevel: ONE_TARGET,
        secondaryDamageBpsByLevel: NO_SECONDARY,
        radiusMilliCellsByLevel: NO_RADIUS,
    },
    cavalry: {
        soldierType: 'cavalry',
        glyph: '骑',
        displayName: '天骑兵',
        damageType: 'physical',
        attackShape: 'radius',
        attackByLevel: [21, 34, 56, 94, 158],
        attackIntervalMsByLevel: [1400, 1350, 1300, 1250, 1200],
        attackRangeMilliCellsByLevel: [3250, 3400, 3550, 3700, 4000],
        critChanceBpsByLevel: [400, 500, 600, 700, 800],
        critDamageBpsByLevel: CRIT_DAMAGE,
        bossDamageBpsByLevel: BASE_BOSS_DAMAGE,
        maxTargetsByLevel: [2, 2, 3, 3, 4],
        secondaryDamageBpsByLevel: [6500, 6500, 6500, 6500, 6500],
        radiusMilliCellsByLevel: [1250, 1250, 1500, 1500, 1750],
    },
};
const wave = (waveNumber, glyphPool, maxHp, armor, magicResistance, spawnIntervalMs) => ({
    waveNumber,
    glyphPool,
    countPerPlayer: 10,
    maxHp,
    armor,
    magicResistance,
    moveSpeedMilliCellsPerSecond: 1000,
    spawnIntervalMs,
    riceReward: economy_1.PVE_ORDINARY_ENEMY_RICE_REWARD,
    xpRewardPoints: 1000,
});
exports.WAVE_MINION_CATALOG = [
    // 这里是未经关卡/难度乘区的平滑基准。对局实际数值由 balance-catalog.ts 解析。
    wave(1, ['鬼'], 24, 0, 0, 2500),
    wave(2, ['鬼', '怪'], 28, 0, 0, 2300),
    wave(3, ['怪', '妖'], 34, 1, 1, 2200),
    wave(4, ['妖', '魅'], 42, 2, 1, 2100),
    wave(5, ['妖', '魔'], 52, 3, 2, 2000),
    wave(6, ['魅', '妖'], 65, 4, 3, 1950),
    wave(7, ['妖', '怪'], 82, 5, 4, 1900),
    wave(8, ['魔', '魅'], 104, 7, 6, 1850),
    wave(9, ['魔', '妖'], 132, 9, 8, 1800),
    wave(10, ['魔', '怪'], 168, 11, 10, 1750),
    // W11–W20 将裸 HP 环比收紧到约 1.172，使真实波次重叠不再在 W14 后指数失控。
    // 防御仍逐波增长，Boss 仍由同波权威预算派生，未注入机器人专用乘区。
    wave(11, ['魔', '魅'], 197, 13, 12, 1700),
    wave(12, ['魔', '妖'], 231, 15, 14, 1700),
    wave(13, ['鬼', '魅'], 271, 17, 16, 1650),
    wave(14, ['妖', '魔'], 318, 19, 18, 1650),
    wave(15, ['魔', '魅'], 373, 22, 21, 1600),
    wave(16, ['魔', '妖'], 438, 25, 24, 1600),
    wave(17, ['鬼', '魔'], 512, 28, 27, 1550),
    wave(18, ['妖', '魅'], 601, 31, 30, 1550),
    wave(19, ['魔', '鬼'], 705, 34, 33, 1500),
    wave(20, ['魔', '魅'], 826, 38, 36, 1500),
];
function getSoldierCatalogEntry(type) {
    return exports.SOLDIER_CATALOG[type];
}
function getSoldierLevelValue(values, level) {
    return values[level - 1];
}
function getWaveMinionCatalogEntry(waveNumber) {
    return exports.WAVE_MINION_CATALOG[waveNumber - 1] ?? null;
}
function validatePveV2Catalogs() {
    for (const type of exports.SOLDIER_TYPES) {
        const entry = exports.SOLDIER_CATALOG[type];
        const arrays = [
            entry.attackByLevel,
            entry.attackIntervalMsByLevel,
            entry.attackRangeMilliCellsByLevel,
            entry.critChanceBpsByLevel,
            entry.critDamageBpsByLevel,
            entry.bossDamageBpsByLevel,
            entry.maxTargetsByLevel,
            entry.secondaryDamageBpsByLevel,
            entry.radiusMilliCellsByLevel,
        ];
        if (arrays.some((values) => values.length !== 5)) {
            throw new Error(`Soldier catalog ${type} must define exactly five levels`);
        }
    }
    if (exports.WAVE_MINION_CATALOG.length !== 20) {
        throw new Error('Wave minion catalog must define exactly twenty waves');
    }
    for (let index = 0; index < exports.WAVE_MINION_CATALOG.length; index += 1) {
        const entry = exports.WAVE_MINION_CATALOG[index];
        if (entry.waveNumber !== index + 1
            || entry.countPerPlayer !== 10
            || entry.moveSpeedMilliCellsPerSecond !== 1000) {
            throw new Error(`Invalid wave catalog entry at index ${index}`);
        }
    }
}
