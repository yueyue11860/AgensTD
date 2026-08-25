import { createHash } from 'crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { ServerConfig } from '../config/server-config'
import type {
  PvpLeaderboardPage,
  PvpMatchDetail,
  PvpMatchHistoryEntry,
  PvpMatchHistoryPage,
  PvpMapCatalogEntry,
  PvpMatchmakingTicket,
  PvpModeDefinition,
  PvpMatchParticipant,
  PvpMatchRecord,
  PvpPlayerSettlement,
  PvpRating,
  PvpRatingLedgerEntry,
  PvpReplayChunk,
  PvpReplayDetail,
  PvpReplayManifest,
  PvpRewardOutboxEvent,
  PvpSeason,
} from '../../../shared/contracts/pvp-competition'
import type {
  PreparedPvpMatchSettlement,
  PvpHistoryQuery,
  PvpLeaderboardQuery,
  PvpSettlementCommitResult,
  PvpStore,
} from './pvp-store'
import { PvpStoreError } from './pvp-store'

type Row = Record<string, unknown>

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function encodeCursor(value: Row): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function decodeCursor(value: string | null | undefined): Row | null {
  if (!value) return null
  try { return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Row }
  catch { return null }
}

function requiredString(row: Row, key: string): string {
  const value = row[key]
  if (typeof value !== 'string') throw new Error(`invalid PVP row field ${key}`)
  return value
}

function nullableString(row: Row, key: string): string | null {
  const value = row[key]
  return typeof value === 'string' ? value : null
}

function numberValue(row: Row, key: string): number {
  const value = Number(row[key])
  if (!Number.isFinite(value)) throw new Error(`invalid PVP row field ${key}`)
  return value
}

function mapSeason(row: Row): PvpSeason {
  return {
    seasonId: requiredString(row, 'season_id'), modeId: requiredString(row, 'mode_id') as PvpSeason['modeId'], modeVersion: requiredString(row, 'mode_version'), region: requiredString(row, 'region'),
    name: requiredString(row, 'name'), status: requiredString(row, 'status') as PvpSeason['status'],
    startsAt: requiredString(row, 'starts_at'), locksAt: requiredString(row, 'locks_at'), endsAt: requiredString(row, 'ends_at'),
    rankPolicyVersion: requiredString(row, 'rank_policy_version'), rewardPolicyVersion: requiredString(row, 'reward_policy_version'),
    createdAt: requiredString(row, 'created_at'), updatedAt: requiredString(row, 'updated_at'),
  }
}

function mapRating(row: Row): PvpRating {
  return {
    seasonId: requiredString(row, 'season_id'), modeId: requiredString(row, 'mode_id') as PvpRating['modeId'], playerId: requiredString(row, 'player_id'),
    rating: numberValue(row, 'rating'), leaguePoints: numberValue(row, 'league_points'), tier: requiredString(row, 'tier') as PvpRating['tier'],
    division: row.division === null || row.division === undefined ? null : numberValue(row, 'division'),
    provisionalGames: numberValue(row, 'provisional_games'), games: numberValue(row, 'games'), wins: numberValue(row, 'wins'),
    losses: numberValue(row, 'losses'), draws: numberValue(row, 'draws'), streak: numberValue(row, 'streak'), version: numberValue(row, 'version'),
    tierReachedAt: requiredString(row, 'tier_reached_at'), updatedAt: requiredString(row, 'updated_at'),
  }
}

function mapMatch(row: Row): PvpMatchRecord {
  return {
    matchId: requiredString(row, 'match_id'), seasonId: requiredString(row, 'season_id'), modeId: requiredString(row, 'mode_id') as PvpMatchRecord['modeId'],
    modeVersion: requiredString(row, 'mode_version'),
    region: requiredString(row, 'region'), mapId: requiredString(row, 'map_id'), mapVersion: requiredString(row, 'map_version'),
    rulesetVersion: requiredString(row, 'ruleset_version'), catalogVersion: requiredString(row, 'catalog_version'),
    effectSystemVersion: requiredString(row, 'effect_system_version'), seed: requiredString(row, 'seed'),
    status: requiredString(row, 'status') as PvpMatchRecord['status'], integrityStatus: requiredString(row, 'integrity_status') as PvpMatchRecord['integrityStatus'],
    winnerSide: nullableString(row, 'winner_side') as PvpMatchRecord['winnerSide'], endReason: requiredString(row, 'end_reason') as PvpMatchRecord['endReason'],
    startedAt: requiredString(row, 'started_at'), endedAt: requiredString(row, 'ended_at'), durationMs: numberValue(row, 'duration_ms'),
    settlementStatus: requiredString(row, 'settlement_status') as PvpMatchRecord['settlementStatus'],
    settlementRequestId: requiredString(row, 'settlement_request_id'), settlementFingerprint: requiredString(row, 'settlement_fingerprint'),
    createdAt: requiredString(row, 'created_at'), updatedAt: requiredString(row, 'updated_at'),
  }
}

