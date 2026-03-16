"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SocketGateway = void 0;
const socket_io_1 = require("socket.io");
const state_projection_1 = require("../core/state-projection");
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
    actionLimiter;
    io;
    config;
    room;
    broadcastEveryTicks;
    lastBroadcastState = null;
    constructor(httpServer, room, config, actionLimiter) {
        this.actionLimiter = actionLimiter;
        this.config = config;
        this.room = room;
        this.broadcastEveryTicks = Math.max(1, Math.round(config.broadcastIntervalMs / Math.max(1, config.tickRateMs)));
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
        this.room.engine.onTick((state) => {
            if (state.status !== 'finished' && state.tick % this.broadcastEveryTicks !== 0) {
                return;
            }
            const uiUpdate = (0, state_projection_1.projectFrontendUiStateUpdate)(state, this.config, this.lastBroadcastState);
            const patch = (0, state_projection_1.projectFrontendGameStatePatch)(state, this.config, this.lastBroadcastState);
            this.lastBroadcastState = mergeFrontendUiStateUpdate(mergeFrontendGameStatePatch(this.lastBroadcastState, patch), uiUpdate);
            this.io.emit('tick_update', {
                mode: 'patch',
                patch,
            });
            if (Object.keys(uiUpdate).length > 0) {
                this.io.emit('ui_state_update', uiUpdate);
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
        socket.emit('room_joined', {
            roomId: this.room.id,
            slot: assignedSlot,
        });
        const fullState = (0, state_projection_1.projectFrontendGameState)(this.room.engine.getStateSnapshot(), this.config);
        this.lastBroadcastState = fullState;
        socket.emit('tick_update', {
            mode: 'full',
            gameState: fullState,
        });
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
}
exports.SocketGateway = SocketGateway;
function mergeFrontendGameStatePatch(previousState, patch) {
    if (!previousState) {
        return null;
    }
    return {
        ...previousState,
        ...patch,
        towers: patch.towers ?? applyEntityDelta(previousState.towers, patch.towerDelta),
        enemies: patch.enemies ?? applyEntityDelta(previousState.enemies, patch.enemyDelta),
        map: patch.map ?? previousState.map,
        notices: patch.notices ?? previousState.notices,
    };
}
function mergeFrontendUiStateUpdate(previousState, update) {
    if (!previousState) {
        return null;
    }
    return {
        ...previousState,
        buildPalette: update.buildPalette ?? previousState.buildPalette,
        actionBar: update.actionBar ?? previousState.actionBar,
    };
}
function applyEntityDelta(currentEntities, delta) {
    if (!delta) {
        return currentEntities;
    }
    const removeIds = new Set(delta.remove);
    const upsertById = new Map(delta.upsert.map((entity) => [entity.id, entity]));
    const nextEntities = [];
    for (const entity of currentEntities) {
        if (removeIds.has(entity.id)) {
            continue;
        }
        nextEntities.push(upsertById.get(entity.id) ?? entity);
        upsertById.delete(entity.id);
    }
    for (const entity of delta.upsert) {
        if (upsertById.has(entity.id)) {
            nextEntities.push(entity);
            upsertById.delete(entity.id);
        }
    }
    return nextEntities;
}
