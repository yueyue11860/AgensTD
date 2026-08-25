"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRestApiRouter = createRestApiRouter;
const express_1 = require("express");
const competition_projection_1 = require("../core/competition-projection");
const state_projection_1 = require("../core/state-projection");
const action_submission_1 = require("./action-submission");
const gateway_auth_1 = require("./gateway-auth");
const unlock_logic_1 = require("../core/unlock-logic");
const types_1 = require("../account-v1/types");
const player_account_adapters_1 = require("../data/player-account-adapters");
const types_2 = require("../item-v1/types");
const account_1 = require("../item-v1/account");
const catalog_1 = require("../weapon-v1/catalog");
const account_2 = require("../weapon-v1/account");
const types_3 = require("../weapon-v1/types");
function resolvePrincipal(request, config) {
    return (0, gateway_auth_1.authenticateGatewayTokenAsync)(config, (0, gateway_auth_1.extractHttpToken)(request));
}
function rejectUnauthorized(response) {
    response.status(401).json({ ok: false, code: 'UNAUTHORIZED', message: 'Missing or invalid gateway token' });
}
function parseLimit(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return Math.floor(parsed);
}
function logCompetitionStoreFailure(operation, error) {
    const details = error instanceof Error ? error.message : String(error);
    console.error(`Competition store ${operation} failed; falling back to memory: ${details}`);
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function publicAccount(account) {
    const { idempotencyByRequestId: _idempotencyByRequestId, buildSnapshotsByMatchId: _buildSnapshotsByMatchId, ...safe } = account;
    return safe;
}
class RequestPayloadError extends Error {
}
function requireString(payload, field) {
    const value = payload[field];
    if (typeof value !== 'string' || value.length === 0)
        throw new RequestPayloadError(`${field} is required`);
    return value;
}
function requireVersion(payload, field) {
    const value = payload[field];
    if (!Number.isSafeInteger(value) || value < 0)
        throw new RequestPayloadError(`${field} must be a non-negative integer`);
    return value;
}
function asNullableStringSlots(value, length, field) {
    if (!Array.isArray(value) || value.length !== length || value.some(slot => slot !== null && typeof slot !== 'string')) {
        throw new RequestPayloadError(`${field} must contain exactly ${length} string-or-null slots`);
    }
    return [...value];
}
function stableStringify(value) {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(stableStringify).join(',')}]`;
    return `{${Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
        .join(',')}}`;
}
function readStoredSubsystemReplay(account, requestId, operation, expectedAccountVersion, context) {
    const stored = account.idempotencyByRequestId[requestId];
    if (!stored)
        return null;
    const result = isRecord(stored.result) ? stored.result : null;
    const storedContext = result && isRecord(result.context) ? result.context : null;
    if (stored.operation !== operation
        || !result
        || result.expectedAccountVersion !== expectedAccountVersion
        || !storedContext
        || stableStringify(storedContext) !== stableStringify(context)) {
        throw new types_1.AccountDomainError('REQUEST_ID_CONFLICT', 'requestId was already used with a different payload');
    }
    return result;
}
function sendAccountError(response, error) {
    if (error instanceof types_1.AccountDomainError) {
        const status = error.code === 'STALE_ACCOUNT_VERSION'
            || error.code === 'REQUEST_ID_CONFLICT'
            || error.code === 'ENTITLEMENT_ALREADY_CONSUMED'
            || error.code === 'SHOP_REWARD_CONFLICT'
            ? 409
            : error.code === 'OFFER_NOT_FOUND' || error.code === 'ACCOUNT_NOT_FOUND'
                ? 404
                : error.code === 'ACCOUNT_WRITE_CONFLICT'
                    ? 503
                    : 422;
        response.status(status).json({ ok: false, code: error.code, message: error.message });
        return;
    }
    if (error instanceof types_3.WeaponDomainError) {
        const status = error.code.startsWith('STALE_') || error.code === 'REQUEST_ID_CONFLICT'
            ? 409
            : error.code === 'WEAPON_NOT_FOUND'
                ? 404
                : 422;
        response.status(status).json({ ok: false, code: error.code, message: error.message });
        return;
    }
    if (error instanceof RequestPayloadError) {
        response.status(400).json({ ok: false, code: 'BAD_PAYLOAD', message: error.message });
        return;
    }
    const details = error instanceof Error ? error.message : String(error);
    console.error(`Account REST operation failed: ${details}`);
    response.status(503).json({ ok: false, code: 'ACCOUNT_SERVICE_UNAVAILABLE', message: 'Account service is temporarily unavailable' });
}
function normalizeRoomStatus(room) {
    if (room.phase === 'playing') {
        return 'IN_MATCH';
    }
    if (room.phase === 'countdown' || room.phase === 'waiting_for_level') {
        return 'DRAFTING';
    }
    return 'OPEN';
}
function serializeRoomSummary(room) {
    return {
        id: room.id,
        name: room.name,
        hasPassword: room.hasPassword,
        players: room.players,
        maxPlayers: room.maxPlayers,
        status: normalizeRoomStatus(room),
        pingMs: null,
        slots: room.slots,
    };
}
function generateRoomId(roomManager) {
    for (let attempt = 0; attempt < 1000; attempt += 1) {
        const roomId = `RM-${Math.floor(1000 + Math.random() * 9000)}`;
        if (!roomManager.getRoom(roomId)) {
            return roomId;
        }
    }
    throw new Error('Failed to allocate room id');
}
function createRestApiRouter(engine, roomManager, config, limiter, replayRecorder, competitionStore, progressStore, accountService, pveRewardStore, checkpointCoordinator) {
    const router = (0, express_1.Router)();
    // ── 局外账户 / 道具 / 武器 ───────────────────────────────────────────
    router.get('/account', async (request, response) => {
        const principal = await resolvePrincipal(request, config);
        if (!principal)
            return rejectUnauthorized(response);
        if (!accountService)
            return response.status(503).json({ ok: false, code: 'ACCOUNT_SERVICE_UNAVAILABLE' });
        try {
            const account = await accountService.getOrCreate(principal.playerId);
            const pveProgression = await accountService.getPveProgression(principal.playerId);
            response.json({ ok: true, account: publicAccount(account), pveProgression, catalogs: player_account_adapters_1.ACCOUNT_CATALOGS });
        }
        catch (error) {
            sendAccountError(response, error);
        }
    });
    router.put('/loadouts/items', async (request, response) => {
        const principal = await resolvePrincipal(request, config);
        if (!principal)
            return rejectUnauthorized(response);
        if (!accountService)
            return response.status(503).json({ ok: false, code: 'ACCOUNT_SERVICE_UNAVAILABLE' });
        try {
            const payload = isRecord(request.body) ? request.body : {};
            const loadout = isRecord(payload.loadout) ? payload.loadout : payload;
            const requestId = requireString(payload, 'requestId');
            const expectedAccountVersion = requireVersion(payload, 'expectedAccountVersion');
            const submittedLoadoutVersion = payload.expectedLoadoutVersion === undefined
                ? null
                : requireVersion(payload, 'expectedLoadoutVersion');
            const expectedCatalogVersion = payload.expectedCatalogVersion === undefined
                ? types_2.ITEM_CATALOG_VERSION
                : requireVersion(payload, 'expectedCatalogVersion');
            if (expectedCatalogVersion !== types_2.ITEM_CATALOG_VERSION) {
                return response.status(409).json({ ok: false, code: 'ITEM_CATALOG_VERSION_MISMATCH' });
            }
            const activeSlots = asNullableStringSlots(loadout.activeSlots, 2, 'activeSlots');
            const passiveSlots = asNullableStringSlots(loadout.passiveSlots, 6, 'passiveSlots');
            const current = await accountService.getOrCreate(principal.playerId);
            const storedReplay = current.idempotencyByRequestId[requestId];
            const storedReplayResult = storedReplay && isRecord(storedReplay.result) ? storedReplay.result : null;
            const storedReplayContext = storedReplayResult && isRecord(storedReplayResult.context) ? storedReplayResult.context : null;
            // V1 前端可省略道具子版本；服务端仍以外层账户 CAS 防止并发覆盖。
            const expectedLoadoutVersion = submittedLoadoutVersion
                ?? (storedReplayContext && typeof storedReplayContext.expectedLoadoutVersion === 'number'
                    ? storedReplayContext.expectedLoadoutVersion
                    : current.item.loadout.version);
            if (current.idempotencyByRequestId[requestId]) {
                readStoredSubsystemReplay(current, requestId, 'save_item_payload', expectedAccountVersion, {
                    kind: 'item_loadout', expectedLoadoutVersion, activeSlots, passiveSlots,
                });
                return response.json({ ok: true, duplicate: true, account: publicAccount(current) });
            }
            if (current.version !== expectedAccountVersion) {
                throw new types_1.AccountDomainError('STALE_ACCOUNT_VERSION', `expected ${expectedAccountVersion}, got ${current.version}`);
            }
            if (current.item.loadout.version !== expectedLoadoutVersion) {
                return response.status(409).json({ ok: false, code: 'ITEM_ACCOUNT_VERSION_MISMATCH', message: 'stale item loadout version' });
            }
            const itemAccount = {
                playerId: principal.playerId,
                version: current.item.version,
                unlockedActiveItemIds: [...current.item.unlockedActiveItemIds],
                unlockedPassiveItemIds: [...current.item.unlockedPassiveItemIds],
                loadout: structuredClone(current.item.loadout),
            };
            const validationError = (0, account_1.validateItemLoadout)(itemAccount, activeSlots, passiveSlots);
            if (validationError)
                return response.status(422).json({ ok: false, code: validationError });
            const now = new Date().toISOString();
            const saved = await accountService.saveItemPayload({
                requestId,
                playerId: principal.playerId,
                expectedAccountVersion,
                idempotencyContext: {
                    kind: 'item_loadout',
                    expectedLoadoutVersion,
                    activeSlots: [...activeSlots],
                    passiveSlots: [...passiveSlots],
                },
                payload: {
                    ...structuredClone(current.item),
                    version: current.item.version + 1,
                    loadout: {
                        activeSlots: [...activeSlots],
                        passiveSlots: [...passiveSlots],
                        version: expectedLoadoutVersion + 1,
                        updatedAt: now,
                    },
                },
            });
            response.json({ ok: true, duplicate: false, account: publicAccount(saved) });
        }
        catch (error) {
            sendAccountError(response, error);
        }
    });
    router.put('/loadouts/weapons/:generalId', async (request, response) => {
        const principal = await resolvePrincipal(request, config);
        if (!principal)
            return rejectUnauthorized(response);
        if (!accountService)
            return response.status(503).json({ ok: false, code: 'ACCOUNT_SERVICE_UNAVAILABLE' });
        try {
            const payload = isRecord(request.body) ? request.body : {};
            const requestId = requireString(payload, 'requestId');
            const expectedAccountVersion = requireVersion(payload, 'expectedAccountVersion');
            const expectedLoadoutVersion = requireVersion(payload, 'expectedLoadoutVersion');
            const slots = asNullableStringSlots(payload.slots, 2, 'slots');
            const generalId = request.params.generalId;
            const current = await accountService.getOrCreate(principal.playerId);
            if (current.idempotencyByRequestId[requestId]) {
                readStoredSubsystemReplay(current, requestId, 'save_weapon_payload', expectedAccountVersion, {
                    kind: 'weapon_loadout', generalId, expectedLoadoutVersion, slots,
                });
                return response.json({ ok: true, duplicate: true, account: publicAccount(current) });
            }
            if (current.version !== expectedAccountVersion) {
                throw new types_1.AccountDomainError('STALE_ACCOUNT_VERSION', `expected ${expectedAccountVersion}, got ${current.version}`);
            }
            const oldLoadout = current.weapon.loadoutsByGeneralId[generalId];
            if ((oldLoadout?.version ?? 0) !== expectedLoadoutVersion) {
                throw new types_3.WeaponDomainError('STALE_WEAPON_LOADOUT_VERSION', 'stale weapon loadout version');
            }
            const weaponAccount = {
                playerId: principal.playerId,
                version: current.weapon.version,
                fragmentBalances: structuredClone(current.weapon.fragmentBalances),
                unlockedWeaponIds: [...current.weapon.unlockedWeaponIds],
                loadoutsByGeneralId: structuredClone(current.weapon.loadoutsByGeneralId),
            };
            (0, account_2.validateWeaponLoadout)(weaponAccount, generalId, slots);
            const nextWeapon = structuredClone(current.weapon);
            nextWeapon.version += 1;
            nextWeapon.loadoutsByGeneralId[generalId] = {
                slots,
                version: expectedLoadoutVersion + 1,
                updatedAt: new Date().toISOString(),
            };
            const saved = await accountService.saveWeaponPayload({
                requestId,
                playerId: principal.playerId,
                expectedAccountVersion,
                payload: nextWeapon,
                idempotencyContext: { kind: 'weapon_loadout', generalId, expectedLoadoutVersion, slots },
            });
            response.json({ ok: true, duplicate: false, account: publicAccount(saved) });
        }
        catch (error) {
            sendAccountError(response, error);
        }
    });
    router.post('/weapons/:weaponId/craft', async (request, response) => {
        const principal = await resolvePrincipal(request, config);
        if (!principal)
            return rejectUnauthorized(response);
        if (!accountService)
            return response.status(503).json({ ok: false, code: 'ACCOUNT_SERVICE_UNAVAILABLE' });
        try {
            const payload = isRecord(request.body) ? request.body : {};
            const requestId = requireString(payload, 'requestId');
            const expectedAccountVersion = requireVersion(payload, 'expectedAccountVersion');
            const weaponId = request.params.weaponId;
            const definition = (0, catalog_1.getWeaponDefinition)(weaponId);
            if (!definition)
                throw new types_3.WeaponDomainError('WEAPON_NOT_FOUND', `Unknown weapon ${weaponId}`);
            const current = await accountService.getOrCreate(principal.playerId);
            if (current.idempotencyByRequestId[requestId]) {
                const replay = readStoredSubsystemReplay(current, requestId, 'save_weapon_payload', expectedAccountVersion, {
                    kind: 'craft_weapon', weaponId,
                });
                const storedWeapon = replay && isRecord(replay.payload) ? replay.payload : null;
                const storedBalances = storedWeapon && isRecord(storedWeapon.fragmentBalances) ? storedWeapon.fragmentBalances : null;
                return response.json({
                    ok: true,
                    duplicate: true,
                    craft: {
                        weaponId,
                        spentFragments: definition.fragmentRequirement,
                        fragmentBalance: storedBalances && typeof storedBalances[weaponId] === 'number'
                            ? storedBalances[weaponId]
                            : current.weapon.fragmentBalances[weaponId] ?? 0,
                    },
                    account: publicAccount(current),
                });
            }
            if (current.version !== expectedAccountVersion) {
                throw new types_1.AccountDomainError('STALE_ACCOUNT_VERSION', `expected ${expectedAccountVersion}, got ${current.version}`);
            }
            if (current.weapon.unlockedWeaponIds.includes(weaponId)) {
                throw new types_3.WeaponDomainError('WEAPON_ALREADY_UNLOCKED', `${weaponId} is already unlocked`);
            }
            const balance = current.weapon.fragmentBalances[weaponId] ?? 0;
            if (balance < definition.fragmentRequirement) {
                throw new types_3.WeaponDomainError('INSUFFICIENT_FRAGMENTS', `${weaponId} requires ${definition.fragmentRequirement} fragments`);
            }
            const nextWeapon = structuredClone(current.weapon);
            nextWeapon.version += 1;
            nextWeapon.fragmentBalances[weaponId] = balance - definition.fragmentRequirement;
            nextWeapon.unlockedWeaponIds = [...nextWeapon.unlockedWeaponIds, weaponId].sort();
            const saved = await accountService.saveWeaponPayload({
                requestId,
                playerId: principal.playerId,
                expectedAccountVersion,
                payload: nextWeapon,
                idempotencyContext: { kind: 'craft_weapon', weaponId },
            });
            response.json({
                ok: true,
                duplicate: false,
                craft: {
                    weaponId,
                    spentFragments: definition.fragmentRequirement,
                    fragmentBalance: nextWeapon.fragmentBalances[weaponId],
                },
                account: publicAccount(saved),
            });
        }
        catch (error) {
            sendAccountError(response, error);
        }
    });
    router.post('/shop/offers', async (request, response) => {
        const principal = await resolvePrincipal(request, config);
        if (!principal)
            return rejectUnauthorized(response);
        if (!accountService)
            return response.status(503).json({ ok: false, code: 'ACCOUNT_SERVICE_UNAVAILABLE' });
        try {
            const payload = isRecord(request.body) ? request.body : {};
            const entitlementId = requireString(payload, 'entitlementId');
            const recentActiveGeneralIds = Array.isArray(payload.recentActiveGeneralIds)
                && payload.recentActiveGeneralIds.every(value => typeof value === 'string')
                ? payload.recentActiveGeneralIds
                : [];
            const offerSet = await accountService.generateFixedOffers({ playerId: principal.playerId, entitlementId, recentActiveGeneralIds });
            response.json({ ok: true, offerSet, offers: offerSet.offers });
        }
        catch (error) {
            sendAccountError(response, error);
        }
    });
    router.post('/shop/purchase', async (request, response) => {
        const principal = await resolvePrincipal(request, config);
        if (!principal)
            return rejectUnauthorized(response);
        if (!accountService)
            return response.status(503).json({ ok: false, code: 'ACCOUNT_SERVICE_UNAVAILABLE' });
        try {
            const payload = isRecord(request.body) ? request.body : {};
            const purchaseInput = {
                requestId: requireString(payload, 'requestId'),
                playerId: principal.playerId,
                entitlementId: requireString(payload, 'entitlementId'),
                offerId: requireString(payload, 'offerId'),
                expectedAccountVersion: requireVersion(payload, 'expectedAccountVersion'),
            };
            const before = await accountService.getOrCreate(principal.playerId);
            const duplicate = Boolean(before.idempotencyByRequestId[purchaseInput.requestId]);
            const receipt = await accountService.purchaseOffer(purchaseInput);
            response.json({ ok: true, duplicate, receipt });
        }
        catch (error) {
            sendAccountError(response, error);
        }
    });
    router.get('/settlements/:matchId', async (request, response) => {
        const principal = await resolvePrincipal(request, config);
        if (!principal)
            return rejectUnauthorized(response);
        if (!accountService)
            return response.status(503).json({ ok: false, code: 'ACCOUNT_SERVICE_UNAVAILABLE' });
        try {
            const settlementId = `${request.params.matchId}:${principal.playerId}`;
            const outboxRecord = await pveRewardStore?.getSettlement(settlementId);
            if (outboxRecord) {
                return response.json({
                    ok: true,
                    settlementId,
                    status: outboxRecord.status,
                    attempts: outboxRecord.attempts,
                    lastError: outboxRecord.lastError,
                    settlement: outboxRecord.settlement
                        ? { ...outboxRecord.settlement, ...(outboxRecord.detail ? { detail: outboxRecord.detail } : {}) }
                        : null,
                    ...(outboxRecord.detail ? { detail: outboxRecord.detail } : {}),
                    combatRulesetVersion: outboxRecord.combatRulesetVersion,
                    configSnapshot: outboxRecord.configSnapshot,
                    rewardTableRevision: outboxRecord.rewardTableRevision,
                    updatedAt: outboxRecord.updatedAt,
                });
            }
            const account = await accountService.getOrCreate(principal.playerId);
            const settlement = account.settlementsById[settlementId];
            if (!settlement)
                return response.status(404).json({ ok: false, code: 'SETTLEMENT_NOT_FOUND' });
            response.json({ ok: true, settlementId, status: 'committed', attempts: 1, lastError: null, settlement });
        }
        catch (error) {
            sendAccountError(response, error);
        }
    });
    router.get('/rooms', async (request, response) => {
        const principal = await resolvePrincipal(request, config);
        if (!principal) {
            rejectUnauthorized(response);
            return;
        }
        const rooms = roomManager
            .listRooms({ includeEmpty: false })
            .map((room) => serializeRoomSummary(room.getSummary()));
        response.json({ ok: true, rooms });
    });
    router.post('/rooms', async (request, response) => {
        const principal = await resolvePrincipal(request, config);
        if (!principal) {
            rejectUnauthorized(response);
            return;
        }
        const payload = isRecord(request.body) ? request.body : {};
        const requestedName = typeof payload.name === 'string' ? payload.name.trim().slice(0, 12) : '';
        const password = typeof payload.password === 'string' ? payload.password : '';
        const roomId = generateRoomId(roomManager);
        const room = roomManager.createRoom(roomId, {
            displayName: requestedName || roomId,
            hasPassword: password.length > 0,
        });
        // REST 建房人必须在返回前成为房主；否则路由切换后的 GET /rooms 会过滤空房，
        // 前端将在 Socket 来得及 join 前丢失 activeRoom 并退回大厅。
        const creatorSlot = room.joinPlayer(principal.playerId);
        if (!creatorSlot) {
            roomManager.removeRoom(roomId);
            response.status(409).json({ ok: false, code: 'ROOM_CREATOR_JOIN_FAILED', message: '建房人无法加入新房间' });
            return;
        }
        room.engine.registerPlayer(principal);
        response.status(201).json({
            ok: true,
            room: serializeRoomSummary(room.getSummary()),
        });
    });
    router.get('/state', async (request, response) => {
        const principal = await resolvePrincipal(request, config);
        if (!principal) {
            rejectUnauthorized(response);
            return;
        }
        response.json({
            ok: true,
            player: {
                playerId: principal.playerId,
                playerName: principal.playerName,
                playerKind: principal.playerKind,
            },
            gameState: (0, state_projection_1.projectFrontendGameState)(engine.getStateSnapshot(), config),
        });
    });
    router.post('/actions', async (request, response) => {
        const principal = await resolvePrincipal(request, config);
        if (!principal) {
            rejectUnauthorized(response);
            return;
        }
        let submission;
        try {
            const room = roomManager.listRooms().find((candidate) => candidate.engine === engine);
            const state = engine.getStateSnapshot();
            submission = checkpointCoordinator && room && state.status === 'running' && state.pve
                ? await (0, action_submission_1.submitDurablePveAction)({
                    engine, room, checkpointCoordinator, limiter, player: principal, payload: request.body,
                })
                : (0, action_submission_1.submitAction)({ engine, limiter, player: principal, payload: request.body });
        }
        catch {
            response.status(503).json({ ok: false, code: 'PVE_PERSISTENCE_UNAVAILABLE', message: 'Authoritative PVE persistence is unavailable' });
            return;
        }
        if (!submission.ok) {
            response.status(submission.status).json({
                ok: false,
                code: submission.code,
                message: submission.message,
                retryAfterMs: submission.retryAfterMs,
            });
            return;
        }
        response.status(202).json({
            ok: true,
            accepted: true,
            action: submission.action,
            rateLimitRemaining: submission.rateLimitRemaining,
            duplicate: submission.duplicate,
            gameState: (0, state_projection_1.projectFrontendGameState)(engine.getStateSnapshot(), config),
        });
    });
    router.get('/leaderboard', async (request, response) => {
        const principal = await resolvePrincipal(request, config);
        if (!principal) {
            rejectUnauthorized(response);
            return;
        }
        const limit = parseLimit(request.query.limit, 10);
        const liveLeaderboards = (0, competition_projection_1.buildLiveLeaderboards)(engine.getStateSnapshot());
        let persistedLeaderboards = null;
        if (competitionStore?.isEnabled()) {
            try {
                persistedLeaderboards = await competitionStore.getDualLeaderboards(limit);
            }
            catch (error) {
                logCompetitionStoreFailure('getDualLeaderboards', error);
            }
        }
        let usingPersistedLeaderboards = false;
        let leaderboards = liveLeaderboards;
        if (persistedLeaderboards) {
            usingPersistedLeaderboards = persistedLeaderboards.all.length > 0
                || persistedLeaderboards.human.length > 0
                || persistedLeaderboards.agent.length > 0;
            if (usingPersistedLeaderboards) {
                leaderboards = persistedLeaderboards;
            }
        }
        response.json({
            ok: true,
            source: usingPersistedLeaderboards ? 'supabase' : 'memory',
            leaderboards,
        });
    });
    router.get('/replays', async (request, response) => {
        const principal = await resolvePrincipal(request, config);
        if (!principal) {
            rejectUnauthorized(response);
            return;
        }
        const limit = parseLimit(request.query.limit, 10);
        const currentReplay = replayRecorder.getCurrentReplay();
        let persisted = [];
        if (competitionStore?.isEnabled()) {
            try {
                persisted = await competitionStore.listRecentReplays(limit);
            }
            catch (error) {
                logCompetitionStoreFailure('listRecentReplays', error);
            }
        }
        const summaries = persisted.length > 0
            ? persisted
            : currentReplay
                ? [(0, competition_projection_1.buildReplaySummary)(currentReplay)]
                : [];
        response.json({
            ok: true,
            source: persisted.length > 0 ? 'supabase' : 'memory',
            replays: summaries,
        });
    });
    // ── POST /replays — 仅存储胜利录像 ─────────────────────────────────────────
    // 收到失败数据包时，直接丢弃并返回 200 OK，不占用数据库空间。
    router.post('/replays', async (request, response) => {
        const principal = await resolvePrincipal(request, config);
        if (!principal) {
            rejectUnauthorized(response);
            return;
        }
        const body = request.body;
        if (typeof body !== 'object'
            || body === null
            || !body.isVictory) {
            // 非胜利数据直接丢弃，返回 200 OK
            response.status(200).json({ ok: true, stored: false, reason: 'defeat_discarded' });
            return;
        }
        const payload = body;
        const level = typeof payload.level === 'number' ? payload.level : null;
        if (level === null || !Number.isFinite(level)) {
            response.status(400).json({ ok: false, code: 'MISSING_LEVEL', message: 'level (number) is required' });
            return;
        }
        const playerType = principal.playerKind === 'human' ? 'HUMAN' : 'AGENT';
        const progress = progressStore.recordLevelClear(principal.playerId, level, playerType);
        response.status(201).json({ ok: true, stored: true, progress });
    });
    router.get('/replays/current', async (request, response) => {
        const principal = await resolvePrincipal(request, config);
        if (!principal) {
            rejectUnauthorized(response);
            return;
        }
        const currentReplay = replayRecorder.getCurrentReplay();
        if (!currentReplay) {
            response.status(404).json({ ok: false, code: 'REPLAY_NOT_FOUND', message: 'No replay available yet' });
            return;
        }
        response.json({ ok: true, replay: currentReplay });
    });
    router.get('/replays/:matchId', async (request, response) => {
        const principal = await resolvePrincipal(request, config);
        if (!principal) {
            rejectUnauthorized(response);
            return;
        }
        const { matchId } = request.params;
        const currentReplay = replayRecorder.getCurrentReplay();
        if (currentReplay?.matchId === matchId) {
            response.json({ ok: true, replay: currentReplay });
            return;
        }
        let persistedReplay = null;
        if (competitionStore?.isEnabled()) {
            try {
                persistedReplay = await competitionStore.getReplay(matchId);
            }
            catch (error) {
                logCompetitionStoreFailure('getReplay', error);
            }
        }
        if (!persistedReplay) {
            response.status(404).json({ ok: false, code: 'REPLAY_NOT_FOUND', message: 'Replay not found' });
            return;
        }
        response.json({ ok: true, replay: persistedReplay });
    });
    // ── GET /leaderboard/level5 — Level 5 大师排行榜 ───────────────────────────
    // 只返回 level5ClearCount > 0 的玩家，按通关次数降序，包含名次与硅基/碳基标识。
    router.get('/leaderboard/level5', async (request, response) => {
        const principal = await resolvePrincipal(request, config);
        if (!principal) {
            rejectUnauthorized(response);
            return;
        }
        const leaderboard = await progressStore.getLevel5LeaderboardAsync();
        response.json({ ok: true, leaderboard });
    });
    // ── GET /progress/:playerId — 查询玩家进度 ────────────────────────────────────
    router.get('/progress/:playerId', async (request, response) => {
        const principal = await resolvePrincipal(request, config);
        if (!principal) {
            rejectUnauthorized(response);
            return;
        }
        const { playerId } = request.params;
        const existing = progressStore.getProgress(playerId);
        if (!existing) {
            response.status(404).json({ ok: false, code: 'PROGRESS_NOT_FOUND', message: `No progress record for player ${playerId}` });
            return;
        }
        response.json({ ok: true, progress: existing });
    });
    // ── GET /progress/:playerId/unlock/:level — 检查关卡解锁状态 ─────────────────
    router.get('/progress/:playerId/unlock/:level', async (request, response) => {
        const principal = await resolvePrincipal(request, config);
        if (!principal) {
            rejectUnauthorized(response);
            return;
        }
        const targetLevel = Number(request.params.level);
        if (!Number.isFinite(targetLevel)) {
            response.status(400).json({ ok: false, code: 'INVALID_LEVEL', message: 'level must be a valid number' });
            return;
        }
        const playerType = principal.playerKind === 'human' ? 'HUMAN' : 'AGENT';
        const progress = progressStore.getOrCreate(request.params.playerId, playerType);
        const result = (0, unlock_logic_1.checkUnlock)(progress, targetLevel);
        response.json({ ok: true, targetLevel, ...result });
    });
    return router;
}
