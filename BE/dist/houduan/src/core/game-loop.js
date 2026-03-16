"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameLoop = void 0;
class GameLoop {
    engine;
    tickRateMs;
    timer = null;
    constructor(engine, tickRateMs) {
        this.engine = engine;
        this.tickRateMs = tickRateMs;
    }
    start() {
        if (this.timer) {
            return;
        }
        this.timer = setInterval(() => {
            this.engine.tick();
        }, this.tickRateMs);
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