function mapMode(row: Row): PvpModeDefinition {
  return {
    modeId: requiredString(row, 'mode_id') as PvpModeDefinition['modeId'], version: requiredString(row, 'version'), name: requiredString(row, 'name'),
    teamSize: numberValue(row, 'team_size'), ranked: row.ranked === true, rewardScaleBps: numberValue(row, 'reward_scale_bps'),
    rulesetVersion: requiredString(row, 'ruleset_version'), mapPoolVersion: requiredString(row, 'map_pool_version'), enabled: row.enabled === true,
    createdAt: requiredString(row, 'created_at'), updatedAt: requiredString(row, 'updated_at'),
  }
}

function mapMap(row: Row): PvpMapCatalogEntry {
  return {
    mapId: requiredString(row, 'map_id'), version: requiredString(row, 'version'), name: requiredString(row, 'name'),
    config: (row.config_json ?? {}) as Record<string, unknown>, checksum: requiredString(row, 'checksum'),
    status: requiredString(row, 'status') as PvpMapCatalogEntry['status'], createdAt: requiredString(row, 'created_at'), updatedAt: requiredString(row, 'updated_at'),
  }
}

function mapTicket(row: Row): PvpMatchmakingTicket {
  return {
    ticketId: requiredString(row, 'ticket_id'), requestId: requiredString(row, 'request_id'), playerId: requiredString(row, 'player_id'),
    seasonId: requiredString(row, 'season_id'), modeId: requiredString(row, 'mode_id') as PvpMatchmakingTicket['modeId'], modeVersion: requiredString(row, 'mode_version'),
    region: requiredString(row, 'region'), ratingSnapshot: numberValue(row, 'rating_snapshot'), state: requiredString(row, 'state') as PvpMatchmakingTicket['state'],
    enqueuedAt: requiredString(row, 'enqueued_at'), expiresAt: requiredString(row, 'expires_at'), matchedMatchId: nullableString(row, 'matched_match_id'),
    updatedAt: requiredString(row, 'updated_at'),
  }
}

function mapParticipant(row: Row): PvpMatchParticipant {
  return {
    matchId: requiredString(row, 'match_id'), playerId: requiredString(row, 'player_id'), playerName: requiredString(row, 'player_name'),
    side: requiredString(row, 'side') as PvpMatchParticipant['side'], slot: numberValue(row, 'slot'), outcome: requiredString(row, 'outcome') as PvpMatchParticipant['outcome'],
    loadoutSnapshotId: requiredString(row, 'loadout_snapshot_id'), ratingBefore: numberValue(row, 'rating_before'),
    ratingDelta: numberValue(row, 'rating_delta'), ratingAfter: numberValue(row, 'rating_after'),
    leaguePointsBefore: numberValue(row, 'league_points_before'), leaguePointsDelta: numberValue(row, 'league_points_delta'),
    leaguePointsAfter: numberValue(row, 'league_points_after'), tierBefore: requiredString(row, 'tier_before') as PvpMatchParticipant['tierBefore'],
    tierAfter: requiredString(row, 'tier_after') as PvpMatchParticipant['tierAfter'], disconnectedMs: numberValue(row, 'disconnected_ms'),
    forfeited: row.forfeited === true, stats: (row.stats_json ?? {}) as Record<string, unknown>,
  }
}

