import assert from 'node:assert/strict'
import {
  BOSS_CATALOG_VERSION,
  BOSS_DEFINITIONS,
  BOSS_WAVE_NUMBERS,
  getBossDefinition,
  resolveBossEncounter,
  validateBossCatalog,
} from './boss-catalog'
import { getResolvedPveWave } from './balance-catalog'

export interface BossBalanceSmokeReport {
  catalogVersion: string
  nodeCount: number
  resolvedVariantCount: number
  maxBossShareOfOrdinaryWavePhysicalBudgetBps: number
}

function physicalEffectiveHp(maxHp: number, armor: number): number {
  return Math.floor(maxHp * (100 + armor) / 100)
}

export function runBossBalanceSmokeChecks(): BossBalanceSmokeReport {
  validateBossCatalog()
  assert.deepEqual(BOSS_WAVE_NUMBERS, [5, 10, 15, 20])
  assert.equal(BOSS_DEFINITIONS.length, 40)
  assert.equal(new Set(BOSS_DEFINITIONS.map((entry) => entry.bossDefinitionId)).size, 40)
  assert.equal(new Set(BOSS_DEFINITIONS.map((entry) => `${entry.levelId}:${entry.waveNumber}`)).size, 40)

  for (let waveNumber = 1; waveNumber <= 20; waveNumber += 1) {
    const shouldExist: boolean = BOSS_WAVE_NUMBERS.includes(waveNumber as 5 | 10 | 15 | 20)
    assert.equal(getBossDefinition(1, waveNumber) !== null, shouldExist)
    assert.equal(resolveBossEncounter(1, 'easy', waveNumber) !== null, shouldExist)
  }

  let resolvedVariantCount = 0
  let maxBossShareOfOrdinaryWavePhysicalBudgetBps = 0
  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    for (let levelId = 1; levelId <= 10; levelId += 1) {
      for (const waveNumber of BOSS_WAVE_NUMBERS) {
        const resolved = resolveBossEncounter(levelId, difficulty, waveNumber)
        assert.ok(resolved)
        resolvedVariantCount += 1
        assert.equal(resolved.schemaVersion, 1)
        assert.equal(resolved.catalogVersion, BOSS_CATALOG_VERSION)
        assert.equal(resolved.levelId, levelId)
        assert.equal(resolved.difficulty, difficulty)
        assert.equal(resolved.waveNumber, waveNumber)
        assert.equal(resolved.definition.levelId, levelId)
        assert.equal(resolved.definition.waveNumber, waveNumber)
        assert.ok(resolved.stats.maxHp > 0)
        assert.ok(resolved.stats.armor > 0)
        assert.ok(resolved.stats.magicResistance > 0)
        assert.ok(resolved.stats.moveSpeedMilliCellsPerSecond > 0)
        assert.ok(resolved.stats.controlResistanceBps >= 0)
        assert.ok(resolved.stats.controlResistanceBps < 10000)
        assert.ok(resolved.stats.maxSingleControlDurationMs > 0)
        assert.ok(resolved.stats.skillIntensityBps > 0)
        assert.ok(resolved.rewardProfile.rice > 0)
        assert.ok(resolved.rewardProfile.experienceMilli > 0)
        assert.equal(resolved.rewardProfile.experienceMilli % 1000, 0)
        assert.equal(resolved.rewardProfile.directWeaponFragments, 0)
        assert.equal(resolved.rewardProfile.weaponMilestoneWave, waveNumber)

        const ordinary = getResolvedPveWave(levelId, difficulty, waveNumber)
        assert.ok(ordinary)
        const bossBudget = physicalEffectiveHp(resolved.stats.maxHp, resolved.stats.armor)
        const ordinaryWaveBudget = physicalEffectiveHp(ordinary.maxHp, ordinary.armor) * ordinary.countPerPlayer
        const shareBps = Math.floor(bossBudget * 10000 / ordinaryWaveBudget)
        maxBossShareOfOrdinaryWavePhysicalBudgetBps = Math.max(
          maxBossShareOfOrdinaryWavePhysicalBudgetBps,
          shareBps,
        )
        // Boss 必须有足够存活时间释放技能，但裸物理预算仍不超过同波普通怪总预算。
        assert.ok(shareBps <= 9000, `${difficulty} L${levelId} W${waveNumber} boss share=${shareBps}`)
      }
    }
  }
  assert.equal(resolvedVariantCount, 120)

  // 简单、普通在同一节点随关卡不倒退；低血量节点受 floor 影响可短暂持平。
  for (const difficulty of ['easy', 'normal'] as const) {
    for (const waveNumber of BOSS_WAVE_NUMBERS) {
      for (let levelId = 2; levelId <= 10; levelId += 1) {
        const previous = resolveBossEncounter(levelId - 1, difficulty, waveNumber)
        const current = resolveBossEncounter(levelId, difficulty, waveNumber)
        assert.ok(previous && current)
        assert.ok(current.stats.maxHp >= previous.stats.maxHp)
        assert.ok(current.stats.armor > previous.stats.armor)
        assert.ok(current.stats.magicResistance > previous.stats.magicResistance)
        assert.ok(current.stats.skillIntensityBps > previous.stats.skillIntensityBps)
      }
    }
  }

  // 困难 10 关的全部数值与奖励预算完全相同；只允许主题、名称与技能编排不同。
  for (const waveNumber of BOSS_WAVE_NUMBERS) {
    const reference = resolveBossEncounter(1, 'hard', waveNumber)
    assert.ok(reference)
    for (let levelId = 2; levelId <= 10; levelId += 1) {
      const current = resolveBossEncounter(levelId, 'hard', waveNumber)
      assert.ok(current)
      assert.deepEqual(current.stats, reference.stats)
      assert.deepEqual(current.rewardProfile, reference.rewardProfile)
    }
  }

  assert.throws(() => resolveBossEncounter(0, 'easy', 5))
  assert.throws(() => resolveBossEncounter(11, 'easy', 5))

  return {
    catalogVersion: BOSS_CATALOG_VERSION,
    nodeCount: BOSS_DEFINITIONS.length,
    resolvedVariantCount,
    maxBossShareOfOrdinaryWavePhysicalBudgetBps,
  }
}

if (require.main === module) {
  process.stdout.write(`${JSON.stringify(runBossBalanceSmokeChecks())}\n`)
}
