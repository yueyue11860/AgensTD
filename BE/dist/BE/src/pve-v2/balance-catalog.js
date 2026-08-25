"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PVE_BASE_MAGIC_RESISTANCE_BY_WAVE = exports.PVE_BASE_ARMOR_BY_WAVE = exports.PVE_BASE_HP_BY_WAVE = exports.PVE_BALANCE_WAVE_COUNT = exports.PVE_BALANCE_LEVEL_MAX = exports.PVE_BALANCE_LEVEL_MIN = exports.PVE_DIFFICULTIES = void 0;
exports.resolvePveBalanceProfile = resolvePveBalanceProfile;
exports.resolvePveWaveCatalog = resolvePveWaveCatalog;
exports.getResolvedPveWave = getResolvedPveWave;
exports.physicalEffectiveHealth = physicalEffectiveHealth;
exports.validatePveBalanceCatalog = validatePveBalanceCatalog;
const catalogs_1 = require("./catalogs");
const pve_stage_config_1 = require("../../../shared/contracts/pve-stage-config");
Object.defineProperty(exports, "PVE_DIFFICULTIES", { enumerable: true, get: function () { return pve_stage_config_1.PVE_DIFFICULTIES; } });
exports.PVE_BALANCE_LEVEL_MIN = 1;
exports.PVE_BALANCE_LEVEL_MAX = 10;
exports.PVE_BALANCE_WAVE_COUNT = 20;
exports.PVE_BASE_HP_BY_WAVE = Object.freeze(catalogs_1.WAVE_MINION_CATALOG.map((wave) => wave.maxHp));
exports.PVE_BASE_ARMOR_BY_WAVE = Object.freeze(catalogs_1.WAVE_MINION_CATALOG.map((wave) => wave.armor));
exports.PVE_BASE_MAGIC_RESISTANCE_BY_WAVE = Object.freeze(catalogs_1.WAVE_MINION_CATALOG.map((wave) => wave.magicResistance));
const EASY_HP_MULTIPLIER_BPS_BY_LEVEL = [
    12750, 12900, 12900, 12900, 12900, 12900, 12900, 12900, 12900, 12900,
];
const NORMAL_HP_MULTIPLIER_BPS_BY_LEVEL = [
    12900, 12920, 12940, 12960, 12980, 13100, 13300, 13500, 13600, 13700,
];
function assertLevelId(levelId) {
    if (!Number.isInteger(levelId) || levelId < exports.PVE_BALANCE_LEVEL_MIN || levelId > exports.PVE_BALANCE_LEVEL_MAX) {
        throw new Error(`PVE balance levelId must be an integer from ${exports.PVE_BALANCE_LEVEL_MIN} to ${exports.PVE_BALANCE_LEVEL_MAX}`);
    }
}
function assertDifficulty(difficulty) {
    if (!pve_stage_config_1.PVE_DIFFICULTIES.includes(difficulty)) {
        throw new Error(`Unknown PVE difficulty: ${difficulty}`);
    }
}
/**
 * 简单、普通随关卡序号递增；困难的 10 个场景使用完全相同的战斗预算。
 * 场景字池不在这里解析，因而不会意外改变难度。
 */
function resolvePveBalanceProfile(levelId, difficulty) {
    assertLevelId(levelId);
    assertDifficulty(difficulty);
    if (difficulty === 'easy') {
        return {
            profileId: `pve-easy-l${levelId}-v2`,
            levelId,
            difficulty,
            enemyHpMultiplierBps: EASY_HP_MULTIPLIER_BPS_BY_LEVEL[levelId - 1],
            enemyDefenseAdd: levelId - 1,
        };
    }
    if (difficulty === 'normal') {
        return {
            profileId: `pve-normal-l${levelId}-v2`,
            levelId,
            difficulty,
            enemyHpMultiplierBps: NORMAL_HP_MULTIPLIER_BPS_BY_LEVEL[levelId - 1],
            enemyDefenseAdd: 4 + (levelId - 1),
        };
    }
    return {
        // 困难模式的 profileId 也故意不带 levelId，便于快照审计。
        profileId: 'pve-hard-shared-v2',
        levelId,
        difficulty,
        enemyHpMultiplierBps: 14800,
        enemyDefenseAdd: 18,
    };
}
function resolvePveWaveCatalog(levelId, difficulty) {
    const profile = resolvePveBalanceProfile(levelId, difficulty);
    const waves = catalogs_1.WAVE_MINION_CATALOG.map((base) => ({
        ...base,
        maxHp: Math.max(1, Math.floor(base.maxHp * profile.enemyHpMultiplierBps / 10000)),
        armor: Math.max(0, base.armor + profile.enemyDefenseAdd),
        magicResistance: Math.max(0, base.magicResistance + profile.enemyDefenseAdd),
    }));
    return { profile, waves };
}
function getResolvedPveWave(levelId, difficulty, waveNumber) {
    if (!Number.isInteger(waveNumber) || waveNumber < 1 || waveNumber > exports.PVE_BALANCE_WAVE_COUNT)
        return null;
    return resolvePveWaveCatalog(levelId, difficulty).waves[waveNumber - 1] ?? null;
}
function physicalEffectiveHealth(entry) {
    return Math.floor(entry.maxHp * entry.countPerPlayer * (100 + entry.armor) / 100);
}
function validatePveBalanceCatalog() {
    if (catalogs_1.WAVE_MINION_CATALOG.length !== exports.PVE_BALANCE_WAVE_COUNT) {
        throw new Error(`PVE balance base catalog must define ${exports.PVE_BALANCE_WAVE_COUNT} waves`);
    }
    for (const difficulty of pve_stage_config_1.PVE_DIFFICULTIES) {
        for (let levelId = exports.PVE_BALANCE_LEVEL_MIN; levelId <= exports.PVE_BALANCE_LEVEL_MAX; levelId += 1) {
            const resolved = resolvePveWaveCatalog(levelId, difficulty);
            if (resolved.waves.length !== exports.PVE_BALANCE_WAVE_COUNT)
                throw new Error('Resolved PVE wave count changed');
            for (let index = 0; index < resolved.waves.length; index += 1) {
                const current = resolved.waves[index];
                if (current.waveNumber !== index + 1 || current.countPerPlayer !== 10) {
                    throw new Error(`Invalid resolved PVE wave ${index + 1}`);
                }
            }
        }
    }
}
