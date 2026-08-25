import assert from 'node:assert/strict'
import {
  PVE_BALANCE_LEVEL_MAX,
  PVE_BASE_ARMOR_BY_WAVE,
  PVE_BASE_HP_BY_WAVE,
  PVE_BASE_MAGIC_RESISTANCE_BY_WAVE,
  PVE_DIFFICULTIES,
  physicalEffectiveHealth,
  resolvePveBalanceProfile,
  resolvePveWaveCatalog,
  validatePveBalanceCatalog,
} from './balance-catalog'
import {
  runPureSoldierMonteCarlo,
  simulateFixedSoldierWave,
  type PureSoldierMonteCarloSummary,
} from './balance-simulator'
import { SOLDIER_TYPES } from './catalogs'
import type { SoldierLevel } from './types'
import { PveGameRuntime } from './runtime'

export interface PveBalanceSmokeReport {
  baseMaxAdjacentBudgetRatioBps: number
  simpleOnePureSoldier: PureSoldierMonteCarloSummary
  simpleTenPureSoldier: PureSoldierMonteCarloSummary
  normalTenPureSoldier: PureSoldierMonteCarloSummary
  hardPureSoldier: PureSoldierMonteCarloSummary
}

function maxAdjacentBudgetRatioBps(levelId: number, difficulty: 'easy' | 'normal' | 'hard'): number {
  const waves = resolvePveWaveCatalog(levelId, difficulty).waves
  let maximum = 0
  for (let index = 1; index < waves.length; index += 1) {
    const previous = physicalEffectiveHealth(waves[index - 1])
    const current = physicalEffectiveHealth(waves[index])
    maximum = Math.max(maximum, Math.floor(current * 10000 / previous))
  }
  return maximum
}

