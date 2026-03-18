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
    latestFullState = null;
    lastBroadcastState = null;
    constructor(engine, config, telemetry) {
        this.engine = engine;
        this.config = config;
        this.telemetry = telemetry;
        this.broadcastEveryTicks = Math.max(1, Math.round(config.broadcastIntervalMs / Math.max(1, config.tickRateMs)));
        this.engine.onTick((state) => {
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
    getCurrentFullState() {
        if (!this.latestFullState) {
            const state = this.engine.getStateSnapshot();
            this.latestFullState = this.telemetry.measure('projection.full', () => (0, state_projection_1.projectFrontendGameState)(state, this.config));
        }
        this.lastBroadcastState = this.latestFullState;
        return this.latestFullState;
    }
    handleTick(state) {
        const fullState = this.telemetry.measure('projection.full', () => (0, state_projection_1.projectFrontendGameState)(state, this.config));
        const shouldSocketBroadcast = state.status === 'finished' || state.tick % this.broadcastEveryTicks === 0;
        const shouldComputeBroadcast = this.broadcastListeners.size > 0 || shouldSocketBroadcast;
        this.latestFullState = fullState;
        let broadcast = null;
        if (shouldComputeBroadcast) {
            const previousState = this.lastBroadcastState ?? fullState;
            const uiUpdate = this.telemetry.measure('projection.ui', () => (0, state_projection_1.projectFrontendUiStateUpdate)(state, this.config, previousState));
            const noticeUpdate = this.telemetry.measure('projection.notice', () => (0, state_projection_1.projectFrontendNoticeUpdate)(state, previousState));
            const patch = this.telemetry.measure('projection.patch', () => (0, state_projection_1.projectFrontendGameStatePatch)(state, this.config, previousState));
            broadcast = {
                patch,
                uiUpdate,
                noticeUpdate,
            };
            this.lastBroadcastState = mergeFrontendNoticeUpdate(mergeFrontendUiStateUpdate(mergeFrontendGameStatePatch(previousState, patch), uiUpdate), noticeUpdate);
        }
        const event = {
            state,
            fullState,
            broadcast,
            shouldSocketBroadcast,
        };
        for (const listener of this.tickListeners) {
            listener(event);
        }
        for (const listener of this.broadcastListeners) {
            listener(event);
        }
    }
    updateListenerGauges() {
        this.telemetry.setGauge('projection.tickListeners', this.tickListeners.size);
        this.telemetry.setGauge('projection.broadcastListeners', this.broadcastListeners.size);
        this.telemetry.setGauge('projection.listeners', this.tickListeners.size + this.broadcastListeners.size);
    }
}
exports.ProjectedTickStream = ProjectedTickStream;
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
