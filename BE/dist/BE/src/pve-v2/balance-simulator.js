"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.simulateFixedSoldierWave = simulateFixedSoldierWave;
exports.simulatePureSoldierEconomyRun = simulatePureSoldierEconomyRun;
exports.runPureSoldierMonteCarlo = runPureSoldierMonteCarlo;
const catalogs_1 = require("./catalogs");
const prng_1 = require("./prng");
const balance_catalog_1 = require("./balance-catalog");
const economy_1 = require("./economy");
const CHARACTER_BRANCH_BPS = 1000;
const OVERLOAD_GRACE_MS = 10000;
const POPULATION_CAP = 10;
/**
 * 简化几何开火率：弓兵用射程换取更高覆盖，近战和群攻受路径转角影响。
 * 这些数值只用于无 UI 趋势回归，不会写入权威战斗。
 */
const GEOMETRY_UPTIME_BPS = {
    blade: 7000,
    spear: 6800,
    bow: 8800,
    cavalry: 6800,
};
function expectedSoldierDps(soldierType, level, armor) {
    const definition = (0, catalogs_1.getSoldierCatalogEntry)(soldierType);
    const attack = (0, catalogs_1.getSoldierLevelValue)(definition.attackByLevel, level);
    const intervalMs = (0, catalogs_1.getSoldierLevelValue)(definition.attackIntervalMsByLevel, level);
    const critChance = (0, catalogs_1.getSoldierLevelValue)(definition.critChanceBpsByLevel, level) / 10000;
    const critDamage = (0, catalogs_1.getSoldierLevelValue)(definition.critDamageBpsByLevel, level) / 10000;
    const expectedPrimaryDamage = attack * (1 + critChance * (critDamage - 1));
    const maxTargets = (0, catalogs_1.getSoldierLevelValue)(definition.maxTargetsByLevel, level);
    const secondaryRatio = (0, catalogs_1.getSoldierLevelValue)(definition.secondaryDamageBpsByLevel, level) / 10000;
    // 群攻的额外目标按 65% 密度折算，避免把每次满目标伪装成实战。
    const crowdFactor = 1 + Math.max(0, maxTargets - 1) * secondaryRatio * 0.65;
    const defenseRatio = 100 / (100 + Math.max(0, armor));
    const uptimeRatio = GEOMETRY_UPTIME_BPS[soldierType] / 10000;
    return expectedPrimaryDamage * crowdFactor * defenseRatio * uptimeRatio * 1000 / intervalMs;
}
function simulateFixedSoldierWave(wave, army) {
    const expectedDps = army.reduce((sum, stack) => (sum + expectedSoldierDps(stack.soldierType, stack.level, wave.armor) * Math.max(0, stack.count)), 0);
    const effectiveHealth = Math.floor(wave.maxHp * wave.countPerPlayer * (100 + wave.armor) / 100);
    const rawTotalHealth = wave.maxHp * wave.countPerPlayer;
    // 最后一只从第 0 只之后经过 count-1 个间隔生成。
    const spawnWindowMs = Math.max(0, wave.countPerPlayer - 1) * wave.spawnIntervalMs;
    const safeClearWindowMs = spawnWindowMs + OVERLOAD_GRACE_MS;
    // expectedDps 已经扣除护甲，因此清空时间使用原始总生命，避免对护甲重复折损。
    const expectedClearMs = expectedDps > 0 ? Math.ceil(rawTotalHealth / expectedDps * 1000) : Number.POSITIVE_INFINITY;
    return {
        waveNumber: wave.waveNumber,
        expectedDps,
        physicalEffectiveHealth: effectiveHealth,
        expectedClearMs,
        safeClearWindowMs,
        passesCapacityWindow: expectedClearMs <= safeClearWindowMs,
    };
}
function createEmptyArmy() {
    return {
        blade: [0, 0, 0, 0, 0],
        spear: [0, 0, 0, 0, 0],
        bow: [0, 0, 0, 0, 0],
        cavalry: [0, 0, 0, 0, 0],
    };
}
function addAndMerge(army, type) {
    army[type][0] += 1;
    for (let index = 0; index < 4; index += 1) {
        const pairs = Math.floor(army[type][index] / 2);
        if (pairs <= 0)
            break;
        army[type][index] -= pairs * 2;
        army[type][index + 1] += pairs;
    }
}
function armyStacks(army) {
    return catalogs_1.SOLDIER_TYPES.flatMap((soldierType) => army[soldierType]
        .map((count, index) => ({ soldierType, level: (index + 1), count }))
        .filter((entry) => entry.count > 0));
}
function selectBestTen(army, armor) {
    const individual = armyStacks(army).flatMap((stack) => Array.from({ length: stack.count }, () => ({
        soldierType: stack.soldierType,
        level: stack.level,
        dps: expectedSoldierDps(stack.soldierType, stack.level, armor),
    }))).sort((left, right) => right.dps - left.dps
        || right.level - left.level
        || left.soldierType.localeCompare(right.soldierType))
        .slice(0, POPULATION_CAP);
    const selected = new Map();
    for (const unit of individual) {
        const key = `${unit.soldierType}:${unit.level}`;
        const current = selected.get(key);
        if (current)
            current.count += 1;
        else
            selected.set(key, { soldierType: unit.soldierType, level: unit.level, count: 1 });
    }
    return [...selected.values()];
}
function recruitWhileAffordable(prng, army, state) {
    while (true) {
        const cost = (0, economy_1.resolvePvePaidRecruitBaseCost)(state.recruitBatches);
        if (state.rice < cost)
            return;
        state.rice -= cost;
        state.riceSpent += cost;
        const soldierTypes = [];
        for (let slot = 0; slot < 5; slot += 1) {
            if (!prng.rollBps(CHARACTER_BRANCH_BPS)) {
                soldierTypes.push(catalogs_1.SOLDIER_TYPES[prng.pickIndex(catalogs_1.SOLDIER_TYPES.length)]);
            }
        }
        if (state.recruitBatches === 0 && soldierTypes.length === 0) {
            soldierTypes.push(catalogs_1.SOLDIER_TYPES[prng.pickIndex(catalogs_1.SOLDIER_TYPES.length)]);
        }
        for (const soldierType of soldierTypes)
            addAndMerge(army, soldierType);
        state.recruitBatches += 1;
    }
}
/**
 * 正常经济、每批 10% 字符损耗、自动合成且完美选位的“纯天兵上限”。
 * 它不代表玩家通关率；用来防止后续调参又出现第 11 波断崖。
 */
