import type { MatchPlayerSettlement } from '../account-v1/types'
import type { PveMatchConfigSnapshot } from '../pve-v2/ruleset'
import type { PveWeaponRewardEvent, PveSettlementDetail, PveSettlementScoreBasis } from './types'

export interface PvePlayerSettlementStats {
  damageDealt: number
  kills: number
  controlAppliedMs: number
  rescues: number
  damageByGeneralId: Record<string, number>
}

export interface SettlementPlayerSnapshot {
  playerId: string
  generalProgress: Array<{ generalId: string; name: string; level: number }>
  activeSynergies: Array<{ synergyId: string; name: string; level: number }>
}

export interface SettlementRuntimeEvent {
  id: string
  tick: number
  type: string
  data: Record<string, string | number | boolean | string[] | number[] | null>
}

export interface PveSettlementTelemetry {
  matchId: string
  sawMatchStarted: boolean
  seenEventIds: Set<string>
  byPlayerId: Map<string, PvePlayerSettlementStats>
  controlByGeneralId: Map<string, number>
}

const emptyStats = (): PvePlayerSettlementStats => ({
  damageDealt: 0,
  kills: 0,
  controlAppliedMs: 0,
  rescues: 0,
  damageByGeneralId: {},
})
const CONTROL_STATUS_IDS = new Set(['slow', 'stun', 'root', 'suppress', 'suppress_active_trait'])

export function createSettlementTelemetry(matchId: string): PveSettlementTelemetry {
  return { matchId, sawMatchStarted: false, seenEventIds: new Set(), byPlayerId: new Map(), controlByGeneralId: new Map() }
}

function finiteNonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function playerStats(telemetry: PveSettlementTelemetry, playerId: string): PvePlayerSettlementStats {
  const existing = telemetry.byPlayerId.get(playerId)
  if (existing) return existing
  const created = emptyStats()
  telemetry.byPlayerId.set(playerId, created)
  return created
}

/** Idempotently consumes the authoritative runtime event stream. */
export function ingestSettlementEvents(telemetry: PveSettlementTelemetry, events: readonly SettlementRuntimeEvent[]): void {
  for (const event of events) {
    if (telemetry.seenEventIds.has(event.id)) continue
    telemetry.seenEventIds.add(event.id)
    if (event.type === 'MATCH_STARTED') telemetry.sawMatchStarted = true
    if (event.type === 'DAMAGE_APPLIED' && typeof event.data.playerId === 'string') {
      const amount = finiteNonNegative(event.data.finalDamage)
      const stats = playerStats(telemetry, event.data.playerId)
      stats.damageDealt += amount
      if (typeof event.data.generalId === 'string' && event.data.generalId !== 'active_item') {
        stats.damageByGeneralId[event.data.generalId] = (stats.damageByGeneralId[event.data.generalId] ?? 0) + amount
      }
    }
    if (event.type === 'ENEMY_DIED' && typeof event.data.lastDamagePlayerId === 'string') {
      playerStats(telemetry, event.data.lastDamagePlayerId).kills += 1
    }
    if (event.type === 'ASSIST_RECORDED' && typeof event.data.playerId === 'string') {
      playerStats(telemetry, event.data.playerId).rescues += 1
    }
    if (event.type === 'STATUS_APPLIED' && typeof event.data.generalId === 'string'
      && typeof event.data.statusId === 'string' && CONTROL_STATUS_IDS.has(event.data.statusId)) {
      const duration = finiteNonNegative(event.data.durationMs)
      telemetry.controlByGeneralId.set(event.data.generalId,
        (telemetry.controlByGeneralId.get(event.data.generalId) ?? 0) + duration)
    }
  }
}