export function runPveBalanceSmokeChecks(): PveBalanceSmokeReport {
  validatePveBalanceCatalog()

  assert.deepEqual(PVE_DIFFICULTIES, ['easy', 'normal', 'hard'])
  assert.deepEqual(PVE_BASE_HP_BY_WAVE, [
    24, 28, 34, 42, 52, 65, 82, 104, 132, 168, 220, 285, 370, 480, 620, 800, 1020, 1300, 1650, 2100,
  ])
  assert.deepEqual(PVE_BASE_ARMOR_BY_WAVE, [
    0, 0, 1, 2, 3, 4, 5, 7, 9, 11, 13, 15, 17, 19, 22, 25, 28, 31, 34, 38,
  ])
  assert.deepEqual(PVE_BASE_MAGIC_RESISTANCE_BY_WAVE, [
    0, 0, 1, 1, 2, 3, 4, 6, 8, 10, 12, 14, 16, 18, 21, 24, 27, 30, 33, 36,
  ])
  assert.deepEqual(resolvePveBalanceProfile(1, 'easy'), {
    profileId: 'pve-easy-l1-v1', levelId: 1, difficulty: 'easy',
    enemyHpMultiplierBps: 8500, enemyDefenseAdd: 0,
  })
  assert.deepEqual(resolvePveBalanceProfile(10, 'easy'), {
    profileId: 'pve-easy-l10-v1', levelId: 10, difficulty: 'easy',
    enemyHpMultiplierBps: 13000, enemyDefenseAdd: 9,
  })
  assert.deepEqual(resolvePveBalanceProfile(1, 'normal'), {
    profileId: 'pve-normal-l1-v1', levelId: 1, difficulty: 'normal',
    enemyHpMultiplierBps: 13500, enemyDefenseAdd: 8,
  })
  assert.deepEqual(resolvePveBalanceProfile(10, 'normal'), {
    profileId: 'pve-normal-l10-v1', levelId: 10, difficulty: 'normal',
    enemyHpMultiplierBps: 19800, enemyDefenseAdd: 17,
  })
  assert.deepEqual(resolvePveBalanceProfile(1, 'hard'), {
    profileId: 'pve-hard-shared-v1', levelId: 1, difficulty: 'hard',
    enemyHpMultiplierBps: 24000, enemyDefenseAdd: 26,
  })
  assert.throws(() => resolvePveBalanceProfile(0, 'easy'))
  assert.throws(() => resolvePveBalanceProfile(11, 'easy'))

  // 简单、普通必须随关卡递增。
  for (const difficulty of ['easy', 'normal'] as const) {
    for (let levelId = 2; levelId <= PVE_BALANCE_LEVEL_MAX; levelId += 1) {
      const previous = resolvePveWaveCatalog(levelId - 1, difficulty).waves
      const current = resolvePveWaveCatalog(levelId, difficulty).waves
      assert.ok(current.every((wave, index) => wave.maxHp > previous[index].maxHp))
      assert.ok(current.every((wave, index) => wave.armor > previous[index].armor))
      assert.ok(current.every((wave, index) => wave.magicResistance > previous[index].magicResistance))
    }
  }

  // 困难模式 10 个场景的战斗数值必须逐字段相同。
  const hardReference = resolvePveWaveCatalog(1, 'hard').waves
  for (let levelId = 2; levelId <= PVE_BALANCE_LEVEL_MAX; levelId += 1) {
    assert.deepEqual(resolvePveWaveCatalog(levelId, 'hard').waves, hardReference)
  }

  // 删除旧 W10 -> W11 十一倍断崖：任意相邻波物理预算增幅不超过 35%。
  let baseMaxAdjacentBudgetRatioBps = 0
  for (const difficulty of PVE_DIFFICULTIES) {
    for (let levelId = 1; levelId <= PVE_BALANCE_LEVEL_MAX; levelId += 1) {
      const ratio = maxAdjacentBudgetRatioBps(levelId, difficulty)
      baseMaxAdjacentBudgetRatioBps = Math.max(baseMaxAdjacentBudgetRatioBps, ratio)
      assert.ok(ratio <= 13500, `${difficulty} level ${levelId} adjacent budget ratio ${ratio}`)
    }
  }

  // 固定构筑边界：简单 1 的前两波仍保留新手教学容错。
  const easyOneWaves = resolvePveWaveCatalog(1, 'easy').waves
  for (const soldierType of SOLDIER_TYPES) {
    assert.equal(simulateFixedSoldierWave(easyOneWaves[0], [
      { soldierType, level: 1, count: 1 },
    ]).passesCapacityWindow, true)
    assert.equal(simulateFixedSoldierWave(easyOneWaves[1], [
      { soldierType, level: 1, count: 2 },
    ]).passesCapacityWindow, true)
    assert.equal(simulateFixedSoldierWave(easyOneWaves[4], [
      { soldierType, level: 5 as SoldierLevel, count: 1 },
    ]).passesCapacityWindow, true)
  }

  // 运行时必须使用冻结后的数值，不是未乘区的基准目录。
  const runtime = new PveGameRuntime({
    seed: 'balance-runtime-snapshot', levelId: 7, difficulty: 'normal', prepDurationMs: 0, maxWaves: 1,
  })
  assert.equal(runtime.registerPlayer('balance-player', 'P1').ok, true)
  assert.equal(runtime.start().ok, true)
  const runtimeSnapshot = runtime.tick()
  const expectedWave = resolvePveWaveCatalog(7, 'normal').waves[0]
  assert.equal(runtimeSnapshot.balance.profileId, 'pve-normal-l7-v1')
  assert.equal(runtimeSnapshot.enemies[0]?.maxHp, expectedWave.maxHp)
  assert.equal(runtimeSnapshot.enemies[0]?.armor, expectedWave.armor)
  assert.equal(runtimeSnapshot.enemies[0]?.magicResistance, expectedWave.magicResistance)

  // 简化 Monte Carlo 是趋势哨兵：固定种子必须完全可复现，难度不得倒挂。
  const simpleOnePureSoldier = runPureSoldierMonteCarlo(512, 1, 'easy', 'balance-regression')
  assert.deepEqual(simpleOnePureSoldier, runPureSoldierMonteCarlo(512, 1, 'easy', 'balance-regression'))
  // 该模型不计神将与局外装备，仍应让绝大多数正常经济种子到达终局。
  // 真实“新手首局 >=75%”还需几何机器人/真人埋点验证，这里使用 70% 防回归底线。
  assert.ok(simpleOnePureSoldier.clearRateBps >= 7000)
  assert.ok(simpleOnePureSoldier.p10HighestClearedWave >= 19)
  const simpleTenPureSoldier = runPureSoldierMonteCarlo(512, 10, 'easy', 'balance-regression')
  const normalTenPureSoldier = runPureSoldierMonteCarlo(512, 10, 'normal', 'balance-regression')
  const hardPureSoldier = runPureSoldierMonteCarlo(512, 1, 'hard', 'balance-regression')
  assert.ok(simpleOnePureSoldier.averageHighestClearedWaveMilli
    >= simpleTenPureSoldier.averageHighestClearedWaveMilli)
  assert.ok(simpleTenPureSoldier.averageHighestClearedWaveMilli
    >= normalTenPureSoldier.averageHighestClearedWaveMilli)
  assert.ok(normalTenPureSoldier.averageHighestClearedWaveMilli
    >= hardPureSoldier.averageHighestClearedWaveMilli)

  return {
    baseMaxAdjacentBudgetRatioBps,
    simpleOnePureSoldier,
    simpleTenPureSoldier,
    normalTenPureSoldier,
    hardPureSoldier,
  }
}

if (require.main === module) {
  process.stdout.write(`${JSON.stringify(runPveBalanceSmokeChecks())}\n`)
}
