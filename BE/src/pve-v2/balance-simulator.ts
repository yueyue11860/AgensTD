import {
  getSoldierCatalogEntry,
  getSoldierLevelValue,
  SOLDIER_TYPES,
  type WaveMinionCatalogEntry,
} from './catalogs'
import { DeterministicPrng } from './prng'
import { resolvePveWaveCatalog, type PveDifficulty } from './balance-catalog'
import type { SoldierLevel, SoldierType } from './types'

export interface SoldierStack {
  soldierType: SoldierType
  level: SoldierLevel
  count: number
}

export interface FixedWaveSimulationResult {
  waveNumber: number
  expectedDps: number
  physicalEffectiveHealth: number
  expectedClearMs: number
  safeClearWindowMs: number
  passesCapacityWindow: boolean
}

export interface PureSoldierEconomyRun {
  seed: string
  levelId: number
  difficulty: PveDifficulty
  highestClearedWave: number
  recruitBatches: number
  remainingRice: number
  finalArmy: SoldierStack[]
}

export interface PureSoldierMonteCarloSummary {
  runs: number
  clearRateBps: number
  averageHighestClearedWaveMilli: number
  medianHighestClearedWave: number
  p10HighestClearedWave: number
  p90HighestClearedWave: number
  histogram: Readonly<Record<number, number>>
}

const CHARACTER_BRANCH_BPS = 1000
const OVERLOAD_GRACE_MS = 10000
const POPULATION_CAP = 10

/**
 * 简化几何开火率：弓兵用射程换取更高覆盖，近战和群攻受路径转角影响。
 * 这些数值只用于无 UI 趋势回归，不会写入权威战斗。
 */
const GEOMETRY_UPTIME_BPS: Readonly<Record<SoldierType, number>> = {
  blade: 7000,
  spear: 6800,
  bow: 8800,
  cavalry: 6800,
}

function expectedSoldierDps(
  soldierType: SoldierType,
  level: SoldierLevel,
  armor: number,
): number {
  const definition = getSoldierCatalogEntry(soldierType)
  const attack = getSoldierLevelValue(definition.attackByLevel, level)
  const intervalMs = getSoldierLevelValue(definition.attackIntervalMsByLevel, level)
  const critChance = getSoldierLevelValue(definition.critChanceBpsByLevel, level) / 10000
  const critDamage = getSoldierLevelValue(definition.critDamageBpsByLevel, level) / 10000
  const expectedPrimaryDamage = attack * (1 + critChance * (critDamage - 1))
  const maxTargets = getSoldierLevelValue(definition.maxTargetsByLevel, level)
  const secondaryRatio = getSoldierLevelValue(definition.secondaryDamageBpsByLevel, level) / 10000
  // 群攻的额外目标按 65% 密度折算，避免把每次满目标伪装成实战。
  const crowdFactor = 1 + Math.max(0, maxTargets - 1) * secondaryRatio * 0.65
  const defenseRatio = 100 / (100 + Math.max(0, armor))
  const uptimeRatio = GEOMETRY_UPTIME_BPS[soldierType] / 10000
  return expectedPrimaryDamage * crowdFactor * defenseRatio * uptimeRatio * 1000 / intervalMs
}

export function simulateFixedSoldierWave(
  wave: WaveMinionCatalogEntry,
  army: readonly SoldierStack[],
): FixedWaveSimulationResult {
  const expectedDps = army.reduce((sum, stack) => (
    sum + expectedSoldierDps(stack.soldierType, stack.level, wave.armor) * Math.max(0, stack.count)
  ), 0)
  const effectiveHealth = Math.floor(wave.maxHp * wave.countPerPlayer * (100 + wave.armor) / 100)
  const rawTotalHealth = wave.maxHp * wave.countPerPlayer
  // 最后一只从第 0 只之后经过 count-1 个间隔生成。
  const spawnWindowMs = Math.max(0, wave.countPerPlayer - 1) * wave.spawnIntervalMs
  const safeClearWindowMs = spawnWindowMs + OVERLOAD_GRACE_MS
  // expectedDps 已经扣除护甲，因此清空时间使用原始总生命，避免对护甲重复折损。
  const expectedClearMs = expectedDps > 0 ? Math.ceil(rawTotalHealth / expectedDps * 1000) : Number.POSITIVE_INFINITY
  return {
    waveNumber: wave.waveNumber,
    expectedDps,
    physicalEffectiveHealth: effectiveHealth,
    expectedClearMs,
    safeClearWindowMs,
    passesCapacityWindow: expectedClearMs <= safeClearWindowMs,
  }
}

type MutableArmy = Record<SoldierType, [number, number, number, number, number]>

function createEmptyArmy(): MutableArmy {
  return {
    blade: [0, 0, 0, 0, 0],
    spear: [0, 0, 0, 0, 0],
    bow: [0, 0, 0, 0, 0],
    cavalry: [0, 0, 0, 0, 0],
  }
}

