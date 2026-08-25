export type SettlementStatus = 'pending' | 'failed' | 'committed'
export type RevealStage = 'verdict' | 'story' | 'rewards' | 'actions'

export interface SettlementRewardDetail {
  kind: 'gold' | 'weapon_fragment' | 'purchase_right' | 'first_clear'
  rewardId: string
  label: string
  amount: number
  source: string
  rarity: string
  milestoneWave?: number
  firstClear?: boolean
}

export interface SettlementDetail {
  schemaVersion: 1
  rules: {
    combatRulesetVersion: string
    rewardTableRevision: string
    stageCatalogRevision: string
    balanceCatalogRevision: string
  }
  outcome: { victory: boolean; reason: string; highestCompletedWave: number; maxWaves: number }
  story: { title: string; summary: string; failureSuggestion: string | null }
  performance: {
    damageDealt: number | null
    kills: number | null
    controlAppliedMs: number | null
    rescues: number | null
    mostDangerousWave: number | null
    coverage: 'complete' | 'partial'
  }
  lineup: {
    coreGeneral: { generalId: string; name: string; level: number; damageDealt: number | null } | null
    activeSynergies: Array<{ synergyId: string; name: string; level: number }>
  }
  mvp: {
    playerId: string
    scoreBps: number
    scoreVersion: string
    basis: Array<{ metric: 'damage' | 'control' | 'rescues' | 'kills'; value: number; weightBps: number; contributionBps: number }>
  } | null
  rewards: SettlementRewardDetail[]
  pity: null
}

export interface MatchSettlement {
  settlementId: string
  matchId: string
  reason: 'defeat' | 'voluntary_exit' | 'disconnect_exit' | 'victory'
  highestCompletedWave: number
  rewardTier: string
  retainedWeaponFragments: Record<string, number>
  goldGranted: number
  entitlementIds: string[]
  progressionUpdated: boolean
  status: 'committed'
  committedAt: string
  detail: SettlementDetail | null
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const numberOrNull = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
const stringOr = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback

function normalizeDetail(value: unknown): SettlementDetail | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.rules) || !isRecord(value.outcome)
    || !isRecord(value.story) || !isRecord(value.performance) || !isRecord(value.lineup)) return null
  const performance = value.performance
  const lineup = value.lineup
  const core = isRecord(lineup.coreGeneral) && typeof lineup.coreGeneral.generalId === 'string'
    ? {
        generalId: lineup.coreGeneral.generalId,
        name: stringOr(lineup.coreGeneral.name, lineup.coreGeneral.generalId),
        level: numberOrNull(lineup.coreGeneral.level) ?? 1,
        damageDealt: numberOrNull(lineup.coreGeneral.damageDealt),
      }
    : null
  const rewards: SettlementRewardDetail[] = Array.isArray(value.rewards) ? value.rewards.flatMap((reward) => {
    if (!isRecord(reward) || !['gold', 'weapon_fragment', 'purchase_right', 'first_clear'].includes(String(reward.kind))
      || typeof reward.rewardId !== 'string' || typeof reward.label !== 'string') return []
    const amount = numberOrNull(reward.amount)
    if (amount === null) return []
    return [{
      kind: reward.kind as SettlementRewardDetail['kind'], rewardId: reward.rewardId, label: reward.label, amount,
      source: stringOr(reward.source, 'server'), rarity: stringOr(reward.rarity, 'standard'),
      ...(numberOrNull(reward.milestoneWave) !== null ? { milestoneWave: numberOrNull(reward.milestoneWave) as number } : {}),
      ...(reward.firstClear === true ? { firstClear: true } : {}),
    }]
  }) : []
  const mvp = isRecord(value.mvp) && typeof value.mvp.playerId === 'string' && Array.isArray(value.mvp.basis)
    ? {
        playerId: value.mvp.playerId,
        scoreBps: numberOrNull(value.mvp.scoreBps) ?? 0,
        scoreVersion: stringOr(value.mvp.scoreVersion, 'server'),
        basis: value.mvp.basis.flatMap((basis) => {
          if (!isRecord(basis) || !['damage', 'control', 'rescues', 'kills'].includes(String(basis.metric))) return []
          return [{
            metric: basis.metric as 'damage' | 'control' | 'rescues' | 'kills',
            value: numberOrNull(basis.value) ?? 0,
            weightBps: numberOrNull(basis.weightBps) ?? 0,
            contributionBps: numberOrNull(basis.contributionBps) ?? 0,
          }]
        }),
      }
    : null
  return {
    schemaVersion: 1,
    rules: {
      combatRulesetVersion: stringOr(value.rules.combatRulesetVersion, 'unknown'),
      rewardTableRevision: stringOr(value.rules.rewardTableRevision, 'unknown'),
      stageCatalogRevision: stringOr(value.rules.stageCatalogRevision, 'unknown'),
      balanceCatalogRevision: stringOr(value.rules.balanceCatalogRevision, 'unknown'),
    },
    outcome: {
      victory: value.outcome.victory === true,
      reason: stringOr(value.outcome.reason, 'unknown'),
      highestCompletedWave: numberOrNull(value.outcome.highestCompletedWave) ?? 0,
      maxWaves: numberOrNull(value.outcome.maxWaves) ?? 0,
    },
    story: {
      title: stringOr(value.story.title, '本局已结算'),
      summary: stringOr(value.story.summary),
      failureSuggestion: typeof value.story.failureSuggestion === 'string' ? value.story.failureSuggestion : null,
    },
    performance: {
      damageDealt: numberOrNull(performance.damageDealt),
      kills: numberOrNull(performance.kills),
      controlAppliedMs: numberOrNull(performance.controlAppliedMs),
      rescues: numberOrNull(performance.rescues),
      mostDangerousWave: numberOrNull(performance.mostDangerousWave),
      coverage: performance.coverage === 'complete' ? 'complete' : 'partial',
    },
    lineup: {
      coreGeneral: core,
      activeSynergies: Array.isArray(lineup.activeSynergies) ? lineup.activeSynergies.flatMap((synergy) => (
        isRecord(synergy) && typeof synergy.synergyId === 'string'
          ? [{ synergyId: synergy.synergyId, name: stringOr(synergy.name, synergy.synergyId), level: numberOrNull(synergy.level) ?? 1 }]
          : []
      )) : [],
    },
    mvp,
    rewards,
    pity: null,
  }
}

