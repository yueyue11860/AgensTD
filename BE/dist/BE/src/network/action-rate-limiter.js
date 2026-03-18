"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActionRateLimiter = void 0;
class ActionRateLimiter {
    windowMs;
    maxActions;
    windows = new Map();
    constructor(windowMs, maxActions) {
        this.windowMs = windowMs;
        this.maxActions = maxActions;
    }
    consume(key, now = Date.now()) {
        const cutoff = now - this.windowMs;
        const existing = (this.windows.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
        if (existing.length >= this.maxActions) {
            const retryAfterMs = Math.max(existing[0] + this.windowMs - now, 0);
            this.windows.set(key, existing);
            return {
                allowed: false,
                retryAfterMs,
                remaining: 0,
            };
        }
        existing.push(now);
        this.windows.set(key, existing);
        return {
            allowed: true,
            retryAfterMs: 0,
            remaining: Math.max(this.maxActions - existing.length, 0),
        };
    }
}
exports.ActionRateLimiter = ActionRateLimiter;
