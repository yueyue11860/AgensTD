import type { PvpModeId, PvpOutcome, PvpRankTier, PvpRating } from '../../../shared/contracts/pvp-competition'

export const PVP_RANK_POLICY_VERSION = 'rank-v1.0.0'
export const PVP_PLACEMENT_GAME_COUNT = 5
export const PVP_INITIAL_RATING = 1500
export const PVP_INITIAL_LEAGUE_POINTS = 0

interface TierBoundary {
  tier: Exclude<PvpRankTier, 'unranked'>
  minimumLeaguePoints: number
}

const TIER_BOUNDARIES: readonly TierBoundary[] = [
  { tier: 'black_iron', minimumLeaguePoints: 0 },
  { tier: 'bronze', minimumLeaguePoints: 300 },
  { tier: 'silver', minimumLeaguePoints: 600 },
  { tier: 'gold', minimumLeaguePoints: 900 },
  { tier: 'amethyst', minimumLeaguePoints: 1200 },
  { tier: 'great_sage', minimumLeaguePoints: 1500 },
]

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

export function createInitialPvpRating(input: {
  seasonId: string
  modeId: PvpModeId
  playerId: string
  at: string
}): PvpRating {
  return {
    seasonId: input.seasonId,
    modeId: input.modeId,
    playerId: input.playerId,
    rating: PVP_INITIAL_RATING,
    leaguePoints: PVP_INITIAL_LEAGUE_POINTS,
    tier: 'unranked',
    division: null,
    provisionalGames: 0,
    games: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    streak: 0,
    version: 0,
    tierReachedAt: input.at,
    updatedAt: input.at,
  }
}

export function expectedScore(selfRating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - selfRating) / 400))
}

function actualScore(outcome: PvpOutcome): number {
  if (outcome === 'win') return 1
  if (outcome === 'draw') return 0.5
  return 0
}

export function calculateRatingDelta(input: {
  self: PvpRating
  opponent: PvpRating
  outcome: Exclude<PvpOutcome, 'no_contest'>
}): number {
  const provisional = input.self.provisionalGames < PVP_PLACEMENT_GAME_COUNT
  const kFactor = provisional ? 64 : input.self.rating >= 2000 ? 24 : 32
  return Math.round(kFactor * (actualScore(input.outcome) - expectedScore(input.self.rating, input.opponent.rating)))
}

export function calculateLeaguePointDelta(input: {
  self: PvpRating
  opponent: PvpRating
  outcome: Exclude<PvpOutcome, 'no_contest'>
}): number {
  const strengthAdjustment = clamp(Math.round((input.opponent.rating - input.self.rating) / 50), -8, 8)
  const placementMultiplier = input.self.provisionalGames < PVP_PLACEMENT_GAME_COUNT ? 2 : 1
  if (input.outcome === 'win') return (25 + strengthAdjustment) * placementMultiplier
  if (input.outcome === 'loss') return Math.min(-5, -20 + strengthAdjustment) * placementMultiplier
  return clamp(strengthAdjustment, -5, 5) * placementMultiplier
}

export function resolveVisibleRank(leaguePoints: number, provisionalGames: number): {
  tier: PvpRankTier
  division: number | null
} {
  if (provisionalGames < PVP_PLACEMENT_GAME_COUNT) return { tier: 'unranked', division: null }

  const points = Math.max(0, leaguePoints)
  let boundary = TIER_BOUNDARIES[0]
  let nextBoundary: TierBoundary | null = TIER_BOUNDARIES[1] ?? null
  for (let index = 0; index < TIER_BOUNDARIES.length; index += 1) {
    if (points < TIER_BOUNDARIES[index].minimumLeaguePoints) break
    boundary = TIER_BOUNDARIES[index]
    nextBoundary = TIER_BOUNDARIES[index + 1] ?? null
  }

  if (!nextBoundary || boundary.tier === 'great_sage') {
    return { tier: boundary.tier, division: null }
  }

  const bandSize = nextBoundary.minimumLeaguePoints - boundary.minimumLeaguePoints
  const progress = clamp(points - boundary.minimumLeaguePoints, 0, Math.max(0, bandSize - 1))
  const division = 3 - Math.min(2, Math.floor(progress / Math.max(1, bandSize / 3)))
  return { tier: boundary.tier, division }
}

/** 斗战胜佛是赛季榜动态身份，不固化到静态 LP 分段中。 */
export function projectLeaderboardRank(rating: PvpRating, leaderboardRank: number): Pick<PvpRating, 'tier' | 'division'> {
  if (rating.tier !== 'unranked' && rating.leaguePoints >= 1800 && leaderboardRank > 0 && leaderboardRank <= 500) {
    return { tier: 'victorious_fighting_buddha', division: null }
  }
  return { tier: rating.tier, division: rating.division }
}

export function applyRatedResult(input: {
  self: PvpRating
  opponent: PvpRating
  outcome: Exclude<PvpOutcome, 'no_contest'>
  at: string
}): { next: PvpRating; ratingDelta: number; leaguePointsDelta: number } {
  const ratingDelta = calculateRatingDelta(input)
  const leaguePointsDelta = calculateLeaguePointDelta(input)
  const provisionalGames = Math.min(PVP_PLACEMENT_GAME_COUNT, input.self.provisionalGames + 1)
  const leaguePoints = Math.max(0, input.self.leaguePoints + leaguePointsDelta)
  const rank = resolveVisibleRank(leaguePoints, provisionalGames)
  const rankChanged = rank.tier !== input.self.tier || rank.division !== input.self.division

  return {
    ratingDelta,
    leaguePointsDelta,
    next: {
      ...input.self,
      rating: Math.max(0, input.self.rating + ratingDelta),
      leaguePoints,
      tier: rank.tier,
      division: rank.division,
      provisionalGames,
      games: input.self.games + 1,
      wins: input.self.wins + (input.outcome === 'win' ? 1 : 0),
      losses: input.self.losses + (input.outcome === 'loss' ? 1 : 0),
      draws: input.self.draws + (input.outcome === 'draw' ? 1 : 0),
      streak: input.outcome === 'win'
        ? Math.max(1, input.self.streak + 1)
        : input.outcome === 'loss'
          ? Math.min(-1, input.self.streak - 1)
          : 0,
      version: input.self.version + 1,
      tierReachedAt: rankChanged ? input.at : input.self.tierReachedAt,
      updatedAt: input.at,
    },
  }
}
