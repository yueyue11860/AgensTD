import { createHash } from 'crypto'
import type {
  PvpEndReason,
  PvpIntegrityStatus,
  PvpMatchDetail,
  PvpMatchParticipant,
  PvpMatchRecord,
  PvpOutcome,
  PvpModeId,
  PvpReplayChunk,
  PvpReplayManifest,
  PvpRewardOutboxEvent,
  PvpSeason,
  PvpSide,
} from '../../../shared/contracts/pvp-competition'
import type { PreparedPvpMatchSettlement, PreparedPvpPlayerSettlement, PvpStore } from '../data/pvp-store'
import { applyRatedResult, createInitialPvpRating, PVP_RANK_POLICY_VERSION } from './policy'

const MAX_SETTLEMENT_RETRIES = 5

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]))
  }
  return value
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')
}

function assertIso(value: string, field: string): number {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) throw new PvpRankError('INVALID_MATCH_RESULT', `${field} must be an ISO timestamp`)
  return timestamp
}

function isNoContestReason(reason: PvpEndReason): boolean {
  return reason === 'server_void'
    || reason === 'ruleset_invalid'
    || reason === 'load_failed'
    || reason === 'load_timeout'
    || reason === 'load_disconnect'
}

export interface SettlePvpParticipantInput {
  playerId: string
  playerName: string
  side: PvpSide
  slot: number
  loadoutSnapshotId: string
  disconnectedMs?: number
  forfeited?: boolean
  stats?: Record<string, unknown>
  reward?: Record<string, unknown>
}

export interface SettlePvpMatchInput {
  requestId: string
  matchId: string
  seasonId: string
  modeId: PvpModeId
  modeVersion: string
  region: string
  mapId: string
  mapVersion: string
  rulesetVersion: string
  catalogVersion: string
  effectSystemVersion: string
  seed: string
  winnerSide: PvpSide | null
  endReason: PvpEndReason
  integrityStatus: PvpIntegrityStatus
  startedAt: string
  endedAt: string
  participants: readonly [SettlePvpParticipantInput, SettlePvpParticipantInput]
}

export class PvpRankError extends Error {
  constructor(
    readonly code:
      | 'INVALID_MATCH_RESULT'
      | 'SEASON_NOT_FOUND'
      | 'SEASON_NOT_SETTLEABLE'
      | 'MODE_NOT_FOUND'
      | 'MAP_NOT_FOUND'
      | 'UNSUPPORTED_RANK_POLICY'
      | 'SETTLEMENT_CONFLICT',
    message: string,
  ) {
    super(message)
    this.name = 'PvpRankError'
  }
}

export class PvpRankService {
  constructor(private readonly store: PvpStore) {}

