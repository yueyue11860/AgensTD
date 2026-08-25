"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PveRewardLedger = exports.PveRewardLedgerError = void 0;
const clone = (value) => structuredClone(value);
class PveRewardLedgerError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'PveRewardLedgerError';
    }
}
exports.PveRewardLedgerError = PveRewardLedgerError;
/**
 * 单进程权威奖励账本。持久化适配器后续可复用相同的 batchKey/eventId 约束；
 * 当前实现确保同一房间内重复波次事件和重复胜利事件不会重复发奖。
 */
class PveRewardLedger {
    batches = new Map();
    events = new Map();
    readBatch(batchKey, fingerprint) {
        const existing = this.batches.get(batchKey);
        if (!existing)
            return null;
        if (existing.fingerprint !== fingerprint) {
            throw new PveRewardLedgerError('REWARD_BATCH_CONFLICT', `Reward batch ${batchKey} was reused with different facts`);
        }
        return { batchKey, duplicate: true, events: clone(existing.events) };
    }
    recordBatch(batchKey, fingerprint, events) {
        const replay = this.readBatch(batchKey, fingerprint);
        if (replay)
            return replay;
        const eventIds = new Set();
        for (const event of events) {
            if (eventIds.has(event.eventId) || this.events.has(event.eventId)) {
                throw new PveRewardLedgerError('REWARD_EVENT_CONFLICT', `Duplicate reward event ${event.eventId}`);
            }
            eventIds.add(event.eventId);
        }
        const stored = clone(events);
        this.batches.set(batchKey, { fingerprint, events: stored });
        for (const event of stored)
            this.events.set(event.eventId, event);
        return { batchKey, duplicate: false, events: clone(stored) };
    }
    getPlayerEvents(matchId, playerId) {
        return [...this.events.values()]
            .filter((event) => event.matchId === matchId && event.playerId === playerId)
            .sort((left, right) => left.eventId.localeCompare(right.eventId))
            .map(clone);
    }
    getPlayerFragmentBalances(matchId, playerId) {
        const balances = {};
        for (const event of this.getPlayerEvents(matchId, playerId)) {
            balances[event.weaponId] = (balances[event.weaponId] ?? 0) + event.amount;
        }
        return balances;
    }
    freezePlayerRewards(matchId, playerId) {
        const events = this.getPlayerEvents(matchId, playerId);
        return Object.freeze({
            matchId,
            playerId,
            rewardEventIds: Object.freeze(events.map((event) => event.eventId)),
            fragmentBalances: Object.freeze({ ...this.getPlayerFragmentBalances(matchId, playerId) }),
        });
    }
}
exports.PveRewardLedger = PveRewardLedger;
