"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPvpV1SmokeChecks = runPvpV1SmokeChecks;
const strict_1 = __importDefault(require("node:assert/strict"));
const map_1 = require("./map");
const runtime_1 = require("./runtime");
function readyRuntime(matchId) {
    const runtime = new runtime_1.PvpMatchRuntime({
        matchId,
        mode: 'ranked_1v1',
        seed: `seed:${matchId}`,
        rulesetVersion: 'pvp-rules-v1',
        tickRateMs: 100,
        countdownMs: 5000,
        roundIntervalMs: 20_000,
        eventHistoryLimit: 2000,
    });
    strict_1.default.equal(runtime.registerParticipant('A', { playerId: `${matchId}:a`, playerName: '甲' }).ok, true);
    strict_1.default.equal(runtime.registerParticipant('B', { playerId: `${matchId}:b`, playerName: '乙' }).ok, true);
    strict_1.default.equal(runtime.snapshot().phase, 'ready_check');
    strict_1.default.equal(runtime.setReady(`${matchId}:a`).ok, true);
    strict_1.default.equal(runtime.setReady(`${matchId}:b`).ok, true);
    strict_1.default.equal(runtime.snapshot().phase, 'loading');
    strict_1.default.equal(runtime.markLoaded(`${matchId}:a`).ok, true);
    strict_1.default.equal(runtime.markLoaded(`${matchId}:b`).ok, true);
    strict_1.default.equal(runtime.snapshot().phase, 'countdown');
    return runtime;
}
function advanceToPlaying(runtime) {
    for (let index = 0; index < 49; index += 1)
        runtime.tick();
    strict_1.default.equal(runtime.snapshot().phase, 'countdown');
    strict_1.default.equal(runtime.snapshot().sides.A?.enemies.length, 0);
    runtime.tick();
    strict_1.default.equal(runtime.snapshot().phase, 'playing');
    strict_1.default.equal(runtime.snapshot().round.number, 1);
    strict_1.default.equal(runtime.snapshot().sides.A?.rations, 15);
    strict_1.default.equal(runtime.snapshot().sides.B?.rations, 15);
}
function validateMap() {
    strict_1.default.equal(map_1.DUAL_REALM_MAP.width, 29);
    strict_1.default.equal(map_1.DUAL_REALM_MAP.height, 29);
    strict_1.default.equal(map_1.DUAL_REALM_MAP.cells.length, 29 * 29);
    strict_1.default.equal(map_1.DUAL_REALM_MAP.routeHash.length, 64);
    strict_1.default.equal((0, map_1.compileDualRealmMap)().routeHash, map_1.DUAL_REALM_MAP.routeHash);
    strict_1.default.deepEqual(map_1.PVP_B_ROUTE_ANCHORS, map_1.PVP_A_ROUTE_ANCHORS.map(map_1.mirrorPvpPosition));
    strict_1.default.deepEqual(map_1.DUAL_REALM_MAP.sides.B.routeCells, map_1.DUAL_REALM_MAP.sides.A.routeCells.map(map_1.mirrorPvpPosition));
    strict_1.default.deepEqual(map_1.DUAL_REALM_MAP.sides.A.routeCells[0], { x: 14, y: 1 });
    strict_1.default.deepEqual(map_1.DUAL_REALM_MAP.sides.A.routeCells.at(-1), { x: 14, y: 12 });
    strict_1.default.deepEqual(map_1.DUAL_REALM_MAP.sides.B.routeCells[0], { x: 14, y: 27 });
    strict_1.default.deepEqual(map_1.DUAL_REALM_MAP.sides.B.routeCells.at(-1), { x: 14, y: 16 });
    strict_1.default.equal((0, map_1.isPvpDeployableCell)('A', 0, 0), true);
    strict_1.default.equal((0, map_1.isPvpDeployableCell)('A', 14, 1), false);
    strict_1.default.equal((0, map_1.isPvpDeployableCell)('A', 0, 15), false);
    strict_1.default.equal((0, map_1.isPvpDeployableCell)('B', 0, 28), true);
    strict_1.default.equal((0, map_1.isPvpDeployableCell)('B', 14, 27), false);
    strict_1.default.equal(map_1.DUAL_REALM_MAP.cells.filter((cell) => cell.y === 14).every((cell) => cell.kind === 'neutral_boundary'), true);
    strict_1.default.equal((0, map_1.hasEnemyBodyFullyExitedPvpSpawnGate)('A', 14_000, 2_900), false);
    strict_1.default.equal((0, map_1.hasEnemyBodyFullyExitedPvpSpawnGate)('A', 14_000, 2_907), true);
    strict_1.default.equal((0, map_1.hasEnemyBodyFullyExitedPvpSpawnGate)('B', 14_000, 25_100), false);
    strict_1.default.equal((0, map_1.hasEnemyBodyFullyExitedPvpSpawnGate)('B', 14_000, 25_093), true);
}
function validateRoundsPressureAndProjection() {
    const runtime = readyRuntime('pressure');
    advanceToPlaying(runtime);
    runtime.tick();
    let state = runtime.snapshot();
    strict_1.default.equal(state.sides.A?.enemies.length, 1);
    strict_1.default.equal(state.sides.B?.enemies.length, 1);
    strict_1.default.equal(state.sides.A?.enemies[0]?.spawnProtected, true);
    let killed = 0;
    for (let guard = 0; guard < 400 && killed < 5; guard += 1) {
        state = runtime.tick();
        const target = state.sides.A?.enemies.find((enemy) => !enemy.spawnProtected);
        if (!target)
            continue;
        const result = runtime.applyAuthoritativeDamage({
            eventId: `combat-event-${killed}`,
            sourcePlayerId: 'pressure:a',
            enemyId: target.enemyId,
            rawDamage: target.hp,
            resolvedDamage: target.hp,
        });
        strict_1.default.equal(result.ok, true);
        const replay = runtime.applyAuthoritativeDamage({
            eventId: `combat-event-${killed}`,
            sourcePlayerId: 'pressure:a',
            enemyId: target.enemyId,
            rawDamage: target.hp,
            resolvedDamage: target.hp,
        });
        strict_1.default.equal(replay.ok, true);
        strict_1.default.equal(replay.duplicate, true);
        killed += 1;
    }
    strict_1.default.equal(killed, 5);
    state = runtime.snapshot();
    strict_1.default.equal(state.sides.A?.scripture, 5);
    strict_1.default.equal(state.sides.A?.stats.scriptureEarned, 5);
    const pressure = runtime.sendPressure('pressure:a', 'send-pressure-1');
    strict_1.default.equal(pressure.ok, true);
    strict_1.default.equal(runtime.snapshot().sides.A?.scripture, 0);
    strict_1.default.equal(runtime.snapshot().sides.B?.privateState.pendingPressure.length, 1);
    const replay = runtime.sendPressure('pressure:a', 'send-pressure-1');
    strict_1.default.equal(replay.ok, true);
    strict_1.default.equal(replay.duplicate, true);
    strict_1.default.equal(runtime.snapshot().sides.B?.privateState.pendingPressure.length, 1);
    const conflict = runtime.surrender('pressure:a', 'send-pressure-1');
    strict_1.default.equal(conflict.ok, false);
    strict_1.default.equal(conflict.code, 'REQUEST_ID_CONFLICT');
    const ownView = runtime.projectForViewer('pressure:a');
    strict_1.default.ok(ownView.sides.A?.privateState);
    strict_1.default.equal(typeof ownView.sides.A?.rations, 'number');
    strict_1.default.equal(ownView.sides.B?.privateState, null);
    strict_1.default.equal(ownView.sides.B?.rations, null);
    strict_1.default.equal(Object.prototype.hasOwnProperty.call(ownView, 'seed'), false);
    const defenderView = runtime.projectForViewer('pressure:b');
    strict_1.default.equal(defenderView.sides.B?.privateState?.pendingPressure.length, 0);
    strict_1.default.equal(defenderView.recentEvents.some((event) => event.type === 'PRESSURE_QUEUED'), false);
    strict_1.default.equal(ownView.recentEvents.some((event) => event.type === 'PRESSURE_QUEUED'), true);
    strict_1.default.equal(runtime.projectForViewer(null).recentEvents.some((event) => event.type === 'PRESSURE_QUEUED'), false);
    const tickAtRoundOne = runtime.snapshot().tick;
    const nextRoundAt = runtime.snapshot().round.nextRoundAtTick;
    for (let tick = tickAtRoundOne; tick < nextRoundAt; tick += 1)
        runtime.tick();
    strict_1.default.equal(runtime.snapshot().round.number, 2);
}
function validateTerminalReasons() {
    const coreDestroyed = readyRuntime('core-destroyed');
    advanceToPlaying(coreDestroyed);
    for (let guard = 0; guard < 2500 && coreDestroyed.snapshot().phase === 'playing'; guard += 1) {
        const state = coreDestroyed.tick();
        for (const enemy of state.sides.A?.enemies.filter((candidate) => !candidate.spawnProtected) ?? []) {
            coreDestroyed.applyAuthoritativeDamage({
                eventId: `core-defense-${guard}-${enemy.enemyId}`,
                sourcePlayerId: 'core-destroyed:a',
                enemyId: enemy.enemyId,
                rawDamage: enemy.hp,
                resolvedDamage: enemy.hp,
            });
        }
    }
    strict_1.default.equal(coreDestroyed.snapshot().result?.reason, 'core_destroyed');
    strict_1.default.equal(coreDestroyed.snapshot().result?.winnerPlayerId, 'core-destroyed:a');
    const surrender = readyRuntime('surrender');
    advanceToPlaying(surrender);
    const first = surrender.surrender('surrender:a', 'surrender-request');
    strict_1.default.equal(first.ok, true);
    strict_1.default.equal(surrender.snapshot().phase, 'settling');
    strict_1.default.equal(surrender.snapshot().result?.reason, 'surrendered');
    strict_1.default.equal(surrender.snapshot().result?.winnerPlayerId, 'surrender:b');
    strict_1.default.equal(surrender.snapshot().recentEvents.filter((event) => event.type === 'PVP_MATCH_FINISHED').length, 1);
    strict_1.default.equal(surrender.completeSettlement().ok, true);
    strict_1.default.equal(surrender.snapshot().phase, 'completed');
    const disconnect = readyRuntime('disconnect');
    advanceToPlaying(disconnect);
    strict_1.default.equal(disconnect.markDisconnected('disconnect:a').ok, true);
    for (let index = 0; index < 599; index += 1)
        disconnect.tick();
    strict_1.default.equal(disconnect.snapshot().phase, 'playing');
    disconnect.tick();
    strict_1.default.equal(disconnect.snapshot().result?.reason, 'disconnect_forfeit');
    strict_1.default.equal(disconnect.snapshot().result?.winnerPlayerId, 'disconnect:b');
    const simultaneous = readyRuntime('simultaneous');
    advanceToPlaying(simultaneous);
    for (let guard = 0; guard < 3000 && simultaneous.snapshot().phase === 'playing'; guard += 1)
        simultaneous.tick();
    strict_1.default.equal(simultaneous.snapshot().result?.reason, 'simultaneous_draw');
    strict_1.default.deepEqual(simultaneous.snapshot().result?.participants, { A: 'draw', B: 'draw' });
    const voided = readyRuntime('voided');
    strict_1.default.equal(voided.voidMatch('ruleset_invalid').ok, true);
    strict_1.default.equal(voided.snapshot().phase, 'voided');
    strict_1.default.equal(voided.snapshot().result?.participants.A, 'void');
    const hardTimeout = new runtime_1.PvpMatchRuntime({
        matchId: 'hard-timeout', mode: 'ranked_1v1', seed: 'hard-timeout', rulesetVersion: 'pvp-rules-v1',
        tickRateMs: 1000, countdownMs: 0, eventHistoryLimit: 50,
    });
    hardTimeout.registerParticipant('A', { playerId: 'hard:a', playerName: '甲' });
    hardTimeout.registerParticipant('B', { playerId: 'hard:b', playerName: '乙' });
    hardTimeout.setReady('hard:a');
    hardTimeout.setReady('hard:b');
    hardTimeout.markLoaded('hard:a');
    hardTimeout.markLoaded('hard:b');
    strict_1.default.equal(hardTimeout.snapshot().phase, 'playing');
    for (let index = 0; index < 720 && hardTimeout.snapshot().phase === 'playing'; index += 1) {
        const state = hardTimeout.tick();
        for (const side of ['A', 'B']) {
            for (const enemy of state.sides[side]?.enemies.filter((candidate) => !candidate.spawnProtected) ?? []) {
                hardTimeout.applyAuthoritativeDamage({
                    eventId: `hard-defense-${index}-${enemy.enemyId}`,
                    sourcePlayerId: `hard:${side.toLowerCase()}`,
                    enemyId: enemy.enemyId,
                    rawDamage: enemy.hp,
                    resolvedDamage: enemy.hp,
                });
            }
        }
    }
    strict_1.default.equal(hardTimeout.snapshot().result?.reason, 'hard_timeout');
    strict_1.default.deepEqual(hardTimeout.snapshot().result?.participants, { A: 'draw', B: 'draw' });
}
function runPvpV1SmokeChecks() {
    validateMap();
    validateRoundsPressureAndProjection();
    validateTerminalReasons();
}
if (require.main === module) {
    runPvpV1SmokeChecks();
    console.log('pvp-v1 smoke checks passed');
}
