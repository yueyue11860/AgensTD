"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPveV2SmokeChecks = runPveV2SmokeChecks;
const strict_1 = __importDefault(require("node:assert/strict"));
const arena_1 = require("./arena");
const runtime_1 = require("./runtime");
function firstSoldier(snapshot) {
    const tray = snapshot.players[0]?.tray ?? [];
    for (let index = 0; index < tray.length; index += 1) {
        const piece = tray[index];
        if (piece?.kind === 'soldier') {
            return { index, piece };
        }
    }
    throw new Error('First recruit batch did not contain a soldier');
}
function createPreparedRuntime(seed) {
    const runtime = new runtime_1.PveGameRuntime({
        seed,
        tickRateMs: 100,
        prepDurationMs: 0,
        maxWaves: 1,
        characterTokens: {
            杨: 2,
            戬: 2,
            孙: 2,
            悟: 2,
            空: 2,
        },
    });
    strict_1.default.equal(runtime.registerPlayer('player-1', 'P1').ok, true);
    strict_1.default.equal(runtime.handleAction('player-1', { type: 'RECRUIT_BATCH', actionId: 'recruit-1' }).ok, true);
    return runtime;
}
function runPveV2SmokeChecks() {
    strict_1.default.equal((0, arena_1.isDefaultDeployableCell)('P1', 12, 16), true);
    strict_1.default.equal((0, arena_1.isDefaultDeployableCell)('P1', 16, 16), false);
    strict_1.default.equal((0, arena_1.isDefaultDeployableCell)('P1', 13, 15), false);
    const runtime = createPreparedRuntime('smoke-combat');
    let snapshot = runtime.snapshot();
    strict_1.default.equal(snapshot.players[0].rice, 5);
    strict_1.default.equal(snapshot.players[0].nextRecruitCost, 7);
    strict_1.default.ok(snapshot.players[0].tray.some((piece) => piece?.kind === 'soldier'));
    strict_1.default.equal(runtime.handleAction('player-1', { type: 'RECRUIT_BATCH', actionId: 'recruit-2' }).code, 'INSUFFICIENT_RICE');
    const duplicateRecruit = runtime.handleAction('player-1', { type: 'RECRUIT_BATCH', actionId: 'recruit-1' });
    strict_1.default.equal(duplicateRecruit.ok, true);
    strict_1.default.equal(runtime.snapshot().players[0].rice, 5);
    const soldier = firstSoldier(snapshot);
    const placement = (0, arena_1.getDefaultSoldierPlacement)('P1');
    strict_1.default.equal(runtime.handleAction('player-1', {
        type: 'SWAP_TRAY_BOARD',
        actionId: 'deploy-1',
        trayIndex: soldier.index,
        boardX: placement.x,
        boardY: placement.y,
    }).ok, true);
    strict_1.default.equal(runtime.snapshot().players[0].populationUsed, 1);
    strict_1.default.equal(runtime.handleAction('player-1', {
        type: 'MOVE_BOARD_PIECE',
        actionId: 'invalid-foreign-zone',
        pieceId: soldier.piece.id,
        targetX: 16,
        targetY: 16,
    }).code, 'CELL_NOT_DEPLOYABLE');
    strict_1.default.equal(runtime.start().ok, true);
    for (let tick = 0; tick < 12000 && runtime.snapshot().status !== 'finished'; tick += 1) {
        runtime.tick();
    }
    snapshot = runtime.snapshot();
    strict_1.default.equal(snapshot.result?.outcome, 'victory');
    strict_1.default.equal(snapshot.players[0].rice, 14);
    strict_1.default.deepEqual(snapshot.players[0].clearedWaves, [1]);
    const mergeRuntime = new runtime_1.PveGameRuntime({ seed: 'smoke-merge', characterTokens: {} });
    strict_1.default.equal(mergeRuntime.registerPlayer('merge-player', 'P1').ok, true);
    strict_1.default.equal(mergeRuntime.handleAction('merge-player', { type: 'RECRUIT_BATCH', actionId: 'merge-recruit' }).ok, true);
    const mergeTray = mergeRuntime.snapshot().players[0].tray.filter((piece) => piece?.kind === 'soldier');
    let source = null;
    let target = null;
    for (let left = 0; left < mergeTray.length; left += 1) {
        for (let right = left + 1; right < mergeTray.length; right += 1) {
            if (mergeTray[left].soldierType === mergeTray[right].soldierType) {
                source = mergeTray[left];
                target = mergeTray[right];
                break;
            }
        }
        if (source) {
            break;
        }
    }
    strict_1.default.ok(source && target);
    strict_1.default.equal(mergeRuntime.handleAction('merge-player', {
        type: 'MERGE_SOLDIERS',
        actionId: 'merge-1',
        sourcePieceId: source.id,
        targetPieceId: target.id,
    }).ok, true);
    const mergedSnapshot = mergeRuntime.snapshot();
    strict_1.default.equal(mergedSnapshot.players[0].tray.filter(Boolean).length, 4);
    strict_1.default.ok(mergedSnapshot.players[0].tray.some((piece) => piece?.kind === 'soldier' && piece.level === 2));
    const deterministicA = createPreparedRuntime('same-seed');
    const deterministicB = createPreparedRuntime('same-seed');
    strict_1.default.deepEqual(deterministicA.snapshot(), deterministicB.snapshot());
    const forcedSoldierRuntime = new runtime_1.PveGameRuntime({
        seed: 'force-117588',
        characterTokens: { 杨: 100, 戬: 100, 孙: 100, 悟: 100, 空: 100 },
    });
    strict_1.default.equal(forcedSoldierRuntime.registerPlayer('forced', 'P1').ok, true);
    strict_1.default.equal(forcedSoldierRuntime.handleAction('forced', {
        type: 'RECRUIT_BATCH',
        actionId: 'forced-recruit',
    }).details?.firstBatchSoldierForced, true);
    const forcedTray = forcedSoldierRuntime.snapshot().players[0].tray;
    strict_1.default.equal(forcedTray.filter((piece) => piece?.kind === 'soldier').length, 1);
    strict_1.default.equal(forcedTray.filter((piece) => piece?.kind === 'character').length, 4);
    const retirementRuntime = new runtime_1.PveGameRuntime({ seed: 'retirement', prepDurationMs: 0, maxWaves: 2 });
    strict_1.default.equal(retirementRuntime.registerPlayer('stay', 'P1').ok, true);
    strict_1.default.equal(retirementRuntime.registerPlayer('leave', 'P2').ok, true);
    strict_1.default.equal(retirementRuntime.start().ok, true);
    retirementRuntime.tick();
    const spawnedBeforeLeave = retirementRuntime.snapshot().wave.lanes.find((lane) => lane.playerId === 'leave')?.spawnedCount;
    strict_1.default.equal(retirementRuntime.unregister('leave').ok, true);
    for (let tick = 0; tick < 30; tick += 1) {
        retirementRuntime.tick();
    }
    const retiredLane = retirementRuntime.snapshot().wave.lanes.find((lane) => lane.playerId === 'leave');
    strict_1.default.equal(retiredLane?.retired, true);
    strict_1.default.equal(retiredLane?.spawnedCount, spawnedBeforeLeave);
    strict_1.default.equal(retiredLane?.totalCount, spawnedBeforeLeave);
    strict_1.default.equal(retiredLane?.clearRewardGranted, false);
    return {
        deterministic: true,
        economy: true,
        deployment: true,
        merge: true,
        combat: true,
    };
}
