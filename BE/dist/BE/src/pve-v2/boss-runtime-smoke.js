"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runBossRuntimeSmokeChecks = runBossRuntimeSmokeChecks;
const strict_1 = __importDefault(require("node:assert/strict"));
const boss_catalog_1 = require("./boss-catalog");
const boss_runtime_1 = require("./boss-runtime");
const runtime_1 = require("./runtime");
function enemy(id, laneOwnerPlayerId, laneSlot, kind, hp = 100) {
    return {
        id,
        entityKind: kind,
        waveNumber: 5,
        laneOwnerPlayerId,
        laneSlot,
        currentHp: hp,
        maxHp: 100,
        lifecycle: 'alive',
    };
}
function eventSink() {
    const events = [];
    return { events, emit: (type, data) => events.push({ type, data }) };
}
function runNodeWaveSpawn(seed) {
    const runtime = new runtime_1.PveGameRuntime({
        seed,
        levelId: 1,
        difficulty: 'easy',
        prepDurationMs: 0,
        initialWaveNumber: 5,
        maxWaves: 5,
    });
    strict_1.default.equal(runtime.registerPlayer('p1', 'P1').ok, true);
    strict_1.default.equal(runtime.start().ok, true);
    let snapshot = runtime.snapshot();
    for (let index = 0; index < 1000 && !snapshot.enemies.some((entry) => entry.entityKind === 'boss'); index += 1) {
        snapshot = runtime.tick();
    }
    const boss = snapshot.enemies.find((entry) => entry.entityKind === 'boss');
    strict_1.default.ok(boss, 'W5 must spawn one Boss after its ten ordinary minions');
    strict_1.default.equal(snapshot.enemies.filter((entry) => entry.entityKind === 'ordinary_minion').length, 10);
    strict_1.default.equal(snapshot.enemies.filter((entry) => entry.entityKind === 'boss').length, 1);
    strict_1.default.equal(snapshot.wave.lanes[0].spawnedCount, 10);
    strict_1.default.equal(snapshot.wave.lanes[0].totalCount, 10);
    strict_1.default.equal(snapshot.wave.lanes[0].bossRequired, true);
    strict_1.default.equal(snapshot.wave.lanes[0].bossSpawned, true);
    strict_1.default.equal(snapshot.wave.lanes[0].cleared, false);
    strict_1.default.equal(snapshot.status, 'running', 'the extra Boss must not consume an ordinary-minion overload slot');
    strict_1.default.equal(boss.spawnProtected, true);
    strict_1.default.equal(boss.invulnerable, false);
    strict_1.default.equal(boss.bossDefinitionId, 'boss_l1_w5_mountain_scout_v1');
    strict_1.default.equal(boss.bossName, '山魈先锋');
    strict_1.default.ok(boss.controlResistanceBps > 0);
    strict_1.default.equal(snapshot.bossRuntime.schemaVersion, 1);
    strict_1.default.equal(snapshot.bossRuntime.instances.length, 1);
    for (let index = 0; index < 80 && snapshot.enemies.find((entry) => entry.id === boss.id)?.spawnProtected; index += 1) {
        snapshot = runtime.tick();
    }
    const enteredBoss = snapshot.enemies.find((entry) => entry.id === boss.id);
    strict_1.default.ok(enteredBoss);
    strict_1.default.equal(enteredBoss.spawnProtected, false, 'Boss becomes targetable only after its body fully exits the spawn square');
    strict_1.default.ok(snapshot.recentEvents.some((entry) => entry.type === 'ENEMY_ENTERED_BATTLEFIELD' && entry.data.enemyId === boss.id));
    // 白盒只用于专项 smoke：验证真正的死亡结算入口，而不是复制一套奖励算法。
    const internals = runtime;
    for (const target of [...internals.enemies]) {
        target.lastDamagePlayerId = 'p1';
        target.currentHp = 0;
        internals.settleEnemyDeath(target);
        internals.settleEnemyDeath(target);
    }
    snapshot = runtime.tick();
    strict_1.default.equal(snapshot.wave.lanes[0].cleared, true, 'Boss death is required before its lane can clear');
    strict_1.default.equal(snapshot.status, 'finished');
    strict_1.default.equal(snapshot.result?.outcome, 'victory');
    // 10初始 + 10只普通怪×1 + W5 Boss×5 + W5路线保底25。
    strict_1.default.equal(snapshot.players[0].rice, 50);
    strict_1.default.equal(snapshot.recentEvents.filter((entry) => entry.type === 'BOSS_DIED' && entry.data.enemyId === boss.id).length, 1);
    strict_1.default.equal(snapshot.recentEvents.filter((entry) => entry.type === 'RICE_GRANTED'
        && entry.data.enemyId === boss.id && entry.data.amount === 5).length, 1);
    return snapshot;
}
function runFourPlayerTwentyWaveIntegration(seed) {
    const runtime = new runtime_1.PveGameRuntime({
        seed,
        levelId: 1,
        difficulty: 'easy',
        tickRateMs: 500,
        maxWaves: 20,
        eventHistoryLimit: 20000,
    });
    const registrations = [
        ['player-1', 'P1'], ['player-2', 'P2'], ['player-3', 'P3'], ['player-4', 'P4'],
    ];
    for (const [playerId, slot] of registrations)
        strict_1.default.equal(runtime.registerPlayer(playerId, slot).ok, true);
    strict_1.default.equal(runtime.start().ok, true);
    const seenEnemyIds = new Set();
    const ordinaryByLane = new Map();
    const bossSpawnKeys = [];
    const internals = runtime;
    let snapshot = runtime.snapshot();
    for (let tick = 0; tick < 5000 && snapshot.status !== 'finished'; tick += 1) {
        snapshot = runtime.tick();
        for (const target of snapshot.enemies) {
            if (seenEnemyIds.has(target.id))
                continue;
            seenEnemyIds.add(target.id);
            if (target.entityKind === 'ordinary_minion') {
                ordinaryByLane.set(target.laneSlot, (ordinaryByLane.get(target.laneSlot) ?? 0) + 1);
            }
            else
                bossSpawnKeys.push(`${target.laneSlot}:${target.waveNumber}:${target.bossDefinitionId}`);
        }
        // 专项联调仅绕过UI布阵和伤害耗时；仍经过唯一 settleEnemyDeath、奖励、清波和事件入口。
        for (const target of [...internals.enemies]) {
            if (target.lifecycle !== 'alive' || target.spawnProtected)
                continue;
            target.lastDamagePlayerId = target.laneOwnerPlayerId;
            target.currentHp = 0;
            internals.settleEnemyDeath(target);
        }
    }
    strict_1.default.equal(snapshot.status, 'finished');
    strict_1.default.equal(snapshot.result?.outcome, 'victory');
    strict_1.default.equal(seenEnemyIds.size, 816);
    for (const slot of ['P1', 'P2', 'P3', 'P4'])
        strict_1.default.equal(ordinaryByLane.get(slot), 200);
    strict_1.default.equal(bossSpawnKeys.length, 16);
    strict_1.default.equal(new Set(bossSpawnKeys).size, 16);
    for (const slot of ['P1', 'P2', 'P3', 'P4']) {
        for (const wave of [5, 10, 15, 20]) {
            strict_1.default.equal(bossSpawnKeys.filter((key) => key.startsWith(`${slot}:${wave}:`)).length, 1);
        }
    }
    for (const player of snapshot.players) {
        strict_1.default.deepEqual(player.clearedWaves, Array.from({ length: 20 }, (_, index) => index + 1));
    }
    const bossLaneClears = snapshot.recentEvents.filter((entry) => (entry.type === 'LANE_WAVE_CLEARED' && entry.data.bossNode === true));
    strict_1.default.equal(bossLaneClears.length, 16);
    strict_1.default.ok(bossLaneClears.every((entry) => typeof entry.data.bossDefinitionId === 'string'));
    const eventCounts = Object.fromEntries([...new Set(snapshot.recentEvents.map((entry) => entry.type))]
        .sort().map((type) => [type, snapshot.recentEvents.filter((entry) => entry.type === type).length]));
    return {
        finalSnapshot: snapshot,
        eventCounts,
        bossSpawnKeys: bossSpawnKeys.slice().sort(),
        ordinaryByLane: Object.fromEntries([...ordinaryByLane.entries()].sort()),
    };
}
function runBossRuntimeSmokeChecks() {
    strict_1.default.equal((0, boss_runtime_1.nextLaneSpawnEntityKind)({ ordinarySpawnedCount: 9, ordinaryTotalCount: 10,
        bossRequired: true, bossSpawned: false }), 'ordinary_minion');
    strict_1.default.equal((0, boss_runtime_1.nextLaneSpawnEntityKind)({ ordinarySpawnedCount: 10, ordinaryTotalCount: 10,
        bossRequired: true, bossSpawned: false }), 'boss');
    strict_1.default.equal((0, boss_runtime_1.nextLaneSpawnEntityKind)({ ordinarySpawnedCount: 10, ordinaryTotalCount: 10,
        bossRequired: true, bossSpawned: true }), null);
    strict_1.default.equal((0, boss_runtime_1.isLaneWaveSpawningComplete)({ ordinarySpawnedCount: 10, ordinaryTotalCount: 10,
        bossRequired: true, bossSpawned: false }), false);
    strict_1.default.equal((0, boss_runtime_1.isLaneWaveSpawningComplete)({ ordinarySpawnedCount: 10, ordinaryTotalCount: 10,
        bossRequired: true, bossSpawned: true }), true);
    strict_1.default.equal((0, boss_runtime_1.settleBossControlDurationMs)(5000, 1000, 3000), 3000);
    strict_1.default.equal((0, boss_runtime_1.settleBossControlDurationMs)(1000, 4000, 1500), 600);
    strict_1.default.equal((0, boss_runtime_1.settleEnemySlowBps)('boss', 9000), 4000);
    strict_1.default.equal((0, boss_runtime_1.settleEnemySlowBps)('ordinary_minion', 9000), 8000);
    const deterministicA = runNodeWaveSpawn('boss-spawn-determinism');
    const deterministicB = runNodeWaveSpawn('boss-spawn-determinism');
    strict_1.default.deepEqual(deterministicA, deterministicB);
    const integrationA = runFourPlayerTwentyWaveIntegration('boss-four-player-integration');
    const integrationB = runFourPlayerTwentyWaveIntegration('boss-four-player-integration');
    strict_1.default.deepEqual(integrationA, integrationB);
    const hasteEncounter = (0, boss_catalog_1.resolveBossEncounter)(1, 'easy', 5);
    strict_1.default.ok(hasteEncounter);
    const bossA = enemy('boss-a', 'player-a', 'P1', 'boss');
    const minionA = enemy('minion-a', 'player-a', 'P1', 'ordinary_minion');
    const minionB = enemy('minion-b', 'player-b', 'P2', 'ordinary_minion');
    const hasteRuntime = new boss_runtime_1.BossCombatRuntimeV1(100);
    const hasteEvents = eventSink();
    hasteRuntime.registerBoss(bossA, hasteEncounter, 0, hasteEvents.emit);
    hasteRuntime.advance({ tick: 10, enemies: [bossA, minionA, minionB], emit: hasteEvents.emit });
    strict_1.default.equal(hasteRuntime.snapshot().instances[0].skillStates[0].lifecycle, 'warning');
    strict_1.default.ok(hasteRuntime.snapshot().instances[0].activeCast?.skillName.includes('山魈'));
    hasteRuntime.advance({ tick: 20, enemies: [bossA, minionA, minionB], emit: hasteEvents.emit });
    strict_1.default.equal(hasteRuntime.snapshot().instances[0].skillStates[0].lifecycle, 'active');
    strict_1.default.ok(hasteRuntime.movementRatioBps(minionA, [bossA, minionA, minionB], 20, hasteEvents.emit) > 10000);
    strict_1.default.equal(hasteRuntime.movementRatioBps(minionB, [bossA, minionA, minionB], 20, hasteEvents.emit), 10000, 'each multiplayer lane owns an independent Boss skill projection');
    strict_1.default.ok(hasteEvents.events.some((entry) => entry.type === 'BOSS_CAST_WARNING'));
    strict_1.default.ok(hasteEvents.events.some((entry) => entry.type === 'BOSS_SKILL_CAST'));
    bossA.lifecycle = 'dead';
    hasteRuntime.handleBossDeath(bossA, 21, hasteEvents.emit);
    const endedBeforeRetry = hasteEvents.events.filter((entry) => entry.type === 'BOSS_SKILL_ENDED').length;
    hasteRuntime.handleBossDeath(bossA, 21, hasteEvents.emit);
    strict_1.default.equal(hasteEvents.events.filter((entry) => entry.type === 'BOSS_SKILL_ENDED').length, endedBeforeRetry, 'Boss cleanup/death is idempotent');
    strict_1.default.equal(hasteRuntime.movementRatioBps(minionA, [bossA, minionA], 21, hasteEvents.emit), 10000, 'lane haste is removed immediately when its Boss dies');
    const guardEncounter = (0, boss_catalog_1.resolveBossEncounter)(1, 'easy', 10);
    strict_1.default.ok(guardEncounter);
    const guardBoss = { ...enemy('guard-boss', 'player-a', 'P1', 'boss', 40), waveNumber: 10 };
    const guardRuntime = new boss_runtime_1.BossCombatRuntimeV1(100);
    const guardEvents = eventSink();
    guardRuntime.registerBoss(guardBoss, guardEncounter, 0, guardEvents.emit);
    guardRuntime.advance({ tick: 0, enemies: [guardBoss], emit: guardEvents.emit });
    strict_1.default.equal(guardRuntime.snapshot().instances[0].skillStates[0].lifecycle, 'warning');
    guardRuntime.advance({ tick: 8, enemies: [guardBoss], emit: guardEvents.emit });
    strict_1.default.equal(guardRuntime.snapshot().instances[0].phase, 2);
    strict_1.default.ok(guardRuntime.damageTakenRatioBps(guardBoss, [guardBoss], 8, guardEvents.emit) < 10000);
    strict_1.default.ok(guardEvents.events.some((entry) => entry.type === 'BOSS_PHASE_CHANGED'));
    const normalGuard = (0, boss_catalog_1.resolveBossEncounter)(1, 'normal', 10);
    const hardGuard = (0, boss_catalog_1.resolveBossEncounter)(1, 'hard', 10);
    strict_1.default.ok(normalGuard && hardGuard);
    const reductionAt = (encounter) => {
        const runtime = new boss_runtime_1.BossCombatRuntimeV1(100);
        const sink = eventSink();
        const target = { ...guardBoss, id: `boss-${encounter.difficulty}` };
        runtime.registerBoss(target, encounter, 0, sink.emit);
        runtime.advance({ tick: 0, enemies: [target], emit: sink.emit });
        runtime.advance({ tick: 8, enemies: [target], emit: sink.emit });
        return runtime.damageTakenRatioBps(target, [target], 8, sink.emit);
    };
    strict_1.default.ok(reductionAt(hardGuard) < reductionAt(normalGuard));
    strict_1.default.ok(reductionAt(normalGuard) < reductionAt(guardEncounter));
    const unknownPluginEncounter = {
        catalogVersion: 'test',
        stats: { skillIntensityBps: 10000 },
        definition: {
            bossDefinitionId: 'plugin-isolation',
            displayName: '异常隔离测试',
            skills: [{ bindingId: 'bad', displayName: '坏插件', pluginId: 'missing_plugin', pluginVersion: 1,
                    trigger: 'periodic', parameters: {} }],
        },
    };
    const isolated = new boss_runtime_1.BossCombatRuntimeV1(100);
    const isolatedEvents = eventSink();
    const isolatedBoss = enemy('isolated', 'player-a', 'P1', 'boss');
    isolated.registerBoss(isolatedBoss, unknownPluginEncounter, 0, isolatedEvents.emit);
    strict_1.default.equal(isolated.snapshot().instances[0].skillStates[0].lifecycle, 'disabled');
    strict_1.default.equal(isolatedEvents.events.filter((entry) => entry.type === 'BOSS_SKILL_PLUGIN_ERROR').length, 1);
    return { deterministic: true, fourPlayerTwentyWave: true, spawning: true, spawnProtection: true, lifecycle: true,
        cleanup: true, multiplayerIsolation: true, pluginIsolation: true, difficultyIntensity: true };
}
if (require.main === module) {
    process.stdout.write(`${JSON.stringify(runBossRuntimeSmokeChecks())}\n`);
}
