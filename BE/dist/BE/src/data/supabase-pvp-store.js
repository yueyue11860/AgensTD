"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupabasePvpStore = void 0;
const crypto_1 = require("crypto");
const supabase_js_1 = require("@supabase/supabase-js");
const pvp_store_1 = require("./pvp-store");
function hashJson(value) {
    return (0, crypto_1.createHash)('sha256').update(JSON.stringify(value)).digest('hex');
}
function encodeCursor(value) {
    return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}
function decodeCursor(value) {
    if (!value)
        return null;
    try {
        return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    }
    catch {
        return null;
    }
}
function requiredString(row, key) {
    const value = row[key];
    if (typeof value !== 'string')
        throw new Error(`invalid PVP row field ${key}`);
    return value;
}
function nullableString(row, key) {
    const value = row[key];
    return typeof value === 'string' ? value : null;
}
function numberValue(row, key) {
    const value = Number(row[key]);
    if (!Number.isFinite(value))
        throw new Error(`invalid PVP row field ${key}`);
    return value;
}
function mapSeason(row) {
    return {
        seasonId: requiredString(row, 'season_id'), modeId: requiredString(row, 'mode_id'), modeVersion: requiredString(row, 'mode_version'), region: requiredString(row, 'region'),
        name: requiredString(row, 'name'), status: requiredString(row, 'status'),
        startsAt: requiredString(row, 'starts_at'), locksAt: requiredString(row, 'locks_at'), endsAt: requiredString(row, 'ends_at'),
        rankPolicyVersion: requiredString(row, 'rank_policy_version'), rewardPolicyVersion: requiredString(row, 'reward_policy_version'),
        createdAt: requiredString(row, 'created_at'), updatedAt: requiredString(row, 'updated_at'),
    };
}
function mapRating(row) {
    return {
        seasonId: requiredString(row, 'season_id'), modeId: requiredString(row, 'mode_id'), playerId: requiredString(row, 'player_id'),
        rating: numberValue(row, 'rating'), leaguePoints: numberValue(row, 'league_points'), tier: requiredString(row, 'tier'),
        division: row.division === null || row.division === undefined ? null : numberValue(row, 'division'),
        provisionalGames: numberValue(row, 'provisional_games'), games: numberValue(row, 'games'), wins: numberValue(row, 'wins'),
        losses: numberValue(row, 'losses'), draws: numberValue(row, 'draws'), streak: numberValue(row, 'streak'), version: numberValue(row, 'version'),
        tierReachedAt: requiredString(row, 'tier_reached_at'), updatedAt: requiredString(row, 'updated_at'),
    };
}
function mapMatch(row) {
    return {
        matchId: requiredString(row, 'match_id'), seasonId: requiredString(row, 'season_id'), modeId: requiredString(row, 'mode_id'),
        modeVersion: requiredString(row, 'mode_version'),
        region: requiredString(row, 'region'), mapId: requiredString(row, 'map_id'), mapVersion: requiredString(row, 'map_version'),
        rulesetVersion: requiredString(row, 'ruleset_version'), catalogVersion: requiredString(row, 'catalog_version'),
        effectSystemVersion: requiredString(row, 'effect_system_version'), seed: requiredString(row, 'seed'),
        status: requiredString(row, 'status'), integrityStatus: requiredString(row, 'integrity_status'),
        winnerSide: nullableString(row, 'winner_side'), endReason: requiredString(row, 'end_reason'),
        startedAt: requiredString(row, 'started_at'), endedAt: requiredString(row, 'ended_at'), durationMs: numberValue(row, 'duration_ms'),
        settlementStatus: requiredString(row, 'settlement_status'),
        settlementRequestId: requiredString(row, 'settlement_request_id'), settlementFingerprint: requiredString(row, 'settlement_fingerprint'),
        createdAt: requiredString(row, 'created_at'), updatedAt: requiredString(row, 'updated_at'),
    };
}
function mapMode(row) {
    return {
        modeId: requiredString(row, 'mode_id'), version: requiredString(row, 'version'), name: requiredString(row, 'name'),
        teamSize: numberValue(row, 'team_size'), ranked: row.ranked === true, rewardScaleBps: numberValue(row, 'reward_scale_bps'),
        rulesetVersion: requiredString(row, 'ruleset_version'), mapPoolVersion: requiredString(row, 'map_pool_version'), enabled: row.enabled === true,
        createdAt: requiredString(row, 'created_at'), updatedAt: requiredString(row, 'updated_at'),
    };
}
function mapMap(row) {
    return {
        mapId: requiredString(row, 'map_id'), version: requiredString(row, 'version'), name: requiredString(row, 'name'),
        config: (row.config_json ?? {}), checksum: requiredString(row, 'checksum'),
        status: requiredString(row, 'status'), createdAt: requiredString(row, 'created_at'), updatedAt: requiredString(row, 'updated_at'),
    };
}
function mapTicket(row) {
    return {
        ticketId: requiredString(row, 'ticket_id'), requestId: requiredString(row, 'request_id'), playerId: requiredString(row, 'player_id'),
        seasonId: requiredString(row, 'season_id'), modeId: requiredString(row, 'mode_id'), modeVersion: requiredString(row, 'mode_version'),
        region: requiredString(row, 'region'), ratingSnapshot: numberValue(row, 'rating_snapshot'), state: requiredString(row, 'state'),
        enqueuedAt: requiredString(row, 'enqueued_at'), expiresAt: requiredString(row, 'expires_at'), matchedMatchId: nullableString(row, 'matched_match_id'),
        updatedAt: requiredString(row, 'updated_at'),
    };
}
function mapParticipant(row) {
    return {
        matchId: requiredString(row, 'match_id'), playerId: requiredString(row, 'player_id'), playerName: requiredString(row, 'player_name'),
        side: requiredString(row, 'side'), slot: numberValue(row, 'slot'), outcome: requiredString(row, 'outcome'),
        loadoutSnapshotId: requiredString(row, 'loadout_snapshot_id'), ratingBefore: numberValue(row, 'rating_before'),
        ratingDelta: numberValue(row, 'rating_delta'), ratingAfter: numberValue(row, 'rating_after'),
        leaguePointsBefore: numberValue(row, 'league_points_before'), leaguePointsDelta: numberValue(row, 'league_points_delta'),
        leaguePointsAfter: numberValue(row, 'league_points_after'), tierBefore: requiredString(row, 'tier_before'),
        tierAfter: requiredString(row, 'tier_after'), disconnectedMs: numberValue(row, 'disconnected_ms'),
        forfeited: row.forfeited === true, stats: (row.stats_json ?? {}),
    };
}
function mapSettlement(row) {
    return {
        settlementId: requiredString(row, 'settlement_id'), matchId: requiredString(row, 'match_id'), playerId: requiredString(row, 'player_id'),
        requestId: requiredString(row, 'request_id'), fingerprint: requiredString(row, 'fingerprint'), outcome: requiredString(row, 'outcome'),
        ratingBefore: numberValue(row, 'rating_before'), ratingDelta: numberValue(row, 'rating_delta'), ratingAfter: numberValue(row, 'rating_after'),
        leaguePointsBefore: numberValue(row, 'league_points_before'), leaguePointsDelta: numberValue(row, 'league_points_delta'),
        leaguePointsAfter: numberValue(row, 'league_points_after'), tierBefore: requiredString(row, 'tier_before'),
        tierAfter: requiredString(row, 'tier_after'), reward: (row.reward_json ?? {}),
        rewardStatus: requiredString(row, 'reward_status'), committedAt: requiredString(row, 'committed_at'),
    };
}
function mapLedger(row) {
    return {
        ledgerId: requiredString(row, 'ledger_id'), seasonId: requiredString(row, 'season_id'), modeId: requiredString(row, 'mode_id'),
        matchId: requiredString(row, 'match_id'), playerId: requiredString(row, 'player_id'), ratingBefore: numberValue(row, 'rating_before'),
        ratingDelta: numberValue(row, 'rating_delta'), ratingAfter: numberValue(row, 'rating_after'),
        leaguePointsBefore: numberValue(row, 'league_points_before'), leaguePointsDelta: numberValue(row, 'league_points_delta'),
        leaguePointsAfter: numberValue(row, 'league_points_after'), policyVersion: requiredString(row, 'policy_version'), createdAt: requiredString(row, 'created_at'),
    };
}
function mapOutbox(row) {
    return {
        eventId: requiredString(row, 'event_id'), matchId: requiredString(row, 'match_id'), playerId: requiredString(row, 'player_id'),
        eventType: 'pvp_match_reward', payload: (row.payload_json ?? {}),
        status: requiredString(row, 'status'), attempts: numberValue(row, 'attempts'),
        availableAt: requiredString(row, 'available_at'), leaseOwner: nullableString(row, 'lease_owner'), leaseExpiresAt: nullableString(row, 'lease_expires_at'),
        lastError: nullableString(row, 'last_error'), createdAt: requiredString(row, 'created_at'), updatedAt: requiredString(row, 'updated_at'),
    };
}
function mapManifest(row) {
    return {
        matchId: requiredString(row, 'match_id'), rulesetVersion: requiredString(row, 'ruleset_version'), catalogVersion: requiredString(row, 'catalog_version'),
        effectSystemVersion: requiredString(row, 'effect_system_version'), mapId: requiredString(row, 'map_id'), mapVersion: requiredString(row, 'map_version'),
        seed: requiredString(row, 'seed'), initialSnapshot: row.initial_snapshot_json ? row.initial_snapshot_json : null,
        initialSnapshotUri: nullableString(row, 'initial_snapshot_uri'), actionCount: numberValue(row, 'action_count'), chunkCount: numberValue(row, 'chunk_count'),
        finalStateHash: nullableString(row, 'final_state_hash'), visibility: requiredString(row, 'visibility'),
        status: requiredString(row, 'status'), createdAt: requiredString(row, 'created_at'), updatedAt: requiredString(row, 'updated_at'),
    };
}
function mapChunk(row) {
    return {
        matchId: requiredString(row, 'match_id'), chunkIndex: numberValue(row, 'chunk_index'), firstTick: numberValue(row, 'first_tick'),
        lastTick: numberValue(row, 'last_tick'), payload: row.payload_json ? row.payload_json : null,
        objectUri: nullableString(row, 'object_uri'), sha256: requiredString(row, 'sha256'), createdAt: requiredString(row, 'created_at'),
    };
}
function throwError(operation, error) {
    if (error)
        throw new Error(`Supabase PVP ${operation} failed: ${error.code ?? ''} ${error.message}`.trim());
}
class SupabasePvpStore {
    client;
    constructor(config) {
        this.client = config.supabaseUrl && config.supabaseServiceRoleKey
            ? (0, supabase_js_1.createClient)(config.supabaseUrl, config.supabaseServiceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
            : null;
    }
    isEnabled() { return this.client !== null; }
    async upsertMode(mode) {
        const { data, error } = await this.requireClient().from('pvp_modes').upsert({
            mode_id: mode.modeId, version: mode.version, name: mode.name, team_size: mode.teamSize, ranked: mode.ranked,
            reward_scale_bps: mode.rewardScaleBps, ruleset_version: mode.rulesetVersion, map_pool_version: mode.mapPoolVersion,
            enabled: mode.enabled, created_at: mode.createdAt, updated_at: mode.updatedAt,
        }, { onConflict: 'mode_id,version' }).select('*').single();
        throwError('upsertMode', error);
        return mapMode(data);
    }
    async getMode(modeId, version) {
        const { data, error } = await this.requireClient().from('pvp_modes').select('*').eq('mode_id', modeId).eq('version', version).maybeSingle();
        throwError('getMode', error);
        return data ? mapMode(data) : null;
    }
    async listModes(enabledOnly = false) {
        let query = this.requireClient().from('pvp_modes').select('*').order('mode_id').order('version', { ascending: false });
        if (enabledOnly)
            query = query.eq('enabled', true);
        const { data, error } = await query;
        throwError('listModes', error);
        return (data ?? []).map(row => mapMode(row));
    }
    async upsertMap(map) {
        const { data, error } = await this.requireClient().from('pvp_maps').upsert({
            map_id: map.mapId, version: map.version, name: map.name, config_json: map.config, checksum: map.checksum,
            status: map.status, created_at: map.createdAt, updated_at: map.updatedAt,
        }, { onConflict: 'map_id,version' }).select('*').single();
        throwError('upsertMap', error);
        return mapMap(data);
    }
    async getMap(mapId, version) {
        const { data, error } = await this.requireClient().from('pvp_maps').select('*').eq('map_id', mapId).eq('version', version).maybeSingle();
        throwError('getMap', error);
        return data ? mapMap(data) : null;
    }
    async listMaps(status) {
        let query = this.requireClient().from('pvp_maps').select('*').order('map_id').order('version', { ascending: false });
        if (status)
            query = query.eq('status', status);
        const { data, error } = await query;
        throwError('listMaps', error);
        return (data ?? []).map(row => mapMap(row));
    }
    async createMatchmakingTicket(ticket) {
        const { data, error } = await this.requireClient().from('pvp_matchmaking_tickets').insert({
            ticket_id: ticket.ticketId, request_id: ticket.requestId, player_id: ticket.playerId, season_id: ticket.seasonId,
            mode_id: ticket.modeId, mode_version: ticket.modeVersion, region: ticket.region, rating_snapshot: ticket.ratingSnapshot,
            state: ticket.state, enqueued_at: ticket.enqueuedAt, expires_at: ticket.expiresAt,
            matched_match_id: ticket.matchedMatchId, updated_at: ticket.updatedAt,
        }).select('*').single();
        if (error?.code === '23505')
            throw new pvp_store_1.PvpStoreError('MATCHMAKING_CONFLICT', error.message);
        throwError('createMatchmakingTicket', error);
        return mapTicket(data);
    }
    async getMatchmakingTicket(ticketId) {
        const { data, error } = await this.requireClient().from('pvp_matchmaking_tickets').select('*').eq('ticket_id', ticketId).maybeSingle();
        throwError('getMatchmakingTicket', error);
        return data ? mapTicket(data) : null;
    }
    async transitionMatchmakingTicket(input) {
        const { data, error } = await this.requireClient().rpc('transition_pvp_matchmaking_ticket', {
            p_ticket_id: input.ticketId, p_expected_state: input.expectedState, p_next_state: input.nextState,
            p_matched_match_id: input.matchedMatchId ?? null, p_updated_at: input.updatedAt,
        });
        throwError('transitionMatchmakingTicket', error);
        return data === true ? this.getMatchmakingTicket(input.ticketId) : null;
    }
    async upsertSeason(season) {
        const { data, error } = await this.requireClient().from('pvp_seasons').upsert({
            season_id: season.seasonId, mode_id: season.modeId, mode_version: season.modeVersion, region: season.region, name: season.name, status: season.status,
            starts_at: season.startsAt, locks_at: season.locksAt, ends_at: season.endsAt, rank_policy_version: season.rankPolicyVersion,
            reward_policy_version: season.rewardPolicyVersion, created_at: season.createdAt, updated_at: season.updatedAt,
        }, { onConflict: 'season_id' }).select('*').single();
        if (error?.code === '23505')
            throw new pvp_store_1.PvpStoreError('SEASON_CONFLICT', error.message);
        throwError('upsertSeason', error);
        return mapSeason(data);
    }
    async getSeason(seasonId) {
        const { data, error } = await this.requireClient().from('pvp_seasons').select('*').eq('season_id', seasonId).maybeSingle();
        throwError('getSeason', error);
        return data ? mapSeason(data) : null;
    }
    async listSeasons(modeId) {
        let query = this.requireClient().from('pvp_seasons').select('*').order('starts_at', { ascending: false }).order('season_id');
        if (modeId)
            query = query.eq('mode_id', modeId);
        const { data, error } = await query;
        throwError('listSeasons', error);
        return (data ?? []).map(row => mapSeason(row));
    }
    async getRating(seasonId, modeId, playerId) {
        const { data, error } = await this.requireClient().from('pvp_ratings').select('*')
            .eq('season_id', seasonId).eq('mode_id', modeId).eq('player_id', playerId).maybeSingle();
        throwError('getRating', error);
        return data ? mapRating(data) : null;
    }
    async getLeaderboard(query) {
        const limit = Math.max(1, Math.min(100, Math.trunc(query.limit)));
        const cursor = decodeCursor(query.cursor);
        const { data, error } = await this.requireClient().rpc('get_pvp_leaderboard_page', {
            p_season_id: query.seasonId, p_mode_id: query.modeId, p_limit: limit + 1,
            p_cursor_lp: cursor?.leaguePoints ?? null, p_cursor_rating: cursor?.rating ?? null,
            p_cursor_wins: cursor?.wins ?? null, p_cursor_reached_at: cursor?.tierReachedAt ?? null,
            p_cursor_player_id: cursor?.playerId ?? null,
        });
        throwError('getLeaderboard', error);
        const rows = (data ?? []);
        const page = rows.slice(0, limit);
        const tail = page[page.length - 1];
        return {
            seasonId: query.seasonId,
            modeId: query.modeId,
            entries: page.map(row => ({ ...mapRating(row), rank: numberValue(row, 'rank'), playerName: requiredString(row, 'player_name') })),
            nextCursor: rows.length > limit && tail ? encodeCursor({
                leaguePoints: numberValue(tail, 'league_points'), rating: numberValue(tail, 'rating'), wins: numberValue(tail, 'wins'),
                tierReachedAt: requiredString(tail, 'tier_reached_at'), playerId: requiredString(tail, 'player_id'),
            }) : null,
        };
    }
    async listRatingLedger(playerId, seasonId, modeId, limit) {
        const { data, error } = await this.requireClient().from('pvp_rating_ledger').select('*')
            .eq('player_id', playerId).eq('season_id', seasonId).eq('mode_id', modeId)
            .order('created_at', { ascending: false }).order('ledger_id', { ascending: false }).limit(Math.max(1, Math.min(100, limit)));
        throwError('listRatingLedger', error);
        return (data ?? []).map(row => mapLedger(row));
    }
    async commitMatchSettlement(command) {
        const { data, error } = await this.requireClient().rpc('commit_pvp_match_settlement', { p_command: command });
        if (error) {
            if (/CONFLICT/.test(error.message))
                throw new pvp_store_1.PvpStoreError('SETTLEMENT_CONFLICT', error.message);
            throwError('commitMatchSettlement', error);
        }
        const status = data?.status;
        if (status === 'rating_conflict')
            return { status: 'rating_conflict' };
        const detail = await this.getMatchDetail(command.match.matchId);
        if (!detail)
            throw new Error('PVP settlement committed without persisted match detail');
        return { status: status === 'duplicate' ? 'duplicate' : 'committed', detail };
    }
    async getMatchDetail(matchId) {
        const client = this.requireClient();
        const [matchResult, participantsResult, settlementsResult] = await Promise.all([
            client.from('pvp_matches').select('*').eq('match_id', matchId).maybeSingle(),
            client.from('pvp_match_players').select('*').eq('match_id', matchId).order('side').order('slot'),
            client.from('pvp_settlements').select('*').eq('match_id', matchId).order('player_id'),
        ]);
        throwError('getMatchDetail.match', matchResult.error);
        throwError('getMatchDetail.participants', participantsResult.error);
        throwError('getMatchDetail.settlements', settlementsResult.error);
        if (!matchResult.data)
            return null;
        return {
            match: mapMatch(matchResult.data),
            participants: (participantsResult.data ?? []).map(row => mapParticipant(row)),
            settlements: (settlementsResult.data ?? []).map(row => mapSettlement(row)),
        };
    }
    async listMatchHistory(query) {
        const limit = Math.max(1, Math.min(100, Math.trunc(query.limit)));
        const cursor = decodeCursor(query.cursor);
        const { data, error } = await this.requireClient().rpc('list_pvp_match_history_ids', {
            p_player_id: query.playerId, p_season_id: query.seasonId ?? null, p_mode_id: query.modeId ?? null,
            p_limit: limit + 1, p_cursor_ended_at: cursor?.endedAt ?? null, p_cursor_match_id: cursor?.matchId ?? null,
        });
        throwError('listMatchHistory', error);
        const rows = (data ?? []);
        const page = rows.slice(0, limit);
        const details = await Promise.all(page.map(row => this.getMatchDetail(requiredString(row, 'match_id'))));
        const entries = details.flatMap((detail) => {
            if (!detail)
                return [];
            const self = detail.participants.find(participant => participant.playerId === query.playerId);
            if (!self)
                return [];
            return [{ match: detail.match, self, opponents: detail.participants.filter(participant => participant.playerId !== query.playerId) }];
        });
        const tail = page[page.length - 1];
        return {
            entries,
            nextCursor: rows.length > limit && tail
                ? encodeCursor({ endedAt: requiredString(tail, 'ended_at'), matchId: requiredString(tail, 'match_id') })
                : null,
        };
    }
    async claimRewardOutbox(workerId, limit, now, leaseMs) {
        const { data, error } = await this.requireClient().rpc('claim_pvp_reward_outbox', {
            p_worker_id: workerId, p_limit: limit, p_now: now, p_lease_ms: leaseMs,
        });
        throwError('claimRewardOutbox', error);
        return (data ?? []).map(mapOutbox);
    }
    async completeRewardOutbox(eventId, workerId, completedAt) {
        const { data, error } = await this.requireClient().rpc('complete_pvp_reward_outbox', {
            p_event_id: eventId, p_worker_id: workerId, p_completed_at: completedAt,
        });
        throwError('completeRewardOutbox', error);
        return data === true;
    }
    async failRewardOutbox(eventId, workerId, errorMessage, retryAt) {
        const { data, error } = await this.requireClient().rpc('fail_pvp_reward_outbox', {
            p_event_id: eventId, p_worker_id: workerId, p_error: errorMessage, p_retry_at: retryAt,
        });
        throwError('failRewardOutbox', error);
        return data === true;
    }
    async createReplayManifest(manifest) {
        const fingerprint = hashJson(manifest);
        const { error } = await this.requireClient().from('pvp_replay_manifests').upsert({
            match_id: manifest.matchId, ruleset_version: manifest.rulesetVersion, catalog_version: manifest.catalogVersion,
            effect_system_version: manifest.effectSystemVersion, map_id: manifest.mapId, map_version: manifest.mapVersion, seed: manifest.seed,
            initial_snapshot_json: manifest.initialSnapshot, initial_snapshot_uri: manifest.initialSnapshotUri,
            action_count: manifest.actionCount, chunk_count: manifest.chunkCount, final_state_hash: manifest.finalStateHash,
            visibility: manifest.visibility, status: manifest.status, manifest_fingerprint: fingerprint,
            created_at: manifest.createdAt, updated_at: manifest.updatedAt,
        }, { onConflict: 'match_id', ignoreDuplicates: true });
        throwError('createReplayManifest', error);
        const { data: stored, error: readError } = await this.requireClient().from('pvp_replay_manifests').select('*').eq('match_id', manifest.matchId).single();
        throwError('createReplayManifest.read', readError);
        if (stored.manifest_fingerprint !== fingerprint)
            throw new pvp_store_1.PvpStoreError('REPLAY_CONFLICT', 'manifest already exists with different content');
        return mapManifest(stored);
    }
    async appendReplayChunk(chunk) {
        const { error } = await this.requireClient().rpc('append_pvp_replay_chunk', { p_chunk: chunk });
        if (error) {
            if (/CONFLICT|ORDER/.test(error.message))
                throw new pvp_store_1.PvpStoreError('REPLAY_CONFLICT', error.message);
            if (/NOT_FOUND/.test(error.message))
                throw new pvp_store_1.PvpStoreError('REPLAY_NOT_FOUND', error.message);
            throwError('appendReplayChunk', error);
        }
        return structuredClone(chunk);
    }
    async finalizeReplay(matchId, chunkCount, actionCount, finalStateHash, updatedAt) {
        const { data, error } = await this.requireClient().rpc('finalize_pvp_replay', {
            p_match_id: matchId, p_chunk_count: chunkCount, p_action_count: actionCount, p_final_hash: finalStateHash, p_updated_at: updatedAt,
        });
        throwError('finalizeReplay', error);
        if (data !== true)
            throw new pvp_store_1.PvpStoreError('REPLAY_CONFLICT', 'replay totals do not match persisted chunks');
        const replay = await this.getReplay(matchId);
        if (!replay)
            throw new pvp_store_1.PvpStoreError('REPLAY_NOT_FOUND', `manifest ${matchId} does not exist`);
        return replay.manifest;
    }
    async getReplay(matchId) {
        const client = this.requireClient();
        const [manifestResult, chunksResult] = await Promise.all([
            client.from('pvp_replay_manifests').select('*').eq('match_id', matchId).maybeSingle(),
            client.from('pvp_replay_chunks').select('*').eq('match_id', matchId).order('chunk_index'),
        ]);
        throwError('getReplay.manifest', manifestResult.error);
        throwError('getReplay.chunks', chunksResult.error);
        if (!manifestResult.data)
            return null;
        return {
            manifest: mapManifest(manifestResult.data),
            chunks: (chunksResult.data ?? []).map(row => mapChunk(row)),
        };
    }
    requireClient() {
        if (!this.client)
            throw new Error('Supabase PVP store is disabled');
        return this.client;
    }
}
exports.SupabasePvpStore = SupabasePvpStore;
