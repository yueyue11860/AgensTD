"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SocketGateway = void 0;
const socket_io_1 = require("socket.io");
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
class SocketGateway {
    telemetry;
    actionLimiter;
    progressStore;
    io;
    config;
    room;
    projectedTickStream;
    constructor(httpServer, room, config, projectedTickStream, telemetry, actionLimiter, progressStore) {
        this.telemetry = telemetry;
        this.actionLimiter = actionLimiter;
        this.progressStore = progressStore;
        this.config = config;
        this.room = room;
        this.projectedTickStream = projectedTickStream;
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
        this.projectedTickStream.subscribeTick((event) => {
            if (!event.shouldSocketBroadcast || !event.broadcast) {
                return;
            }
            const recipientCount = this.io.sockets.sockets.size;
            if (recipientCount === 0) {
                return;
            }
            const tickEnvelope = {
                mode: 'patch',
                patch: event.broadcast.patch,
            };
            this.io.emit('tick_update', tickEnvelope);
            this.recordOutbound('socket.tick_update.patch', tickEnvelope, recipientCount);
            if (Object.keys(event.broadcast.uiUpdate).length > 0) {
                this.io.emit('ui_state_update', event.broadcast.uiUpdate);
                this.recordOutbound('socket.ui_state_update', event.broadcast.uiUpdate, recipientCount);
            }
            if (event.broadcast.noticeUpdate) {
                this.io.emit('notice_update', event.broadcast.noticeUpdate);
                this.recordOutbound('socket.notice_update', event.broadcast.noticeUpdate, recipientCount);
            }
        });
    }
    handleConnection(socket) {
        const identity = this.resolvePlayerIdentity(socket);
        const assignedSlot = this.room.joinPlayer(identity.playerId);
        if (!assignedSlot) {
            socket.emit('engine_error', {
                code: 'ROOM_FULL',
                message: 'Room is full',
            });
            socket.disconnect(true);
            return;
        }
        this.room.engine.registerPlayer(identity);
        this.telemetry.setGauge('socket.connections', this.io.sockets.sockets.size);
        socket.emit('room_joined', {
            roomId: this.room.id,
            slot: assignedSlot,
        });
        const fullEnvelope = {
            mode: 'full',
            gameState: this.projectedTickStream.getCurrentFullState(),
        };
        socket.emit('tick_update', fullEnvelope);
        this.recordOutbound('socket.tick_update.full', fullEnvelope, 1);
        socket.on('send_action', (payload) => {
            const submission = (0, action_submission_1.submitAction)({
                engine: this.room.engine,
                limiter: this.actionLimiter,
                player: identity,
                payload,
            });
            if (!submission.ok) {
                socket.emit('engine_error', {
                    code: submission.code,
                    message: submission.message,
                    retryAfterMs: submission.retryAfterMs,
                });
                return;
            }
            socket.emit('action_accepted', {
                ok: true,
                action: submission.action,
                rateLimitRemaining: submission.rateLimitRemaining,
            });
        });
        // ── start_game: 房主按下开始——倒计时3秒────────────────────────────────
        socket.on('start_game', () => {
            const result = this.room.beginCountdown(identity.playerId, () => {
                // 3 秒后自动切入「等待选择难度」模式，向全房广播
                this.io.emit('room_phase_changed', { phase: 'waiting_for_level' });
            });
            if (result === 'forbidden') {
                socket.emit('engine_error', {
                    code: 'FORBIDDEN',
                    message: '只有房主可以启动游戏',
                });
                return;
            }
            if (result === 'wrong_phase') {
                socket.emit('engine_error', {
                    code: 'WRONG_PHASE',
                    message: '当前房间状态不允许启动该操作',
                });
                return;
            }
            // 广播倒计旷开始
            this.io.emit('room_phase_changed', { phase: 'countdown', durationMs: 3000 });
        });
        // ── select_level: 房主注入难度——校验全部通过后点火引擎─────────────
        socket.on('select_level', (payload) => {
            // 1. phase 校验
            if (this.room.getPhase() !== 'waiting_for_level') {
                socket.emit('engine_error', {
                    code: 'WRONG_PHASE',
                    message: '当前状态不接受难度选择，请等倒计旷完成',
                });
                return;
            }
            // 2. 房主权限校验
            if (identity.playerId !== this.room.getHostPlayerId()) {
                socket.emit('engine_error', {
                    code: 'FORBIDDEN',
                    message: '只有房主有权选择难度',
                });
                return;
            }
            // 3. 解析 payload
            if (typeof payload !== 'object'
                || payload === null
                || typeof payload.levelId !== 'number') {
                socket.emit('engine_error', {
                    code: 'BAD_PAYLOAD',
                    message: '缺少必要参数 levelId',
                });
                return;
            }
            const levelId = payload.levelId;
            // 4. 进度/解锁校验
            const playerType = identity.playerKind === 'human' ? 'HUMAN' : 'AGENT';
            const progress = this.progressStore.getOrCreate(identity.playerId, playerType);
            const unlockResult = (0, unlock_logic_1.checkUnlock)(progress, levelId);
            if (!unlockResult.allowed) {
                socket.emit('engine_error', {
                    code: 'LEVEL_LOCKED',
                    message: unlockResult.reason,
                });
                return;
            }
            // 5. 隱藏关人数校验
            if (levelId === 6 && this.room.getPlayerCount() < 2) {
                socket.emit('engine_error', {
                    code: 'COOP_REQUIRED',
                    message: '零域裁决需至少两名物理终端协同',
                });
                return;
            }
            // 6. 获取关卡配置
            const levelConfig = level_config_1.LEVEL_CONFIGS[levelId];
            if (!levelConfig) {
                socket.emit('engine_error', {
                    code: 'INVALID_LEVEL',
                    message: `Level ${levelId} 不存在`,
                });
                return;
            }
            // 7. 点火引擎
            this.room.igniteWithLevel(levelConfig.waves, levelConfig.startingGold);
            // 8. 广播 LEVEL_SELECTED + 状态变化
            const levelSelectedPayload = {
                levelId: levelConfig.levelId,
                label: levelConfig.label,
                description: levelConfig.description,
                targetClearRate: levelConfig.targetClearRate,
                waveCount: levelConfig.waves.length,
                minPlayers: levelConfig.minPlayers,
            };
            this.io.emit('level_selected', levelSelectedPayload);
            this.io.emit('room_phase_changed', { phase: 'playing', levelId });
        });
        socket.on('disconnect', () => {
            this.room.leavePlayer(identity.playerId);
            this.room.engine.markPlayerDisconnected(identity.playerId);
            this.telemetry.setGauge('socket.connections', this.io.sockets.sockets.size);
        });
    }
    resolvePlayerIdentity(socket) {
        const principal = socket.data.principal;
        const playerId = principal?.playerId ?? readHandshakeValue(socket, 'playerId') ?? socket.id;
        const playerName = principal?.playerName ?? readHandshakeValue(socket, 'playerName') ?? `player-${playerId.slice(0, 6)}`;
        const playerKind = principal?.playerKind ?? (readHandshakeValue(socket, 'playerKind') === 'agent' ? 'agent' : 'human');
        return {
            playerId,
            playerName,
            playerKind,
        };
    }
    recordOutbound(metricName, payload, recipientCount) {
        const payloadBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
        this.telemetry.incrementCounter(`${metricName}.messages`, 1);
        this.telemetry.incrementCounter(`${metricName}.bytes`, payloadBytes * recipientCount);
        this.telemetry.setGauge(`${metricName}.lastPayloadBytes`, payloadBytes);
    }
}
exports.SocketGateway = SocketGateway;
