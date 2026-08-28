"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryPvpStore = void 0;
const pvp_store_1 = require("./pvp-store");
const policy_1 = require("../rank-v1/policy");
function clone(value) {
    return structuredClone(value);
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
function compareRatings(left, right) {
    return right.leaguePoints - left.leaguePoints
        || right.rating - left.rating
        || right.wins - left.wins
        || left.tierReachedAt.localeCompare(right.tierReachedAt)
        || left.playerId.localeCompare(right.playerId);
}
function isAfterLeaderboardCursor(rating, cursor) {
    const synthetic = {
        ...rating,
        playerId: cursor.playerId,
        leaguePoints: cursor.leaguePoints,
        rating: cursor.rating,
        wins: cursor.wins,
        tierReachedAt: cursor.tierReachedAt,
    };
    return compareRatings(rating, synthetic) > 0;
}
class MemoryPvpStore {
    modes = new Map();
    maps = new Map();
    tickets = new Map();
    seasons = new Map();
    ratings = new Map();
    matches = new Map();
    ledger = new Map();
    outbox = new Map();
    replayManifests = new Map();
    replayChunks = new Map();
    playerNames = new Map();
    settlementRequests = new Map();
    activeLeases = new Map();
    activeCheckpoints = new Map();
    isEnabled() {
        return true;
    }
    async upsertMode(mode) {
        if (!mode.modeId || !mode.version || !Number.isInteger(mode.teamSize) || mode.teamSize < 1
            || !Number.isInteger(mode.rewardScaleBps) || mode.rewardScaleBps < 0 || mode.rewardScaleBps > 10000) {
            throw new pvp_store_1.PvpStoreError('CATALOG_CONFLICT', 'invalid PVP mode definition');
        }
        this.modes.set(`${mode.modeId}\u0000${mode.version}`, clone(mode));
        return clone(mode);
    }
    async getMode(modeId, version) {
        const mode = this.modes.get(`${modeId}\u0000${version}`);
        return mode ? clone(mode) : null;
    }
    async listModes(enabledOnly = false) {
        return [...this.modes.values()].filter(mode => !enabledOnly || mode.enabled)
            .sort((left, right) => left.modeId.localeCompare(right.modeId) || right.version.localeCompare(left.version)).map(clone);
    }
    async upsertMap(map) {
        if (!map.mapId || !map.version || !map.checksum)
            throw new pvp_store_1.PvpStoreError('CATALOG_CONFLICT', 'invalid PVP map definition');
        this.maps.set(`${map.mapId}\u0000${map.version}`, clone(map));
        return clone(map);
    }
    async getMap(mapId, version) {
        const map = this.maps.get(`${mapId}\u0000${version}`);
        return map ? clone(map) : null;
    }
    async listMaps(status) {
        return [...this.maps.values()].filter(map => !status || map.status === status)
            .sort((left, right) => left.mapId.localeCompare(right.mapId) || right.version.localeCompare(left.version)).map(clone);
    }
    async createMatchmakingTicket(ticket) {
        const existing = this.tickets.get(ticket.ticketId);
        if (existing) {
            if (JSON.stringify(existing) !== JSON.stringify(ticket))
                throw new pvp_store_1.PvpStoreError('MATCHMAKING_CONFLICT', 'ticketId conflict');
            return clone(existing);
        }
        const active = [...this.tickets.values()].find(candidate => candidate.playerId === ticket.playerId
            && candidate.modeId === ticket.modeId && (candidate.state === 'searching' || candidate.state === 'match_found' || candidate.state === 'accepted'));
        if (active)
            throw new pvp_store_1.PvpStoreError('MATCHMAKING_CONFLICT', `player already owns active ticket ${active.ticketId}`);
        this.tickets.set(ticket.ticketId, clone(ticket));
        return clone(ticket);
    }
    async getMatchmakingTicket(ticketId) {
        const ticket = this.tickets.get(ticketId);
        return ticket ? clone(ticket) : null;
    }
    async transitionMatchmakingTicket(input) {
        const ticket = this.tickets.get(input.ticketId);
        if (!ticket || ticket.state !== input.expectedState)
            return null;
        ticket.state = input.nextState;
        ticket.matchedMatchId = input.matchedMatchId ?? ticket.matchedMatchId;
        ticket.updatedAt = input.updatedAt;
        return clone(ticket);
    }
    async upsertSeason(season) {
        this.validateSeason(season);
        if (!this.modes.has(`${season.modeId}\u0000${season.modeVersion}`)) {
            throw new pvp_store_1.PvpStoreError('SEASON_CONFLICT', 'season references an unknown mode version');
        }
        if (season.status === 'active') {
            const conflict = [...this.seasons.values()].find(candidate => (candidate.seasonId !== season.seasonId
                && candidate.modeId === season.modeId
                && candidate.region === season.region
                && candidate.status === 'active'));
            if (conflict)
                throw new pvp_store_1.PvpStoreError('SEASON_CONFLICT', `active season ${conflict.seasonId} already exists`);
        }
        const current = this.seasons.get(season.seasonId);
        if (current && (current.modeId !== season.modeId || current.modeVersion !== season.modeVersion || current.region !== season.region)) {
            throw new pvp_store_1.PvpStoreError('SEASON_CONFLICT', 'season mode and region are immutable');
        }
        this.seasons.set(season.seasonId, clone(season));
        return clone(season);
    }
    async getSeason(seasonId) {
        const season = this.seasons.get(seasonId);
        return season ? clone(season) : null;
    }
    async listSeasons(modeId) {
        return [...this.seasons.values()]
            .filter(season => !modeId || season.modeId === modeId)
            .sort((left, right) => right.startsAt.localeCompare(left.startsAt) || left.seasonId.localeCompare(right.seasonId))
            .map(clone);
    }
    async getRating(seasonId, modeId, playerId) {
        const rating = this.ratings.get(this.ratingKey(seasonId, modeId, playerId));
        return rating ? clone(rating) : null;
    }
    async getLeaderboard(query) {
        const limit = Math.max(1, Math.min(100, Math.trunc(query.limit)));
        const cursor = decodeCursor(query.cursor);
        const ordered = [...this.ratings.values()]
            .filter(rating => rating.seasonId === query.seasonId && rating.modeId === query.modeId && rating.tier !== 'unranked')
            .sort(compareRatings);
        const filtered = cursor ? ordered.filter(rating => isAfterLeaderboardCursor(rating, cursor)) : ordered;
        const page = filtered.slice(0, limit);
        const rankByPlayer = new Map(ordered.map((rating, index) => [rating.playerId, index + 1]));
        const entries = page.map(rating => ({
            ...clone(rating),
            rank: rankByPlayer.get(rating.playerId) ?? 0,
            playerName: this.playerNames.get(rating.playerId) ?? rating.playerId,
            ...(0, policy_1.projectLeaderboardRank)(rating, rankByPlayer.get(rating.playerId) ?? 0),
        }));
        const tail = page[page.length - 1];
        return {
            seasonId: query.seasonId,
            modeId: query.modeId,
            entries,
            nextCursor: filtered.length > limit && tail ? encodeCursor({
                leaguePoints: tail.leaguePoints,
                rating: tail.rating,
                wins: tail.wins,
                tierReachedAt: tail.tierReachedAt,
                playerId: tail.playerId,
            }) : null,
        };
    }
    async listRatingLedger(playerId, seasonId, modeId, limit) {
        return [...this.ledger.values()]
            .filter(entry => entry.playerId === playerId && entry.seasonId === seasonId && entry.modeId === modeId)
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.ledgerId.localeCompare(left.ledgerId))
            .slice(0, Math.max(1, Math.min(100, Math.trunc(limit))))
            .map(clone);
    }
    async commitMatchSettlement(command) {
        const requestReceipt = this.settlementRequests.get(command.match.settlementRequestId);
        if (requestReceipt && (requestReceipt.matchId !== command.match.matchId || requestReceipt.fingerprint !== command.match.settlementFingerprint)) {
            throw new pvp_store_1.PvpStoreError('SETTLEMENT_CONFLICT', 'settlement requestId was reused with a different match payload');
        }
        const existing = this.matches.get(command.match.matchId);
        if (existing) {
            if (existing.match.settlementFingerprint !== command.match.settlementFingerprint) {
                throw new pvp_store_1.PvpStoreError('SETTLEMENT_CONFLICT', 'match is already settled with a different payload');
            }
            return { status: 'duplicate', detail: clone(existing) };
        }
        for (const player of command.players) {
            const key = this.ratingKey(command.match.seasonId, command.match.modeId, player.participant.playerId);
            const current = this.ratings.get(key);
            const currentVersion = current?.version ?? 0;
            if (currentVersion !== player.expectedRatingVersion)
                return { status: 'rating_conflict' };
            if (player.ledger && player.nextRating.version !== currentVersion + 1) {
                throw new pvp_store_1.PvpStoreError('SETTLEMENT_CONFLICT', 'rated settlement must advance rating version exactly once');
            }
            if (!player.ledger && player.nextRating.version !== currentVersion) {
                throw new pvp_store_1.PvpStoreError('SETTLEMENT_CONFLICT', 'no_contest must not advance rating version');
            }
        }
        const playerIds = command.players.map(player => player.participant.playerId);
        if (new Set(playerIds).size !== 2)
            throw new pvp_store_1.PvpStoreError('SETTLEMENT_CONFLICT', 'settlement requires two distinct players');
        const detail = {
            match: clone(command.match),
            participants: command.players.map(player => clone(player.participant)),
            settlements: command.players.map(player => clone(player.settlement)),
        };
        this.matches.set(command.match.matchId, detail);
        this.settlementRequests.set(command.match.settlementRequestId, {
            matchId: command.match.matchId,
            fingerprint: command.match.settlementFingerprint,
        });
        for (const player of command.players) {
            this.playerNames.set(player.participant.playerId, player.participant.playerName);
            if (player.ledger) {
                this.ratings.set(this.ratingKey(command.match.seasonId, command.match.modeId, player.participant.playerId), clone(player.nextRating));
                this.ledger.set(player.ledger.ledgerId, clone(player.ledger));
            }
            if (player.outbox)
                this.outbox.set(player.outbox.eventId, clone(player.outbox));
        }
        return { status: 'committed', detail: clone(detail) };
    }
    async getMatchDetail(matchId) {
        const detail = this.matches.get(matchId);
        return detail ? clone(detail) : null;
    }
    async listMatchHistory(query) {
        const limit = Math.max(1, Math.min(100, Math.trunc(query.limit)));
        const cursor = decodeCursor(query.cursor);
        const entries = [...this.matches.values()]
            .filter(detail => detail.participants.some(participant => participant.playerId === query.playerId))
            .filter(detail => !query.seasonId || detail.match.seasonId === query.seasonId)
            .filter(detail => !query.modeId || detail.match.modeId === query.modeId)
            .sort((left, right) => right.match.endedAt.localeCompare(left.match.endedAt) || right.match.matchId.localeCompare(left.match.matchId))
            .filter(detail => !cursor
            || detail.match.endedAt < cursor.endedAt
            || (detail.match.endedAt === cursor.endedAt && detail.match.matchId < cursor.matchId));
        const page = entries.slice(0, limit);
        const mapped = page.map((detail) => ({
            match: clone(detail.match),
            self: clone(detail.participants.find(participant => participant.playerId === query.playerId)),
            opponents: detail.participants.filter(participant => participant.playerId !== query.playerId).map(clone),
        }));
        const tail = page[page.length - 1];
        return {
            entries: mapped,
            nextCursor: entries.length > limit && tail
                ? encodeCursor({ endedAt: tail.match.endedAt, matchId: tail.match.matchId })
                : null,
        };
    }
    async claimRewardOutbox(workerId, limit, now, leaseMs) {
        const nowMs = Date.parse(now);
        const claimed = [...this.outbox.values()]
            .filter(event => ((event.status === 'pending' && Date.parse(event.availableAt) <= nowMs)
            || (event.status === 'processing' && event.leaseExpiresAt !== null && Date.parse(event.leaseExpiresAt) <= nowMs)))
            .sort((left, right) => left.availableAt.localeCompare(right.availableAt) || left.eventId.localeCompare(right.eventId))
            .slice(0, Math.max(1, Math.min(100, Math.trunc(limit))));
        for (const event of claimed) {
            event.status = 'processing';
            event.attempts += 1;
            event.leaseOwner = workerId;
            event.leaseExpiresAt = new Date(nowMs + Math.max(1000, leaseMs)).toISOString();
            event.updatedAt = now;
            this.updateSettlementRewardStatus(event.matchId, event.playerId, 'processing');
        }
        return claimed.map(clone);
    }
    async completeRewardOutbox(eventId, workerId, completedAt) {
        const event = this.outbox.get(eventId);
        if (!event || event.status !== 'processing' || event.leaseOwner !== workerId)
            return false;
        event.status = 'committed';
        event.leaseOwner = null;
        event.leaseExpiresAt = null;
        event.lastError = null;
        event.updatedAt = completedAt;
        this.updateSettlementRewardStatus(event.matchId, event.playerId, 'committed');
        this.updateMatchRewardStatus(event.matchId, completedAt);
        return true;
    }
    async failRewardOutbox(eventId, workerId, error, retryAt) {
        const event = this.outbox.get(eventId);
        if (!event || event.status !== 'processing' || event.leaseOwner !== workerId)
            return false;
        event.status = 'pending';
        event.availableAt = retryAt;
        event.leaseOwner = null;
        event.leaseExpiresAt = null;
        event.lastError = error.slice(0, 1000);
        event.updatedAt = retryAt;
        this.updateSettlementRewardStatus(event.matchId, event.playerId, 'pending');
        return true;
    }
    async claimActiveMatchLease(input) {
        if (!input.matchId || !input.holderId || !Number.isFinite(input.ttlMs) || input.ttlMs < 5_000) {
            throw new pvp_store_1.PvpStoreError('LEASE_FENCED', 'invalid PVP active-match lease');
        }
        const previous = this.activeLeases.get(input.matchId);
        const now = Date.now();
        const previousExpires = previous ? Date.parse(previous.leaseExpiresAt) : 0;
        const sameOwner = previous?.holderId === input.holderId;
        if (previous && previousExpires > now && !sameOwner)
            throw new pvp_store_1.PvpStoreError('LEASE_FENCED', 'PVP active match lease is held');
        const lease = {
            matchId: input.matchId,
            holderId: input.holderId,
            generation: previous ? (sameOwner && previousExpires > now ? previous.generation : previous.generation + 1) : 1,
            leaseExpiresAt: new Date(now + Math.trunc(input.ttlMs)).toISOString(),
        };
        this.activeLeases.set(input.matchId, clone(lease));
        return clone(lease);
    }
    async renewActiveMatchLease(lease, ttlMs) {
        this.assertActiveLease(lease);
        const renewed = { ...lease, leaseExpiresAt: new Date(Date.now() + Math.trunc(ttlMs)).toISOString() };
        this.activeLeases.set(lease.matchId, clone(renewed));
        return clone(renewed);
    }
    async loadActiveMatchCheckpoint(matchId) {
        const checkpoint = this.activeCheckpoints.get(matchId);
        return checkpoint ? clone(checkpoint) : null;
    }
    async listActiveMatchCheckpoints(limit = 1000) {
        return [...this.activeCheckpoints.values()]
            .sort((left, right) => right.checkpointTick - left.checkpointTick || right.createdAt.localeCompare(left.createdAt))
            .slice(0, Math.max(1, Math.min(1000, Math.trunc(limit))))
            .map(clone);
    }
    async saveActiveMatchCheckpoint(lease, checkpoint) {
        this.assertActiveLease(lease);
        if (checkpoint.matchId !== lease.matchId || checkpoint.runtime.options.matchId !== lease.matchId) {
            throw new pvp_store_1.PvpStoreError('CHECKPOINT_CONFLICT', 'PVP checkpoint identity does not match lease');
        }
        const previous = this.activeCheckpoints.get(checkpoint.matchId);
        if (previous && previous.generation === lease.generation && previous.checkpointTick > checkpoint.checkpointTick) {
            throw new pvp_store_1.PvpStoreError('CHECKPOINT_CONFLICT', 'PVP checkpoint moved backwards');
        }
        const stored = { ...clone(checkpoint), generation: lease.generation };
        this.activeCheckpoints.set(checkpoint.matchId, stored);
        return clone(stored);
    }
    async deleteActiveMatchCheckpoint(lease) {
        // Terminal GC may run after the lease naturally expires.  Generation and
        // holder fencing still prevent an older process from deleting a newer
        // checkpoint, so expiry itself must not strand the retained blob.
        this.assertActiveLease(lease, true);
        this.activeCheckpoints.delete(lease.matchId);
        return true;
    }
    assertActiveLease(candidate, allowExpired = false) {
        const current = this.activeLeases.get(candidate.matchId);
        if (!current || current.holderId !== candidate.holderId || current.generation !== candidate.generation
            || (!allowExpired && Date.parse(current.leaseExpiresAt) <= Date.now())) {
            throw new pvp_store_1.PvpStoreError('LEASE_FENCED', 'PVP active match lease fenced');
        }
    }
    async createReplayManifest(manifest) {
        const existing = this.replayManifests.get(manifest.matchId);
        if (existing) {
            if (JSON.stringify(existing) !== JSON.stringify(manifest)) {
                throw new pvp_store_1.PvpStoreError('REPLAY_CONFLICT', 'replay manifest already exists with different content');
            }
            return clone(existing);
        }
        if ((manifest.initialSnapshot === null) === (manifest.initialSnapshotUri === null)) {
            throw new pvp_store_1.PvpStoreError('REPLAY_CONFLICT', 'manifest requires exactly one initial snapshot source');
        }
        if (manifest.status !== 'recording' || manifest.chunkCount !== 0 || manifest.actionCount !== 0) {
            throw new pvp_store_1.PvpStoreError('REPLAY_CONFLICT', 'new replay manifest must start empty and recording');
        }
        this.replayManifests.set(manifest.matchId, clone(manifest));
        this.replayChunks.set(manifest.matchId, new Map());
        return clone(manifest);
    }
    async appendReplayChunk(chunk) {
        const manifest = this.replayManifests.get(chunk.matchId);
        if (!manifest)
            throw new pvp_store_1.PvpStoreError('REPLAY_NOT_FOUND', `manifest ${chunk.matchId} does not exist`);
        const chunks = this.replayChunks.get(chunk.matchId);
        const existing = chunks.get(chunk.chunkIndex);
        if (existing) {
            if (existing.sha256 !== chunk.sha256 || JSON.stringify(existing) !== JSON.stringify(chunk)) {
                throw new pvp_store_1.PvpStoreError('REPLAY_CONFLICT', 'replay chunk index already contains different content');
            }
            return clone(existing);
        }
        if (manifest.status !== 'recording')
            throw new pvp_store_1.PvpStoreError('REPLAY_CONFLICT', 'completed replay is immutable');
        if (chunk.chunkIndex !== manifest.chunkCount || chunk.firstTick > chunk.lastTick) {
            throw new pvp_store_1.PvpStoreError('INVALID_REPLAY_CHUNK', 'chunks must be contiguous and ticks must be ordered');
        }
        if ((chunk.payload === null) === (chunk.objectUri === null)) {
            throw new pvp_store_1.PvpStoreError('INVALID_REPLAY_CHUNK', 'chunk requires exactly one payload source');
        }
        chunks.set(chunk.chunkIndex, clone(chunk));
        manifest.chunkCount += 1;
        manifest.updatedAt = chunk.createdAt;
        return clone(chunk);
    }
    async finalizeReplay(matchId, chunkCount, actionCount, finalStateHash, updatedAt) {
        const manifest = this.replayManifests.get(matchId);
        if (!manifest)
            throw new pvp_store_1.PvpStoreError('REPLAY_NOT_FOUND', `manifest ${matchId} does not exist`);
        if (manifest.status === 'complete') {
            if (manifest.chunkCount === chunkCount && manifest.actionCount === actionCount && manifest.finalStateHash === finalStateHash)
                return clone(manifest);
            throw new pvp_store_1.PvpStoreError('REPLAY_CONFLICT', 'replay is already finalized with different totals');
        }
        if (manifest.chunkCount !== chunkCount || this.replayChunks.get(matchId)?.size !== chunkCount || !finalStateHash) {
            throw new pvp_store_1.PvpStoreError('REPLAY_CONFLICT', 'replay totals do not match persisted chunks');
        }
        manifest.actionCount = actionCount;
        manifest.finalStateHash = finalStateHash;
        manifest.status = 'complete';
        manifest.updatedAt = updatedAt;
        return clone(manifest);
    }
    async getReplay(matchId) {
        const manifest = this.replayManifests.get(matchId);
        if (!manifest)
            return null;
        const chunks = [...(this.replayChunks.get(matchId)?.values() ?? [])]
            .sort((left, right) => left.chunkIndex - right.chunkIndex)
            .map(clone);
        return { manifest: clone(manifest), chunks };
    }
    ratingKey(seasonId, modeId, playerId) {
        return `${seasonId}\u0000${modeId}\u0000${playerId}`;
    }
    validateSeason(season) {
        const startsAt = Date.parse(season.startsAt);
        const locksAt = Date.parse(season.locksAt);
        const endsAt = Date.parse(season.endsAt);
        if (!season.seasonId || !season.modeId || !season.region || !Number.isFinite(startsAt) || !(startsAt < locksAt && locksAt <= endsAt)) {
            throw new pvp_store_1.PvpStoreError('SEASON_CONFLICT', 'season requires valid identity and startsAt < locksAt <= endsAt');
        }
    }
    updateSettlementRewardStatus(matchId, playerId, status) {
        const detail = this.matches.get(matchId);
        const settlement = detail?.settlements.find(candidate => candidate.playerId === playerId);
        if (settlement)
            settlement.rewardStatus = status;
    }
    updateMatchRewardStatus(matchId, updatedAt) {
        const detail = this.matches.get(matchId);
        if (!detail)
            return;
        if (detail.settlements.every(settlement => settlement.rewardStatus === 'committed' || settlement.rewardStatus === 'not_applicable')) {
            detail.match.settlementStatus = 'committed';
            detail.match.updatedAt = updatedAt;
        }
    }
}
exports.MemoryPvpStore = MemoryPvpStore;
