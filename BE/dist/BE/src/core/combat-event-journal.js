"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CombatEventJournal = void 0;
const game_1 = require("../../../shared/contracts/game");
const EVENT_SEQUENCE_PATTERN = /^event-(\d+)$/;
class CombatEventJournal {
    retentionLimit;
    matchId = null;
    publishedSeq = 0;
    highestSeq = 0;
    retained = new Map();
    constructor(retentionLimit = 1_024) {
        this.retentionLimit = retentionLimit;
    }
    baseline(matchId, events) {
        this.observe(matchId, events);
        this.publishedSeq = this.highestSeq;
    }
    observe(matchId, events) {
        if (this.matchId !== matchId)
            this.reset(matchId);
        for (const event of events) {
            const parsed = EVENT_SEQUENCE_PATTERN.exec(event.id);
            const parsedSeq = parsed ? Number(parsed[1]) : Number.NaN;
            const seq = Number.isSafeInteger(parsedSeq) && parsedSeq > 0
                ? parsedSeq
                : this.highestSeq + 1;
            if (this.retained.has(seq))
                continue;
            this.retained.set(seq, { ...structuredClone(event), seq });
            this.highestSeq = Math.max(this.highestSeq, seq);
        }
        this.trim();
    }
    drain() {
        if (!this.matchId || this.highestSeq <= this.publishedSeq)
            return null;
        const events = [...this.retained.values()]
            .filter((event) => event.seq > this.publishedSeq)
            .sort((left, right) => left.seq - right.seq);
        if (!events.length)
            return null;
        const batch = this.toBatch(events);
        this.publishedSeq = batch.toSeq;
        return batch;
    }
    replayFrom(fromSeq) {
        if (!this.matchId || !Number.isSafeInteger(fromSeq) || fromSeq < 1)
            return null;
        const events = [...this.retained.values()]
            .filter((event) => event.seq >= fromSeq)
            .sort((left, right) => left.seq - right.seq);
        if (!events.length || events[0].seq !== fromSeq)
            return null;
        return this.toBatch(events);
    }
    cursor() {
        return {
            matchId: this.matchId,
            presentationVersion: game_1.COMBAT_PRESENTATION_VERSION,
            eventSeq: this.highestSeq,
            earliestRetainedSeq: this.retained.size ? Math.min(...this.retained.keys()) : this.highestSeq + 1,
        };
    }
    toBatch(events) {
        return {
            matchId: this.matchId,
            presentationVersion: game_1.COMBAT_PRESENTATION_VERSION,
            fromSeq: events[0].seq,
            toSeq: events[events.length - 1].seq,
            events,
        };
    }
    reset(matchId) {
        this.matchId = matchId;
        this.publishedSeq = 0;
        this.highestSeq = 0;
        this.retained.clear();
    }
    trim() {
        if (this.retained.size <= this.retentionLimit)
            return;
        const ordered = [...this.retained.keys()].sort((left, right) => left - right);
        for (const seq of ordered.slice(0, ordered.length - this.retentionLimit))
            this.retained.delete(seq);
    }
}
exports.CombatEventJournal = CombatEventJournal;