  async settleMatch(input: SettlePvpMatchInput): Promise<PvpMatchDetail> {
    this.validateMatchInput(input)
    const season = await this.store.getSeason(input.seasonId)
    if (!season) throw new PvpRankError('SEASON_NOT_FOUND', `season ${input.seasonId} does not exist`)
    this.validateSeason(season, input)
    const mode = await this.store.getMode(input.modeId, input.modeVersion)
    if (!mode || !mode.enabled) throw new PvpRankError('MODE_NOT_FOUND', `enabled mode ${input.modeId}@${input.modeVersion} does not exist`)
    if (mode.rulesetVersion !== input.rulesetVersion) {
      throw new PvpRankError('INVALID_MATCH_RESULT', 'match ruleset does not match its versioned mode definition')
    }
    const map = await this.store.getMap(input.mapId, input.mapVersion)
    if (!map || map.status !== 'active') throw new PvpRankError('MAP_NOT_FOUND', `active map ${input.mapId}@${input.mapVersion} does not exist`)

    const factualFingerprint = fingerprint({
      ...input,
      requestId: undefined,
      participants: input.participants.map(({ reward, ...participant }) => ({ ...participant, reward: reward ?? {} })),
    })
    const noContest = input.integrityStatus !== 'valid' || isNoContestReason(input.endReason)
    const ratedMatch = !noContest && mode.ranked
    const rewardEligible = !noContest && mode.rewardScaleBps > 0

    for (let attempt = 0; attempt < MAX_SETTLEMENT_RETRIES; attempt += 1) {
      const ratings = await Promise.all(input.participants.map(async (participant) => (
        await this.store.getRating(input.seasonId, input.modeId, participant.playerId)
        ?? createInitialPvpRating({
          seasonId: input.seasonId,
          modeId: input.modeId,
          playerId: participant.playerId,
          at: input.startedAt,
        })
      )))

      const outcomes = input.participants.map((participant): PvpOutcome => {
        if (noContest) return 'no_contest'
        if (input.winnerSide === null) return 'draw'
        return participant.side === input.winnerSide ? 'win' : 'loss'
      }) as [PvpOutcome, PvpOutcome]

      const preparedPlayers = input.participants.map((participant, index): PreparedPvpPlayerSettlement => {
        const current = ratings[index]
        const opponent = ratings[index === 0 ? 1 : 0]
        const outcome = outcomes[index]
        const rated = ratedMatch && outcome !== 'no_contest'
          ? applyRatedResult({ self: current, opponent, outcome, at: input.endedAt })
          : { next: current, ratingDelta: 0, leaguePointsDelta: 0 }
        const nextRating = rated.next
        const reward = participant.reward ?? {}
        const outboxReward = { ...structuredClone(reward), rewardScaleBps: mode.rewardScaleBps }
        const settlementId = `pvp:${input.matchId}:${participant.playerId}`

        const matchParticipant: PvpMatchParticipant = {
          matchId: input.matchId,
          playerId: participant.playerId,
          playerName: participant.playerName,
          side: participant.side,
          slot: participant.slot,
          outcome,
          loadoutSnapshotId: participant.loadoutSnapshotId,
          ratingBefore: current.rating,
          ratingDelta: rated.ratingDelta,
          ratingAfter: nextRating.rating,
          leaguePointsBefore: current.leaguePoints,
          leaguePointsDelta: rated.leaguePointsDelta,
          leaguePointsAfter: nextRating.leaguePoints,
          tierBefore: current.tier,
          tierAfter: nextRating.tier,
          disconnectedMs: Math.max(0, participant.disconnectedMs ?? 0),
          forfeited: participant.forfeited ?? false,
          stats: structuredClone(participant.stats ?? {}),
        }

        return {
          participant: matchParticipant,
          nextRating: structuredClone(nextRating),
          expectedRatingVersion: current.version,
          settlement: {
            settlementId,
            matchId: input.matchId,
            playerId: participant.playerId,
            requestId: `${input.requestId}:${participant.playerId}`,
            fingerprint: factualFingerprint,
            outcome,
            ratingBefore: current.rating,
            ratingDelta: rated.ratingDelta,
            ratingAfter: nextRating.rating,
            leaguePointsBefore: current.leaguePoints,
            leaguePointsDelta: rated.leaguePointsDelta,
            leaguePointsAfter: nextRating.leaguePoints,
            tierBefore: current.tier,
            tierAfter: nextRating.tier,
            reward: rewardEligible ? outboxReward : {},
            rewardStatus: rewardEligible ? 'pending' : 'not_applicable',
            committedAt: input.endedAt,
          },
          ledger: !ratedMatch ? null : {
            ledgerId: `rating:${input.matchId}:${participant.playerId}`,
            seasonId: input.seasonId,
            modeId: input.modeId,
            matchId: input.matchId,
            playerId: participant.playerId,
            ratingBefore: current.rating,
            ratingDelta: rated.ratingDelta,
            ratingAfter: nextRating.rating,
            leaguePointsBefore: current.leaguePoints,
            leaguePointsDelta: rated.leaguePointsDelta,
            leaguePointsAfter: nextRating.leaguePoints,
            policyVersion: season.rankPolicyVersion,
            createdAt: input.endedAt,
          },
          outbox: !rewardEligible ? null : {
            eventId: `reward:${input.matchId}:${participant.playerId}`,
            matchId: input.matchId,
            playerId: participant.playerId,
            eventType: 'pvp_match_reward',
            payload: outboxReward,
            status: 'pending',
            attempts: 0,
            availableAt: input.endedAt,
            leaseOwner: null,
            leaseExpiresAt: null,
            lastError: null,
            createdAt: input.endedAt,
            updatedAt: input.endedAt,
          } satisfies PvpRewardOutboxEvent,
        }
      }) as [PreparedPvpPlayerSettlement, PreparedPvpPlayerSettlement]

      const startedAt = assertIso(input.startedAt, 'startedAt')
      const endedAt = assertIso(input.endedAt, 'endedAt')
      const match: PvpMatchRecord = {
        matchId: input.matchId,
        seasonId: input.seasonId,
        modeId: input.modeId,
        modeVersion: input.modeVersion,
        region: input.region,
        mapId: input.mapId,
        mapVersion: input.mapVersion,
        rulesetVersion: input.rulesetVersion,
        catalogVersion: input.catalogVersion,
        effectSystemVersion: input.effectSystemVersion,
        seed: input.seed,
        status: noContest ? 'no_contest' : 'finished',
        integrityStatus: input.integrityStatus,
        winnerSide: noContest ? null : input.winnerSide,
        endReason: input.endReason,
        startedAt: input.startedAt,
        endedAt: input.endedAt,
        durationMs: endedAt - startedAt,
        settlementStatus: rewardEligible ? 'rating_committed_reward_pending' : 'committed',
        settlementRequestId: input.requestId,
        settlementFingerprint: factualFingerprint,
        createdAt: input.endedAt,
        updatedAt: input.endedAt,
      }

      const result = await this.store.commitMatchSettlement({ match, players: preparedPlayers })
      if (result.status === 'committed' || result.status === 'duplicate') return result.detail
    }

    throw new PvpRankError('SETTLEMENT_CONFLICT', 'rating rows changed repeatedly while settling match')
  }