export function resolveSettlementStats(
  telemetry: PveSettlementTelemetry,
  players: readonly Pick<SettlementPlayerSnapshot, 'playerId' | 'generalProgress'>[],
): Map<string, PvePlayerSettlementStats> {
  const resolved = new Map(players.map(player => [player.playerId, structuredClone(telemetry.byPlayerId.get(player.playerId) ?? emptyStats())]))
  const ownerByGeneralId = new Map<string, string | null>()
  for (const player of players) for (const general of player.generalProgress) {
    const previous = ownerByGeneralId.get(general.generalId)
    ownerByGeneralId.set(general.generalId, previous === undefined ? player.playerId : null)
  }
  for (const [generalId, duration] of telemetry.controlByGeneralId) {
    const owner = ownerByGeneralId.get(generalId)
    if (owner) (resolved.get(owner) as PvePlayerSettlementStats).controlAppliedMs += duration
  }
  return resolved
}

function metricContribution(value: number, total: number, weightBps: number) {
  return total > 0 ? Math.round(value / total * weightBps) : 0
}

export function scorePveSettlementMvp(
  byPlayerId: ReadonlyMap<string, PvePlayerSettlementStats>,
  coverageComplete: boolean,
): PveSettlementDetail['mvp'] {
  if (!coverageComplete || byPlayerId.size < 2) return null
  const entries = [...byPlayerId.entries()].sort(([left], [right]) => left.localeCompare(right))
  const totals = entries.reduce((sum, [, stats]) => ({
    damage: sum.damage + stats.damageDealt,
    control: sum.control + stats.controlAppliedMs,
    rescues: sum.rescues + stats.rescues,
    kills: sum.kills + stats.kills,
  }), { damage: 0, control: 0, rescues: 0, kills: 0 })
  const candidates = entries.map(([playerId, stats]) => {
    const basis: PveSettlementScoreBasis[] = [
      { metric: 'damage', value: stats.damageDealt, weightBps: 5500, contributionBps: metricContribution(stats.damageDealt, totals.damage, 5500) },
      { metric: 'control', value: stats.controlAppliedMs, weightBps: 2000, contributionBps: metricContribution(stats.controlAppliedMs, totals.control, 2000) },
      { metric: 'rescues', value: stats.rescues, weightBps: 2000, contributionBps: metricContribution(stats.rescues, totals.rescues, 2000) },
      { metric: 'kills', value: stats.kills, weightBps: 500, contributionBps: metricContribution(stats.kills, totals.kills, 500) },
    ]
    return { playerId, basis, scoreBps: basis.reduce((sum, item) => sum + item.contributionBps, 0) }
  }).sort((left, right) => right.scoreBps - left.scoreBps || left.playerId.localeCompare(right.playerId))
  const winner = candidates[0]
  return winner && winner.scoreBps > 0
    ? { playerId: winner.playerId, scoreBps: winner.scoreBps, scoreVersion: 'pve-settlement-score-v1', basis: winner.basis }
    : null
}

function failureSuggestion(reason: PveSettlementDetail['outcome']['reason'], wave: number): string | null {
  if (reason === 'victory') return null
  if (reason === 'disconnect_exit') return '检查网络后重连；宽限期内回房可继续本局，避免提前结算。'
  if (reason === 'voluntary_exit') return '再战前先调整构筑，确保主力神将与至少一组羁绊成型。'
  if (wave < 5) return '前五波先优先合成一名主力神将，不要将饭全部分散到低星棋子。'
  if (wave < 10) return '下次在 Boss 波前留出道具与技能冷却，并补一名控制或破甲神将。'
  return '查看本局贡献与羁绊，将资源集中到输出最高的核心神将并保留一个救场道具。'
}

const sourceMap = {
  wave_milestone: 'wave_milestone',
  boss_fragment_bonus: 'boss_fragment_bonus',
  hard_victory_exclusive_guarantee: 'hard_victory_guarantee',
} as const

