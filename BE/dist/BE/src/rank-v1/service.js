"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PvpRankService = exports.PvpRankError = void 0;
const crypto_1 = require("crypto");
const policy_1 = require("./policy");
const MAX_SETTLEMENT_RETRIES = 5;
function stableValue(value) {
    if (Array.isArray(value))
        return value.map(stableValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, child]) => [key, stableValue(child)]));
    }
    return value;
}
function fingerprint(value) {
    return (0, crypto_1.createHash)('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}
function assertIso(value, field) {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp))
        throw new PvpRankError('INVALID_MATCH_RESULT', `${field} must be an ISO timestamp`);
    return timestamp;
}
function isNoContestReason(reason) {
    return reason === 'server_void'
        || reason === 'ruleset_invalid'
        || reason === 'load_failed'
        || reason === 'load_timeout'
        || reason === 'load_disconnect';
}
class PvpRankError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'PvpRankError';
    }
}
exports.PvpRankError = PvpRankError;
class PvpRankService {
    store;
    constructor(store) {
        this.store = store;
    }
    async settleMatch(input) {
        this.validateMatchInput(input);
        const season = await this.store.getSeason(input.seasonId);
        if (!season)
            throw new PvpRankError('SEASON_NOT_FOUND', `season ${input.seasonId} does not exist`);
        this.validateSeason(season, input);
        const mode = await this.store.getMode(input.modeId, input.modeVersion);
        if (!mode || !mode.enabled)
            throw new PvpRankError('MODE_NOT_FOUND', `enabled mode ${input.modeId}@${input.modeVersion} does not exist`);
        if (mode.rulesetVersion !== input.rulesetVersion) {
            throw new PvpRankError('INVALID_MATCH_RESULT', 'match ruleset does not match its versioned mode definition');
        }
        const map = await this.store.getMap(input.mapId, input.mapVersion);
        if (!map || map.status !== 'active')
            throw new PvpRankError('MAP_NOT_FOUND', `active map ${input.mapId}@${input.mapVersion} does not exist`);
        const factualFingerprint = fingerprint({
            ...input,
            requestId: undefined,
            participants: input.participants.map(({ reward, ...participant }) => ({ ...participant, reward: reward ?? {} })),
        });
        const noContest = input.integrityStatus !== 'valid' || isNoContestReason(input.endReason);
        const ratedMatch = !noContest && mode.ranked;
        const rewardEligible = !noContest && mode.rewardScaleBps > 0;
        for (let attempt = 0; attempt < MAX_SETTLEMENT_RETRIES; attempt += 1) {
            const ratings = await Promise.all(input.participants.map(async (participant) => (await this.store.getRating(input.seasonId, input.modeId, participant.playerId)
                ?? (0, policy_1.createInitialPvpRating)({
                    seasonId: input.seasonId,
                    modeId: input.modeId,
                    playerId: participant.playerId,
                    at: input.startedAt,
                }))));
            const outcomes = input.participants.map((participant) => {
                if (noContest)
                    return 'no_contest';
                if (input.winnerSide === null)
                    return 'draw';
                return participant.side === input.winnerSide ? 'win' : 'loss';
            });
            const preparedPlayers = input.participants.map((participant, index) => {
                const current = ratings[index];
                const opponent = ratings[index === 0 ? 1 : 0];
                const outcome = outcomes[index];
                const rated = ratedMatch && outcome !== 'no_contest'
                    ? (0, policy_1.applyRatedResult)({ self: current, opponent, outcome, at: input.endedAt })
                    : { next: current, ratingDelta: 0, leaguePointsDelta: 0 };
                const nextRating = rated.next;
                const reward = participant.reward ?? {};
                const outboxReward = { ...structuredClone(reward), rewardScaleBps: mode.rewardScaleBps };
                const settlementId = `pvp:${input.matchId}:${participant.playerId}`;
                const matchParticipant = {
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
                };
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
                    },
                };
            });
            const startedAt = assertIso(input.startedAt, 'startedAt');
            const endedAt = assertIso(input.endedAt, 'endedAt');
            const match = {
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
            };
            const result = await this.store.commitMatchSettlement({ match, players: preparedPlayers });
            if (result.status === 'committed' || result.status === 'duplicate')
                return result.detail;
        }
        throw new PvpRankError('SETTLEMENT_CONFLICT', 'rating rows changed repeatedly while settling match');
    }
    async createReplayManifest(manifest) {
        return this.store.createReplayManifest(manifest);
    }
    async appendReplayChunk(chunk) {
        return this.store.appendReplayChunk(chunk);
    }
    validateMatchInput(input) {
        if (!input.requestId || !input.matchId || !input.seasonId || !input.modeId || !input.modeVersion) {
            throw new PvpRankError('INVALID_MATCH_RESULT', 'requestId, matchId, seasonId, modeId and modeVersion are required');
        }
        const [left, right] = input.participants;
        if (!left.playerId || !right.playerId || left.playerId === right.playerId) {
            throw new PvpRankError('INVALID_MATCH_RESULT', 'a PVP match requires two distinct players');
        }
        if (left.side === right.side || new Set([left.side, right.side]).size !== 2) {
            throw new PvpRankError('INVALID_MATCH_RESULT', 'participants must occupy opposite sides');
        }
        if (!Number.isInteger(left.slot) || !Number.isInteger(right.slot) || left.slot < 0 || right.slot < 0) {
            throw new PvpRankError('INVALID_MATCH_RESULT', 'participant slots must be non-negative integers');
        }
        const startedAt = assertIso(input.startedAt, 'startedAt');
        const endedAt = assertIso(input.endedAt, 'endedAt');
        if (endedAt < startedAt)
            throw new PvpRankError('INVALID_MATCH_RESULT', 'endedAt must not precede startedAt');
        if (input.winnerSide !== null && input.winnerSide !== left.side && input.winnerSide !== right.side) {
            throw new PvpRankError('INVALID_MATCH_RESULT', 'winnerSide must identify a participant side');
        }
    }
    validateSeason(season, input) {
        if (season.modeId !== input.modeId || season.modeVersion !== input.modeVersion || season.region !== input.region) {
            throw new PvpRankError('SEASON_NOT_SETTLEABLE', 'match mode/region does not belong to the season');
        }
        if (season.status !== 'active' && season.status !== 'locked') {
            throw new PvpRankError('SEASON_NOT_SETTLEABLE', `season status ${season.status} cannot accept a result`);
        }
        const startedAt = assertIso(input.startedAt, 'startedAt');
        if (startedAt < assertIso(season.startsAt, 'season.startsAt') || startedAt >= assertIso(season.locksAt, 'season.locksAt')) {
            throw new PvpRankError('SEASON_NOT_SETTLEABLE', 'match did not start inside the season matchmaking window');
        }
        if (season.rankPolicyVersion !== policy_1.PVP_RANK_POLICY_VERSION) {
            throw new PvpRankError('UNSUPPORTED_RANK_POLICY', `unsupported rank policy ${season.rankPolicyVersion}`);
        }
    }
}
exports.PvpRankService = PvpRankService;
