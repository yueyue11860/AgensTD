"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectedTickStream = void 0;
const state_projection_1 = require("./state-projection");
class ProjectedTickStream {
    engine;
    config;
    telemetry;
    tickListeners = new Set();
    broadcastListeners = new Set();
    broadcastEveryTicks;
    fullSnapshotEveryTicks;
    latestFullState = null;
    lastBroadcastState = null;
    lastStatus = null;
    unsubscribeEngineTick;
    constructor(engine, config, telemetry) {
        this.engine = engine;
        this.config = config;
        this.telemetry = telemetry;
        this.broadcastEveryTicks = Math.max(1, Math.round(config.broadcastIntervalMs / Math.max(1, config.tickRateMs)));
        const fullSnapshotEveryBroadcasts = Math.max(1, Math.round(config.fullSnapshotIntervalMs / Math.max(1, config.broadcastIntervalMs)));
        this.fullSnapshotEveryTicks = this.broadcastEveryTicks * fullSnapshotEveryBroadcasts;
        this.unsubscribeEngineTick = this.engine.onTick((state) => {
            this.handleTick(state);
        }, { label: 'projected-tick-stream' });
    }
    subscribeTick(listener) {
        this.tickListeners.add(listener);
        this.updateListenerGauges();
        return () => {
            this.tickListeners.delete(listener);
            this.updateListenerGauges();
        };
    }
    subscribeBroadcast(listener) {
        this.broadcastListeners.add(listener);
        this.updateListenerGauges();
        return () => {
            this.broadcastListeners.delete(listener);
            this.updateListenerGauges();
        };
    }
    getCurrentFullState(options) {
        if (!this.latestFullState) {
            const state = this.engine.getStateSnapshot();
            this.latestFullState = this.telemetry.measure('projection.full', () => (0, state_projection_1.projectFrontendGameState)(state, this.config));
        }
        if (options?.initializeBroadcastBaseline && !this.lastBroadcastState) {
            this.lastBroadcastState = this.latestFullState;
        }
        return this.latestFullState;
    }
    dispose() {
        this.unsubscribeEngineTick();
        this.tickListeners.clear();
        this.broadcastListeners.clear();
        this.updateListenerGauges();
    }
    handleTick(state) {
        const justFinished = state.status === 'finished' && this.lastStatus !== 'finished';
        const shouldSocketBroadcast = justFinished || state.tick % this.broadcastEveryTicks === 0;
        const shouldNotifyTickListeners = this.tickListeners.size > 0;
        this.lastStatus = state.status;
        if (!shouldSocketBroadcast && !shouldNotifyTickListeners) {
            return;
        }
        const fullState = this.telemetry.measure('projection.full', () => (0, state_projection_1.projectFrontendGameState)(state, this.config));
        const shouldFullSnapshot = this.lastBroadcastState === null
            || justFinished
            || state.tick % this.fullSnapshotEveryTicks === 0;
        this.latestFullState = fullState;
        let broadcast = null;
        if (shouldSocketBroadcast) {
            const previousState = this.lastBroadcastState ?? fullState;
            const uiUpdate = this.telemetry.measure('projection.ui', () => (0, state_projection_1.projectFrontendUiStateUpdate)(state, this.config, previousState));
            const noticeUpdate = this.telemetry.measure('projection.notice', () => (0, state_projection_1.projectFrontendNoticeUpdate)(state, previousState));
            const patch = this.telemetry.measure('projection.patch', () => (0, state_projection_1.projectFrontendGameStatePatch)(state, this.config, previousState));
            broadcast = {
                patch,
                checkpoint: createCheckpointPatch(fullState),
                uiUpdate,
                noticeUpdate,
            };
            this.lastBroadcastState = mergeFrontendNoticeUpdate(mergeFrontendUiStateUpdate(mergeFrontendGameStatePatch(previousState, patch), uiUpdate), noticeUpdate);
            if (shouldFullSnapshot) {
                this.lastBroadcastState = fullState;
            }
        }
        const event = {
            state,
            fullState,
            broadcast,
            shouldSocketBroadcast,
            shouldFullSnapshot,
        };
        for (const listener of this.tickListeners) {
            listener(event);
        }
        if (shouldSocketBroadcast) {
            for (const listener of this.broadcastListeners) {
                listener(event);
            }
        }
    }
    updateListenerGauges() {
        this.telemetry.setGauge('projection.tickListeners', this.tickListeners.size);
        this.telemetry.setGauge('projection.broadcastListeners', this.broadcastListeners.size);
        this.telemetry.setGauge('projection.listeners', this.tickListeners.size + this.broadcastListeners.size);
    }
}
exports.ProjectedTickStream = ProjectedTickStream;
function createCheckpointPatch(state) {
    return {
        tick: state.tick,
        status: state.status,
        result: state.result,
        resources: state.resources,
        room: state.room,
        towers: state.towers,
        enemies: state.enemies,
        wave: state.wave,
        score: state.score,
        updatedAt: state.updatedAt,
        pve: state.pve,
    };
}
function mergeFrontendGameStatePatch(previousState, patch) {
    return {
        ...previousState,
        ...patch,
        towers: patch.towers ?? applyEntityDelta(previousState.towers, patch.towerDelta),
        enemies: patch.enemies ?? applyEntityDelta(previousState.enemies, patch.enemyDelta),
        map: patch.map ?? previousState.map,
    };
}
function mergeFrontendUiStateUpdate(previousState, update) {
    return {
        ...previousState,
        buildPalette: update.buildPalette ?? previousState.buildPalette,
        actionBar: update.actionBar ?? previousState.actionBar,
    };
}
function mergeFrontendNoticeUpdate(previousState, update) {
    if (!update) {
        return previousState;
    }
    return {
        ...previousState,
        notices: update.notices,
    };
}
function applyEntityDelta(currentEntities, delta) {
    if (!delta || (delta.upsert.length === 0 && delta.remove.length === 0)) {
        return currentEntities;
    }
    const removeIds = new Set(delta.remove);
    const upsertById = new Map(delta.upsert.map((entity) => [entity.id, entity]));
    const nextEntities = [];
    for (const entity of currentEntities) {
        if (removeIds.has(entity.id)) {
            continue;
        }
        nextEntities.push(upsertById.get(entity.id) ?? entity);
        upsertById.delete(entity.id);
    }
    for (const entity of delta.upsert) {
        if (upsertById.has(entity.id)) {
            nextEntities.push(entity);
            upsertById.delete(entity.id);
        }
    }
    return nextEntities;
}
