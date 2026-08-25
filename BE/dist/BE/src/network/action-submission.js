"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.submitDurablePveAction = submitDurablePveAction;
exports.submitAction = submitAction;
const actions_1 = require("../domain/actions");
async function submitDurablePveAction(input) {
    const parsedAction = (0, actions_1.parseClientAction)(normalizeActionPayload(input.payload));
    if (!parsedAction)
        return { ok: false, status: 400, code: 'INVALID_ACTION_PAYLOAD', message: 'Invalid action payload' };
    const requestId = readRequestId(input.payload);
    if (!requestId)
        return {
            ok: false, status: 400, code: 'REQUEST_ID_REQUIRED',
            message: 'PVE actions require a stable requestId for durable idempotency',
        };
    const previous = await input.checkpointCoordinator.findAction({
        room: input.room, playerId: input.player.playerId, requestId, action: parsedAction,
    });
    if (previous?.status === 'conflict')
        return {
            ok: false, status: 409, code: 'REQUEST_ID_CONFLICT', message: 'requestId was already used with a different action payload',
        };
    if (previous?.status === 'duplicate')
        return {
            ok: true, action: parsedAction, requestId, actionId: previous.record.actionId,
            serverTick: previous.record.serverTick, rateLimitRemaining: previous.record.rateLimitRemaining, duplicate: true,
        };
    const limitDecision = input.limiter.consume(input.player.playerId);
    if (!limitDecision.allowed)
        return {
            ok: false, status: 429, code: 'RATE_LIMITED', message: 'Action rate limit exceeded', retryAfterMs: limitDecision.retryAfterMs,
        };
    const reserved = await input.checkpointCoordinator.reserveAction({
        room: input.room, player: input.player, requestId, action: parsedAction, rateLimitRemaining: limitDecision.remaining,
    });
    if (reserved.status === 'conflict')
        return {
            ok: false, status: 409, code: 'REQUEST_ID_CONFLICT', message: 'requestId was already used with a different action payload',
        };
    if (reserved.status === 'duplicate')
        return {
            ok: true, action: parsedAction, requestId, actionId: reserved.record.actionId,
            serverTick: reserved.record.serverTick, rateLimitRemaining: reserved.record.rateLimitRemaining, duplicate: true,
        };
    input.engine.enqueueDurableAction({
        player: input.player, action: parsedAction, requestId, actionId: reserved.record.actionId,
        rateLimitRemaining: reserved.record.rateLimitRemaining,
    });
    return {
        ok: true, action: parsedAction, requestId, actionId: reserved.record.actionId,
        serverTick: reserved.record.serverTick, rateLimitRemaining: reserved.record.rateLimitRemaining, duplicate: false,
    };
}
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
