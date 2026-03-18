"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReplayRecorder = void 0;
const competition_projection_1 = require("./competition-projection");
class ReplayRecorder {
    config;
    store;
    telemetry;
    maxFrames;
    maxActions;
    replay = null;
    isPersisting = false;
    hasLoggedPersistenceFailure = false;
    constructor(engine, projectedTickStream, config, store = null, telemetry = null, maxFrames = config.replayMaxFrames, maxActions = config.replayMaxActions) {
        this.config = config;
        this.store = store;
        this.telemetry = telemetry;
        this.maxFrames = maxFrames;
        this.maxActions = maxActions;
        projectedTickStream.subscribeTick(({ state, fullState }) => {
            this.recordFrame({
                tick: state.tick,
                recordedAt: new Date().toISOString(),
                gameState: fullState,
            });
            if (state.tick > 0 && state.tick % this.config.persistenceFlushEveryTicks === 0) {
                const flushPromise = this.telemetry
                    ? this.telemetry.measureAsync('replay.flush', async () => this.flush(state))
                    : this.flush(state);
                void flushPromise.catch((error) => {
                    this.logPersistenceFailure('periodic flush', error);
                });
            }
        });
        engine.onActionQueued((queuedAction) => {
            this.recordAction({
                id: queuedAction.id,
                receivedAt: queuedAction.receivedAt,
                player: queuedAction.player,
                action: queuedAction.action,
            });
        });
    }
    getCurrentReplay() {
        return this.replay ? structuredClone(this.replay) : null;
    }
    async flushLatest() {
        if (!this.store?.isEnabled()) {
            return;
        }
        const replay = this.getCurrentReplay();
        if (!replay) {
            return;
        }
        if (this.telemetry) {
            await this.telemetry.measureAsync('replay.flushLatest', async () => this.flushReplay(replay));
            return;
        }
        await this.flushReplay(replay);
    }
    ensureReplay(matchId) {
        if (!this.replay || this.replay.matchId !== matchId) {
            const now = new Date().toISOString();
            this.replay = {
                matchId,
                createdAt: now,
                updatedAt: now,
                actions: [],
                frames: [],
            };
        }
        return this.replay;
    }
    recordFrame(frame) {
        const replay = this.ensureReplay(frame.gameState.matchId ?? 'unknown-match');
        replay.frames.push(frame);
        replay.frames = replay.frames.slice(-this.maxFrames);
        replay.updatedAt = frame.recordedAt;
    }
    recordAction(action) {
        const replay = this.ensureReplay(this.config.matchId);
        replay.actions.push(action);
        replay.actions = replay.actions.slice(-this.maxActions);
        replay.updatedAt = new Date(action.receivedAt).toISOString();
    }
    async flush(state) {
        if (!this.store?.isEnabled() || this.isPersisting) {
            return;
        }
        const replay = this.getCurrentReplay();
        if (!replay) {
            return;
        }
        this.isPersisting = true;
        try {
            await this.flushReplay(replay);
            await this.store.persistMatchResults((0, competition_projection_1.buildMatchResults)(state, this.config));
            this.hasLoggedPersistenceFailure = false;
        }
        finally {
            this.isPersisting = false;
        }
    }
    async flushReplay(replay) {
        if (!this.store?.isEnabled()) {
            return;
        }
        await this.store.upsertReplay(replay, (0, competition_projection_1.buildReplaySummary)(replay));
    }
    logPersistenceFailure(operation, error) {
        const details = error instanceof Error ? error.message : String(error);
        if (this.hasLoggedPersistenceFailure) {
            return;
        }
        this.hasLoggedPersistenceFailure = true;
        console.error(`Replay persistence ${operation} failed; continuing without persisted sync: ${details}`);
    }
}
exports.ReplayRecorder = ReplayRecorder;