  async createReplayManifest(manifest: PvpReplayManifest) {
    return this.store.createReplayManifest(manifest)
  }

  async appendReplayChunk(chunk: PvpReplayChunk) {
    return this.store.appendReplayChunk(chunk)
  }

  private validateMatchInput(input: SettlePvpMatchInput): void {
    if (!input.requestId || !input.matchId || !input.seasonId || !input.modeId || !input.modeVersion) {
      throw new PvpRankError('INVALID_MATCH_RESULT', 'requestId, matchId, seasonId, modeId and modeVersion are required')
    }
    const [left, right] = input.participants
    if (!left.playerId || !right.playerId || left.playerId === right.playerId) {
      throw new PvpRankError('INVALID_MATCH_RESULT', 'a PVP match requires two distinct players')
    }
    if (left.side === right.side || new Set([left.side, right.side]).size !== 2) {
      throw new PvpRankError('INVALID_MATCH_RESULT', 'participants must occupy opposite sides')
    }
    if (!Number.isInteger(left.slot) || !Number.isInteger(right.slot) || left.slot < 0 || right.slot < 0) {
      throw new PvpRankError('INVALID_MATCH_RESULT', 'participant slots must be non-negative integers')
    }
    const startedAt = assertIso(input.startedAt, 'startedAt')
    const endedAt = assertIso(input.endedAt, 'endedAt')
    if (endedAt < startedAt) throw new PvpRankError('INVALID_MATCH_RESULT', 'endedAt must not precede startedAt')
    if (input.winnerSide !== null && input.winnerSide !== left.side && input.winnerSide !== right.side) {
      throw new PvpRankError('INVALID_MATCH_RESULT', 'winnerSide must identify a participant side')
    }
  }

  private validateSeason(season: PvpSeason, input: SettlePvpMatchInput): void {
    if (season.modeId !== input.modeId || season.modeVersion !== input.modeVersion || season.region !== input.region) {
      throw new PvpRankError('SEASON_NOT_SETTLEABLE', 'match mode/region does not belong to the season')
    }
    if (season.status !== 'active' && season.status !== 'locked') {
      throw new PvpRankError('SEASON_NOT_SETTLEABLE', `season status ${season.status} cannot accept a result`)
    }
    const startedAt = assertIso(input.startedAt, 'startedAt')
    if (startedAt < assertIso(season.startsAt, 'season.startsAt') || startedAt >= assertIso(season.locksAt, 'season.locksAt')) {
      throw new PvpRankError('SEASON_NOT_SETTLEABLE', 'match did not start inside the season matchmaking window')
    }
    if (season.rankPolicyVersion !== PVP_RANK_POLICY_VERSION) {
      throw new PvpRankError('UNSUPPORTED_RANK_POLICY', `unsupported rank policy ${season.rankPolicyVersion}`)
    }
  }
}
