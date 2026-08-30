"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SocketGateway = void 0;
const socket_io_1 = require("socket.io");
const game_loop_1 = require("../core/game-loop");
const projected_tick_stream_1 = require("../core/projected-tick-stream");
const action_submission_1 = require("./action-submission");
const gateway_auth_1 = require("./gateway-auth");
const unlock_logic_1 = require("../core/unlock-logic");
const level_config_1 = require("../config/level-config");
const pve_stage_config_1 = require("../../../shared/contracts/pve-stage-config");
const pve_reward_v1_1 = require("../pve-reward-v1");
const settlement_detail_1 = require("../pve-reward-v1/settlement-detail");
const item_v1_1 = require("../item-v1");
const weapon_v1_1 = require("../weapon-v1");
const reconnect_registry_1 = require("./reconnect-registry");
const game_1 = require("../../../shared/contracts/game");
const e2e_renderer_stress_1 = require("./e2e-renderer-stress");
function readHandshakeValue(socket, key) {
    const queryValue = socket.handshake.query[key];
    if (typeof queryValue === 'string' && queryValue.length > 0) {
        return queryValue;
    }
    return undefined;
}
const DEFAULT_ROOM_ID = 'public-1';
const COUNTDOWN_DURATION_MS = 3000;
const COMBAT_PROTOCOL_ROOM_PREFIX = '__combat-event-v1__:';
const ROOM_PASSWORD_ATTEMPT_WINDOW_MS = 60_000;
const ROOM_PASSWORD_ATTEMPT_MAX = 5;
function combatProtocolRoom(roomId) {
    return `${COMBAT_PROTOCOL_ROOM_PREFIX}${roomId}`;
}
function supportsCombatEventBatch(payload) {
    return payload.capabilities?.combatEventBatch === game_1.COMBAT_PRESENTATION_VERSION;
}
function detachCombatEvents(state) {
    if (!state.pve)
        return state;
    return { ...state, pve: { ...state.pve, recentEvents: [] } };
}
function isJoinRoomPayload(payload) {
    return typeof payload === 'object'
        && payload !== null
        && typeof payload.roomId === 'string'
        && payload.roomId.trim().length > 0;
}
function parseStageSelection(payload) {
    if (typeof payload !== 'object' || payload === null)
        return null;
    const candidate = payload;
    const difficulty = candidate.difficulty === undefined ? 'easy' : candidate.difficulty;
    const selection = { levelId: candidate.levelId, difficulty };
    return (0, pve_stage_config_1.isPveStageSelection)(selection) ? selection : null;
}
function isBuildTowerPayload(payload) {
    return typeof payload === 'object'
        && payload !== null
        && typeof payload.x === 'number'
        && typeof payload.y === 'number'
        && typeof payload.towerType === 'string';
}
class SocketGateway {
    telemetry;
    actionLimiter;
    progressStore;
    defaultProjectedTickStream;
    accountService;
    checkpointCoordinator;
    io;
    config;
    roomManager;
    roomRuntimes = new Map();
    pveRewardService;
    settlementCoordinator;
    roomLoopsStarted;
    e2eRendererStressTimers = new Map();
    /** Per-room/player guard for password brute-force attempts. Values are never persisted or exposed. */
    roomPasswordAttempts = new Map();
    setE2eHostLoopInterval(roomId, playerId, requestedIntervalMs) {
        if (!this.config.pveE2eEnabled || process.env.NODE_ENV === 'production') {
            return { ok: false, code: 'PVE_E2E_DISABLED' };
        }
        const room = this.roomManager.getRoom(roomId);
        if (!room)
            return { ok: false, code: 'ROOM_NOT_FOUND' };
        if (!room.getPlayerSlot(playerId))
            return { ok: false, code: 'ROOM_ACCESS_DENIED' };
        if (!Number.isFinite(requestedIntervalMs))
            return { ok: false, code: 'INVALID_INTERVAL' };
        const intervalMs = Math.max(1, Math.min(this.config.tickRateMs, Math.round(requestedIntervalMs)));
        const runtime = this.ensureRoomRuntime(roomId);
        runtime.loop.setIntervalMs(intervalMs);
        return { ok: true, intervalMs, logicalTickRateMs: this.config.tickRateMs };
    }
    getE2eAuthoritativeState(roomId, playerId) {
        if (!this.config.pveE2eEnabled || process.env.NODE_ENV === 'production')
            return null;
        const room = this.roomManager.getRoom(roomId);
        if (!room || !room.getPlayerSlot(playerId))
            return null;
        return room.engine.getStateSnapshot();
    }
    async submitE2eAction(roomId, principal, payload) {
        if (!this.config.pveE2eEnabled || process.env.NODE_ENV === 'production') {
            return { ok: false, status: 404, code: 'PVE_E2E_DISABLED' };
        }
        const room = this.roomManager.getRoom(roomId);
        if (!room)
            return { ok: false, status: 404, code: 'ROOM_NOT_FOUND' };
        if (!room.getPlayerSlot(principal.playerId))
            return { ok: false, status: 403, code: 'ROOM_ACCESS_DENIED' };
        try {
            const state = room.engine.getStateSnapshot();
            const submission = this.checkpointCoordinator && state.status === 'running' && state.pve
                ? await (0, action_submission_1.submitDurablePveAction)({
                    engine: room.engine, room, checkpointCoordinator: this.checkpointCoordinator,
                    limiter: this.actionLimiter, player: principal, payload,
                })
                : (0, action_submission_1.submitAction)({ engine: room.engine, limiter: this.actionLimiter, player: principal, payload });
            return submission.ok ? { ...submission, status: 202 } : submission;
        }
        catch {
            return { ok: false, status: 503, code: 'PVE_PERSISTENCE_UNAVAILABLE' };
        }
    }
    constructor(httpServer, roomManager, config, telemetry, actionLimiter, progressStore, defaultProjectedTickStream, accountService, pveRewardService = new pve_reward_v1_1.PveRewardService(), settlementCoordinator, checkpointCoordinator, deferRoomLoops = false) {
        this.telemetry = telemetry;
        this.actionLimiter = actionLimiter;
        this.progressStore = progressStore;
        this.defaultProjectedTickStream = defaultProjectedTickStream;
        this.accountService = accountService;
        this.checkpointCoordinator = checkpointCoordinator;
        this.config = config;
        this.roomManager = roomManager;
        this.pveRewardService = pveRewardService;
        this.settlementCoordinator = settlementCoordinator
            ?? (accountService ? new pve_reward_v1_1.PveSettlementCoordinator(pveRewardService.store, accountService) : null);
        this.roomLoopsStarted = !deferRoomLoops;
        this.io = new socket_io_1.Server(httpServer, {
            cors: {
                origin: config.corsOrigin === '*' ? true : config.corsOrigin,
                credentials: true,
            },
        });
        this.io.use((socket, next) => {
            void (0, gateway_auth_1.authenticateGatewayTokenAsync)(this.config, (0, gateway_auth_1.extractSocketToken)(socket))
                .then((principal) => {
                if (!principal) {
                    next(new Error('Missing or invalid gateway token'));
                    return;
                }
                socket.data.principal = principal;
                next();
            })
                .catch(() => next(new Error('Authentication service unavailable')));
        });
        this.io.on('connection', (socket) => {
            this.handleConnection(socket);
        });
        for (const room of this.roomManager.listRooms()) {
            this.ensureRoomRuntime(room.id);
        }
    }
    handleConnection(socket) {
        this.telemetry.setGauge('socket.connections', this.io.sockets.sockets.size);
        socket.on('JOIN_ROOM', (payload) => {
            const requestedRoomId = typeof payload === 'object' && payload !== null && 'roomId' in payload
                ? payload.roomId : null;
            if (requestedRoomId === e2e_renderer_stress_1.E2E_RENDERER_STRESS_ROOM) {
                this.startE2eRendererStress(socket);
                return;
            }
            this.handleJoinRoom(socket, payload);
        });
        socket.on('SEND_ACTION', (payload) => {
            void this.handleActionSubmission(socket, payload);
        });
        socket.on('BUILD_TOWER', (payload) => {
            this.handleBuildTower(socket, payload);
        });
        socket.on('START_MATCH', (payload) => {
            this.handleStartMatch(socket, payload);
        });
        socket.on('SET_GENERAL_SELECTION', (payload) => {
            const joinedContext = this.getJoinedContext(socket);
            const ids = payload && typeof payload === 'object' ? payload.selectedGeneralIds : null;
            if (!joinedContext || !Array.isArray(ids) || ids.some((id) => typeof id !== 'string')
                || !joinedContext.room.setPlayerGeneralSelection(joinedContext.identity.playerId, ids)) {
                this.emitEngineError(socket, 'BAD_PAYLOAD', 'selectedGeneralIds 无效');
            }
        });
        socket.on('SELECT_LEVEL', (payload) => {
            void this.handleSelectLevel(socket, payload);
        });
        socket.on('REQUEST_FULL_STATE', () => {
            this.handleFullStateRequest(socket);
        });
        socket.on('COMBAT_EVENT_ACK', (payload) => {
            this.handleCombatEventAck(socket, payload);
        });
        socket.on('REQUEST_COMBAT_EVENTS', (payload) => {
            this.handleCombatEventReplayRequest(socket, payload);
        });
        socket.on('disconnect', () => {
            const stressTimer = this.e2eRendererStressTimers.get(socket.id);
            if (stressTimer)
                clearInterval(stressTimer);
            this.e2eRendererStressTimers.delete(socket.id);
            this.leaveJoinedRoom(socket);
            this.telemetry.setGauge('socket.connections', this.io.sockets.sockets.size);
        });
    }
    shutdown(onClosed) {
        for (const timer of this.e2eRendererStressTimers.values())
            clearInterval(timer);
        this.e2eRendererStressTimers.clear();
        for (const runtime of this.roomRuntimes.values()) {
            runtime.reconnectRegistry.shutdown();
            runtime.unsubscribeProjection();
            runtime.unsubscribeSettlement();
            if (runtime.ownsProjectedTickStream) {
                runtime.projectedTickStream.dispose();
            }
            runtime.loop.stop();
        }
        this.roomRuntimes.clear();
        this.io.close(onClosed);
    }
    startE2eRendererStress(socket) {
        if (!this.config.pveE2eEnabled || process.env.NODE_ENV === 'production') {
            this.emitEngineError(socket, 'NOT_FOUND', 'Renderer stress fixture is unavailable');
            return;
        }
        const existing = this.e2eRendererStressTimers.get(socket.id);
        if (existing)
            return;
        socket.data.e2eRendererStress = true;
        socket.emit('ROOM_JOINED', { roomId: e2e_renderer_stress_1.E2E_RENDERER_STRESS_ROOM, slot: 'P1', phase: 'playing', hostPlayerId: 'human-dev', reconnected: false });
        socket.emit('ROOM_SNAPSHOT', { id: e2e_renderer_stress_1.E2E_RENDERER_STRESS_ROOM, slots: [{ slotId: 'P1', playerId: 'human-dev', playerName: 'Renderer QA', connected: true, connectionState: 'connected', isHost: true }] });
        socket.emit('ROOM_PHASE_CHANGED', { phase: 'playing' });
        socket.emit('LEVEL_SELECTED', { levelId: 1, difficulty: 'easy', label: '渲染协议压力', description: '仅渲染与增量协议验收，不生成伤害、奖励或结算。', waveCount: 20, targetClearRate: 0, minPlayers: 1 });
        let revision = 1;
        let tick = 0;
        let sequence = 0;
        socket.emit('TICK_UPDATE', { mode: 'full', gameState: (0, e2e_renderer_stress_1.stressFullState)(tick), sentAt: Date.now(), revision, presentationVersion: 1, eventSeq: 0, eventsDetached: true });
        const timer = setInterval(() => {
            const baseRevision = revision;
            revision += 1;
            tick += 10;
            sequence += 1;
            socket.emit('TICK_UPDATE', { mode: 'patch', patch: (0, e2e_renderer_stress_1.stressPatch)(tick), sentAt: Date.now(), revision, baseRevision, eventsDetached: true });
            socket.emit('COMBAT_EVENT_BATCH', (0, e2e_renderer_stress_1.stressCombatBatch)(sequence, tick));
        }, 200);
        this.e2eRendererStressTimers.set(socket.id, timer);
    }
    startRoomLoops() {
        this.roomLoopsStarted = true;
        for (const runtime of this.roomRuntimes.values())
            runtime.loop.start();
    }
    prepareRoomRuntimes() {
        for (const room of this.roomManager.listRooms())
            this.ensureRoomRuntime(room.id);
    }
    stopRoomLoops() {
        this.roomLoopsStarted = false;
        for (const runtime of this.roomRuntimes.values())
            runtime.loop.stop();
    }
    handleJoinRoom(socket, payload) {
        if (!isJoinRoomPayload(payload)) {
            this.emitEngineError(socket, 'BAD_PAYLOAD', '缺少必要参数 roomId');
            return;
        }
        const identity = this.resolvePlayerIdentity(socket, payload);
        const nextRoomId = payload.roomId.trim();
        const currentRoomId = this.getJoinedRoomId(socket);
        const currentPlayerId = this.getJoinedIdentity(socket)?.playerId;
        if (currentRoomId === nextRoomId && currentPlayerId === identity.playerId) {
            const runtime = this.ensureRoomRuntime(nextRoomId);
            const slot = runtime.room.getPlayerSlot(identity.playerId);
            if (!slot) {
                this.emitEngineError(socket, 'ROOM_JOIN_STATE_INVALID', '玩家房间状态异常，请重新连接');
                return;
            }
            this.configureCombatProtocol(socket, nextRoomId, supportsCombatEventBatch(payload));
            this.emitJoinSnapshot(socket, runtime, slot);
            return;
        }
        if (currentRoomId && (currentRoomId !== nextRoomId || currentPlayerId !== identity.playerId)) {
            this.leaveJoinedRoom(socket);
        }
        const runtime = this.ensureRoomRuntime(nextRoomId);
        const existingSlot = runtime.room.getPlayerSlot(identity.playerId);
        if (!existingSlot && runtime.room.requiresPassword()) {
            const password = typeof payload.password === 'string' ? payload.password : '';
            const principal = socket.data.principal;
            const passwordResult = this.checkRoomPassword(nextRoomId, principal?.playerId ?? identity.playerId, socket.handshake.address, password, runtime.room);
            if (!passwordResult.ok) {
                this.emitEngineError(socket, passwordResult.code, passwordResult.message, passwordResult.retryAfterMs);
                return;
            }
        }
        if (!existingSlot && !runtime.room.isAcceptingNewPlayers()) {
            this.emitEngineError(socket, 'MATCH_IN_PROGRESS', '对局构筑已锁定，只允许原玩家重连');
            return;
        }
        const assignedSlot = existingSlot ?? runtime.room.joinPlayer(identity.playerId);
        if (!assignedSlot) {
            this.emitEngineError(socket, 'ROOM_FULL', 'Room is full');
            return;
        }
        const attachment = runtime.reconnectRegistry.attach(identity.playerId, socket.id);
        if (!attachment.ok || !attachment.lease) {
            this.emitEngineError(socket, 'RECONNECT_WINDOW_EXPIRED', '重连期限已过，离场结算正在处理中');
            return;
        }
        if (attachment.supersededSocketId) {
            this.invalidateSupersededSocket(runtime.room.id, identity.playerId, attachment.supersededSocketId);
        }
        if (existingSlot)
            runtime.room.engine.restorePlayerConnection(identity);
        else
            runtime.room.engine.registerPlayer(identity);
        socket.join(nextRoomId);
        this.configureCombatProtocol(socket, nextRoomId, supportsCombatEventBatch(payload));
        socket.data.identity = identity;
        socket.data.roomId = nextRoomId;
        socket.data.connectionGeneration = attachment.lease.generation;
        this.emitJoinSnapshot(socket, runtime, assignedSlot, attachment.reconnected);
        this.emitPlayerConnectionState(runtime, identity.playerId, 'connected', null);
        this.emitRoomSnapshot(runtime);
    }
    checkRoomPassword(roomId, playerId, address, password, room) {
        const key = `${roomId}:${playerId}:${address}`;
        const now = Date.now();
        const current = this.roomPasswordAttempts.get(key);
        if (current && current.blockedUntil > now) {
            this.telemetry.incrementCounter('room.password.rate_limited');
            return {
                ok: false,
                code: 'PASSWORD_ATTEMPTS_EXCEEDED',
                message: '密码尝试次数过多，请稍后再试',
                retryAfterMs: current.blockedUntil - now,
            };
        }
        const state = !current || now - current.windowStartedAt >= ROOM_PASSWORD_ATTEMPT_WINDOW_MS
            ? { windowStartedAt: now, count: 0, blockedUntil: 0 }
            : current;
        if (!password || !room.verifyJoinPassword(password)) {
            state.count += 1;
            if (state.count >= ROOM_PASSWORD_ATTEMPT_MAX)
                state.blockedUntil = now + ROOM_PASSWORD_ATTEMPT_WINDOW_MS;
            this.roomPasswordAttempts.set(key, state);
            this.telemetry.incrementCounter('room.password.rejected');
            if (state.blockedUntil > now) {
                return {
                    ok: false,
                    code: 'PASSWORD_ATTEMPTS_EXCEEDED',
                    message: '密码尝试次数过多，请稍后再试',
                    retryAfterMs: state.blockedUntil - now,
                };
            }
            return {
                ok: false,
                code: password ? 'WRONG_PASSWORD' : 'PASSWORD_REQUIRED',
                message: password ? '房间密码错误' : '加入密码房必须提供 password',
            };
        }
        this.roomPasswordAttempts.delete(key);
        this.telemetry.incrementCounter('room.password.accepted');
        return { ok: true };
    }
    configureCombatProtocol(socket, roomId, enabled) {
        socket.data.combatEventBatchEnabled = enabled;
        socket.data.combatEventAckSeq = 0;
        if (enabled)
            socket.join(combatProtocolRoom(roomId));
        else
            socket.leave(combatProtocolRoom(roomId));
    }
    emitJoinSnapshot(socket, runtime, assignedSlot, reconnected = false) {
        const joinPayload = {
            roomId: runtime.room.id,
            slot: assignedSlot,
            phase: runtime.room.getPhase(),
            hostPlayerId: runtime.room.getHostPlayerId(),
            reconnected,
        };
        socket.emit('ROOM_JOINED', joinPayload);
        const fullEnvelope = this.createFullEnvelope(socket, runtime, true);
        socket.emit('TICK_UPDATE', fullEnvelope);
        socket.emit('ROOM_SNAPSHOT', this.serializeRoomSummary(runtime));
        socket.emit('ROOM_PHASE_CHANGED', { phase: runtime.room.getPhase() });
        this.recordOutbound('socket.TICK_UPDATE.full', fullEnvelope, 1);
    }
    handleFullStateRequest(socket) {
        const joinedContext = this.getJoinedContext(socket);
        if (!joinedContext) {
            this.emitEngineError(socket, 'NOT_IN_ROOM', '请先发送 JOIN_ROOM 加入房间');
            return;
        }
        const fullEnvelope = this.createFullEnvelope(socket, joinedContext.runtime);
        socket.emit('TICK_UPDATE', fullEnvelope);
        this.recordOutbound('socket.TICK_UPDATE.resync', fullEnvelope, 1);
    }
    createFullEnvelope(socket, runtime, initializeBroadcastBaseline = false) {
        const fullState = runtime.projectedTickStream.getCurrentFullState({ initializeBroadcastBaseline });
        if (!socket.data.combatEventBatchEnabled) {
            return { mode: 'full', gameState: fullState, sentAt: Date.now() };
        }
        const cursor = runtime.projectedTickStream.getPresentationCursor();
        return {
            mode: 'full',
            gameState: detachCombatEvents(fullState),
            sentAt: Date.now(),
            revision: fullState.tick,
            presentationVersion: game_1.COMBAT_PRESENTATION_VERSION,
            eventSeq: cursor.matchId === fullState.matchId ? cursor.eventSeq : 0,
            eventsDetached: true,
        };
    }
    handleCombatEventAck(socket, payload) {
        if (!socket.data.combatEventBatchEnabled || !payload || typeof payload !== 'object')
            return;
        const ack = payload;
        const joinedContext = this.getJoinedContext(socket);
        if (!joinedContext || ack.presentationVersion !== game_1.COMBAT_PRESENTATION_VERSION)
            return;
        const cursor = joinedContext.runtime.projectedTickStream.getPresentationCursor();
        if (ack.matchId !== cursor.matchId || !Number.isSafeInteger(ack.ackSeq) || ack.ackSeq < 0)
            return;
        socket.data.combatEventAckSeq = Math.max(socket.data.combatEventAckSeq ?? 0, ack.ackSeq);
    }
    handleCombatEventReplayRequest(socket, payload) {
        if (!socket.data.combatEventBatchEnabled || !payload || typeof payload !== 'object')
            return;
        const request = payload;
        const joinedContext = this.getJoinedContext(socket);
        if (!joinedContext
            || request.presentationVersion !== game_1.COMBAT_PRESENTATION_VERSION
            || !Number.isSafeInteger(request.fromSeq)
            || request.fromSeq < 1)
            return;
        const cursor = joinedContext.runtime.projectedTickStream.getPresentationCursor();
        if (request.matchId !== cursor.matchId) {
            this.handleFullStateRequest(socket);
            return;
        }
        const batch = joinedContext.runtime.projectedTickStream.getCombatEventBatchAfter(request.fromSeq);
        if (batch) {
            socket.emit('COMBAT_EVENT_BATCH', batch);
            this.recordOutbound('socket.COMBAT_EVENT_BATCH.replay', batch, 1);
            return;
        }
        socket.emit('COMBAT_EVENT_RESET', {
            matchId: cursor.matchId,
            presentationVersion: game_1.COMBAT_PRESENTATION_VERSION,
            eventSeq: cursor.eventSeq,
            reason: 'retention_gap',
        });
        this.handleFullStateRequest(socket);
    }
    async handleActionSubmission(socket, payload) {
        const requestId = typeof payload === 'object' && payload !== null && 'requestId' in payload
            && typeof payload.requestId === 'string'
            ? payload.requestId
            : null;
        const joinedContext = this.getJoinedContext(socket);
        if (!joinedContext) {
            this.emitEngineError(socket, 'NOT_IN_ROOM', '请先发送 JOIN_ROOM 加入房间', undefined, requestId);
            return;
        }
        let submission;
        try {
            const state = joinedContext.room.engine.getStateSnapshot();
            submission = this.checkpointCoordinator && state.status === 'running' && state.pve
                ? await (0, action_submission_1.submitDurablePveAction)({
                    engine: joinedContext.room.engine, room: joinedContext.room,
                    checkpointCoordinator: this.checkpointCoordinator,
                    limiter: this.actionLimiter, player: joinedContext.identity, payload,
                })
                : (0, action_submission_1.submitAction)({ engine: joinedContext.room.engine, limiter: this.actionLimiter, player: joinedContext.identity, payload });
        }
        catch {
            this.emitEngineError(socket, 'PVE_PERSISTENCE_UNAVAILABLE', '权威对局持久化暂不可用，请勿重试新 requestId', undefined, requestId);
            return;
        }
        if (!submission.ok) {
            this.emitEngineError(socket, submission.code, submission.message, submission.retryAfterMs, requestId);
            return;
        }
        const acceptedPayload = {
            ok: true,
            action: submission.action,
            requestId: submission.requestId,
            actionId: submission.actionId,
            serverTick: submission.serverTick,
            rateLimitRemaining: submission.rateLimitRemaining,
            duplicate: submission.duplicate,
        };
        socket.emit('ACTION_ACCEPTED', acceptedPayload);
        socket.emit('action_accepted', acceptedPayload);
    }
    handleBuildTower(socket, payload) {
        if (!isBuildTowerPayload(payload)) {
            this.emitEngineError(socket, 'BAD_PAYLOAD', '缺少必要参数 x、y、towerType');
            return;
        }
        void this.handleActionSubmission(socket, {
            action: 'BUILD_TOWER',
            x: payload.x,
            y: payload.y,
            type: payload.towerType,
        });
    }
    handleStartMatch(socket, payload) {
        const joinedContext = this.getJoinedContext(socket);
        if (!joinedContext) {
            this.emitEngineError(socket, 'NOT_IN_ROOM', '请先发送 JOIN_ROOM 加入房间');
            return;
        }
        const raw = payload;
        if (raw && typeof raw === 'object' && Array.isArray(raw.selectedGeneralIds)) {
            const requested = raw.selectedGeneralIds;
            if (requested.length === 0 || requested.some((id) => typeof id !== 'string')) {
                this.emitEngineError(socket, 'BAD_PAYLOAD', 'selectedGeneralIds 无效');
                return;
            }
            const accepted = joinedContext.room.setPlayerGeneralSelection(joinedContext.identity.playerId, requested);
            if (!accepted) {
                this.emitEngineError(socket, 'BAD_PAYLOAD', 'selectedGeneralIds 无效或超过本局上限');
                return;
            }
        }
        void this.beginRoomCountdown(joinedContext, socket);
    }
    async handleSelectLevel(socket, payload) {
        const joinedContext = this.getJoinedContext(socket);
        if (!joinedContext) {
            this.emitEngineError(socket, 'NOT_IN_ROOM', '请先发送 JOIN_ROOM 加入房间');
            return;
        }
        if (joinedContext.identity.playerId !== joinedContext.room.getHostPlayerId()) {
            this.emitEngineError(socket, 'FORBIDDEN', '只有房主有权选择难度');
            return;
        }
        const selection = parseStageSelection(payload);
        if (!selection) {
            this.emitEngineError(socket, 'BAD_PAYLOAD', '缺少或无效的 levelId、difficulty');
            return;
        }
        if (joinedContext.room.getPhase() !== 'playing'
            && payload && typeof payload === 'object' && Array.isArray(payload.selectedGeneralIds)) {
            const selected = payload.selectedGeneralIds;
            if (selected.some((id) => typeof id !== 'string')
                || !joinedContext.room.setPlayerGeneralSelection(joinedContext.identity.playerId, selected)) {
                this.emitEngineError(socket, 'BAD_PAYLOAD', 'selectedGeneralIds 无效');
                return;
            }
        }
        const levelConfig = level_config_1.LEVEL_CONFIGS[selection.levelId];
        if (!levelConfig) {
            this.emitEngineError(socket, 'INVALID_LEVEL', `Level ${selection.levelId} 不存在`);
            return;
        }
        if (!this.accountService) {
            this.emitEngineError(socket, 'ACCOUNT_SERVICE_UNAVAILABLE', '关卡进度服务暂不可用');
            return;
        }
        const participantIds = joinedContext.room.getConnectedPlayerIds();
        const participantAccounts = await Promise.all(participantIds.map(playerId => this.accountService.getOrCreate(playerId)));
        const lockedParticipant = participantAccounts.find(account => !(0, unlock_logic_1.checkPveStageUnlock)(account.pveProgress, selection).allowed);
        if (lockedParticipant) {
            const unlockResult = (0, unlock_logic_1.checkPveStageUnlock)(lockedParticipant.pveProgress, selection);
            this.emitEngineError(socket, 'LEVEL_LOCKED', `玩家 ${lockedParticipant.playerId} 未解锁：${unlockResult.allowed ? '前置不满足' : unlockResult.reason}`);
            return;
        }
        if (!levelConfig.allowedPlayerKinds.includes(joinedContext.identity.playerKind)) {
            this.emitEngineError(socket, 'LEVEL_LOCKED', '当前玩家类型不允许进入该关卡');
            return;
        }
        const currentPhase = joinedContext.room.getPhase();
        if (currentPhase === 'playing') {
            this.emitEngineError(socket, 'WRONG_PHASE', '当前对局已开始，不能再次选择难度');
            return;
        }
        if (currentPhase === 'lobby' || currentPhase === 'countdown') {
            joinedContext.room.setPendingStageSelection(selection);
            if (currentPhase === 'lobby') {
                void this.beginRoomCountdown(joinedContext, socket);
            }
            return;
        }
        if (currentPhase !== 'waiting_for_level') {
            this.emitEngineError(socket, 'WRONG_PHASE', '当前状态不接受难度选择，请等待倒计时完成');
            return;
        }
        await this.activateRoomLevel(joinedContext.room, levelConfig, selection);
    }
    async beginRoomCountdown(joinedContext, socket) {
        const result = await joinedContext.room.beginCountdown(joinedContext.identity.playerId, () => {
            this.handleCountdownCompleted(joinedContext.room);
        });
        if (result === 'forbidden') {
            this.emitEngineError(socket, 'FORBIDDEN', '只有房主可以启动游戏');
            return false;
        }
        if (result === 'wrong_phase') {
            this.emitEngineError(socket, 'WRONG_PHASE', '当前房间状态不允许启动该操作');
            return false;
        }
        if (result === 'snapshot_failed') {
            this.emitEngineError(socket, 'BUILD_SNAPSHOT_FAILED', '局外构筑锁定失败，对局未启动，请重试');
            return false;
        }
        const countdownPayload = {
            phase: 'countdown',
            durationMs: COUNTDOWN_DURATION_MS,
            remainingSeconds: COUNTDOWN_DURATION_MS / 1000,
        };
        this.io.to(joinedContext.room.id).emit('START_MATCH_ACCEPTED', countdownPayload);
        this.io.to(joinedContext.room.id).emit('ROOM_PHASE_CHANGED', countdownPayload);
        this.emitRoomSnapshot(joinedContext.room);
        this.scheduleCountdownBroadcast(joinedContext.room);
        return true;
    }
    handleCountdownCompleted(room) {
        const pendingSelection = room.consumePendingStageSelection();
        if (pendingSelection === null) {
            this.io.to(room.id).emit('ROOM_PHASE_CHANGED', { phase: 'waiting_for_level' });
            this.emitRoomSnapshot(room);
            return;
        }
        const levelConfig = level_config_1.LEVEL_CONFIGS[pendingSelection.levelId];
        if (!levelConfig) {
            this.io.to(room.id).emit('ROOM_PHASE_CHANGED', { phase: 'waiting_for_level' });
            return;
        }
        void this.activateRoomLevel(room, levelConfig, pendingSelection).catch(() => undefined);
    }
    async activateRoomLevel(room, levelConfig, selection) {
        room.ignitePveV2(selection);
        if (this.checkpointCoordinator)
            await this.checkpointCoordinator.attachFreshRoom(room);
        const levelSelectedPayload = {
            levelId: levelConfig.levelId,
            difficulty: selection.difficulty,
            label: levelConfig.label,
            description: levelConfig.description,
            targetClearRate: levelConfig.targetClearRate,
            waveCount: levelConfig.waves.length,
            minPlayers: levelConfig.minPlayers,
        };
        this.io.to(room.id).emit('LEVEL_SELECTED', levelSelectedPayload);
        this.io.to(room.id).emit('ROOM_PHASE_CHANGED', { phase: 'playing', levelId: levelConfig.levelId });
        this.emitRoomSnapshot(room);
    }
    scheduleCountdownBroadcast(room) {
        const countdownSeconds = [2, 1];
        countdownSeconds.forEach((remainingSeconds) => {
            setTimeout(() => {
                if (room.getPhase() !== 'countdown') {
                    return;
                }
                this.io.to(room.id).emit('COUNTDOWN_TICK', {
                    phase: 'countdown',
                    remainingSeconds,
                    remainingMs: remainingSeconds * 1000,
                });
            }, (COUNTDOWN_DURATION_MS / 1000 - remainingSeconds) * 1000);
        });
    }
    ensureRoomRuntime(roomId) {
        const existingRuntime = this.roomRuntimes.get(roomId);
        if (existingRuntime) {
            return existingRuntime;
        }
        const room = this.roomManager.getOrCreateRoom(roomId);
        const usesSharedProjectedTickStream = roomId === DEFAULT_ROOM_ID && Boolean(this.defaultProjectedTickStream);
        const projectedTickStream = usesSharedProjectedTickStream
            ? this.defaultProjectedTickStream
            : new projected_tick_stream_1.ProjectedTickStream(room.engine, this.config, this.telemetry);
        const loop = new game_loop_1.GameLoop(room.engine, this.config.hostLoopIntervalMs);
        room.engine.attachPerformanceTelemetry(this.telemetry);
        let runtime;
        const reconnectRegistry = new reconnect_registry_1.PlayerReconnectRegistry({
            graceMs: this.config.disconnectGraceMs,
            onGraceStarted: (pending) => this.handleReconnectGraceStarted(runtime, pending),
            onExpired: (pending) => this.finalizeExpiredPlayer(runtime, pending),
        });
        runtime = {
            room,
            loop,
            projectedTickStream,
            reconnectRegistry,
            ownsProjectedTickStream: !usesSharedProjectedTickStream,
            unsubscribeProjection: () => { },
            unsubscribeSettlement: () => { },
            rewardQueue: Promise.resolve(),
            settledMatchIds: new Set(),
            scheduledRewardKeys: new Set(),
            scheduledDepartures: new Set(),
            settlementTelemetry: null,
        };
        runtime.unsubscribeSettlement = room.engine.onTick((state) => {
            if (state.pve) {
                if (runtime.settlementTelemetry?.matchId !== state.matchId) {
                    runtime.settlementTelemetry = (0, settlement_detail_1.createSettlementTelemetry)(state.matchId);
                }
                (0, settlement_detail_1.ingestSettlementEvents)(runtime.settlementTelemetry, state.pve.recentEvents);
            }
            this.schedulePveRewardWork(runtime, state);
        }, { label: 'pve-reward-settlement' });
        runtime.unsubscribeProjection = projectedTickStream.subscribeBroadcast((event) => {
            const recipientCount = this.io.sockets.adapter.rooms.get(room.id)?.size ?? 0;
            if (recipientCount === 0) {
                return;
            }
            if (!event.shouldSocketBroadcast || !event.broadcast) {
                return;
            }
            const protocolRoom = combatProtocolRoom(room.id);
            const protocolRecipientCount = this.io.sockets.adapter.rooms.get(protocolRoom)?.size ?? 0;
            const legacyRecipientCount = Math.max(0, recipientCount - protocolRecipientCount);
            const mode = event.shouldFullSnapshot ? 'checkpoint' : 'patch';
            const legacyPatch = event.shouldFullSnapshot ? event.broadcast.checkpoint : event.broadcast.legacyPatch;
            const protocolPatch = event.shouldFullSnapshot
                ? detachCombatEvents(event.broadcast.checkpoint)
                : event.broadcast.patch;
            const sentAt = Date.now();
            if (legacyRecipientCount > 0) {
                const legacyEnvelope = { mode, patch: legacyPatch, sentAt };
                this.io.to(room.id).except(protocolRoom).emit('TICK_UPDATE', legacyEnvelope);
                this.recordOutbound(`socket.TICK_UPDATE.${mode}.legacy`, legacyEnvelope, legacyRecipientCount);
            }
            if (protocolRecipientCount > 0) {
                const protocolEnvelope = {
                    mode,
                    patch: protocolPatch,
                    sentAt,
                    revision: event.broadcast.patch.tick,
                    baseRevision: event.broadcast.baseRevision,
                    eventsDetached: true,
                };
                this.io.to(protocolRoom).emit('TICK_UPDATE', protocolEnvelope);
                this.recordOutbound(`socket.TICK_UPDATE.${mode}.v2`, protocolEnvelope, protocolRecipientCount);
                if (event.broadcast.combatEventBatch) {
                    this.io.to(protocolRoom).emit('COMBAT_EVENT_BATCH', event.broadcast.combatEventBatch);
                    this.recordOutbound('socket.COMBAT_EVENT_BATCH', event.broadcast.combatEventBatch, protocolRecipientCount);
                }
            }
            if (Object.keys(event.broadcast.uiUpdate).length > 0) {
                this.io.to(room.id).emit('UI_STATE_UPDATE', event.broadcast.uiUpdate);
                this.recordOutbound('socket.UI_STATE_UPDATE', event.broadcast.uiUpdate, recipientCount);
            }
            if (event.broadcast.noticeUpdate) {
                this.io.to(room.id).emit('NOTICE_UPDATE', event.broadcast.noticeUpdate);
                this.recordOutbound('socket.NOTICE_UPDATE', event.broadcast.noticeUpdate, recipientCount);
            }
        });
        if (this.roomLoopsStarted)
            loop.start();
        this.roomRuntimes.set(roomId, runtime);
        return runtime;
    }
    schedulePveRewardWork(runtime, state) {
        const selection = runtime.room.getStageSelectionForMatch(state.matchId);
        if (!selection || !state.pve || !this.accountService)
            return;
        const milestones = [5, 10, 15, 20];
        const dueMilestones = state.pve.players.flatMap(player => milestones
            // 波次允许重叠，后续波次先清完不能被误判为前一个 Boss 已死亡。
            .filter(milestone => player.clearedWaves.includes(milestone))
            .map(milestone => ({ playerId: player.playerId, milestone })))
            .filter(({ playerId, milestone }) => !runtime.scheduledRewardKeys.has(`${state.matchId}:${playerId}:wave-${milestone}`));
        const needsSettlement = state.status === 'finished' && !runtime.settledMatchIds.has(state.matchId)
            && !runtime.scheduledRewardKeys.has(`${state.matchId}:settlement`);
        if (dueMilestones.length === 0 && !needsSettlement)
            return;
        for (const due of dueMilestones) {
            runtime.scheduledRewardKeys.add(`${state.matchId}:${due.playerId}:wave-${due.milestone}`);
        }
        if (needsSettlement)
            runtime.scheduledRewardKeys.add(`${state.matchId}:settlement`);
        const stateSnapshot = structuredClone(state);
        runtime.rewardQueue = runtime.rewardQueue
            .then(async () => {
            const milestoneResults = await Promise.allSettled(dueMilestones.map(due => (this.recordPveMilestone(runtime, stateSnapshot, due.playerId, due.milestone))));
            const milestoneFailures = [];
            milestoneResults.forEach((result, index) => {
                if (result.status === 'rejected') {
                    const due = dueMilestones[index];
                    runtime.scheduledRewardKeys.delete(`${state.matchId}:${due.playerId}:wave-${due.milestone}`);
                    milestoneFailures.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
                }
            });
            if (milestoneFailures.length > 0)
                throw new Error(milestoneFailures.join(', '));
            if (needsSettlement)
                await this.settleFinishedPveMatch(runtime, stateSnapshot);
        })
            .catch((error) => {
            if (needsSettlement)
                runtime.scheduledRewardKeys.delete(`${state.matchId}:settlement`);
            const details = error instanceof Error ? error.message : String(error);
            console.error(`PVE reward processing failed for ${state.matchId}: ${details}`);
        });
    }
    async recordPveMilestone(runtime, state, playerId, milestone) {
        if (!this.accountService)
            throw new Error('PLAYER_ACCOUNT_SERVICE_NOT_CONFIGURED');
        const pve = state.pve;
        const selection = runtime.room.getStageSelectionForMatch(state.matchId);
        const stage = selection ? (0, pve_stage_config_1.getPveStageDefinition)(selection.levelId) : null;
        const player = pve?.players.find(candidate => candidate.playerId === playerId);
        if (!selection || !stage || !player || !pve || !(0, pve_stage_config_1.isPveDifficulty)(selection.difficulty)) {
            throw new Error('PVE_REWARD_CONTEXT_INCOMPLETE');
        }
        const account = await this.accountService.getOrCreate(playerId);
        await this.pveRewardService.recordWaveMilestone({
            matchId: state.matchId,
            matchSeed: state.matchId,
            combatRulesetVersion: pve.combatRulesetVersion,
            configSnapshot: pve.configSnapshot,
            stage: { levelId: selection.levelId, stageId: stage.stageId, difficulty: selection.difficulty },
            playerId,
            milestone,
            activatedGeneralIds: player.generalProgress.map(progress => progress.generalId),
            discoveredGeneralIds: Object.keys(account.weapon.loadoutsByGeneralId),
            weaponState: {
                fragmentBalances: account.weapon.fragmentBalances,
                unlockedWeaponIds: account.weapon.unlockedWeaponIds,
            },
            bossFragmentBonus: this.resolveBossFragmentBonus(runtime.room, playerId),
        });
    }
    resolveBossFragmentBonus(room, playerId) {
        const build = room.getMatchBuildSnapshot(playerId);
        if (!build)
            return undefined;
        for (const itemId of build.item.passiveSlots) {
            if (!itemId)
                continue;
            const definition = (0, item_v1_1.getPassiveItemDefinition)(itemId);
            const modifier = definition?.ruleModifiers.find(candidate => candidate.type === 'boss_fragment_bonus');
            if (modifier?.type === 'boss_fragment_bonus') {
                return {
                    chanceBps: modifier.chanceBps,
                    extraCount: modifier.extraCount,
                    maxExtraPerBoss: modifier.maxExtraPerBoss,
                    qualityPolicy: modifier.qualityPolicy,
                };
            }
        }
        return undefined;
    }
    async settleFinishedPveMatch(runtime, state) {
        if (!this.accountService || !state.pve || !state.result)
            return;
        const selection = runtime.room.getStageSelectionForMatch(state.matchId);
        const stage = selection ? (0, pve_stage_config_1.getPveStageDefinition)(selection.levelId) : null;
        if (!selection || !stage)
            throw new Error('PVE_SETTLEMENT_CONTEXT_INCOMPLETE');
        const officialVictory = state.result.outcome === 'victory';
        const failures = [];
        for (const player of state.pve.players) {
            try {
                const account = await this.accountService.getOrCreate(player.playerId);
                if (account.settlementsById[`${state.matchId}:${player.playerId}`])
                    continue;
                const rewardContext = {
                    matchId: state.matchId,
                    matchSeed: state.matchId,
                    combatRulesetVersion: state.pve.combatRulesetVersion,
                    configSnapshot: state.pve.configSnapshot,
                    stage: { levelId: selection.levelId, stageId: stage.stageId, difficulty: selection.difficulty },
                    playerId: player.playerId,
                    activatedGeneralIds: player.generalProgress.map(progress => progress.generalId),
                    discoveredGeneralIds: Object.keys(account.weapon.loadoutsByGeneralId),
                    weaponState: {
                        fragmentBalances: account.weapon.fragmentBalances,
                        unlockedWeaponIds: account.weapon.unlockedWeaponIds,
                    },
                };
                await this.pveRewardService.recordMatchOutcome({ ...rewardContext, officialVictory });
                const frozenRewards = await this.pveRewardService.freezePlayerRewards(state.matchId, player.playerId);
                const rewardEvents = (await this.pveRewardService.store.listPlayerBatches(state.matchId, player.playerId))
                    .flatMap(batch => batch.events);
                const telemetry = runtime.settlementTelemetry?.matchId === state.matchId
                    ? runtime.settlementTelemetry : (0, settlement_detail_1.createSettlementTelemetry)(state.matchId);
                const allStats = (0, settlement_detail_1.resolveSettlementStats)(telemetry, state.pve.players);
                const detail = (0, settlement_detail_1.buildPveSettlementDetail)({
                    configSnapshot: state.pve.configSnapshot,
                    rewardTableRevision: weapon_v1_1.PVE_WEAPON_REWARD_TABLE_REVISION,
                    reason: officialVictory ? 'victory' : 'defeat',
                    officialVictory,
                    highestCompletedWave: player.highestCompletedWave,
                    player,
                    allStats,
                    coverageComplete: telemetry.sawMatchStarted,
                    rewardEvents,
                    firstClear: officialVictory && !account.pveProgress.clearsByStageKey[(0, pve_stage_config_1.pveStageKey)(selection)],
                });
                if (!this.settlementCoordinator || !state.pve.configSnapshot) {
                    throw new Error('PVE_SETTLEMENT_COORDINATOR_NOT_CONFIGURED');
                }
                await this.settlementCoordinator.settle({
                    settlementId: `${state.matchId}:${player.playerId}`,
                    combatRulesetVersion: state.pve.combatRulesetVersion,
                    configSnapshot: state.pve.configSnapshot,
                    rewardTableRevision: weapon_v1_1.PVE_WEAPON_REWARD_TABLE_REVISION,
                    detail,
                    input: {
                        requestId: `settle:${state.matchId}:${player.playerId}`,
                        matchId: state.matchId,
                        playerId: player.playerId,
                        reason: officialVictory ? 'victory' : 'defeat',
                        highestCompletedWave: player.highestCompletedWave,
                        officialVictory,
                        retainedWeaponFragments: frozenRewards.fragmentBalances,
                        stageSelection: selection,
                    },
                });
            }
            catch (error) {
                failures.push(`${player.playerId}:${error instanceof Error ? error.message : String(error)}`);
            }
        }
        if (failures.length > 0)
            throw new Error(failures.join(', '));
        runtime.settledMatchIds.add(state.matchId);
    }
    async settleDepartingPvePlayer(runtime, playerId, frozenState) {
        if (!this.accountService)
            return;
        const state = frozenState ?? runtime.room.engine.getStateSnapshot();
        const pve = state.pve;
        const selection = runtime.room.getStageSelectionForMatch(state.matchId);
        const stage = selection ? (0, pve_stage_config_1.getPveStageDefinition)(selection.levelId) : null;
        const player = pve?.players.find(candidate => candidate.playerId === playerId);
        if (state.status !== 'running' || !selection || !stage || !player || !pve)
            return;
        const account = await this.accountService.getOrCreate(playerId);
        if (account.settlementsById[`${state.matchId}:${playerId}`])
            return;
        for (const milestone of [5, 10, 15, 20]) {
            if (player.clearedWaves.includes(milestone)) {
                await this.recordPveMilestone(runtime, state, playerId, milestone);
            }
        }
        await this.pveRewardService.recordMatchOutcome({
            matchId: state.matchId,
            matchSeed: state.matchId,
            combatRulesetVersion: pve.combatRulesetVersion,
            configSnapshot: pve.configSnapshot,
            stage: { levelId: selection.levelId, stageId: stage.stageId, difficulty: selection.difficulty },
            playerId,
            activatedGeneralIds: player.generalProgress.map(progress => progress.generalId),
            discoveredGeneralIds: Object.keys(account.weapon.loadoutsByGeneralId),
            weaponState: {
                fragmentBalances: account.weapon.fragmentBalances,
                unlockedWeaponIds: account.weapon.unlockedWeaponIds,
            },
            officialVictory: false,
        });
        const frozenRewards = await this.pveRewardService.freezePlayerRewards(state.matchId, playerId);
        const rewardEvents = (await this.pveRewardService.store.listPlayerBatches(state.matchId, playerId))
            .flatMap(batch => batch.events);
        const telemetry = runtime.settlementTelemetry?.matchId === state.matchId
            ? runtime.settlementTelemetry : (0, settlement_detail_1.createSettlementTelemetry)(state.matchId);
        const allStats = (0, settlement_detail_1.resolveSettlementStats)(telemetry, pve.players);
        const detail = (0, settlement_detail_1.buildPveSettlementDetail)({
            configSnapshot: pve.configSnapshot,
            rewardTableRevision: weapon_v1_1.PVE_WEAPON_REWARD_TABLE_REVISION,
            reason: 'disconnect_exit',
            officialVictory: false,
            highestCompletedWave: player.highestCompletedWave,
            player,
            allStats,
            coverageComplete: telemetry.sawMatchStarted,
            rewardEvents,
            firstClear: false,
        });
        if (!this.settlementCoordinator) {
            throw new Error('PVE_SETTLEMENT_COORDINATOR_NOT_CONFIGURED');
        }
        await this.settlementCoordinator.settle({
            settlementId: `${state.matchId}:${playerId}`,
            combatRulesetVersion: pve.combatRulesetVersion,
            configSnapshot: pve.configSnapshot,
            rewardTableRevision: weapon_v1_1.PVE_WEAPON_REWARD_TABLE_REVISION,
            detail,
            input: {
                requestId: `settle:${state.matchId}:${playerId}`,
                matchId: state.matchId,
                playerId,
                reason: 'disconnect_exit',
                highestCompletedWave: player.highestCompletedWave,
                officialVictory: false,
                retainedWeaponFragments: frozenRewards.fragmentBalances,
                stageSelection: selection,
            },
        });
    }
    leaveJoinedRoom(socket) {
        const roomId = this.getJoinedRoomId(socket);
        const identity = this.getJoinedIdentity(socket);
        if (!roomId || !identity) {
            return;
        }
        const runtime = this.roomRuntimes.get(roomId);
        if (!runtime) {
            delete socket.data.roomId;
            delete socket.data.identity;
            return;
        }
        const generation = typeof socket.data.connectionGeneration === 'number'
            ? socket.data.connectionGeneration
            : -1;
        runtime.reconnectRegistry.detach(identity.playerId, socket.id, generation);
        socket.leave(roomId);
        socket.leave(combatProtocolRoom(roomId));
        delete socket.data.roomId;
        delete socket.data.identity;
        delete socket.data.connectionGeneration;
        delete socket.data.combatEventBatchEnabled;
        delete socket.data.combatEventAckSeq;
    }
    handleReconnectGraceStarted(runtime, pending) {
        runtime.room.engine.markPlayerReconnecting(pending.playerId);
        this.emitPlayerConnectionState(runtime, pending.playerId, 'reconnecting', pending.deadlineAt);
        this.emitRoomSnapshot(runtime);
    }
    finalizeExpiredPlayer(runtime, pending) {
        // 在宽限到期这一刻冻结结算事实，避免排队期间对局结束改变离场原因。
        const state = runtime.room.engine.getStateSnapshot();
        const departureKey = `${state.matchId}:${pending.playerId}`;
        if (runtime.scheduledDepartures.has(departureKey))
            return;
        runtime.scheduledDepartures.add(departureKey);
        runtime.room.engine.markPlayerDisconnected(pending.playerId);
        this.emitPlayerConnectionState(runtime, pending.playerId, 'disconnected', null);
        this.emitRoomSnapshot(runtime);
        runtime.rewardQueue = runtime.rewardQueue
            .then(() => this.settleDepartingPvePlayer(runtime, pending.playerId, state))
            .catch((error) => {
            console.error(`PVE disconnect settlement failed for ${pending.playerId}: ${error instanceof Error ? error.message : String(error)}`);
        })
            .finally(() => {
            runtime.room.leavePlayer(pending.playerId);
            runtime.reconnectRegistry.completeDeparture(pending.playerId);
            this.emitRoomSnapshot(runtime);
            this.cleanupRoomIfEmpty(runtime.room.id);
        });
    }
    invalidateSupersededSocket(roomId, playerId, socketId) {
        const superseded = this.io.sockets.sockets.get(socketId);
        if (!superseded)
            return;
        superseded.emit('PLAYER_CONNECTION_REPLACED', { playerId, replacementReason: 'newer_authenticated_socket' });
        superseded.leave(roomId);
        superseded.leave(combatProtocolRoom(roomId));
        delete superseded.data.roomId;
        delete superseded.data.identity;
        delete superseded.data.connectionGeneration;
    }
    emitPlayerConnectionState(runtime, playerId, status, reconnectDeadlineAt) {
        const remainingMs = reconnectDeadlineAt === null ? 0 : Math.max(0, reconnectDeadlineAt - Date.now());
        this.io.to(runtime.room.id).emit('PLAYER_CONNECTION_STATE', {
            playerId,
            status,
            reconnectDeadlineAt,
            reconnectRemainingMs: remainingMs,
            graceMs: this.config.disconnectGraceMs,
        });
    }
    cleanupRoomIfEmpty(roomId) {
        const runtime = this.roomRuntimes.get(roomId);
        if (!runtime || !runtime.room.isEmpty()) {
            return;
        }
        runtime.reconnectRegistry.shutdown();
        runtime.unsubscribeProjection();
        runtime.unsubscribeSettlement();
        if (runtime.ownsProjectedTickStream) {
            runtime.projectedTickStream.dispose();
        }
        runtime.loop.stop();
        this.roomRuntimes.delete(roomId);
        this.roomManager.removeRoom(roomId);
    }
    getJoinedContext(socket) {
        const roomId = this.getJoinedRoomId(socket);
        const identity = this.getJoinedIdentity(socket);
        if (!roomId || !identity) {
            return null;
        }
        const runtime = this.roomRuntimes.get(roomId);
        if (!runtime) {
            return null;
        }
        const generation = typeof socket.data.connectionGeneration === 'number'
            ? socket.data.connectionGeneration
            : -1;
        if (!runtime.reconnectRegistry.isCurrent(identity.playerId, socket.id, generation)) {
            return null;
        }
        return {
            room: runtime.room,
            runtime,
            identity,
        };
    }
    getJoinedRoomId(socket) {
        return typeof socket.data.roomId === 'string' ? socket.data.roomId : null;
    }
    getJoinedIdentity(socket) {
        const identity = socket.data.identity;
        if (!identity || typeof identity !== 'object') {
            return null;
        }
        const candidate = identity;
        if (typeof candidate.playerId !== 'string'
            || typeof candidate.playerName !== 'string'
            || (candidate.playerKind !== 'human' && candidate.playerKind !== 'agent')) {
            return null;
        }
        return candidate;
    }
    resolvePlayerIdentity(socket, overrides) {
        const principal = socket.data.principal;
        const requestedPlayerId = overrides?.playerId ?? readHandshakeValue(socket, 'playerId');
        const requestedPlayerName = overrides?.playerName ?? readHandshakeValue(socket, 'playerName');
        const isSupabaseSession = principal?.authSource === 'supabase';
        const playerId = isSupabaseSession
            ? principal?.playerId ?? requestedPlayerId ?? socket.id
            : requestedPlayerId ?? principal?.playerId ?? socket.id;
        const playerName = isSupabaseSession
            ? principal?.playerName ?? requestedPlayerName ?? `player-${playerId.slice(0, 6)}`
            : requestedPlayerName ?? principal?.playerName ?? `player-${playerId.slice(0, 6)}`;
        const playerKind = principal?.playerKind ?? overrides?.playerKind ?? (readHandshakeValue(socket, 'playerKind') === 'agent' ? 'agent' : 'human');
        return {
            playerId,
            playerName,
            playerKind,
        };
    }
    serializeRoomSummary(runtime) {
        const summary = runtime.room.getSummary();
        return {
            id: summary.id,
            name: summary.name,
            hasPassword: summary.hasPassword,
            players: summary.players,
            maxPlayers: summary.maxPlayers,
            status: summary.phase === 'playing'
                ? 'IN_MATCH'
                : summary.phase === 'countdown' || summary.phase === 'waiting_for_level'
                    ? 'DRAFTING'
                    : 'OPEN',
            pingMs: null,
            slots: summary.slots.map((slot) => {
                const pending = slot.playerId ? runtime.reconnectRegistry.getPending(slot.playerId) : null;
                return pending
                    ? {
                        ...slot,
                        reconnectDeadlineAt: pending.deadlineAt,
                        reconnectRemainingMs: Math.max(0, pending.deadlineAt - Date.now()),
                    }
                    : slot;
            }),
        };
    }
    emitRoomSnapshot(value) {
        const runtime = 'room' in value ? value : this.roomRuntimes.get(value.id);
        if (!runtime)
            return;
        this.io.to(runtime.room.id).emit('ROOM_SNAPSHOT', this.serializeRoomSummary(runtime));
    }
    emitEngineError(socket, code, message, retryAfterMs, requestId) {
        socket.emit('engine_error', {
            code,
            message,
            retryAfterMs,
            ...(requestId ? { requestId } : {}),
        });
    }
    recordOutbound(metricName, payload, recipientCount) {
        const payloadBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
        this.telemetry.incrementCounter(`${metricName}.messages`, 1);
        this.telemetry.incrementCounter(`${metricName}.bytes`, payloadBytes * recipientCount);
        this.telemetry.setGauge(`${metricName}.lastPayloadBytes`, payloadBytes);
    }
}
exports.SocketGateway = SocketGateway;
