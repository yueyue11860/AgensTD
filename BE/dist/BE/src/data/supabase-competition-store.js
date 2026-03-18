"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupabaseCompetitionStore = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
function summarizeSupabaseErrorText(value) {
    const normalized = value
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return normalized.length > 240
        ? `${normalized.slice(0, 240)}...`
        : normalized;
}
function throwIfSupabaseError(operation, error) {
    if (!error) {
        return;
    }
    const details = [error.message, error.details, error.hint, error.code]
        .filter((value) => Boolean(value))
        .map((value) => summarizeSupabaseErrorText(value))
        .join(' | ');
    throw new Error(`Supabase ${operation} failed: ${details}`);
}
function mapReplaySummary(row) {
    return {
        matchId: row.match_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        latestTick: row.latest_tick,
        frameCount: row.frame_count,
        actionCount: row.action_count,
        playerCount: row.player_count,
        topWave: row.top_wave,
        topScore: row.top_score,
    };
}
function mapLeaderboardEntry(row) {
    return {
        playerId: row.player_id,
        playerName: row.player_name,
        playerKind: row.player_kind,
        bestSurvivedWaves: row.best_survived_waves,
        bestScore: row.best_score,
        lastMatchId: row.last_match_id,
        updatedAt: row.updated_at,
    };
}
function isBetterResult(next, current) {
    if (!current) {
        return true;
    }
    if (next.score !== current.best_score) {
        return next.score > current.best_score;
    }
    return next.survivedWaves > current.best_survived_waves;
}
class SupabaseCompetitionStore {
    client;
    remoteDisabledUntil = 0;
    failureCooldownMs = 60_000;
    requestTimeoutMs = 5_000;
    constructor(config) {
        if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
            this.client = null;
            return;
        }
        this.client = (0, supabase_js_1.createClient)(config.supabaseUrl, config.supabaseServiceRoleKey, {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
            },
        });
    }
    isEnabled() {
        return this.client !== null;
    }
    async upsertReplay(replay, summary) {
        if (!this.client || this.isRemoteTemporarilyDisabled()) {
            return;
        }
        const client = this.client;
        try {
            const { error } = await this.withRequestTimeout(() => client
                .from('match_replays')
                .upsert({
                match_id: summary.matchId,
                created_at: summary.createdAt,
                updated_at: summary.updatedAt,
                latest_tick: summary.latestTick,
                frame_count: summary.frameCount,
                action_count: summary.actionCount,
                player_count: summary.playerCount,
                top_wave: summary.topWave,
                top_score: summary.topScore,
                replay_json: replay,
            }, {
                onConflict: 'match_id',
            }));
            throwIfSupabaseError('upsertReplay', error);
            this.markRemoteSuccess();
        }
        catch (error) {
            this.markRemoteFailure();
            throw error;
        }
    }
    async persistMatchResults(results) {
        if (!this.client || results.length === 0 || this.isRemoteTemporarilyDisabled()) {
            return;
        }
        const client = this.client;
        const resultRows = results.map((result) => ({
            match_id: result.matchId,
            player_id: result.playerId,
            player_name: result.playerName,
            player_kind: result.playerKind,
            survived_waves: result.survivedWaves,
            score: result.score,
            fortress: result.fortress,
            updated_at: result.updatedAt,
        }));
        try {
            const { error: matchResultsError } = await this.withRequestTimeout(() => client
                .from('match_results')
                .upsert(resultRows, {
                onConflict: 'match_id,player_id',
            }));
            throwIfSupabaseError('persistMatchResults.match_results', matchResultsError);
            for (const result of results) {
                const { data: current, error: currentLeaderboardError } = await this.withRequestTimeout(() => client
                    .from('leaderboard_entries')
                    .select('player_id, player_name, player_kind, best_survived_waves, best_score, last_match_id, updated_at')
                    .eq('player_id', result.playerId)
                    .eq('player_kind', result.playerKind)
                    .maybeSingle());
                throwIfSupabaseError('persistMatchResults.selectLeaderboardEntry', currentLeaderboardError);
                if (!isBetterResult(result, current)) {
                    continue;
                }
                const { error: leaderboardUpsertError } = await this.withRequestTimeout(() => client
                    .from('leaderboard_entries')
                    .upsert({
                    player_id: result.playerId,
                    player_name: result.playerName,
                    player_kind: result.playerKind,
                    best_survived_waves: result.survivedWaves,
                    best_score: result.score,
                    last_match_id: result.matchId,
                    updated_at: result.updatedAt,
                }, {
                    onConflict: 'player_id,player_kind',
                }));
                throwIfSupabaseError('persistMatchResults.upsertLeaderboardEntry', leaderboardUpsertError);
            }
            this.markRemoteSuccess();
        }
        catch (error) {
            this.markRemoteFailure();
            throw error;
        }
    }
    async listRecentReplays(limit) {
        if (!this.client || this.isRemoteTemporarilyDisabled()) {
            return [];
        }
        const client = this.client;
        try {
            const { data, error } = await this.withRequestTimeout(() => client
                .from('match_replays')
                .select('match_id, created_at, updated_at, latest_tick, frame_count, action_count, player_count, top_wave, top_score, replay_json')
                .order('updated_at', { ascending: false })
                .limit(limit));
            throwIfSupabaseError('listRecentReplays', error);
            this.markRemoteSuccess();
            return (data ?? []).map((row) => mapReplaySummary(row));
        }
        catch (error) {
            this.markRemoteFailure();
            throw error;
        }
    }
    async getReplay(matchId) {
        if (!this.client || this.isRemoteTemporarilyDisabled()) {
            return null;
        }
        const client = this.client;
        try {
            const { data, error } = await this.withRequestTimeout(() => client
                .from('match_replays')
                .select('replay_json')
                .eq('match_id', matchId)
                .maybeSingle());
            throwIfSupabaseError('getReplay', error);
            this.markRemoteSuccess();
            return data?.replay_json ?? null;
        }
        catch (error) {
            this.markRemoteFailure();
            throw error;
        }
    }
    async getDualLeaderboards(limit) {
        if (!this.client || this.isRemoteTemporarilyDisabled()) {
            return {
                human: [],
                agent: [],
                all: [],
            };
        }
        return {
            human: await this.getLeaderboardByKind('human', limit),
            agent: await this.getLeaderboardByKind('agent', limit),
            all: await this.getLeaderboardByKind('all', limit),
        };
    }
    async getLeaderboardByKind(kind, limit) {
        if (!this.client || this.isRemoteTemporarilyDisabled()) {
            return [];
        }
        let query = this.client
            .from('leaderboard_entries')
            .select('player_id, player_name, player_kind, best_survived_waves, best_score, last_match_id, updated_at')
            .order('best_score', { ascending: false })
            .order('best_survived_waves', { ascending: false })
            .order('updated_at', { ascending: false })
            .limit(limit);
        if (kind !== 'all') {
            query = query.eq('player_kind', kind);
        }
        try {
            const { data, error } = await this.withRequestTimeout(() => query);
            throwIfSupabaseError(`getLeaderboardByKind.${kind}`, error);
            this.markRemoteSuccess();
            return (data ?? []).map((row) => mapLeaderboardEntry(row));
        }
        catch (error) {
            this.markRemoteFailure();
            throw error;
        }
    }
    isRemoteTemporarilyDisabled() {
        return Date.now() < this.remoteDisabledUntil;
    }
    markRemoteFailure() {
        this.remoteDisabledUntil = Date.now() + this.failureCooldownMs;
    }
    markRemoteSuccess() {
        this.remoteDisabledUntil = 0;
    }
    async withRequestTimeout(requestFactory) {
        let timeoutId = null;
        try {
            return await Promise.race([
                Promise.resolve(requestFactory()),
                new Promise((_, reject) => {
                    timeoutId = setTimeout(() => {
                        reject(new Error(`Supabase request timed out after ${this.requestTimeoutMs}ms`));
                    }, this.requestTimeoutMs);
                }),
            ]);
        }
        finally {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        }
    }
}
exports.SupabaseCompetitionStore = SupabaseCompetitionStore;
