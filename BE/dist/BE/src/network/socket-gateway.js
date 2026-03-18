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
function readHandshakeValue(socket, key) {
    const queryValue = socket.handshake.query[key];
    if (typeof queryValue === 'string' && queryValue.length > 0) {
        return queryValue;
    }
    return undefined;
}
const DEFAULT_ROOM_ID = 'public-1';
const COUNTDOWN_DURATION_MS = 3000;
function isJoinRoomPayload(payload) {
    return typeof payload === 'object'
        && payload !== null
        && typeof payload.roomId === 'string'
        && payload.roomId.trim().length > 0;
}
function isSelectLevelPayload(payload) {
    return typeof payload === 'object'
        && payload !== null
        && typeof payload.levelId === 'number';
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
    io;
    config;
    roomManager;
    roomRuntimes = new Map();
    constructor(httpServer, roomManager, config, telemetry, actionLimiter, progressStore) {
        this.telemetry = telemetry;
        this.actionLimiter = actionLimiter;
        this.progressStore = progressStore;
        this.config = config;
        this.roomManager = roomManager;
        this.io = new socket_io_1.Server(httpServer, {
            cors: {
                origin: config.corsOrigin === '*' ? true : config.corsOrigin,
                credentials: true,
            },
        });
        this.io.use((socket, next) => {
            const principal = (0, gateway_auth_1.authenticateGatewayToken)(this.config, (0, gateway_auth_1.extractSocketToken)(socket));
            if (!principal) {
                next(new Error('Missing or invalid gateway token'));
                return;
            }
            socket.data.principal = principal;
            next();
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
            this.handleJoinRoom(socket, payload);
        });
        socket.on('send_action', (payload) => {
            this.handleActionSubmission(socket, payload);
        });
        socket.on('BUILD_TOWER', (payload) => {
            this.handleBuildTower(socket, payload);
        });
        socket.on('START_MATCH', () => {
            this.handleStartMatch(socket);
        });
        socket.on('SELECT_LEVEL', (payload) => {
            this.handleSelectLevel(socket, payload);
        });
        socket.on('disconnect', () => {
            this.leaveJoinedRoom(socket);
            this.telemetry.setGauge('socket.connections', this.io.sockets.sockets.size);
        });
    }
    shutdown(onClosed) {
        for (const runtime of this.roomRuntimes.values()) {
            runtime.unsubscribeProjection();
            runtime.loop.stop();
        }
        this.roomRuntimes.clear();
        this.io.close(onClosed);
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
            this.emitJoinSnapshot(socket, runtime, slot);
            return;
        }
        if (currentRoomId && (currentRoomId !== nextRoomId || currentPlayerId !== identity.playerId)) {
            this.leaveJoinedRoom(socket);
        }
        const runtime = this.ensureRoomRuntime(nextRoomId);
        const existingConnections = runtime.playerConnections.get(identity.playerId) ?? 0;
        const assignedSlot = existingConnections > 0
            ? runtime.room.getPlayerSlot(identity.playerId)
            : runtime.room.joinPlayer(identity.playerId);
        if (!assignedSlot) {
            this.emitEngineError(socket, 'ROOM_FULL', 'Room is full');
            return;
        }
        runtime.playerConnections.set(identity.playerId, existingConnections + 1);
        runtime.room.engine.registerPlayer(identity);
        socket.join(nextRoomId);
        socket.data.identity = identity;
        socket.data.roomId = nextRoomId;
        this.emitJoinSnapshot(socket, runtime, assignedSlot);
    }
    emitJoinSnapshot(socket, runtime, assignedSlot) {
        const joinPayload = {
            roomId: runtime.room.id,
            slot: assignedSlot,
            phase: runtime.room.getPhase(),
            hostPlayerId: runtime.room.getHostPlayerId(),
        };
        socket.emit('ROOM_JOINED', joinPayload);
        const fullEnvelope = {
            mode: 'full',
            gameState: runtime.projectedTickStream.getCurrentFullState(),
        };
        socket.emit('tick_update', fullEnvelope);
        const statePayload = this.serializeRoomGameState(runtime.room, runtime.room.engine.getStateSnapshot());
        socket.emit('SYNC_STATE', statePayload);
        socket.emit('GAME_STATE', statePayload);
        socket.emit('ROOM_PHASE_CHANGED', { phase: runtime.room.getPhase() });
        this.recordOutbound('socket.tick_update.full', fullEnvelope, 1);
    }
    handleActionSubmission(socket, payload) {
        const joinedContext = this.getJoinedContext(socket);
        if (!joinedContext) {
            this.emitEngineError(socket, 'NOT_IN_ROOM', '请先发送 JOIN_ROOM 加入房间');
            return;
        }
        const submission = (0, action_submission_1.submitAction)({
            engine: joinedContext.room.engine,
            limiter: this.actionLimiter,
            player: joinedContext.identity,
            payload,
        });
        if (!submission.ok) {
            this.emitEngineError(socket, submission.code, submission.message, submission.retryAfterMs);
            return;
        }
        const acceptedPayload = {
            ok: true,
            action: submission.action,
            rateLimitRemaining: submission.rateLimitRemaining,
        };
        socket.emit('ACTION_ACCEPTED', acceptedPayload);
        socket.emit('action_accepted', acceptedPayload);
    }
    handleBuildTower(socket, payload) {
        if (!isBuildTowerPayload(payload)) {
            this.emitEngineError(socket, 'BAD_PAYLOAD', '缺少必要参数 x、y、towerType');
            return;
        }
        this.handleActionSubmission(socket, {
            action: 'BUILD_TOWER',
            x: payload.x,
            y: payload.y,
            type: payload.towerType,
        });
    }
    handleStartMatch(socket) {
        const joinedContext = this.getJoinedContext(socket);
        if (!joinedContext) {
            this.emitEngineError(socket, 'NOT_IN_ROOM', '请先发送 JOIN_ROOM 加入房间');
            return;
        }
        const result = joinedContext.room.beginCountdown(joinedContext.identity.playerId, () => {
            const waitingPayload = { phase: 'waiting_for_level' };
            this.io.to(joinedContext.room.id).emit('ROOM_PHASE_CHANGED', waitingPayload);
        });
        if (result === 'forbidden') {
            this.emitEngineError(socket, 'FORBIDDEN', '只有房主可以启动游戏');
            return;
        }
        if (result === 'wrong_phase') {
            this.emitEngineError(socket, 'WRONG_PHASE', '当前房间状态不允许启动该操作');
            return;
        }
        const countdownPayload = {
            phase: 'countdown',
            durationMs: COUNTDOWN_DURATION_MS,
            remainingSeconds: COUNTDOWN_DURATION_MS / 1000,
        };
        this.io.to(joinedContext.room.id).emit('START_MATCH_ACCEPTED', countdownPayload);
        this.io.to(joinedContext.room.id).emit('ROOM_PHASE_CHANGED', countdownPayload);
        this.scheduleCountdownBroadcast(joinedContext.room);
    }
    handleSelectLevel(socket, payload) {
        const joinedContext = this.getJoinedContext(socket);
        if (!joinedContext) {
            this.emitEngineError(socket, 'NOT_IN_ROOM', '请先发送 JOIN_ROOM 加入房间');
            return;
        }
        if (joinedContext.room.getPhase() !== 'waiting_for_level') {
            this.emitEngineError(socket, 'WRONG_PHASE', '当前状态不接受难度选择，请等待倒计时完成');
            return;
        }
        if (joinedContext.identity.playerId !== joinedContext.room.getHostPlayerId()) {
            this.emitEngineError(socket, 'FORBIDDEN', '只有房主有权选择难度');
            return;
        }
        if (!isSelectLevelPayload(payload)) {
            this.emitEngineError(socket, 'BAD_PAYLOAD', '缺少必要参数 levelId');
            return;
        }
        const levelConfig = level_config_1.LEVEL_CONFIGS[payload.levelId];
        if (!levelConfig) {
            this.emitEngineError(socket, 'INVALID_LEVEL', `Level ${payload.levelId} 不存在`);
            return;
        }
        const playerType = joinedContext.identity.playerKind === 'human' ? 'HUMAN' : 'AGENT';
        const progress = this.progressStore.getOrCreate(joinedContext.identity.playerId, playerType);
        const unlockResult = (0, unlock_logic_1.checkUnlock)(progress, payload.levelId);
        if (!unlockResult.allowed) {
            this.emitEngineError(socket, 'LEVEL_LOCKED', unlockResult.reason);
            return;
        }
        if (!levelConfig.allowedPlayerKinds.includes(joinedContext.identity.playerKind)) {
            this.emitEngineError(socket, 'LEVEL_LOCKED', '当前玩家类型不允许进入该关卡');
            return;
        }
        if (payload.levelId === 6 && joinedContext.room.getPlayerCount() < 2) {
            this.emitEngineError(socket, 'COOP_REQUIRED', '零域裁决需至少两名物理终端协同');
            return;
        }
        joinedContext.room.igniteWithLevel(levelConfig.waves, levelConfig.startingGold);
        const levelSelectedPayload = {
            levelId: levelConfig.levelId,
            label: levelConfig.label,
            description: levelConfig.description,
            targetClearRate: levelConfig.targetClearRate,
            waveCount: levelConfig.waves.length,
            minPlayers: levelConfig.minPlayers,
        };
        this.io.to(joinedContext.room.id).emit('LEVEL_SELECTED', levelSelectedPayload);
        this.io.to(joinedContext.room.id).emit('ROOM_PHASE_CHANGED', { phase: 'playing', levelId: payload.levelId });
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
        const projectedTickStream = new projected_tick_stream_1.ProjectedTickStream(room.engine, this.config, this.telemetry);
        const loop = new game_loop_1.GameLoop(room.engine, this.config.tickRateMs);
        const runtime = {
            room,
            loop,
            projectedTickStream,
            playerConnections: new Map(),
            unsubscribeProjection: () => { },
        };
        runtime.unsubscribeProjection = projectedTickStream.subscribeTick((event) => {
            const recipientCount = this.io.sockets.adapter.rooms.get(room.id)?.size ?? 0;
            if (recipientCount === 0) {
                return;
            }
            const statePayload = this.serializeRoomGameState(room, event.state);
            this.io.to(room.id).emit('SYNC_STATE', statePayload);
            this.io.to(room.id).emit('GAME_STATE', statePayload);
            this.recordOutbound('socket.sync_state', statePayload, recipientCount);
            this.recordOutbound('socket.game_state', statePayload, recipientCount);
            if (!event.shouldSocketBroadcast || !event.broadcast) {
                return;
            }
            const tickEnvelope = {
                mode: 'patch',
                patch: event.broadcast.patch,
            };
            this.io.to(room.id).emit('tick_update', tickEnvelope);
            this.recordOutbound('socket.tick_update.patch', tickEnvelope, recipientCount);
            if (Object.keys(event.broadcast.uiUpdate).length > 0) {
                this.io.to(room.id).emit('ui_state_update', event.broadcast.uiUpdate);
                this.recordOutbound('socket.ui_state_update', event.broadcast.uiUpdate, recipientCount);
            }
            if (event.broadcast.noticeUpdate) {
                this.io.to(room.id).emit('notice_update', event.broadcast.noticeUpdate);
                this.recordOutbound('socket.notice_update', event.broadcast.noticeUpdate, recipientCount);
            }
        });
        loop.start();
        this.roomRuntimes.set(roomId, runtime);
        return runtime;
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
        const activeConnectionCount = runtime.playerConnections.get(identity.playerId) ?? 0;
        if (activeConnectionCount <= 1) {
            runtime.playerConnections.delete(identity.playerId);
            runtime.room.leavePlayer(identity.playerId);
            runtime.room.engine.markPlayerDisconnected(identity.playerId);
        }
        else {
            runtime.playerConnections.set(identity.playerId, activeConnectionCount - 1);
        }
        socket.leave(roomId);
        delete socket.data.roomId;
        delete socket.data.identity;
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
        const playerId = principal?.playerId ?? overrides?.playerId ?? readHandshakeValue(socket, 'playerId') ?? socket.id;
        const playerName = principal?.playerName ?? overrides?.playerName ?? readHandshakeValue(socket, 'playerName') ?? `player-${playerId.slice(0, 6)}`;
        const playerKind = principal?.playerKind ?? overrides?.playerKind ?? (readHandshakeValue(socket, 'playerKind') === 'agent' ? 'agent' : 'human');
        return {
            playerId,
            playerName,
            playerKind,
        };
    }
    serializeRoomGameState(room, state) {
        return {
            roomId: room.id,
            phase: room.getPhase(),
            tick: state.tick,
            status: state.status,
            enemies: state.enemies,
            towers: state.towers,
            gold: state.players.reduce((sum, player) => sum + player.gold, 0),
            playerGold: state.players.map((player) => ({
                playerId: player.id,
                slot: room.getPlayerSlot(player.id),
                gold: player.gold,
            })),
            currentWave: state.wave,
            overloadTicks: state.overloadTicks,
        };
    }
    emitEngineError(socket, code, message, retryAfterMs) {
        socket.emit('engine_error', {
            code,
            message,
            retryAfterMs,
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
