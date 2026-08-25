"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPveBalanceSmokeChecks = runPveBalanceSmokeChecks;
const strict_1 = __importDefault(require("node:assert/strict"));
const balance_catalog_1 = require("./balance-catalog");
const balance_simulator_1 = require("./balance-simulator");
const economy_1 = require("./economy");
const catalogs_1 = require("./catalogs");
const runtime_1 = require("./runtime");
function maxAdjacentBudgetRatioBps(levelId, difficulty) {
    const waves = (0, balance_catalog_1.resolvePveWaveCatalog)(levelId, difficulty).waves;
    let maximum = 0;
    for (let index = 1; index < waves.length; index += 1) {
        const previous = (0, balance_catalog_1.physicalEffectiveHealth)(waves[index - 1]);
        const current = (0, balance_catalog_1.physicalEffectiveHealth)(waves[index]);
        maximum = Math.max(maximum, Math.floor(current * 10000 / previous));
    }
    return maximum;
}
function runPveBalanceSmokeChecks() {
    (0, balance_catalog_1.validatePveBalanceCatalog)();
    strict_1.default.deepEqual(balance_catalog_1.PVE_DIFFICULTIES, ['easy', 'normal', 'hard']);
    strict_1.default.deepEqual(balance_catalog_1.PVE_BASE_HP_BY_WAVE, [
        24, 28, 34, 42, 52, 65, 82, 104, 132, 168, 197, 231, 271, 318, 373, 438, 512, 601, 705, 826,
    ]);
    strict_1.default.deepEqual(balance_catalog_1.PVE_BASE_ARMOR_BY_WAVE, [
        0, 0, 1, 2, 3, 4, 5, 7, 9, 11, 13, 15, 17, 19, 22, 25, 28, 31, 34, 38,
    ]);
    strict_1.default.deepEqual(balance_catalog_1.PVE_BASE_MAGIC_RESISTANCE_BY_WAVE, [
        0, 0, 1, 1, 2, 3, 4, 6, 8, 10, 12, 14, 16, 18, 21, 24, 27, 30, 33, 36,
    ]);
    strict_1.default.deepEqual((0, balance_catalog_1.resolvePveBalanceProfile)(1, 'easy'), {
        profileId: 'pve-easy-l1-v2', levelId: 1, difficulty: 'easy',
        enemyHpMultiplierBps: 12750, enemyDefenseAdd: 0,
    });
    strict_1.default.deepEqual((0, balance_catalog_1.resolvePveBalanceProfile)(10, 'easy'), {
        profileId: 'pve-easy-l10-v2', levelId: 10, difficulty: 'easy',
        enemyHpMultiplierBps: 12900, enemyDefenseAdd: 9,
    });
    strict_1.default.deepEqual((0, balance_catalog_1.resolvePveBalanceProfile)(1, 'normal'), {
        profileId: 'pve-normal-l1-v2', levelId: 1, difficulty: 'normal',
        enemyHpMultiplierBps: 12900, enemyDefenseAdd: 4,
    });
    strict_1.default.deepEqual((0, balance_catalog_1.resolvePveBalanceProfile)(10, 'normal'), {
        profileId: 'pve-normal-l10-v2', levelId: 10, difficulty: 'normal',
        enemyHpMultiplierBps: 13700, enemyDefenseAdd: 13,
    });
    strict_1.default.deepEqual((0, balance_catalog_1.resolvePveBalanceProfile)(1, 'hard'), {
        profileId: 'pve-hard-shared-v2', levelId: 1, difficulty: 'hard',
        enemyHpMultiplierBps: 14800, enemyDefenseAdd: 18,
    });
    strict_1.default.throws(() => (0, balance_catalog_1.resolvePveBalanceProfile)(0, 'easy'));
    strict_1.default.throws(() => (0, balance_catalog_1.resolvePveBalanceProfile)(11, 'easy'));
    // 简单、普通必须随关卡递增。
    for (const difficulty of ['easy', 'normal']) {
        for (let levelId = 2; levelId <= balance_catalog_1.PVE_BALANCE_LEVEL_MAX; levelId += 1) {
            const previous = (0, balance_catalog_1.resolvePveWaveCatalog)(levelId - 1, difficulty).waves;
            const current = (0, balance_catalog_1.resolvePveWaveCatalog)(levelId, difficulty).waves;
            // HP 可使用平台预算，但不得倒退；关卡单调性由下方严格增长的双防一并保证。
            strict_1.default.ok(current.every((wave, index) => wave.maxHp >= previous[index].maxHp));
            strict_1.default.ok(current.every((wave, index) => wave.armor > previous[index].armor));
            strict_1.default.ok(current.every((wave, index) => wave.magicResistance > previous[index].magicResistance));
        }
    }
    // 困难模式 10 个场景的战斗数值必须逐字段相同。
    const hardReference = (0, balance_catalog_1.resolvePveWaveCatalog)(1, 'hard').waves;
    for (let levelId = 2; levelId <= balance_catalog_1.PVE_BALANCE_LEVEL_MAX; levelId += 1) {
        strict_1.default.deepEqual((0, balance_catalog_1.resolvePveWaveCatalog)(levelId, 'hard').waves, hardReference);
    }
    // 删除旧 W10 -> W11 十一倍断崖：任意相邻波物理预算增幅不超过 35%。
    let baseMaxAdjacentBudgetRatioBps = 0;
    for (const difficulty of balance_catalog_1.PVE_DIFFICULTIES) {
        for (let levelId = 1; levelId <= balance_catalog_1.PVE_BALANCE_LEVEL_MAX; levelId += 1) {
            const ratio = maxAdjacentBudgetRatioBps(levelId, difficulty);
            baseMaxAdjacentBudgetRatioBps = Math.max(baseMaxAdjacentBudgetRatioBps, ratio);
            strict_1.default.ok(ratio <= 13500, `${difficulty} level ${levelId} adjacent budget ratio ${ratio}`);
        }
    }
    // 固定构筑边界：简单 1 的前两波仍保留新手教学容错。
    const easyOneWaves = (0, balance_catalog_1.resolvePveWaveCatalog)(1, 'easy').waves;
    for (const soldierType of catalogs_1.SOLDIER_TYPES) {
        strict_1.default.equal((0, balance_simulator_1.simulateFixedSoldierWave)(easyOneWaves[0], [
            { soldierType, level: 1, count: 1 },
        ]).passesCapacityWindow, true);
        strict_1.default.equal((0, balance_simulator_1.simulateFixedSoldierWave)(easyOneWaves[1], [
            { soldierType, level: 1, count: 2 },
        ]).passesCapacityWindow, true);
        strict_1.default.equal((0, balance_simulator_1.simulateFixedSoldierWave)(easyOneWaves[4], [
            { soldierType, level: 5, count: 1 },
        ]).passesCapacityWindow, true);
    }
    // 运行时必须使用冻结后的数值，不是未乘区的基准目录。
    const runtime = new runtime_1.PveGameRuntime({
        seed: 'balance-runtime-snapshot', levelId: 7, difficulty: 'normal', prepDurationMs: 0, maxWaves: 1,
    });
    strict_1.default.equal(runtime.registerPlayer('balance-player', 'P1').ok, true);
    strict_1.default.equal(runtime.start().ok, true);
    const runtimeSnapshot = runtime.tick();
    const expectedWave = (0, balance_catalog_1.resolvePveWaveCatalog)(7, 'normal').waves[0];
    strict_1.default.equal(runtimeSnapshot.balance.profileId, 'pve-normal-l7-v2');
    strict_1.default.equal(runtimeSnapshot.enemies[0]?.maxHp, expectedWave.maxHp);
    strict_1.default.equal(runtimeSnapshot.enemies[0]?.armor, expectedWave.armor);
    strict_1.default.equal(runtimeSnapshot.enemies[0]?.magicResistance, expectedWave.magicResistance);
    // 简化 Monte Carlo 是趋势哨兵：固定种子必须完全可复现，难度不得倒挂。
    const simpleOnePureSoldier = (0, balance_simulator_1.runPureSoldierMonteCarlo)(512, 1, 'easy', 'balance-regression');
    strict_1.default.deepEqual(simpleOnePureSoldier, (0, balance_simulator_1.runPureSoldierMonteCarlo)(512, 1, 'easy', 'balance-regression'));
    // 该模型不计神将与局外装备，仍应让绝大多数正常经济种子到达终局。
    // 真实“新手首局 >=75%”还需几何机器人/真人埋点验证，这里使用 70% 防回归底线。
    strict_1.default.ok(simpleOnePureSoldier.clearRateBps >= 7000);
    strict_1.default.ok(simpleOnePureSoldier.p10HighestClearedWave >= 19);
    strict_1.default.equal(economy_1.PVE_FULL_MATCH_BASE_GROSS_RICE, 335);
    strict_1.default.equal(simpleOnePureSoldier.averageRecruitBatchesAfterWave5Milli, 12_000, '前5波应稳定支撑12批付费招募，形成招募/合成闭环');
    strict_1.default.ok(simpleOnePureSoldier.averageRecruitBatchesMilli >= 26_000
        && simpleOnePureSoldier.averageRecruitBatchesMilli <= 34_000, '完整简单局付费招募应落在26–34批目标区间');
    const fullClearEconomy = (0, balance_simulator_1.simulatePureSoldierEconomyRun)('gross:0', 1, 'easy');
    strict_1.default.equal(fullClearEconomy.highestClearedWave, 20);
    strict_1.default.equal(fullClearEconomy.grossRiceEarned, 335);
    strict_1.default.equal(fullClearEconomy.recruitBatchesAfterWave5, 12);
    strict_1.default.ok(fullClearEconomy.recruitBatches >= 26 && fullClearEconomy.recruitBatches <= 34);
    const simpleTenPureSoldier = (0, balance_simulator_1.runPureSoldierMonteCarlo)(512, 10, 'easy', 'balance-regression');
    const normalTenPureSoldier = (0, balance_simulator_1.runPureSoldierMonteCarlo)(512, 10, 'normal', 'balance-regression');
    const hardPureSoldier = (0, balance_simulator_1.runPureSoldierMonteCarlo)(512, 1, 'hard', 'balance-regression');
    strict_1.default.ok(simpleOnePureSoldier.averageHighestClearedWaveMilli
        >= simpleTenPureSoldier.averageHighestClearedWaveMilli);
    strict_1.default.ok(simpleTenPureSoldier.averageHighestClearedWaveMilli
        >= normalTenPureSoldier.averageHighestClearedWaveMilli);
    strict_1.default.ok(normalTenPureSoldier.averageHighestClearedWaveMilli
        >= hardPureSoldier.averageHighestClearedWaveMilli);
    return {
        baseMaxAdjacentBudgetRatioBps,
        simpleOnePureSoldier,
        simpleTenPureSoldier,
        normalTenPureSoldier,
        hardPureSoldier,
    };
}
if (require.main === module) {
    process.stdout.write(`${JSON.stringify(runPveBalanceSmokeChecks())}\n`);
}
