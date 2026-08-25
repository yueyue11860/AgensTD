"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryPlayerAccountStore = void 0;
function clone(value) {
    return structuredClone(value);
}
/** 与持久化存储保持一致 CAS 语义的内存实现。 */
class MemoryPlayerAccountStore {
    records = new Map();
    isEnabled() {
        return true;
    }
    async get(playerId) {
        const value = this.records.get(playerId);
        return value ? clone(value) : null;
    }
    async createIfAbsent(account) {
        const existing = this.records.get(account.playerId);
        if (existing)
            return clone(existing);
        const stored = clone(account);
        this.records.set(account.playerId, stored);
        return clone(stored);
    }
    async compareAndSwap(playerId, expectedVersion, next) {
        const current = this.records.get(playerId);
        if (!current || current.version !== expectedVersion)
            return false;
        if (next.playerId !== playerId || next.version !== expectedVersion + 1)
            return false;
        this.records.set(playerId, clone(next));
        return true;
    }
}
exports.MemoryPlayerAccountStore = MemoryPlayerAccountStore;
