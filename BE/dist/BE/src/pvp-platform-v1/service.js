"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PvpPlatformService = void 0;
const node_crypto_1 = require("node:crypto");
const memory_pvp_store_1 = require("../data/memory-pvp-store");
const service_1 = require("../matchmaking-v1/service");
const map_1 = require("../pvp-v1/map");
const runtime_1 = require("../pvp-v1/runtime");
const policy_1 = require("../rank-v1/policy");
const service_2 = require("../rank-v1/service");
const types_1 = require("./types");
const MODE_VERSION = '1';
const RULESET_VERSION = 'pvp_rules_v1';
const MAP_VERSION = '1';
const MAP_NAME = '两界斗法台';
const REGION = 'auto';
const CATALOG_VERSION = 'pvp_catalog_v1';
const EFFECT_SYSTEM_VERSION = 'effect_v1';
const TICK_RATE_MS = 100;
function hashPassword(value) {
    const salt = (0, node_crypto_1.randomBytes)(16);
    const hash = (0, node_crypto_1.scryptSync)(value, salt, 32);
    return `${salt.toString('hex')}:${hash.toString('hex')}`;
}
function passwordMatches(value, encoded) {
    const [saltHex, hashHex, extra] = encoded.split(':');
    if (!saltHex || !hashHex || extra)
        return false;
    try {
        const expected = Buffer.from(hashHex, 'hex');
        const actual = (0, node_crypto_1.scryptSync)(value, Buffer.from(saltHex, 'hex'), expected.length);
        return expected.length > 0 && (0, node_crypto_1.timingSafeEqual)(actual, expected);
    }
    catch {
        return false;
    }
}
function nowIso() {
    return new Date().toISOString();
}
function clampLimit(value, fallback) {
    if (!Number.isFinite(value) || (value ?? 0) <= 0)
        return fallback;
    return Math.max(1, Math.min(100, Math.trunc(value)));
}
/**
 * PVP 竖向装配层。它只编排匹配、权威战斗与竞技持久化，不复制三个子域的规则。
 */
