export const PVE_STARTING_RICE = 10 as const
export const PVE_ORDINARY_ENEMY_RICE_REWARD = 1 as const
export const PVE_PAID_RECRUIT_SOFT_CAP_BATCHES = 30 as const
export const PVE_CONTROL_XP_SHARE_CAP_BPS = 2000 as const

export const PVE_BOSS_RICE_REWARD_BY_WAVE = Object.freeze({
  5: 3,
  10: 5,
  15: 8,
  20: 12,
} as const)

/** completedPaidBatches is zero before the first paid batch; free refreshes never increment it. */
export function resolvePvePaidRecruitBaseCost(completedPaidBatches: number): number {
  if (!Number.isSafeInteger(completedPaidBatches) || completedPaidBatches < 0) {
    throw new Error('completedPaidBatches must be a non-negative safe integer')
  }
  return 5 + Math.floor(completedPaidBatches / 3)
    + (completedPaidBatches >= PVE_PAID_RECRUIT_SOFT_CAP_BATCHES ? 2 : 0)
}

export function resolvePveLaneClearRiceReward(waveNumber: number): number {
  if (!Number.isSafeInteger(waveNumber) || waveNumber < 1 || waveNumber > 20) {
    throw new Error('waveNumber must be an integer from 1 to 20')
  }
  if (waveNumber <= 4) return 3
  if (waveNumber <= 9) return 4
  if (waveNumber <= 14) return 5
  if (waveNumber <= 19) return 6
  return 10
}

export function resolvePveBossRiceReward(waveNumber: number): number {
  return PVE_BOSS_RICE_REWARD_BY_WAVE[waveNumber as keyof typeof PVE_BOSS_RICE_REWARD_BY_WAVE] ?? 0
}

export const PVE_FULL_MATCH_BASE_GROSS_RICE = PVE_STARTING_RICE
  + 20 * 10 * PVE_ORDINARY_ENEMY_RICE_REWARD
  + Object.values(PVE_BOSS_RICE_REWARD_BY_WAVE).reduce((sum, reward) => sum + reward, 0)
  + Array.from({ length: 20 }, (_, index) => resolvePveLaneClearRiceReward(index + 1))
    .reduce((sum, reward) => sum + reward, 0)

export type PveXpContributionCategory = 'physical' | 'magic' | 'summon' | 'control'

export interface PveXpContributionIdentity {
  contributionKey: string
  category: PveXpContributionCategory
}

function allocateEqual(points: number, entries: readonly PveXpContributionIdentity[]): Map<string, number> {
  const allocations = new Map<string, number>()
  if (points <= 0 || entries.length === 0) return allocations
  const sorted = [...entries].sort((left, right) => left.contributionKey.localeCompare(right.contributionKey))
  const quotient = Math.floor(points / sorted.length)
  let remainder = points % sorted.length
  for (const entry of sorted) {
    allocations.set(entry.contributionKey, quotient + (remainder > 0 ? 1 : 0))
    remainder = Math.max(0, remainder - 1)
  }
  return allocations
}

/**
 * Current contribution telemetry records contributor/category/last tick, not exact damage or control duration.
 * This deterministic minimum split therefore divides each pool equally by eligible contributor. Control uses
 * at most 20% of base XP; when no damage contribution exists the unassigned 80% is deliberately not invented.
 */
export function allocatePveBaseXpByContribution(
  baseExperiencePoints: number,
  contributions: readonly PveXpContributionIdentity[],
): ReadonlyMap<string, number> {
  if (!Number.isSafeInteger(baseExperiencePoints) || baseExperiencePoints < 0) {
    throw new Error('baseExperiencePoints must be a non-negative safe integer')
  }
  const unique = [...new Map(contributions.map(entry => [entry.contributionKey, entry])).values()]
  const control = unique.filter(entry => entry.category === 'control')
  const damage = unique.filter(entry => entry.category !== 'control')
  const controlCap = Math.floor(baseExperiencePoints * PVE_CONTROL_XP_SHARE_CAP_BPS / 10_000)
  const weightedControlShare = control.length === 0 ? 0 : Math.floor(
    baseExperiencePoints * control.length / (control.length + damage.length * 4),
  )
  const controlPoints = Math.min(controlCap, weightedControlShare)
  const damagePoints = damage.length > 0 ? baseExperiencePoints - controlPoints : 0
  const result = allocateEqual(damagePoints, damage)
  for (const [key, points] of allocateEqual(controlPoints, control)) {
    result.set(key, (result.get(key) ?? 0) + points)
  }
  return result
}
