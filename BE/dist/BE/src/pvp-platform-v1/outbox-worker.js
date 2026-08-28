"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PvpRewardOutboxWorker = void 0;
class PvpRewardOutboxWorker {
    store;
    workerId;
    pollIntervalMs;
    leaseMs;
    batchSize;
    apply;
    now;
    timer = null;
    running = false;
    constructor(store, options = {}) {
        this.store = store;
        this.workerId = options.workerId ?? `pvp-reward-worker:${process.pid}`;
        this.pollIntervalMs = Math.max(50, Math.floor(options.pollIntervalMs ?? 1_000));
        this.leaseMs = Math.max(1_000, Math.floor(options.leaseMs ?? 30_000));
        this.batchSize = Math.max(1, Math.min(100, Math.floor(options.batchSize ?? 20)));
        this.apply = options.apply ?? (async () => undefined);
        this.now = options.now ?? (() => new Date());
    }
    start() {
        if (this.running)
            return;
        this.running = true;
        void this.drain().catch((error) => this.reportPollError(error));
        this.timer = setInterval(() => {
            void this.drain().catch((error) => this.reportPollError(error));
        }, this.pollIntervalMs);
        this.timer.unref?.();
    }
    async drain() {
        if (!this.running && this.timer)
            return { claimed: 0, completed: 0, failed: 0 };
        const at = this.now();
        const events = await this.store.claimRewardOutbox(this.workerId, this.batchSize, at.toISOString(), this.leaseMs);
        let completed = 0;
        let failed = 0;
        for (const event of events) {
            try {
                await this.apply(event);
                if (await this.store.completeRewardOutbox(event.eventId, this.workerId, this.now().toISOString()))
                    completed += 1;
            }
            catch (error) {
                failed += 1;
                const message = error instanceof Error ? error.message : String(error);
                const delay = Math.min(60_000, 1_000 * 2 ** Math.min(event.attempts, 6));
                await this.store.failRewardOutbox(event.eventId, this.workerId, message, new Date(this.now().getTime() + delay).toISOString());
            }
        }
        return { claimed: events.length, completed, failed };
    }
    async stop() {
        this.running = false;
        if (this.timer)
            clearInterval(this.timer);
        this.timer = null;
        // Expired leases are intentionally reclaimed by the next worker instance.
    }
    reportPollError(error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`PVP reward outbox poll failed: ${message}`);
    }
}
exports.PvpRewardOutboxWorker = PvpRewardOutboxWorker;
