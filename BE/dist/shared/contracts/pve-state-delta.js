"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPveMatchStatePatch = createPveMatchStatePatch;
exports.applyPveMatchStatePatch = applyPveMatchStatePatch;
exports.applyPveDeltaToGameState = applyPveDeltaToGameState;
function sameValue(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}
function createCollectionDelta(previous, next, keyOf) {
    const previousByKey = new Map(previous.map((value) => [keyOf(value), value]));
    const nextKeys = new Set();
    const upsert = [];
    for (const value of next) {
        const key = keyOf(value);
        nextKeys.add(key);
        if (!sameValue(previousByKey.get(key), value))
            upsert.push(value);
    }
    const remove = previous
        .map(keyOf)
        .filter((key) => !nextKeys.has(key));
    return upsert.length || remove.length ? { upsert, remove } : undefined;
}
function applyCollectionDelta(previous, delta, keyOf) {
    if (!delta)
        return previous;
    const removed = new Set(delta.remove);
    const replacements = new Map(delta.upsert.map((value) => [keyOf(value), value]));
    const next = [];
    for (const value of previous) {
        const key = keyOf(value);
        if (removed.has(key))
            continue;
        next.push(replacements.get(key) ?? value);
        replacements.delete(key);
    }
    for (const value of delta.upsert) {
        const key = keyOf(value);
        if (!replacements.has(key))
            continue;
        next.push(value);
        replacements.delete(key);
    }
    return next;
}
function createPveMatchStatePatch(previous, next) {
    return {
        baseTick: previous.tick,
        tick: next.tick,
        phase: next.phase,
        currentWave: next.currentWave,
        maxWaves: next.maxWaves,
        enemyCount: next.enemyCount,
        maxCapacity: next.maxCapacity,
        overloadCountdownSec: next.overloadCountdownSec,
        playerDelta: createCollectionDelta(previous.players, next.players, (value) => value.playerId),
        boardPieceDelta: createCollectionDelta(previous.boardPieces, next.boardPieces, (value) => value.entityId),
        pveEnemyDelta: createCollectionDelta(previous.enemies, next.enemies, (value) => value.entityId),
        statusDelta: createCollectionDelta(previous.statuses, next.statuses, (value) => value.instanceId),
        summonedUnitDelta: createCollectionDelta(previous.summonedUnits, next.summonedUnits, (value) => value.entityId),
        zoneDelta: createCollectionDelta(previous.zones, next.zones, (value) => value.entityId),
        laneWaves: sameValue(previous.laneWaves, next.laneWaves) ? undefined : next.laneWaves,
    };
}
function applyPveMatchStatePatch(previous, patch) {
    if (!previous || !patch || patch.baseTick !== previous.tick || patch.tick <= previous.tick)
        return previous;
    return {
        ...previous,
        tick: patch.tick,
        phase: patch.phase,
        currentWave: patch.currentWave,
        maxWaves: patch.maxWaves,
        enemyCount: patch.enemyCount,
        maxCapacity: patch.maxCapacity,
        overloadCountdownSec: patch.overloadCountdownSec,
        players: applyCollectionDelta(previous.players, patch.playerDelta, (value) => value.playerId),
        boardPieces: applyCollectionDelta(previous.boardPieces, patch.boardPieceDelta, (value) => value.entityId),
        enemies: applyCollectionDelta(previous.enemies, patch.pveEnemyDelta, (value) => value.entityId),
        statuses: applyCollectionDelta(previous.statuses, patch.statusDelta, (value) => value.instanceId),
        summonedUnits: applyCollectionDelta(previous.summonedUnits, patch.summonedUnitDelta, (value) => value.entityId),
        zones: applyCollectionDelta(previous.zones, patch.zoneDelta, (value) => value.entityId),
        laneWaves: patch.laneWaves ?? previous.laneWaves,
    };
}
function applyPveDeltaToGameState(previous, patch) {
    if (patch.pve)
        return patch.pve;
    return applyPveMatchStatePatch(previous.pve, patch.pvePatch);
}