function addAndMerge(army: MutableArmy, type: SoldierType): void {
  army[type][0] += 1
  for (let index = 0; index < 4; index += 1) {
    const pairs = Math.floor(army[type][index] / 2)
    if (pairs <= 0) break
    army[type][index] -= pairs * 2
    army[type][index + 1] += pairs
  }
}

function armyStacks(army: MutableArmy): SoldierStack[] {
  return SOLDIER_TYPES.flatMap((soldierType) => army[soldierType]
    .map((count, index) => ({ soldierType, level: (index + 1) as SoldierLevel, count }))
    .filter((entry) => entry.count > 0))
}

function selectBestTen(army: MutableArmy, armor: number): SoldierStack[] {
  const individual = armyStacks(army).flatMap((stack) => Array.from({ length: stack.count }, () => ({
    soldierType: stack.soldierType,
    level: stack.level,
    dps: expectedSoldierDps(stack.soldierType, stack.level, armor),
  }))).sort((left, right) => right.dps - left.dps
    || right.level - left.level
    || left.soldierType.localeCompare(right.soldierType))
    .slice(0, POPULATION_CAP)

  const selected = new Map<string, SoldierStack>()
  for (const unit of individual) {
    const key = `${unit.soldierType}:${unit.level}`
    const current = selected.get(key)
    if (current) current.count += 1
    else selected.set(key, { soldierType: unit.soldierType, level: unit.level, count: 1 })
  }
  return [...selected.values()]
}

function recruitWhileAffordable(
  prng: DeterministicPrng,
  army: MutableArmy,
  state: { rice: number, recruitBatches: number },
): void {
  while (true) {
    const cost = 5 + state.recruitBatches * 2
    if (state.rice < cost) return
    state.rice -= cost
    const soldierTypes: SoldierType[] = []
    for (let slot = 0; slot < 5; slot += 1) {
      if (!prng.rollBps(CHARACTER_BRANCH_BPS)) {
        soldierTypes.push(SOLDIER_TYPES[prng.pickIndex(SOLDIER_TYPES.length)])
      }
    }
    if (state.recruitBatches === 0 && soldierTypes.length === 0) {
      soldierTypes.push(SOLDIER_TYPES[prng.pickIndex(SOLDIER_TYPES.length)])
    }
    for (const soldierType of soldierTypes) addAndMerge(army, soldierType)
    state.recruitBatches += 1
  }
}

/**
 * 正常经济、每批 10% 字符损耗、自动合成且完美选位的“纯天兵上限”。
 * 它不代表玩家通关率；用来防止后续调参又出现第 11 波断崖。
 */
export function simulatePureSoldierEconomyRun(
  seed: string,
  levelId = 1,
  difficulty: PveDifficulty = 'easy',
): PureSoldierEconomyRun {
  const prng = new DeterministicPrng(seed)
  const army = createEmptyArmy()
  const economy = { rice: 10, recruitBatches: 0 }
  const waves = resolvePveWaveCatalog(levelId, difficulty).waves
  recruitWhileAffordable(prng, army, economy)

  let highestClearedWave = 0
  for (const wave of waves) {
    const deployed = selectBestTen(army, wave.armor)
    if (!simulateFixedSoldierWave(wave, deployed).passesCapacityWindow) break
    highestClearedWave = wave.waveNumber
    economy.rice += wave.countPerPlayer + 5 * wave.waveNumber
    recruitWhileAffordable(prng, army, economy)
  }

  return {
    seed,
    levelId,
    difficulty,
    highestClearedWave,
    recruitBatches: economy.recruitBatches,
    remainingRice: economy.rice,
    finalArmy: armyStacks(army),
  }
}

function percentile(sorted: readonly number[], ratio: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)))]
}

export function runPureSoldierMonteCarlo(
  runs: number,
  levelId = 1,
  difficulty: PveDifficulty = 'easy',
  seedPrefix = 'pve-balance',
): PureSoldierMonteCarloSummary {
  if (!Number.isInteger(runs) || runs < 1) throw new Error('runs must be a positive integer')
  const cleared = Array.from({ length: runs }, (_, index) => (
    simulatePureSoldierEconomyRun(`${seedPrefix}:${index}`, levelId, difficulty).highestClearedWave
  )).sort((left, right) => left - right)
  const histogram: Record<number, number> = {}
  for (const wave of cleared) histogram[wave] = (histogram[wave] ?? 0) + 1
  return {
    runs,
    clearRateBps: Math.floor(cleared.filter((wave) => wave >= 20).length * 10000 / runs),
    averageHighestClearedWaveMilli: Math.floor(cleared.reduce((sum, wave) => sum + wave, 0) * 1000 / runs),
    medianHighestClearedWave: percentile(cleared, 0.5),
    p10HighestClearedWave: percentile(cleared, 0.1),
    p90HighestClearedWave: percentile(cleared, 0.9),
    histogram,
  }
}
