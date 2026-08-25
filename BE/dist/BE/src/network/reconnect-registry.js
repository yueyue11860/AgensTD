"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlayerReconnectRegistry = void 0;
/**
 * 房间内玩家连接租约。每个 playerId 只允许一个权威 socket，generation
 * 让旧 socket 的迟到 disconnect 无法影响更新的连接。
 */
class PlayerReconnectRegistry {
    options;
    active = new Map();
    pending = new Map();
    generations = new Map();
    departing = new Set();
    now;
    constructor(options) {
        this.options = options;
        this.now = options.now ?? Date.now;
    }
    attach(playerId, socketId) {
        if (this.departing.has(playerId)) {
            return { ok: false, reconnected: false, supersededSocketId: null, reason: 'DEPARTURE_IN_PROGRESS' };
        }
        const previous = this.active.get(playerId);
        const pending = this.pending.get(playerId);
        if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(playerId);
        }
        const generation = (this.generations.get(playerId) ?? 0) + 1;
        this.generations.set(playerId, generation);
        const lease = { playerId, socketId, generation };
        this.active.set(playerId, lease);
        return {
            ok: true,
            lease,
            reconnected: Boolean(pending || previous),
            supersededSocketId: previous && previous.socketId !== socketId ? previous.socketId : null,
        };
    }
    detach(playerId, socketId, generation) {
        const active = this.active.get(playerId);
        if (!active || active.socketId !== socketId || active.generation !== generation) {
            return { startedGrace: false, stale: true };
        }
        this.active.delete(playerId);
        const deadlineAt = this.now() + this.options.graceMs;
        const pending = {
            ...active,
            deadlineAt,
            timer: setTimeout(() => this.expire(active, deadlineAt), this.options.graceMs),
        };
        this.pending.set(playerId, pending);
        const publicPending = this.publicPending(pending);
        this.options.onGraceStarted?.(publicPending);
        return { startedGrace: true, stale: false, pending: publicPending };
    }
    isCurrent(playerId, socketId, generation) {
        const active = this.active.get(playerId);
        return active?.socketId === socketId && active.generation === generation;
    }
    getPending(playerId) {
        const pending = this.pending.get(playerId);
        return pending ? this.publicPending(pending) : null;
    }
    completeDeparture(playerId) {
        this.departing.delete(playerId);
    }
    shutdown() {
        for (const pending of this.pending.values())
            clearTimeout(pending.timer);
        this.pending.clear();
        this.active.clear();
        this.departing.clear();
    }
    expire(lease, deadlineAt) {
        const pending = this.pending.get(lease.playerId);
        if (!pending || pending.socketId !== lease.socketId || pending.generation !== lease.generation)
            return;
        if (this.generations.get(lease.playerId) !== lease.generation || this.active.has(lease.playerId))
            return;
        this.pending.delete(lease.playerId);
        this.departing.add(lease.playerId);
        this.options.onExpired({ ...lease, deadlineAt });
    }
    publicPending(pending) {
        const { timer: _timer, ...value } = pending;
        return value;
    }
}
exports.PlayerReconnectRegistry = PlayerReconnectRegistry;