class PvpPlatformService {
    store;
    matchmaking;
    rank;
    ready;
    liveMatches = new Map();
    customRooms = new Map();
    tickTimer;
    constructor(options = {}) {
        this.store = options.store ?? new memory_pvp_store_1.MemoryPvpStore();
        this.matchmaking = new service_1.InMemoryPvpMatchmakingService();
        this.rank = new service_2.PvpRankService(this.store);
        this.ready = this.bootstrapCatalog();
        this.tickTimer = options.autoTick === false ? null : setInterval(() => this.tick(), TICK_RATE_MS);
        this.tickTimer?.unref();
    }
    shutdown() {
        if (this.tickTimer)
            clearInterval(this.tickTimer);
    }
    async currentSeason(mode = 'ranked_1v1') {
        await this.ready;
        const season = (await this.store.listSeasons(mode)).find(candidate => candidate.status === 'active');
        if (!season)
            throw new types_1.PvpPlatformError('PVP_SEASON_NOT_FOUND', '当前没有可用的 PVP 赛季', 404);
        return { ...season, rulesetVersion: RULESET_VERSION, mapIds: [map_1.DUAL_REALM_MAP.mapId] };
    }
    async profile(principal) {
        const season = await this.currentSeason('ranked_1v1');
        const rating = await this.ratingOrInitial(season, principal.playerId);
        const leaderboard = await this.store.getLeaderboard({ seasonId: season.seasonId, modeId: 'ranked_1v1', limit: 100 });
        const rank = leaderboard.entries.find(entry => entry.playerId === principal.playerId)?.rank ?? null;
        const history = await this.store.listMatchHistory({ playerId: principal.playerId, seasonId: season.seasonId, limit: 10 });
        const cooldownUntil = this.matchmaking.getPlayerCooldownUntil(principal.playerId);
        return {
            playerId: principal.playerId,
            playerName: principal.playerName,
            avatarUrl: null,
            tutorialCompleted: true,
            loadoutValid: true,
            queuePenaltyUntil: cooldownUntil > Date.now()
                ? new Date(cooldownUntil).toISOString()
                : null,
            region: REGION,
            rating: { ...rating, visibleLp: rating.leaguePoints, rank, peakLp: rating.leaguePoints },
            recentMatchIds: history.entries.map(entry => entry.match.matchId),
        };
    }
    async leaderboard(principal, limit, cursor) {
        const season = await this.currentSeason('ranked_1v1');
        const page = await this.store.getLeaderboard({ seasonId: season.seasonId, modeId: 'ranked_1v1', limit: clampLimit(limit, 50), cursor });
        let self = page.entries.find(entry => entry.playerId === principal.playerId) ?? null;
        if (!self) {
            const complete = await this.store.getLeaderboard({ seasonId: season.seasonId, modeId: 'ranked_1v1', limit: 100 });
            self = complete.entries.find(entry => entry.playerId === principal.playerId) ?? null;
        }
        return { ...page, scope: 'global', self };
    }
    async history(principal, limit, cursor) {
        await this.ready;
        return this.store.listMatchHistory({ playerId: principal.playerId, limit: clampLimit(limit, 20), cursor });
    }
    async matchDetail(principal, matchId) {
        await this.ready;
        const settled = await this.store.getMatchDetail(matchId);
        if (settled) {
            this.assertParticipant(settled.participants.map(player => player.playerId), principal.playerId);
            return settled;
        }
        const live = this.requireLiveMatchForPlayer(matchId, principal.playerId);
        const state = live.runtime.snapshot();
        return {
            match: {
                matchId,
                seasonId: live.seasonId,
                modeId: live.mode,
                mapId: state.mapId,
                mapVersion: String(state.mapVersion),
                rulesetVersion: state.rulesetVersion,
                status: state.phase,
                startedAt: live.createdAt,
                endedAt: null,
                durationMs: state.tick * state.tickRateMs,
            },
            participants: live.participants.map(participant => ({
                ...participant,
                stats: state.sides[participant.side]?.stats ?? {},
            })),
            settlements: [],
            replayAvailable: false,
            replayStatus: 'processing',
        };
    }
    matchState(principal, matchId) {
        const live = this.requireLiveMatchForPlayer(matchId, principal.playerId);
        return live.runtime.projectForViewer(principal.playerId);
    }
    async joinQueue(principal, request) {
        await this.ready;
        const activeMatch = [...this.liveMatches.values()].find(live => (live.participants.some(participant => participant.playerId === principal.playerId)
            && !['completed', 'voided'].includes(live.runtime.snapshot().phase)));
        if (activeMatch)
            throw new types_1.PvpPlatformError('ALREADY_IN_MATCH', '当前账号已在 PVP 对局中', 409);
        const season = await this.currentSeason(request.mode);
        if (request.rulesetVersion !== RULESET_VERSION && request.rulesetVersion !== 'current') {
            throw new types_1.PvpPlatformError('RULESET_VERSION_MISMATCH', '客户端 PVP 规则版本已过期', 409);
        }
        const rating = await this.ratingOrInitial(season, principal.playerId);
        const recent = await this.store.listMatchHistory({ playerId: principal.playerId, seasonId: season.seasonId, modeId: request.mode, limit: 3 });
        const board = await this.store.getLeaderboard({ seasonId: season.seasonId, modeId: request.mode, limit: 100 });
        const result = this.matchmaking.join({
            principal: { kind: 'human', playerId: principal.playerId, playerName: principal.playerName },
            request: { ...request, region: REGION, rulesetVersion: RULESET_VERSION },
            profile: {
                rating: rating.rating,
                isPlacement: rating.provisionalGames < 5,
                leaderboardRank: board.entries.find(entry => entry.playerId === principal.playerId)?.rank ?? null,
                recentOpponentIds: recent.entries.flatMap(entry => entry.opponents.map(opponent => opponent.playerId)).slice(0, 3),
            },
        });
        if (!result.ok || !result.value)
            throw new types_1.PvpPlatformError(result.code, result.code, result.code === 'ALREADY_QUEUED' ? 409 : 422);
        return this.queueEnvelope(result.value);
    }
    queueStatus(principal, ticketId) {
        this.matchmaking.advance();
        const ticket = this.matchmaking.getTicket(ticketId);
        if (!ticket || ticket.playerId !== principal.playerId)
            throw new types_1.PvpPlatformError('TICKET_NOT_FOUND', '匹配票据不存在', 404);
        return this.queueEnvelope(ticket);
    }
    cancelQueue(principal, ticketId, requestId) {
        const result = this.matchmaking.cancel(principal.playerId, ticketId, requestId);
        if (!result.ok)
            throw new types_1.PvpPlatformError(result.code, result.code, result.code === 'TICKET_NOT_FOUND' ? 404 : 409);
        return { ticket: result.value ?? null };
    }
    async acceptProposal(principal, proposalId, requestId) {
        await this.ready;
        const result = this.matchmaking.accept(principal.playerId, proposalId, requestId);
        if (!result.ok || !result.value)
            throw new types_1.PvpPlatformError(result.code, result.code, result.code === 'PROPOSAL_NOT_FOUND' ? 404 : 409);
        if ('matchId' in result.value)
            this.activateAcceptedMatch(result.value);
        const ticket = this.findPlayerTicket(principal.playerId, proposalId);
        return {
            ticket,
            proposal: 'confirmDeadlineAt' in result.value ? result.value : this.matchmaking.getProposal(proposalId),
            match: 'matchId' in result.value ? result.value : null,
            acceptedMatch: 'matchId' in result.value ? result.value : null,
        };
    }
    sendPressure(principal, matchId, requestId) {
        const live = this.requireLiveMatchForPlayer(matchId, principal.playerId);
        return live.runtime.sendPressure(principal.playerId, requestId);
    }
    /** 仅供服务端战斗解析器调用；REST/Socket 绝不得接收客户端伤害数值后转发。 */
    applyAuthoritativeDamage(matchId, input) {
        const live = this.liveMatches.get(matchId);
        if (!live)
            throw new types_1.PvpPlatformError('MATCH_NOT_FOUND', 'PVP 对局不存在', 404);
        return live.runtime.applyAuthoritativeDamage(input);
    }
    async surrender(principal, matchId, requestId) {
        const live = this.requireLiveMatchForPlayer(matchId, principal.playerId);
        const result = live.runtime.surrender(principal.playerId, requestId);
        if (result.ok)
            await this.settleIfNeeded(live);
        return result;
    }
    async listRooms() {
        await this.ready;
        return [...this.customRooms.values()].map(room => this.projectRoom(room));
    }
    createRoom(principal, input) {
        const roomName = input.roomName?.trim();
        if (!roomName || roomName.length > 40)
            throw new types_1.PvpPlatformError('INVALID_ROOM_NAME', '房间名称长度必须为 1–40', 422);
        const roomId = `PVP-${(0, node_crypto_1.randomUUID)().slice(0, 8).toUpperCase()}`;
        const room = {
            roomId,
            roomName,
            passwordHash: input.password ? hashPassword(input.password) : null,
            spectatorsAllowed: input.spectatorsAllowed === true,
            createdAt: nowIso(),
            hostPlayerId: principal.playerId,
            players: [this.customRoomPlayer(principal, 'A', true)],
            matchId: null,
        };
        this.customRooms.set(roomId, room);
        return this.projectRoom(room);
    }
    getRoom(roomId) {
        return this.projectRoom(this.requireRoom(roomId));
    }
    async joinRoom(principal, roomId, password = '') {
        const room = this.requireRoom(roomId);
        if (room.matchId)
            throw new types_1.PvpPlatformError('ROOM_ALREADY_STARTED', '房间已经开始', 409);
        if (room.players.some(player => player.playerId === principal.playerId))
            return this.projectRoom(room);
        if (room.players.length >= 2)
            throw new types_1.PvpPlatformError('ROOM_FULL', '房间已满', 409);
        if (room.passwordHash && !passwordMatches(password, room.passwordHash))
            throw new types_1.PvpPlatformError('WRONG_PASSWORD', '房间密码错误', 403);
        room.players.push(this.customRoomPlayer(principal, 'B', false));
        return this.projectRoom(room);
    }
    async setRoomReady(principal, roomId, ready) {
        const room = this.requireRoom(roomId);
        const player = room.players.find(candidate => candidate.playerId === principal.playerId);
        if (!player)
            throw new types_1.PvpPlatformError('NOT_IN_ROOM', '你不在该自定义房中', 403);
        if (room.matchId)
            return this.projectRoom(room);
        player.ready = ready;
        if (room.players.length === 2 && room.players.every(candidate => candidate.ready)) {
            const matchId = `pvp-custom-${Date.now()}-${(0, node_crypto_1.randomUUID)().slice(0, 6)}`;
            room.matchId = matchId;
            const acceptedAt = Date.now();
            this.activateMatch({
                matchId,
                mode: 'custom_1v1',
                region: REGION,
                rulesetVersion: RULESET_VERSION,
                acceptedAt,
                players: room.players.map(playerEntry => ({
                    playerId: playerEntry.playerId,
                    playerName: playerEntry.playerName,
                    side: playerEntry.side,
                    loadoutVersion: 0,
                })),
            });
        }
        return this.projectRoom(room);
    }
    /** 供 smoke 与可控时钟宿主主动推进；生产默认由 100ms 定时器调用。 */
    tick() {
        this.matchmaking.advance();
        for (const live of this.liveMatches.values()) {
            const state = live.runtime.tick();
            if (state.phase === 'settling' || state.phase === 'voided')
                void this.settleIfNeeded(live);
        }
    }
    async bootstrapCatalog() {
        const now = Date.now();
        const createdAt = new Date(now).toISOString();
        const modeDefinitions = [
            { modeId: 'ranked_1v1', version: MODE_VERSION, name: '排位斗法', teamSize: 1, ranked: true, rewardScaleBps: 10_000, rulesetVersion: RULESET_VERSION, mapPoolVersion: 'pvp_maps_v1', enabled: true, createdAt, updatedAt: createdAt },
            { modeId: 'casual_1v1', version: MODE_VERSION, name: '休闲斗法', teamSize: 1, ranked: false, rewardScaleBps: 5_000, rulesetVersion: RULESET_VERSION, mapPoolVersion: 'pvp_maps_v1', enabled: true, createdAt, updatedAt: createdAt },
            { modeId: 'custom_1v1', version: MODE_VERSION, name: '自定义斗法', teamSize: 1, ranked: false, rewardScaleBps: 0, rulesetVersion: RULESET_VERSION, mapPoolVersion: 'pvp_maps_v1', enabled: true, createdAt, updatedAt: createdAt },
        ];
        for (const definition of modeDefinitions)
            await this.store.upsertMode(definition);
        const map = {
            mapId: map_1.DUAL_REALM_MAP.mapId,
            version: MAP_VERSION,
            name: MAP_NAME,
            config: { width: map_1.DUAL_REALM_MAP.width, height: map_1.DUAL_REALM_MAP.height, routeHash: map_1.DUAL_REALM_MAP.routeHash },
            checksum: map_1.DUAL_REALM_MAP.routeHash,
            status: 'active',
            createdAt,
            updatedAt: createdAt,
        };
        await this.store.upsertMap(map);
        for (const definition of modeDefinitions) {
            const seasonId = `season-1-${definition.modeId}`;
            await this.store.upsertSeason({
                seasonId,
                modeId: definition.modeId,
                modeVersion: MODE_VERSION,
                region: REGION,
                name: definition.modeId === 'ranked_1v1' ? '齐天之路·S1' : `${definition.name}·S1`,
                status: 'active',
                startsAt: new Date(now - 7 * 86_400_000).toISOString(),
                locksAt: new Date(now + 49 * 86_400_000).toISOString(),
                endsAt: new Date(now + 50 * 86_400_000).toISOString(),
                rankPolicyVersion: policy_1.PVP_RANK_POLICY_VERSION,
                rewardPolicyVersion: 'pvp_reward_v1',
                createdAt,
                updatedAt: createdAt,
            });
        }
    }
    async ratingOrInitial(season, playerId) {
        return await this.store.getRating(season.seasonId, season.modeId, playerId)
            ?? (0, policy_1.createInitialPvpRating)({ seasonId: season.seasonId, modeId: season.modeId, playerId, at: nowIso() });
    }
    queueEnvelope(ticket) {
        const proposal = ticket.proposalId ? this.matchmaking.getProposal(ticket.proposalId) : null;
        const acceptedMatch = this.matchmaking.snapshot().acceptedMatches.find(match => match.players.some(player => player.ticketId === ticket.ticketId)) ?? null;
        const elapsed = Math.max(0, Date.now() - ticket.searchStartedAt);
        return {
            ticket: {
                ...ticket,
                searchRange: Math.min(400, 100 + Math.floor(elapsed / 10_000) * 50),
                estimatedWaitSeconds: 15,
                proposal,
                acceptedMatch,
            },
            proposal,
            match: acceptedMatch,
            acceptedMatch,
        };
    }
    findPlayerTicket(playerId, proposalId) {
        const proposal = this.matchmaking.getProposal(proposalId);
        const ticketId = proposal?.players.find(player => player.playerId === playerId)?.ticketId
            ?? this.matchmaking.snapshot().acceptedMatches
                .find(match => match.proposalId === proposalId)?.players.find(player => player.playerId === playerId)?.ticketId;
        return ticketId ? this.matchmaking.getTicket(ticketId) : null;
    }
    activateAcceptedMatch(match) {
        this.activateMatch(match);
    }
    activateMatch(match) {
        if (this.liveMatches.has(match.matchId))
            return;
        const runtime = new runtime_1.PvpMatchRuntime({
            matchId: match.matchId,
            mode: match.mode,
            seed: `${match.matchId}:${match.acceptedAt}`,
            rulesetVersion: match.rulesetVersion,
            tickRateMs: TICK_RATE_MS,
            countdownMs: 5000,
        });
        for (const player of match.players)
            runtime.registerParticipant(player.side, player);
        for (const player of match.players)
            runtime.setReady(player.playerId, true);
        for (const player of match.players)
            runtime.markLoaded(player.playerId);
        const live = {
            runtime,
            mode: match.mode,
            region: match.region,
            seasonId: `season-1-${match.mode}`,
            createdAt: new Date(match.acceptedAt).toISOString(),
            participants: match.players.map(player => ({ ...player })),
            settling: false,
            settledDetail: null,
        };
        this.liveMatches.set(match.matchId, live);
    }
    async settleIfNeeded(live) {
        const authority = live.runtime.snapshot();
        if (live.settling || live.settledDetail || !authority.result || (authority.phase !== 'settling' && authority.phase !== 'voided'))
            return;
        live.settling = true;
        try {
            const endedAt = nowIso();
            const detail = await this.rank.settleMatch({
                requestId: `settle:${authority.matchId}`,
                matchId: authority.matchId,
                seasonId: live.seasonId,
                modeId: live.mode,
                modeVersion: MODE_VERSION,
                region: live.region,
                mapId: authority.mapId,
                mapVersion: String(authority.mapVersion),
                rulesetVersion: authority.rulesetVersion,
                catalogVersion: CATALOG_VERSION,
                effectSystemVersion: EFFECT_SYSTEM_VERSION,
                seed: authority.seed,
                winnerSide: this.winnerSide(authority),
                endReason: authority.result.reason,
                integrityStatus: authority.phase === 'voided' ? 'invalid' : 'valid',
                startedAt: live.createdAt,
                endedAt,
                participants: live.participants.map((participant, index) => ({
                    playerId: participant.playerId,
                    playerName: participant.playerName,
                    side: participant.side,
                    slot: index,
                    loadoutSnapshotId: `pvp-loadout:${participant.playerId}:${participant.loadoutVersion}`,
                    forfeited: authority.result?.reason === 'surrendered' && authority.result.loserPlayerId === participant.playerId,
                    stats: authority.sides[participant.side]?.stats ?? {},
                    reward: this.rewardFor(authority.result.participants[participant.side], authority.tick * authority.tickRateMs),
                })),
            });
            live.settledDetail = detail;
            if (authority.phase === 'settling')
                live.runtime.completeSettlement();
        }
        catch (error) {
            live.settling = false;
            console.error(`PVP settlement failed for ${authority.matchId}:`, error);
            return;
        }
        live.settling = false;
    }
    rewardFor(result, durationMs) {
        if (result === 'void' || durationMs < 30_000)
            return {};
        if (result === 'win')
            return { honor: 20, gold: 10 };
        if (result === 'draw')
            return { honor: 12, gold: 6 };
        return { honor: 8, gold: 5 };
    }
    winnerSide(authority) {
        const winnerId = authority.result?.winnerPlayerId;
        if (!winnerId)
            return null;
        return authority.sides.A?.playerId === winnerId ? 'A' : authority.sides.B?.playerId === winnerId ? 'B' : null;
    }
    requireLiveMatchForPlayer(matchId, playerId) {
        const live = this.liveMatches.get(matchId);
        if (!live)
            throw new types_1.PvpPlatformError('MATCH_NOT_FOUND', 'PVP 对局不存在', 404);
        this.assertParticipant(live.participants.map(player => player.playerId), playerId);
        return live;
    }
    assertParticipant(playerIds, playerId) {
        if (!playerIds.includes(playerId))
            throw new types_1.PvpPlatformError('MATCH_ACCESS_DENIED', '只有对局参与者可以访问当前状态', 403);
    }
    customRoomPlayer(principal, side, isHost) {
        return {
            playerId: principal.playerId,
            playerName: principal.playerName,
            side,
            ready: false,
            connected: true,
            isHost,
            tier: 'unranked',
            division: null,
        };
    }
    requireRoom(roomId) {
        const room = this.customRooms.get(roomId);
        if (!room)
            throw new types_1.PvpPlatformError('ROOM_NOT_FOUND', 'PVP 房间不存在', 404);
        return room;
    }
    projectRoom(room) {
        const phase = room.matchId ? this.liveMatches.get(room.matchId)?.runtime.snapshot().phase ?? 'loading' : 'waiting_players';
        return {
            roomId: room.roomId,
            roomName: room.roomName,
            mode: 'custom_1v1',
            status: phase,
            mapId: map_1.DUAL_REALM_MAP.mapId,
            mapName: MAP_NAME,
            hasPassword: room.passwordHash !== null,
            spectatorsAllowed: room.spectatorsAllowed,
            playerCount: room.players.length,
            maxPlayers: 2,
            players: structuredClone(room.players),
            createdAt: room.createdAt,
            matchId: room.matchId,
        };
    }
}
exports.PvpPlatformService = PvpPlatformService;
