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
    engine.enqueueAction(player, parsedAction);
    return {
        ok: true,
        action: parsedAction,
        rateLimitRemaining: limitDecision.remaining,
    };
}