export function buildPveSettlementDetail(input: {
  configSnapshot: PveMatchConfigSnapshot
  rewardTableRevision: string
  reason: PveSettlementDetail['outcome']['reason']
  officialVictory: boolean
  highestCompletedWave: number
  player: SettlementPlayerSnapshot
  allStats: ReadonlyMap<string, PvePlayerSettlementStats>
  coverageComplete: boolean
  rewardEvents: readonly PveWeaponRewardEvent[]
  firstClear: boolean
}): PveSettlementDetail {
  const stats = input.allStats.get(input.player.playerId) ?? emptyStats()
  const coreProgress = [...input.player.generalProgress].sort((left, right) =>
    (stats.damageByGeneralId[right.generalId] ?? 0) - (stats.damageByGeneralId[left.generalId] ?? 0)
      || right.level - left.level || left.generalId.localeCompare(right.generalId))[0]
  const rewards = input.rewardEvents.map(event => ({
    kind: 'weapon_fragment' as const,
    rewardId: event.eventId,
    label: event.weaponId,
    amount: event.amount,
    source: sourceMap[event.source],
    rarity: event.quality,
    ...(event.milestone ? { milestoneWave: event.milestone } : {}),
  }))
  return {
    schemaVersion: 1,
    rules: {
      combatRulesetVersion: input.configSnapshot.combatRulesetVersion,
      rewardTableRevision: input.rewardTableRevision,
      stageCatalogRevision: input.configSnapshot.stageCatalogRevision,
      balanceCatalogRevision: input.configSnapshot.balanceCatalogRevision,
    },
    outcome: { victory: input.officialVictory, reason: input.reason, highestCompletedWave: input.highestCompletedWave, maxWaves: input.configSnapshot.maxWaves },
    story: {
      title: input.officialVictory ? '天门已定，字灵归箓' : `防线止于第 ${input.highestCompletedWave + 1} 波`,
      summary: input.officialVictory
        ? `你守住了 ${input.configSnapshot.maxWaves} 波妖潮，本局奖励已由服务端核定。`
        : `你完成了 ${input.highestCompletedWave} 波；调整构筑后可从本章回再战。`,
      failureSuggestion: failureSuggestion(input.reason, input.highestCompletedWave),
    },
    performance: {
      damageDealt: input.coverageComplete ? stats.damageDealt : null,
      kills: input.coverageComplete ? stats.kills : null,
      controlAppliedMs: input.coverageComplete ? stats.controlAppliedMs : null,
      rescues: input.coverageComplete ? stats.rescues : null,
      mostDangerousWave: null,
      coverage: input.coverageComplete ? 'complete' : 'partial',
    },
    lineup: {
      coreGeneral: coreProgress ? {
        generalId: coreProgress.generalId,
        name: coreProgress.name,
        level: coreProgress.level,
        damageDealt: input.coverageComplete ? stats.damageByGeneralId[coreProgress.generalId] ?? 0 : null,
      } : null,
      activeSynergies: input.player.activeSynergies.map(synergy => ({ synergyId: synergy.synergyId, name: synergy.name, level: synergy.level })),
    },
    mvp: scorePveSettlementMvp(input.allStats, input.coverageComplete),
    rewards: [
      ...rewards,
      ...(input.firstClear ? [{ kind: 'first_clear' as const, rewardId: 'stage-first-clear', label: '章回首通', amount: 1, source: 'stage_first_clear' as const, rarity: 'standard' as const, firstClear: true }] : []),
    ],
    pity: null,
  }
}

export function finalizePveSettlementDetail(detail: PveSettlementDetail, settlement: MatchPlayerSettlement): PveSettlementDetail {
  const durableRewards = detail.rewards.filter(reward => reward.kind === 'weapon_fragment' || (reward.kind === 'first_clear' && reward.firstClear))
  if (settlement.goldGranted > 0) durableRewards.unshift({
    kind: 'gold', rewardId: `${settlement.settlementId}:gold`, label: '功勋金', amount: settlement.goldGranted,
    source: 'match_tier', rarity: 'standard',
  })
  if (settlement.entitlementIds.length > 0) durableRewards.push({
    kind: 'purchase_right', rewardId: `${settlement.settlementId}:purchase-rights`, label: '局外商店购买权',
    amount: settlement.entitlementIds.length, source: 'match_tier', rarity: 'standard',
  })
  return { ...detail, rewards: durableRewards }
}