function mapSettlement(row: Row): PvpPlayerSettlement {
  return {
    settlementId: requiredString(row, 'settlement_id'), matchId: requiredString(row, 'match_id'), playerId: requiredString(row, 'player_id'),
    requestId: requiredString(row, 'request_id'), fingerprint: requiredString(row, 'fingerprint'), outcome: requiredString(row, 'outcome') as PvpPlayerSettlement['outcome'],
    ratingBefore: numberValue(row, 'rating_before'), ratingDelta: numberValue(row, 'rating_delta'), ratingAfter: numberValue(row, 'rating_after'),
    leaguePointsBefore: numberValue(row, 'league_points_before'), leaguePointsDelta: numberValue(row, 'league_points_delta'),
    leaguePointsAfter: numberValue(row, 'league_points_after'), tierBefore: requiredString(row, 'tier_before') as PvpPlayerSettlement['tierBefore'],
    tierAfter: requiredString(row, 'tier_after') as PvpPlayerSettlement['tierAfter'], reward: (row.reward_json ?? {}) as Record<string, unknown>,
    rewardStatus: requiredString(row, 'reward_status') as PvpPlayerSettlement['rewardStatus'], committedAt: requiredString(row, 'committed_at'),
  }
}

function mapLedger(row: Row): PvpRatingLedgerEntry {
  return {
    ledgerId: requiredString(row, 'ledger_id'), seasonId: requiredString(row, 'season_id'), modeId: requiredString(row, 'mode_id') as PvpRatingLedgerEntry['modeId'],
    matchId: requiredString(row, 'match_id'), playerId: requiredString(row, 'player_id'), ratingBefore: numberValue(row, 'rating_before'),
    ratingDelta: numberValue(row, 'rating_delta'), ratingAfter: numberValue(row, 'rating_after'),
    leaguePointsBefore: numberValue(row, 'league_points_before'), leaguePointsDelta: numberValue(row, 'league_points_delta'),
    leaguePointsAfter: numberValue(row, 'league_points_after'), policyVersion: requiredString(row, 'policy_version'), createdAt: requiredString(row, 'created_at'),
  }
}

function mapOutbox(row: Row): PvpRewardOutboxEvent {
  return {
    eventId: requiredString(row, 'event_id'), matchId: requiredString(row, 'match_id'), playerId: requiredString(row, 'player_id'),
    eventType: 'pvp_match_reward', payload: (row.payload_json ?? {}) as Record<string, unknown>,
    status: requiredString(row, 'status') as PvpRewardOutboxEvent['status'], attempts: numberValue(row, 'attempts'),
    availableAt: requiredString(row, 'available_at'), leaseOwner: nullableString(row, 'lease_owner'), leaseExpiresAt: nullableString(row, 'lease_expires_at'),
    lastError: nullableString(row, 'last_error'), createdAt: requiredString(row, 'created_at'), updatedAt: requiredString(row, 'updated_at'),
  }
}

function mapManifest(row: Row): PvpReplayManifest {
  return {
    matchId: requiredString(row, 'match_id'), rulesetVersion: requiredString(row, 'ruleset_version'), catalogVersion: requiredString(row, 'catalog_version'),
    effectSystemVersion: requiredString(row, 'effect_system_version'), mapId: requiredString(row, 'map_id'), mapVersion: requiredString(row, 'map_version'),
    seed: requiredString(row, 'seed'), initialSnapshot: row.initial_snapshot_json ? row.initial_snapshot_json as Record<string, unknown> : null,
    initialSnapshotUri: nullableString(row, 'initial_snapshot_uri'), actionCount: numberValue(row, 'action_count'), chunkCount: numberValue(row, 'chunk_count'),
    finalStateHash: nullableString(row, 'final_state_hash'), visibility: requiredString(row, 'visibility') as PvpReplayManifest['visibility'],
    status: requiredString(row, 'status') as PvpReplayManifest['status'], createdAt: requiredString(row, 'created_at'), updatedAt: requiredString(row, 'updated_at'),
  }
}

function mapChunk(row: Row): PvpReplayChunk {
  return {
    matchId: requiredString(row, 'match_id'), chunkIndex: numberValue(row, 'chunk_index'), firstTick: numberValue(row, 'first_tick'),
    lastTick: numberValue(row, 'last_tick'), payload: row.payload_json ? row.payload_json as Record<string, unknown> : null,
    objectUri: nullableString(row, 'object_uri'), sha256: requiredString(row, 'sha256'), createdAt: requiredString(row, 'created_at'),
  }
}

