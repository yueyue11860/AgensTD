"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.submitAction = submitAction;
const actions_1 = require("../domain/actions");
function normalizeActionPayload(payload) {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        return payload;
    }
    if ('payload' in payload) {
        return payload.payload;
    }
    return payload;
}
function readRequestId(payload) {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        return null;
    }
    const requestId = payload.requestId;
    return typeof requestId === 'string' && requestId.length > 0 ? requestId : null;
}
function submitAction({ engine, limiter, player, payload }) {
    const parsedAction = (0, actions_1.parseClientAction)(normalizeActionPayload(payload));
    if (!parsedAction) {
        return {
            ok: false,
            status: 400,
            code: 'INVALID_ACTION_PAYLOAD',
            message: 'Invalid action payload',
        };
    }
    const requestId = readRequestId(payload);
    if (requestId) {
        const previous = engine.resolveActionRequest(player.playerId, requestId, parsedAction);
        if (previous.status === 'conflict') {
            return {
                ok: false,
                status: 409,
                code: 'REQUEST_ID_CONFLICT',
                message: 'requestId was already used with a different action payload',
            };
        }
        if (previous.status === 'replay') {
            return {
                ok: true,
                action: parsedAction,
                requestId,
                actionId: previous.actionId,
                serverTick: previous.serverTick,
                rateLimitRemaining: previous.rateLimitRemaining,
                duplicate: true,
            };
        }
    }
    const limitDecision = limiter.consume(player.playerId);
    if (!limitDecision.allowed) {
        return {
            ok: false,
            status: 429,
            code: 'RATE_LIMITED',
            message: 'Action rate limit exceeded',
            retryAfterMs: limitDecision.retryAfterMs,
        };
    }
    const queued = engine.enqueueAction(player, parsedAction, requestId, limitDecision.remaining);
    return {
        ok: true,
        action: parsedAction,
        requestId,
        actionId: queued.actionId,
        serverTick: queued.serverTick,
        rateLimitRemaining: limitDecision.remaining,
        duplicate: false,
    };
}
