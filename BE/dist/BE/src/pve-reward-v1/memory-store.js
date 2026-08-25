"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryPveRewardStore = void 0;
const store_1 = require("./store");
const clone = (value) => structuredClone(value);
const nowIso = () => new Date().toISOString();
/** 与 Supabase 适配器保持相同幂等/冲突语义的开发与测试存储。 */
class MemoryPveRewardStore {
    batches = new Map();
    settlements = new Map();
    isEnabled() { return true; }
    async getBatch(batchKey) {
        const value = this.batches.get(batchKey);
        return value ? clone(value) : null;
    }
    async recordBatch(batch) {
        const existing = this.batches.get(batch.batchKey);
        if (existing) {
            if (existing.fingerprint !== batch.fingerprint) {
                throw new store_1.PveRewardStoreConflictError('REWARD_BATCH_CONFLICT', `Reward batch ${batch.batchKey} conflicts with stored facts`);
            }
            return { duplicate: true, batch: clone(existing) };
        }
        this.batches.set(batch.batchKey, clone(batch));
        return { duplicate: false, batch: clone(batch) };
    }
    async listPlayerBatches(matchId, playerId) {
        return [...this.batches.values()]
            .filter(batch => batch.matchId === matchId && batch.playerId === playerId)
            .sort((left, right) => left.batchKey.localeCompare(right.batchKey))
            .map(clone);
    }
    async prepareSettlement(command, fingerprint) {
        const existing = this.settlements.get(command.settlementId);
        if (existing) {
            if (existing.fingerprint !== fingerprint) {
                throw new store_1.PveRewardStoreConflictError('SETTLEMENT_CONFLICT', `Settlement ${command.settlementId} conflicts with stored facts`);
            }
            if (existing.status === 'committed')
                return clone(existing);
            const retried = { ...existing, status: 'pending', attempts: existing.attempts + 1, updatedAt: nowIso() };
            this.settlements.set(command.settlementId, clone(retried));
            return clone(retried);
        }
        const at = nowIso();
        const created = {
            ...clone(command), fingerprint, status: 'pending', attempts: 1, lastError: null,
            settlement: null, createdAt: at, updatedAt: at,
        };
        this.settlements.set(command.settlementId, clone(created));
        return clone(created);
    }
    async markSettlementCommitted(settlementId, settlement, detail) {
        const current = this.requireSettlement(settlementId);
        const next = { ...current, status: 'committed', lastError: null, settlement: clone(settlement), ...(detail ? { detail: clone(detail) } : {}), updatedAt: nowIso() };
        this.settlements.set(settlementId, clone(next));
        return clone(next);
    }
    async markSettlementFailed(settlementId, error) {
        const current = this.requireSettlement(settlementId);
        if (current.status === 'committed')
            return clone(current);
        const next = { ...current, status: 'failed', lastError: error.slice(0, 2000), updatedAt: nowIso() };
        this.settlements.set(settlementId, clone(next));
        return clone(next);
    }
    async getSettlement(settlementId) {
        const value = this.settlements.get(settlementId);
        return value ? clone(value) : null;
    }
    async listRecoverableSettlements(limit = 100) {
        return [...this.settlements.values()]
            .filter(record => record.status !== 'committed')
            .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
            .slice(0, limit)
            .map(clone);
    }
    requireSettlement(settlementId) {
        const value = this.settlements.get(settlementId);
        if (!value)
            throw new Error(`Settlement ${settlementId} is missing`);
        return value;
    }
}
exports.MemoryPveRewardStore = MemoryPveRewardStore;
