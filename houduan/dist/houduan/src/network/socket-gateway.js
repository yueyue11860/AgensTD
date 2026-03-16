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
    engine;
    actionLimiter;
    io;
    config;
    constructor(httpServer, engine, config, actionLimiter) {
        this.engine = engine;
        this.actionLimiter = actionLimiter;
        this.config = config;
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
        this.engine.onTick((state) => {
            this.io.emit('tick_update', (0, state_projection_1.projectFrontendGameState)(state, this.config));
        });
    }
    handleConnection(socket) {
        const identity = this.resolvePlayerIdentity(socket);
        this.engine.registerPlayer(identity);
        socket.emit('tick_update', (0, state_projection_1.projectFrontendGameState)(this.engine.getStateSnapshot(), this.config));
        socket.on('send_action', (payload) => {
            const submission = (0, action_submission_1.submitAction)({
                engine: this.engine,
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
            this.engine.markPlayerDisconnected(identity.playerId);
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