function throwError(operation: string, error: { message: string; code?: string } | null): void {
  if (error) throw new Error(`Supabase PVP ${operation} failed: ${error.code ?? ''} ${error.message}`.trim())
}

export class SupabasePvpStore implements PvpStore {
  private readonly client: SupabaseClient | null

  constructor(config: ServerConfig) {
    this.client = config.supabaseUrl && config.supabaseServiceRoleKey
      ? createClient(config.supabaseUrl, config.supabaseServiceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
      : null
  }

  isEnabled(): boolean { return this.client !== null }

  async upsertMode(mode: PvpModeDefinition): Promise<PvpModeDefinition> {
    const { data, error } = await this.requireClient().from('pvp_modes').upsert({
      mode_id: mode.modeId, version: mode.version, name: mode.name, team_size: mode.teamSize, ranked: mode.ranked,
      reward_scale_bps: mode.rewardScaleBps, ruleset_version: mode.rulesetVersion, map_pool_version: mode.mapPoolVersion,
      enabled: mode.enabled, created_at: mode.createdAt, updated_at: mode.updatedAt,
    }, { onConflict: 'mode_id,version' }).select('*').single()
    throwError('upsertMode', error)
    return mapMode(data as Row)
  }

  async getMode(modeId: string, version: string): Promise<PvpModeDefinition | null> {
    const { data, error } = await this.requireClient().from('pvp_modes').select('*').eq('mode_id', modeId).eq('version', version).maybeSingle()
    throwError('getMode', error)
    return data ? mapMode(data as Row) : null
  }

  async listModes(enabledOnly = false): Promise<PvpModeDefinition[]> {
    let query = this.requireClient().from('pvp_modes').select('*').order('mode_id').order('version', { ascending: false })
    if (enabledOnly) query = query.eq('enabled', true)
    const { data, error } = await query
    throwError('listModes', error)
    return (data ?? []).map(row => mapMode(row as Row))
  }

  async upsertMap(map: PvpMapCatalogEntry): Promise<PvpMapCatalogEntry> {
    const { data, error } = await this.requireClient().from('pvp_maps').upsert({
      map_id: map.mapId, version: map.version, name: map.name, config_json: map.config, checksum: map.checksum,
      status: map.status, created_at: map.createdAt, updated_at: map.updatedAt,
    }, { onConflict: 'map_id,version' }).select('*').single()
    throwError('upsertMap', error)
    return mapMap(data as Row)
  }

  async getMap(mapId: string, version: string): Promise<PvpMapCatalogEntry | null> {
    const { data, error } = await this.requireClient().from('pvp_maps').select('*').eq('map_id', mapId).eq('version', version).maybeSingle()
    throwError('getMap', error)
    return data ? mapMap(data as Row) : null
  }

  async listMaps(status?: PvpMapCatalogEntry['status']): Promise<PvpMapCatalogEntry[]> {
    let query = this.requireClient().from('pvp_maps').select('*').order('map_id').order('version', { ascending: false })
    if (status) query = query.eq('status', status)
    const { data, error } = await query
    throwError('listMaps', error)
    return (data ?? []).map(row => mapMap(row as Row))
  }

  async createMatchmakingTicket(ticket: PvpMatchmakingTicket): Promise<PvpMatchmakingTicket> {
    const { data, error } = await this.requireClient().from('pvp_matchmaking_tickets').insert({
      ticket_id: ticket.ticketId, request_id: ticket.requestId, player_id: ticket.playerId, season_id: ticket.seasonId,
      mode_id: ticket.modeId, mode_version: ticket.modeVersion, region: ticket.region, rating_snapshot: ticket.ratingSnapshot,
      state: ticket.state, enqueued_at: ticket.enqueuedAt, expires_at: ticket.expiresAt,
      matched_match_id: ticket.matchedMatchId, updated_at: ticket.updatedAt,
    }).select('*').single()
    if (error?.code === '23505') throw new PvpStoreError('MATCHMAKING_CONFLICT', error.message)
    throwError('createMatchmakingTicket', error)
    return mapTicket(data as Row)
  }

  async getMatchmakingTicket(ticketId: string): Promise<PvpMatchmakingTicket | null> {
    const { data, error } = await this.requireClient().from('pvp_matchmaking_tickets').select('*').eq('ticket_id', ticketId).maybeSingle()
    throwError('getMatchmakingTicket', error)
    return data ? mapTicket(data as Row) : null
  }

  async transitionMatchmakingTicket(input: { ticketId: string; expectedState: PvpMatchmakingTicket['state']; nextState: PvpMatchmakingTicket['state']; matchedMatchId?: string | null; updatedAt: string }): Promise<PvpMatchmakingTicket | null> {
    const { data, error } = await this.requireClient().rpc('transition_pvp_matchmaking_ticket', {
      p_ticket_id: input.ticketId, p_expected_state: input.expectedState, p_next_state: input.nextState,
      p_matched_match_id: input.matchedMatchId ?? null, p_updated_at: input.updatedAt,
    })
    throwError('transitionMatchmakingTicket', error)
    return data === true ? this.getMatchmakingTicket(input.ticketId) : null
  }

  async upsertSeason(season: PvpSeason): Promise<PvpSeason> {
    const { data, error } = await this.requireClient().from('pvp_seasons').upsert({
      season_id: season.seasonId, mode_id: season.modeId, mode_version: season.modeVersion, region: season.region, name: season.name, status: season.status,
      starts_at: season.startsAt, locks_at: season.locksAt, ends_at: season.endsAt, rank_policy_version: season.rankPolicyVersion,
      reward_policy_version: season.rewardPolicyVersion, created_at: season.createdAt, updated_at: season.updatedAt,
    }, { onConflict: 'season_id' }).select('*').single()
    if (error?.code === '23505') throw new PvpStoreError('SEASON_CONFLICT', error.message)
    throwError('upsertSeason', error)
    return mapSeason(data as Row)
  }

  async getSeason(seasonId: string): Promise<PvpSeason | null> {
    const { data, error } = await this.requireClient().from('pvp_seasons').select('*').eq('season_id', seasonId).maybeSingle()
    throwError('getSeason', error)
    return data ? mapSeason(data as Row) : null
  }

  async listSeasons(modeId?: string): Promise<PvpSeason[]> {
    let query = this.requireClient().from('pvp_seasons').select('*').order('starts_at', { ascending: false }).order('season_id')
    if (modeId) query = query.eq('mode_id', modeId)
    const { data, error } = await query
    throwError('listSeasons', error)
    return (data ?? []).map(row => mapSeason(row as Row))
  }

  async getRating(seasonId: string, modeId: string, playerId: string): Promise<PvpRating | null> {
    const { data, error } = await this.requireClient().from('pvp_ratings').select('*')
      .eq('season_id', seasonId).eq('mode_id', modeId).eq('player_id', playerId).maybeSingle()
    throwError('getRating', error)
    return data ? mapRating(data as Row) : null
  }

  async getLeaderboard(query: PvpLeaderboardQuery): Promise<PvpLeaderboardPage> {
    const limit = Math.max(1, Math.min(100, Math.trunc(query.limit)))
    const cursor = decodeCursor(query.cursor)
    const { data, error } = await this.requireClient().rpc('get_pvp_leaderboard_page', {
      p_season_id: query.seasonId, p_mode_id: query.modeId, p_limit: limit + 1,
      p_cursor_lp: cursor?.leaguePoints ?? null, p_cursor_rating: cursor?.rating ?? null,
      p_cursor_wins: cursor?.wins ?? null, p_cursor_reached_at: cursor?.tierReachedAt ?? null,
      p_cursor_player_id: cursor?.playerId ?? null,
    })
    throwError('getLeaderboard', error)
    const rows = (data ?? []) as Row[]
    const page = rows.slice(0, limit)
    const tail = page[page.length - 1]
    return {
      seasonId: query.seasonId,
      modeId: query.modeId,
      entries: page.map(row => ({ ...mapRating(row), rank: numberValue(row, 'rank'), playerName: requiredString(row, 'player_name') })),
      nextCursor: rows.length > limit && tail ? encodeCursor({
        leaguePoints: numberValue(tail, 'league_points'), rating: numberValue(tail, 'rating'), wins: numberValue(tail, 'wins'),
        tierReachedAt: requiredString(tail, 'tier_reached_at'), playerId: requiredString(tail, 'player_id'),
      }) : null,
    }
  }

  async listRatingLedger(playerId: string, seasonId: string, modeId: string, limit: number): Promise<PvpRatingLedgerEntry[]> {
    const { data, error } = await this.requireClient().from('pvp_rating_ledger').select('*')
      .eq('player_id', playerId).eq('season_id', seasonId).eq('mode_id', modeId)
      .order('created_at', { ascending: false }).order('ledger_id', { ascending: false }).limit(Math.max(1, Math.min(100, limit)))
    throwError('listRatingLedger', error)
    return (data ?? []).map(row => mapLedger(row as Row))
  }

  async commitMatchSettlement(command: PreparedPvpMatchSettlement): Promise<PvpSettlementCommitResult> {
    const { data, error } = await this.requireClient().rpc('commit_pvp_match_settlement', { p_command: command })
    if (error) {
      if (/CONFLICT/.test(error.message)) throw new PvpStoreError('SETTLEMENT_CONFLICT', error.message)
      throwError('commitMatchSettlement', error)
    }
    const status = (data as { status?: string } | null)?.status
    if (status === 'rating_conflict') return { status: 'rating_conflict' }
    const detail = await this.getMatchDetail(command.match.matchId)
    if (!detail) throw new Error('PVP settlement committed without persisted match detail')
    return { status: status === 'duplicate' ? 'duplicate' : 'committed', detail }
  }

  async getMatchDetail(matchId: string): Promise<PvpMatchDetail | null> {
    const client = this.requireClient()
    const [matchResult, participantsResult, settlementsResult] = await Promise.all([
      client.from('pvp_matches').select('*').eq('match_id', matchId).maybeSingle(),
      client.from('pvp_match_players').select('*').eq('match_id', matchId).order('side').order('slot'),
      client.from('pvp_settlements').select('*').eq('match_id', matchId).order('player_id'),
    ])
    throwError('getMatchDetail.match', matchResult.error)
    throwError('getMatchDetail.participants', participantsResult.error)
    throwError('getMatchDetail.settlements', settlementsResult.error)
    if (!matchResult.data) return null
    return {
      match: mapMatch(matchResult.data as Row),
      participants: (participantsResult.data ?? []).map(row => mapParticipant(row as Row)),
      settlements: (settlementsResult.data ?? []).map(row => mapSettlement(row as Row)),
    }
  }

  async listMatchHistory(query: PvpHistoryQuery): Promise<PvpMatchHistoryPage> {
    const limit = Math.max(1, Math.min(100, Math.trunc(query.limit)))
    const cursor = decodeCursor(query.cursor)
    const { data, error } = await this.requireClient().rpc('list_pvp_match_history_ids', {
      p_player_id: query.playerId, p_season_id: query.seasonId ?? null, p_mode_id: query.modeId ?? null,
      p_limit: limit + 1, p_cursor_ended_at: cursor?.endedAt ?? null, p_cursor_match_id: cursor?.matchId ?? null,
    })
    throwError('listMatchHistory', error)
    const rows = (data ?? []) as Row[]
    const page = rows.slice(0, limit)
    const details = await Promise.all(page.map(row => this.getMatchDetail(requiredString(row, 'match_id'))))
    const entries: PvpMatchHistoryEntry[] = details.flatMap((detail) => {
      if (!detail) return []
      const self = detail.participants.find(participant => participant.playerId === query.playerId)
      if (!self) return []
      return [{ match: detail.match, self, opponents: detail.participants.filter(participant => participant.playerId !== query.playerId) }]
    })
    const tail = page[page.length - 1]
    return {
      entries,
      nextCursor: rows.length > limit && tail
        ? encodeCursor({ endedAt: requiredString(tail, 'ended_at'), matchId: requiredString(tail, 'match_id') })
        : null,
    }
  }

  async claimRewardOutbox(workerId: string, limit: number, now: string, leaseMs: number): Promise<PvpRewardOutboxEvent[]> {
    const { data, error } = await this.requireClient().rpc('claim_pvp_reward_outbox', {
      p_worker_id: workerId, p_limit: limit, p_now: now, p_lease_ms: leaseMs,
    })
    throwError('claimRewardOutbox', error)
    return ((data ?? []) as Row[]).map(mapOutbox)
  }

  async completeRewardOutbox(eventId: string, workerId: string, completedAt: string): Promise<boolean> {
    const { data, error } = await this.requireClient().rpc('complete_pvp_reward_outbox', {
      p_event_id: eventId, p_worker_id: workerId, p_completed_at: completedAt,
    })
    throwError('completeRewardOutbox', error)
    return data === true
  }

  async failRewardOutbox(eventId: string, workerId: string, errorMessage: string, retryAt: string): Promise<boolean> {
    const { data, error } = await this.requireClient().rpc('fail_pvp_reward_outbox', {
      p_event_id: eventId, p_worker_id: workerId, p_error: errorMessage, p_retry_at: retryAt,
    })
    throwError('failRewardOutbox', error)
    return data === true
  }

  async createReplayManifest(manifest: PvpReplayManifest): Promise<PvpReplayManifest> {
    const fingerprint = hashJson(manifest)
    const { error } = await this.requireClient().from('pvp_replay_manifests').upsert({
      match_id: manifest.matchId, ruleset_version: manifest.rulesetVersion, catalog_version: manifest.catalogVersion,
      effect_system_version: manifest.effectSystemVersion, map_id: manifest.mapId, map_version: manifest.mapVersion, seed: manifest.seed,
      initial_snapshot_json: manifest.initialSnapshot, initial_snapshot_uri: manifest.initialSnapshotUri,
      action_count: manifest.actionCount, chunk_count: manifest.chunkCount, final_state_hash: manifest.finalStateHash,
      visibility: manifest.visibility, status: manifest.status, manifest_fingerprint: fingerprint,
      created_at: manifest.createdAt, updated_at: manifest.updatedAt,
    }, { onConflict: 'match_id', ignoreDuplicates: true })
    throwError('createReplayManifest', error)
    const { data: stored, error: readError } = await this.requireClient().from('pvp_replay_manifests').select('*').eq('match_id', manifest.matchId).single()
    throwError('createReplayManifest.read', readError)
    if ((stored as Row).manifest_fingerprint !== fingerprint) throw new PvpStoreError('REPLAY_CONFLICT', 'manifest already exists with different content')
    return mapManifest(stored as Row)
  }

  async appendReplayChunk(chunk: PvpReplayChunk): Promise<PvpReplayChunk> {
    const { error } = await this.requireClient().rpc('append_pvp_replay_chunk', { p_chunk: chunk })
    if (error) {
      if (/CONFLICT|ORDER/.test(error.message)) throw new PvpStoreError('REPLAY_CONFLICT', error.message)
      if (/NOT_FOUND/.test(error.message)) throw new PvpStoreError('REPLAY_NOT_FOUND', error.message)
      throwError('appendReplayChunk', error)
    }
    return structuredClone(chunk)
  }

  async finalizeReplay(matchId: string, chunkCount: number, actionCount: number, finalStateHash: string, updatedAt: string): Promise<PvpReplayManifest> {
    const { data, error } = await this.requireClient().rpc('finalize_pvp_replay', {
      p_match_id: matchId, p_chunk_count: chunkCount, p_action_count: actionCount, p_final_hash: finalStateHash, p_updated_at: updatedAt,
    })
    throwError('finalizeReplay', error)
    if (data !== true) throw new PvpStoreError('REPLAY_CONFLICT', 'replay totals do not match persisted chunks')
    const replay = await this.getReplay(matchId)
    if (!replay) throw new PvpStoreError('REPLAY_NOT_FOUND', `manifest ${matchId} does not exist`)
    return replay.manifest
  }

  async getReplay(matchId: string): Promise<PvpReplayDetail | null> {
    const client = this.requireClient()
    const [manifestResult, chunksResult] = await Promise.all([
      client.from('pvp_replay_manifests').select('*').eq('match_id', matchId).maybeSingle(),
      client.from('pvp_replay_chunks').select('*').eq('match_id', matchId).order('chunk_index'),
    ])
    throwError('getReplay.manifest', manifestResult.error)
    throwError('getReplay.chunks', chunksResult.error)
    if (!manifestResult.data) return null
    return {
      manifest: mapManifest(manifestResult.data as Row),
      chunks: (chunksResult.data ?? []).map(row => mapChunk(row as Row)),
    }
  }

  private requireClient(): SupabaseClient {
    if (!this.client) throw new Error('Supabase PVP store is disabled')
    return this.client
  }
}
