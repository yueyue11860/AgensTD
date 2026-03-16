"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SocketGateway = void 0;
const socket_io_1 = require("socket.io");
const action_submission_1 = require("./action-submission");
const gateway_auth_1 = require("./gateway-auth");
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
    io;
    config;
    room;
    projectedTickStream;
    constructor(httpServer, room, config, projectedTickStream, telemetry, actionLimiter) {
        this.telemetry = telemetry;
        this.actionLimiter = actionLimiter;
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
