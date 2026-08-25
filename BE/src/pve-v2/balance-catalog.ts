import {
  WAVE_MINION_CATALOG,
  type WaveMinionCatalogEntry,
} from './catalogs'
import {
  PVE_DIFFICULTIES,
  type PveDifficulty,
} from '../../../shared/contracts/pve-stage-config'

export { PVE_DIFFICULTIES }
export type { PveDifficulty }
export const PVE_BALANCE_LEVEL_MIN = 1
export const PVE_BALANCE_LEVEL_MAX = 10
export const PVE_BALANCE_WAVE_COUNT = 20
export const PVE_BASE_HP_BY_WAVE = Object.freeze(WAVE_MINION_CATALOG.map((wave) => wave.maxHp))
export const PVE_BASE_ARMOR_BY_WAVE = Object.freeze(WAVE_MINION_CATALOG.map((wave) => wave.armor))
export const PVE_BASE_MAGIC_RESISTANCE_BY_WAVE = Object.freeze(
  WAVE_MINION_CATALOG.map((wave) => wave.magicResistance),
)
const EASY_HP_MULTIPLIER_BPS_BY_LEVEL = [
  12750, 12900, 12900, 12900, 12900, 12900, 12900, 12900, 12900, 12900,
] as const
const NORMAL_HP_MULTIPLIER_BPS_BY_LEVEL = [
  12900, 12920, 12940, 12960, 12980, 13100, 13300, 13500, 13600, 13700,
] as const

export interface PveBalanceProfile {
  profileId: string
  levelId: number
  difficulty: PveDifficulty
  enemyHpMultiplierBps: number
  enemyDefenseAdd: number
}

export interface ResolvedPveBalanceCatalog {
  profile: PveBalanceProfile
  waves: readonly WaveMinionCatalogEntry[]
}

function assertLevelId(levelId: number): void {
  if (!Number.isInteger(levelId) || levelId < PVE_BALANCE_LEVEL_MIN || levelId > PVE_BALANCE_LEVEL_MAX) {
    throw new Error(`PVE balance levelId must be an integer from ${PVE_BALANCE_LEVEL_MIN} to ${PVE_BALANCE_LEVEL_MAX}`)
  }
}

function assertDifficulty(difficulty: string): asserts difficulty is PveDifficulty {
  if (!PVE_DIFFICULTIES.includes(difficulty as PveDifficulty)) {
    throw new Error(`Unknown PVE difficulty: ${difficulty}`)
  }
}

/**
 * 简单、普通随关卡序号递增；困难的 10 个场景使用完全相同的战斗预算。
 * 场景字池不在这里解析，因而不会意外改变难度。
 */
export function resolvePveBalanceProfile(
  levelId: number,
  difficulty: PveDifficulty,
): PveBalanceProfile {
  assertLevelId(levelId)
  assertDifficulty(difficulty)

  if (difficulty === 'easy') {
    return {
      profileId: `pve-easy-l${levelId}-v2`,
      levelId,
      difficulty,
      enemyHpMultiplierBps: EASY_HP_MULTIPLIER_BPS_BY_LEVEL[levelId - 1],
      enemyDefenseAdd: levelId - 1,
    }
  }

  if (difficulty === 'normal') {
    return {
      profileId: `pve-normal-l${levelId}-v2`,
      levelId,
      difficulty,
      enemyHpMultiplierBps: NORMAL_HP_MULTIPLIER_BPS_BY_LEVEL[levelId - 1],
      enemyDefenseAdd: 4 + (levelId - 1),
    }
  }

  return {
    // 困难模式的 profileId 也故意不带 levelId，便于快照审计。
    profileId: 'pve-hard-shared-v2',
    levelId,
    difficulty,
    enemyHpMultiplierBps: 14800,
    enemyDefenseAdd: 18,
  }
}

export function resolvePveWaveCatalog(
  levelId: number,
  difficulty: PveDifficulty,
): ResolvedPveBalanceCatalog {
  const profile = resolvePveBalanceProfile(levelId, difficulty)
  const waves = WAVE_MINION_CATALOG.map((base) => ({
    ...base,
    maxHp: Math.max(1, Math.floor(base.maxHp * profile.enemyHpMultiplierBps / 10000)),
    armor: Math.max(0, base.armor + profile.enemyDefenseAdd),
    magicResistance: Math.max(0, base.magicResistance + profile.enemyDefenseAdd),
  }))
  return { profile, waves }
}

export function getResolvedPveWave(
  levelId: number,
  difficulty: PveDifficulty,
  waveNumber: number,
): WaveMinionCatalogEntry | null {
  if (!Number.isInteger(waveNumber) || waveNumber < 1 || waveNumber > PVE_BALANCE_WAVE_COUNT) return null
  return resolvePveWaveCatalog(levelId, difficulty).waves[waveNumber - 1] ?? null
}

export function physicalEffectiveHealth(entry: WaveMinionCatalogEntry): number {
  return Math.floor(entry.maxHp * entry.countPerPlayer * (100 + entry.armor) / 100)
}

export function validatePveBalanceCatalog(): void {
  if (WAVE_MINION_CATALOG.length !== PVE_BALANCE_WAVE_COUNT) {
    throw new Error(`PVE balance base catalog must define ${PVE_BALANCE_WAVE_COUNT} waves`)
  }

  for (const difficulty of PVE_DIFFICULTIES) {
    for (let levelId = PVE_BALANCE_LEVEL_MIN; levelId <= PVE_BALANCE_LEVEL_MAX; levelId += 1) {
      const resolved = resolvePveWaveCatalog(levelId, difficulty)
      if (resolved.waves.length !== PVE_BALANCE_WAVE_COUNT) throw new Error('Resolved PVE wave count changed')
      for (let index = 0; index < resolved.waves.length; index += 1) {
        const current = resolved.waves[index]
        if (current.waveNumber !== index + 1 || current.countPerPlayer !== 10) {
          throw new Error(`Invalid resolved PVE wave ${index + 1}`)
        }
      }
    }
  }
}
