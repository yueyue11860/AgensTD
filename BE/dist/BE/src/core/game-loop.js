"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameLoop = void 0;
class GameLoop {
    engine;
    timer = null;
    intervalMs;
    constructor(engine, tickRateMs) {
        this.engine = engine;
        this.intervalMs = tickRateMs;
    }
    start() {
        if (this.timer) {
            return;
        }
        this.timer = setInterval(() => this.engine.tick(), this.intervalMs);
    }
    setIntervalMs(intervalMs) {
        const next = Math.max(1, Math.round(intervalMs));
        if (next === this.intervalMs)
            return;
        const running = this.timer !== null;
        this.stop();
        this.intervalMs = next;
        if (running)
            this.start();
    }
    getIntervalMs() {
        return this.intervalMs;
    }
    stop() {
        if (!this.timer) {
            return;
        }
        clearInterval(this.timer);
        this.timer = null;
    }
}
exports.GameLoop = GameLoop;