export function normalizeSettlement(payload: unknown): MatchSettlement | null {
  if (!isRecord(payload) || !isRecord(payload.settlement)) return null
  const settlement = payload.settlement
  if (settlement.status !== 'committed' || typeof settlement.settlementId !== 'string'
    || typeof settlement.matchId !== 'string' || typeof settlement.goldGranted !== 'number'
    || !isRecord(settlement.retainedWeaponFragments) || !Array.isArray(settlement.entitlementIds)) return null
  return {
    settlementId: settlement.settlementId,
    matchId: settlement.matchId,
    reason: settlement.reason === 'victory' || settlement.reason === 'voluntary_exit' || settlement.reason === 'disconnect_exit' ? settlement.reason : 'defeat',
    highestCompletedWave: numberOrNull(settlement.highestCompletedWave) ?? 0,
    rewardTier: stringOr(settlement.rewardTier, 'unknown'),
    retainedWeaponFragments: Object.fromEntries(Object.entries(settlement.retainedWeaponFragments)
      .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] > 0)),
    goldGranted: settlement.goldGranted,
    entitlementIds: settlement.entitlementIds.filter((id): id is string => typeof id === 'string'),
    progressionUpdated: settlement.progressionUpdated === true,
    status: 'committed',
    committedAt: stringOr(settlement.committedAt),
    detail: normalizeDetail(settlement.detail ?? payload.detail),
  }
}

export function settlementPayloadStatus(payload: unknown): SettlementStatus | null {
  return isRecord(payload) && (payload.status === 'pending' || payload.status === 'failed' || payload.status === 'committed')
    ? payload.status : null
}

export function settlementLastError(payload: unknown): string | null {
  return isRecord(payload) && typeof payload.lastError === 'string' && payload.lastError.trim() ? payload.lastError.trim() : null
}

export const revealStageOrder: readonly RevealStage[] = ['verdict', 'story', 'rewards', 'actions']
export function nextRevealStage(stage: RevealStage): RevealStage {
  return revealStageOrder[Math.min(revealStageOrder.length - 1, revealStageOrder.indexOf(stage) + 1)]
}