function simulatePureSoldierEconomyRun(seed, levelId = 1, difficulty = 'easy') {
    const prng = new prng_1.DeterministicPrng(seed);
    const army = createEmptyArmy();
    const economy = { rice: economy_1.PVE_STARTING_RICE, recruitBatches: 0, riceSpent: 0 };
    let grossRiceEarned = economy_1.PVE_STARTING_RICE;
    let recruitBatchesAfterWave5 = 0;
    const waves = (0, balance_catalog_1.resolvePveWaveCatalog)(levelId, difficulty).waves;
    recruitWhileAffordable(prng, army, economy);
    let highestClearedWave = 0;
    for (const wave of waves) {
        const deployed = selectBestTen(army, wave.armor);
        if (!simulateFixedSoldierWave(wave, deployed).passesCapacityWindow)
            break;
        highestClearedWave = wave.waveNumber;
        const waveIncome = wave.countPerPlayer
            + (0, economy_1.resolvePveLaneClearRiceReward)(wave.waveNumber)
            + (0, economy_1.resolvePveBossRiceReward)(wave.waveNumber);
        economy.rice += waveIncome;
        grossRiceEarned += waveIncome;
        recruitWhileAffordable(prng, army, economy);
        if (wave.waveNumber === 5)
            recruitBatchesAfterWave5 = economy.recruitBatches;
    }
    return {
        seed,
        levelId,
        difficulty,
        highestClearedWave,
        recruitBatches: economy.recruitBatches,
        recruitBatchesAfterWave5,
        grossRiceEarned,
        riceSpent: economy.riceSpent,
        remainingRice: economy.rice,
        finalArmy: armyStacks(army),
    };
}
function percentile(sorted, ratio) {
    if (sorted.length === 0)
        return 0;
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)))];
}
function runPureSoldierMonteCarlo(runs, levelId = 1, difficulty = 'easy', seedPrefix = 'pve-balance') {
    if (!Number.isInteger(runs) || runs < 1)
        throw new Error('runs must be a positive integer');
    const results = Array.from({ length: runs }, (_, index) => (simulatePureSoldierEconomyRun(`${seedPrefix}:${index}`, levelId, difficulty)));
    const cleared = results.map(result => result.highestClearedWave).sort((left, right) => left - right);
    const histogram = {};
    for (const wave of cleared)
        histogram[wave] = (histogram[wave] ?? 0) + 1;
    return {
        runs,
        clearRateBps: Math.floor(cleared.filter((wave) => wave >= 20).length * 10000 / runs),
        averageHighestClearedWaveMilli: Math.floor(cleared.reduce((sum, wave) => sum + wave, 0) * 1000 / runs),
        medianHighestClearedWave: percentile(cleared, 0.5),
        p10HighestClearedWave: percentile(cleared, 0.1),
        p90HighestClearedWave: percentile(cleared, 0.9),
        averageRecruitBatchesMilli: Math.floor(results.reduce((sum, result) => sum + result.recruitBatches, 0) * 1000 / runs),
        averageRecruitBatchesAfterWave5Milli: Math.floor(results.reduce((sum, result) => sum + result.recruitBatchesAfterWave5, 0) * 1000 / runs),
        averageRemainingRiceMilli: Math.floor(results.reduce((sum, result) => sum + result.remainingRice, 0) * 1000 / runs),
        histogram,
    };
}
