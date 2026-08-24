"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPveV2SmokeChecks = runPveV2SmokeChecks;
const strict_1 = __importDefault(require("node:assert/strict"));
const pve_stage_config_1 = require("../../../shared/contracts/pve-stage-config");
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
    strict_1.default.equal((0, arena_1.isDefaultDeployableCell)('P1', 17, 19), true);
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
        actionId: 'cross-territory-deploy',
        trayIndex: soldier.index,
        boardX: 17,
        boardY: 19,
    }).ok, true);
    strict_1.default.equal(runtime.snapshot().players[0].populationUsed, 1);
    strict_1.default.equal(runtime.handleAction('player-1', {
        type: 'MOVE_BOARD_PIECE',
        actionId: 'move-to-home-side',
        pieceId: soldier.piece.id,
        targetX: placement.x,
        targetY: placement.y,
    }).ok, true);
    strict_1.default.equal(runtime.handleAction('player-1', {
        type: 'MOVE_BOARD_PIECE',
        actionId: 'invalid-core-cell',
        pieceId: soldier.piece.id,
        targetX: 13,
        targetY: 15,
    }).code, 'CELL_NOT_DEPLOYABLE');
    strict_1.default.equal(runtime.start().ok, true);
    for (let tick = 0; tick < 12000 && runtime.snapshot().status !== 'finished'; tick += 1) {
        runtime.tick();
    }
    snapshot = runtime.snapshot();
    strict_1.default.equal(snapshot.result?.outcome, 'victory');
    strict_1.default.equal(snapshot.players[0].rice, 20);
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
    let chainRuntime = null;
    let chainPieces = [];
    for (let seedIndex = 0; seedIndex < 2000 && chainPieces.length < 4; seedIndex += 1) {
        const candidate = new runtime_1.PveGameRuntime({ seed: `tray-chain-${seedIndex}`, characterTokens: {} });
        strict_1.default.equal(candidate.registerPlayer('chain-player', 'P1').ok, true);
        strict_1.default.equal(candidate.handleAction('chain-player', { type: 'RECRUIT_BATCH', actionId: 'chain-recruit' }).ok, true);
        const soldiers = candidate.snapshot().players[0].tray.filter(isSoldierForSmoke);
        const matching = soldiers.filter((piece) => (soldiers.filter((other) => other.soldierType === piece.soldierType).length >= 4));
        if (matching.length >= 4) {
            chainRuntime = candidate;
            chainPieces = matching.slice(0, 4);
        }
    }
    strict_1.default.ok(chainRuntime && chainPieces.length === 4);
    const chainIndexes = chainPieces.map((piece) => (chainRuntime.snapshot().players[0].tray.findIndex((candidate) => candidate?.id === piece.id)));
    strict_1.default.ok(chainIndexes.every((index) => index >= 0));
    strict_1.default.equal(chainRuntime.handleAction('chain-player', {
        type: 'SWAP_STORAGE_PIECES', actionId: 'chain-store-1',
        sourceZone: 'tray', sourceIndex: chainIndexes[0], targetZone: 'reserve', targetIndex: 0,
    }).ok, true);
    strict_1.default.equal(chainRuntime.handleAction('chain-player', {
        type: 'SWAP_STORAGE_PIECES', actionId: 'chain-store-2',
        sourceZone: 'tray', sourceIndex: chainIndexes[1], targetZone: 'reserve', targetIndex: 1,
    }).ok, true);
    strict_1.default.equal(chainRuntime.handleAction('chain-player', {
        type: 'MERGE_SOLDIERS', actionId: 'chain-merge-reserve',
        sourcePieceId: chainPieces[0].id, targetPieceId: chainPieces[1].id,
    }).ok, true);
    strict_1.default.equal(chainRuntime.handleAction('chain-player', {
        type: 'MERGE_SOLDIERS', actionId: 'chain-merge-tray',
        sourcePieceId: chainPieces[2].id, targetPieceId: chainPieces[3].id,
    }).ok, true);
    const chainMiddleSnapshot = chainRuntime.snapshot().players[0];
    const reserveLevelTwo = chainMiddleSnapshot.reserve.find((piece) => piece?.kind === 'soldier' && piece.level === 2);
    const trayLevelTwo = chainMiddleSnapshot.tray.find((piece) => piece?.kind === 'soldier' && piece.level === 2);
    strict_1.default.ok(reserveLevelTwo && trayLevelTwo);
    strict_1.default.equal(chainRuntime.handleAction('chain-player', {
        type: 'MERGE_SOLDIERS', actionId: 'chain-merge-cross-storage',
        sourcePieceId: reserveLevelTwo.id, targetPieceId: trayLevelTwo.id,
    }).ok, true);
    const levelThreeSlot = chainRuntime.snapshot().players[0].tray.findIndex((piece) => piece?.kind === 'soldier' && piece.level === 3);
    strict_1.default.ok(levelThreeSlot >= 0);
    strict_1.default.equal(chainRuntime.handleAction('chain-player', {
        type: 'SWAP_TRAY_BOARD', actionId: 'chain-deploy', trayIndex: levelThreeSlot, boardX: 9, boardY: 17,
    }).ok, true);
    strict_1.default.equal(chainRuntime.snapshot().players[0].boardPieces[0].piece.level, 3);
    const storageSwapRuntime = new runtime_1.PveGameRuntime({ seed: 'storage-swap', characterTokens: {} });
    strict_1.default.equal(storageSwapRuntime.registerPlayer('storage-player', 'P1').ok, true);
    strict_1.default.equal(storageSwapRuntime.handleAction('storage-player', {
        type: 'RECRUIT_BATCH', actionId: 'storage-recruit',
    }).ok, true);
    const storageInitial = storageSwapRuntime.snapshot().players[0].tray;
    const storageIds = storageInitial.slice(0, 4).map((piece) => piece?.id);
    strict_1.default.ok(storageIds.every(Boolean));
    strict_1.default.equal(storageSwapRuntime.handleAction('storage-player', {
        type: 'SWAP_STORAGE_PIECES', actionId: 'storage-tray-reserve-a',
        sourceZone: 'tray', sourceIndex: 0, targetZone: 'reserve', targetIndex: 0,
    }).ok, true);
    strict_1.default.equal(storageSwapRuntime.handleAction('storage-player', {
        type: 'SWAP_STORAGE_PIECES', actionId: 'storage-tray-reserve-b',
        sourceZone: 'tray', sourceIndex: 1, targetZone: 'reserve', targetIndex: 1,
    }).ok, true);
    strict_1.default.equal(storageSwapRuntime.handleAction('storage-player', {
        type: 'SWAP_STORAGE_PIECES', actionId: 'storage-reserve-reserve',
        sourceZone: 'reserve', sourceIndex: 0, targetZone: 'reserve', targetIndex: 1,
    }).ok, true);
    strict_1.default.equal(storageSwapRuntime.handleAction('storage-player', {
        type: 'SWAP_STORAGE_PIECES', actionId: 'storage-reserve-tray-occupied',
        sourceZone: 'reserve', sourceIndex: 0, targetZone: 'tray', targetIndex: 2,
    }).ok, true);
    strict_1.default.equal(storageSwapRuntime.handleAction('storage-player', {
        type: 'SWAP_STORAGE_PIECES', actionId: 'storage-tray-tray-occupied',
        sourceZone: 'tray', sourceIndex: 2, targetZone: 'tray', targetIndex: 3,
    }).ok, true);
    const storageFinal = storageSwapRuntime.snapshot().players[0];
    strict_1.default.equal(storageFinal.populationUsed, 0);
    strict_1.default.equal(storageFinal.reserve[1]?.id, storageIds[0]);
    strict_1.default.equal(storageFinal.tray[3]?.id, storageIds[1]);
    strict_1.default.equal(storageFinal.tray[2]?.id, storageIds[3]);
    const directMergeRuntime = new runtime_1.PveGameRuntime({ seed: 'direct-board-merge', characterTokens: {} });
    strict_1.default.equal(directMergeRuntime.registerPlayer('direct-player', 'P1').ok, true);
    strict_1.default.equal(directMergeRuntime.handleAction('direct-player', {
        type: 'RECRUIT_BATCH',
        actionId: 'direct-recruit',
    }).ok, true);
    const directTray = directMergeRuntime.snapshot().players[0].tray;
    let directSourceIndex = -1;
    let directTargetIndex = -1;
    for (let left = 0; left < directTray.length; left += 1) {
        for (let right = left + 1; right < directTray.length; right += 1) {
            const leftPiece = directTray[left];
            const rightPiece = directTray[right];
            if (isSoldierForSmoke(leftPiece) && isSoldierForSmoke(rightPiece) && leftPiece.soldierType === rightPiece.soldierType) {
                directSourceIndex = left;
                directTargetIndex = right;
                break;
            }
        }
        if (directSourceIndex >= 0)
            break;
    }
    strict_1.default.ok(directSourceIndex >= 0 && directTargetIndex >= 0);
    const directSource = directTray[directSourceIndex];
    const directTarget = directTray[directTargetIndex];
    strict_1.default.equal(directMergeRuntime.handleAction('direct-player', {
        type: 'SWAP_TRAY_BOARD',
        actionId: 'direct-deploy-target',
        trayIndex: directTargetIndex,
        boardX: 9,
        boardY: 17,
    }).ok, true);
    strict_1.default.equal(directMergeRuntime.handleAction('direct-player', {
        type: 'MERGE_SOLDIERS',
        actionId: 'direct-merge',
        sourcePieceId: directSource.id,
        targetPieceId: directTarget.id,
    }).ok, true);
    let directSnapshot = directMergeRuntime.snapshot();
    strict_1.default.equal(directSnapshot.players[0].boardPieces.length, 1);
    strict_1.default.equal(directSnapshot.players[0].boardPieces[0].piece.level, 2);
    strict_1.default.equal(directSnapshot.players[0].populationUsed, 1);
    const swapCandidates = directSnapshot.players[0].tray
        .map((piece, index) => ({ piece, index }))
        .filter((candidate) => candidate.piece?.kind === 'soldier')
        .slice(0, 2);
    strict_1.default.equal(swapCandidates.length, 2);
    strict_1.default.equal(directMergeRuntime.handleAction('direct-player', {
        type: 'SWAP_TRAY_BOARD', actionId: 'swap-deploy-a', trayIndex: swapCandidates[0].index, boardX: 8, boardY: 17,
    }).ok, true);
    strict_1.default.equal(directMergeRuntime.handleAction('direct-player', {
        type: 'SWAP_TRAY_BOARD', actionId: 'swap-deploy-b', trayIndex: swapCandidates[1].index, boardX: 8, boardY: 16,
    }).ok, true);
    strict_1.default.equal(directMergeRuntime.handleAction('direct-player', {
        type: 'MOVE_BOARD_PIECE', actionId: 'direct-board-swap', pieceId: swapCandidates[0].piece.id, targetX: 8, targetY: 16,
    }).ok, true);
    directSnapshot = directMergeRuntime.snapshot();
    const swappedA = directSnapshot.players[0].boardPieces.find(({ piece }) => piece.id === swapCandidates[0].piece.id);
    const swappedB = directSnapshot.players[0].boardPieces.find(({ piece }) => piece.id === swapCandidates[1].piece.id);
    strict_1.default.deepEqual(swappedA && { x: swappedA.x, y: swappedA.y }, { x: 8, y: 16 });
    strict_1.default.deepEqual(swappedB && { x: swappedB.x, y: swappedB.y }, { x: 8, y: 17 });
    const reserveRuntime = new runtime_1.PveGameRuntime({ seed: 'reserve-flow', characterTokens: {} });
    strict_1.default.equal(reserveRuntime.registerPlayer('reserve-player', 'P1').ok, true);
    strict_1.default.equal(reserveRuntime.handleAction('reserve-player', {
        type: 'RECRUIT_BATCH', actionId: 'reserve-recruit',
    }).ok, true);
    const reserveTray = reserveRuntime.snapshot().players[0].tray;
    const reserveSoldiers = reserveTray
        .map((piece, index) => ({ piece, index }))
        .filter((candidate) => candidate.piece?.kind === 'soldier');
    strict_1.default.ok(reserveSoldiers.length >= 2);
    strict_1.default.equal(reserveRuntime.handleAction('reserve-player', {
        type: 'SWAP_TRAY_BOARD', actionId: 'reserve-deploy-a', trayIndex: reserveSoldiers[0].index, boardX: 9, boardY: 17,
    }).ok, true);
    strict_1.default.equal(reserveRuntime.handleAction('reserve-player', {
        type: 'SWAP_TRAY_BOARD', actionId: 'reserve-deploy-b', trayIndex: reserveSoldiers[1].index, boardX: 8, boardY: 17,
    }).ok, true);
    strict_1.default.equal(reserveRuntime.snapshot().players[0].populationUsed, 2);
    strict_1.default.equal(reserveRuntime.handleAction('reserve-player', {
        type: 'SWAP_RESERVE_BOARD', actionId: 'reserve-store', reserveIndex: 0, boardX: 9, boardY: 17,
    }).ok, true);
    let reserveSnapshot = reserveRuntime.snapshot();
    strict_1.default.equal(reserveSnapshot.players[0].populationUsed, 1);
    strict_1.default.equal(reserveSnapshot.players[0].reserve[0]?.id, reserveSoldiers[0].piece.id);
    const staleReserveRevision = reserveSnapshot.players[0].reserveRevision - 1;
    strict_1.default.equal(reserveRuntime.handleAction('reserve-player', {
        type: 'SWAP_RESERVE_BOARD', actionId: 'reserve-stale', reserveIndex: 0, boardX: 8, boardY: 17,
        expectedReserveRevision: staleReserveRevision,
    }).code, 'STALE_RESERVE_REVISION');
    strict_1.default.equal(reserveRuntime.handleAction('reserve-player', {
        type: 'SWAP_RESERVE_BOARD', actionId: 'reserve-swap', reserveIndex: 0, boardX: 8, boardY: 17,
    }).ok, true);
    reserveSnapshot = reserveRuntime.snapshot();
    strict_1.default.equal(reserveSnapshot.players[0].populationUsed, 1);
    strict_1.default.equal(reserveSnapshot.players[0].reserve[0]?.id, reserveSoldiers[1].piece.id);
    strict_1.default.equal(reserveSnapshot.players[0].boardPieces.find(({ x, y }) => x === 8 && y === 17)?.piece.id, reserveSoldiers[0].piece.id);
    strict_1.default.equal(reserveRuntime.handleAction('reserve-player', {
        type: 'EXILE_RESERVE', actionId: 'reserve-exile', expectedReserveRevision: reserveSnapshot.players[0].reserveRevision,
    }).details?.exiledCount, 1);
    reserveSnapshot = reserveRuntime.snapshot();
    strict_1.default.deepEqual(reserveSnapshot.players[0].reserve, [null, null]);
    strict_1.default.equal(reserveRuntime.handleAction('reserve-player', {
        type: 'EXILE_RESERVE', actionId: 'reserve-exile-empty', expectedReserveRevision: reserveSnapshot.players[0].reserveRevision,
    }).details?.exiledCount, 0);
    let houyiRuntime = null;
    for (let seedIndex = 0; seedIndex < 5000 && !houyiRuntime; seedIndex += 1) {
        const candidate = new runtime_1.PveGameRuntime({
            seed: `houyi-integration-${seedIndex}`,
            prepDurationMs: 0,
            maxWaves: 1,
            characterTokens: { 后: 1, 羿: 1 },
        });
        candidate.registerPlayer('houyi-player', 'P1');
        candidate.handleAction('houyi-player', { type: 'RECRUIT_BATCH', actionId: 'houyi-recruit' });
        const glyphs = candidate.snapshot().players[0].tray.flatMap((piece) => (piece?.kind === 'character' ? [piece.glyph] : []));
        if (glyphs.includes('后') && glyphs.includes('羿'))
            houyiRuntime = candidate;
    }
    strict_1.default.ok(houyiRuntime, 'A deterministic seed should recruit both Houyi glyphs in the first batch');
    const houyiTray = houyiRuntime.snapshot().players[0].tray;
    const houIndex = houyiTray.findIndex((piece) => piece?.kind === 'character' && piece.glyph === '后');
    const yiIndex = houyiTray.findIndex((piece) => piece?.kind === 'character' && piece.glyph === '羿');
    strict_1.default.equal(houyiRuntime.handleAction('houyi-player', {
        type: 'SWAP_TRAY_BOARD', actionId: 'deploy-hou', trayIndex: houIndex, boardX: 11, boardY: 17,
    }).ok, true);
    strict_1.default.equal(houyiRuntime.handleAction('houyi-player', {
        type: 'SWAP_TRAY_BOARD', actionId: 'deploy-yi', trayIndex: yiIndex, boardX: 12, boardY: 17,
    }).ok, true);
    let houyiSnapshot = houyiRuntime.snapshot();
    strict_1.default.equal(houyiSnapshot.players[0].populationUsed, 1);
    strict_1.default.equal(houyiSnapshot.players[0].generalFormations[0]?.generalId, 'houyi');
    strict_1.default.equal(houyiSnapshot.players[0].generalProgress[0]?.attack, 34);
    strict_1.default.equal(houyiSnapshot.players[0].generalProgress[0]?.attackRangeMilliCells, 3000);
    const firstFormationId = houyiSnapshot.players[0].generalFormations[0]?.formationId;
    strict_1.default.ok(firstFormationId);
    strict_1.default.equal(houyiRuntime.handleAction('houyi-player', {
        type: 'SET_GENERAL_FIXED', actionId: 'fix-houyi', formationId: firstFormationId, fixed: true,
    }).ok, true);
    const yiPieceId = houyiSnapshot.players[0].boardPieces.find(({ piece }) => (piece.kind === 'character' && piece.glyph === '羿'))?.piece.id;
    strict_1.default.ok(yiPieceId);
    strict_1.default.equal(houyiRuntime.handleAction('houyi-player', {
        type: 'MOVE_BOARD_PIECE', actionId: 'fixed-single-move-rejected', pieceId: yiPieceId, targetX: 8, targetY: 17,
    }).code, 'GENERAL_FIXED');
    strict_1.default.equal(houyiRuntime.handleAction('houyi-player', {
        type: 'MOVE_FIXED_GENERAL', actionId: 'move-fixed-houyi', formationId: firstFormationId,
        targetStartX: 10, targetStartY: 17,
    }).ok, true);
    strict_1.default.equal(houyiRuntime.start().ok, true);
    for (let tick = 0; tick < 150; tick += 1) {
        houyiRuntime.tick();
        if ((houyiRuntime.snapshot().players[0].generalProgress[0]?.experiencePoints ?? 0) > 0)
            break;
    }
    houyiSnapshot = houyiRuntime.snapshot();
    const experienceBeforeDisband = houyiSnapshot.players[0].generalProgress[0]?.experiencePoints ?? 0;
    strict_1.default.ok(experienceBeforeDisband > 0, 'Houyi should deal a killing contribution and receive experience');
    strict_1.default.equal(houyiRuntime.handleAction('houyi-player', {
        type: 'SET_GENERAL_FIXED', actionId: 'unfix-houyi', formationId: firstFormationId, fixed: false,
    }).ok, true);
    strict_1.default.equal(houyiRuntime.handleAction('houyi-player', {
        type: 'MOVE_BOARD_PIECE', actionId: 'disband-houyi', pieceId: yiPieceId, targetX: 8, targetY: 17,
    }).ok, true);
    houyiSnapshot = houyiRuntime.snapshot();
    strict_1.default.equal(houyiSnapshot.players[0].generalFormations.length, 0);
    strict_1.default.equal(houyiSnapshot.players[0].populationUsed, 0);
    strict_1.default.equal(houyiSnapshot.players[0].generalProgress[0]?.experiencePoints, experienceBeforeDisband);
    strict_1.default.equal(houyiRuntime.handleAction('houyi-player', {
        type: 'MOVE_BOARD_PIECE', actionId: 'reform-houyi', pieceId: yiPieceId, targetX: 11, targetY: 17,
    }).ok, true);
    houyiSnapshot = houyiRuntime.snapshot();
    strict_1.default.equal(houyiSnapshot.players[0].generalFormations[0]?.generalId, 'houyi');
    strict_1.default.equal(houyiSnapshot.players[0].generalProgress[0]?.experiencePoints, experienceBeforeDisband);
    const firstWavePrepRuntime = new runtime_1.PveGameRuntime({
        seed: 'first-wave-five-second-prep',
        tickRateMs: 100,
        maxWaves: 1,
    });
    strict_1.default.equal(firstWavePrepRuntime.registerPlayer('first-wave-player', 'P1').ok, true);
    strict_1.default.equal(firstWavePrepRuntime.start().ok, true);
    let firstWavePrepSnapshot = firstWavePrepRuntime.snapshot();
    strict_1.default.equal(firstWavePrepSnapshot.wave.number, 1);
    strict_1.default.equal(firstWavePrepSnapshot.wave.phase, 'prep');
    strict_1.default.equal(firstWavePrepSnapshot.wave.prepRemainingTicks, runtime_1.PVE_WAVE_PREP_DURATION_MS / 100);
    strict_1.default.equal(firstWavePrepSnapshot.enemies.length, 0);
    for (let tick = 0; tick < (runtime_1.PVE_WAVE_PREP_DURATION_MS / 100) - 1; tick += 1) {
        firstWavePrepSnapshot = firstWavePrepRuntime.tick();
        strict_1.default.equal(firstWavePrepSnapshot.enemies.length, 0);
    }
    strict_1.default.equal(firstWavePrepSnapshot.wave.phase, 'prep');
    strict_1.default.equal(firstWavePrepSnapshot.wave.prepRemainingTicks, 1);
    firstWavePrepSnapshot = firstWavePrepRuntime.tick();
    strict_1.default.equal(firstWavePrepSnapshot.wave.phase, 'spawning');
    strict_1.default.equal(firstWavePrepSnapshot.enemies.length, 1);
    strict_1.default.equal(firstWavePrepSnapshot.recentEvents.find((event) => event.type === 'ENEMY_SPAWNED')?.tick, runtime_1.PVE_WAVE_PREP_DURATION_MS / 100);
    const timedWaveRuntime = new runtime_1.PveGameRuntime({
        seed: 'timed-overlapping-waves',
        tickRateMs: 100,
        prepDurationMs: 500,
        maxWaves: 2,
    });
    strict_1.default.equal(timedWaveRuntime.registerPlayer('timed-player', 'P1').ok, true);
    strict_1.default.equal(timedWaveRuntime.start().ok, true);
    let sawFirstWaveSpawning = false;
    let reachedInterWaveCountdown = false;
    for (let tick = 0; tick < 500 && !reachedInterWaveCountdown; tick += 1) {
        const timedSnapshot = timedWaveRuntime.tick();
        if (timedSnapshot.wave.number === 1 && timedSnapshot.wave.phase === 'spawning') {
            sawFirstWaveSpawning = true;
        }
        reachedInterWaveCountdown = sawFirstWaveSpawning
            && timedSnapshot.wave.number === 1
            && timedSnapshot.wave.phase === 'prep';
    }
    let timedSnapshot = timedWaveRuntime.snapshot();
    strict_1.default.equal(reachedInterWaveCountdown, true);
    strict_1.default.equal(timedSnapshot.wave.prepRemainingTicks, 5);
    strict_1.default.ok(timedSnapshot.enemies.some((enemy) => enemy.waveNumber === 1));
    for (let tick = 0; tick < 4; tick += 1)
        timedWaveRuntime.tick();
    timedSnapshot = timedWaveRuntime.snapshot();
    strict_1.default.equal(timedSnapshot.wave.number, 1);
    strict_1.default.equal(timedSnapshot.wave.phase, 'prep');
    strict_1.default.equal(timedSnapshot.wave.prepRemainingTicks, 1);
    timedSnapshot = timedWaveRuntime.tick();
    strict_1.default.equal(timedSnapshot.wave.number, 2);
    strict_1.default.equal(timedSnapshot.wave.phase, 'spawning');
    strict_1.default.ok(timedSnapshot.enemies.some((enemy) => enemy.waveNumber === 1));
    strict_1.default.ok(timedSnapshot.enemies.some((enemy) => enemy.waveNumber === 2));
    // 出生方格真实边界是 12.5～15.5；半径 0.406 的身体后缘必须严格越线。
    strict_1.default.equal((0, arena_1.hasEnemyBodyFullyExitedPveSpawnSquareMilli)(12094, 14000), false);
    strict_1.default.equal((0, arena_1.hasEnemyBodyFullyExitedPveSpawnSquareMilli)(12093, 14000), true);
    strict_1.default.equal((0, arena_1.hasEnemyBodyFullyExitedPveSpawnSquareMilli)(15906, 14000), false);
    strict_1.default.equal((0, arena_1.hasEnemyBodyFullyExitedPveSpawnSquareMilli)(15907, 14000), true);
    strict_1.default.equal((0, arena_1.hasEnemyBodyFullyExitedPveSpawnSquareMilli)(14000, 12094), false);
    strict_1.default.equal((0, arena_1.hasEnemyBodyFullyExitedPveSpawnSquareMilli)(14000, 12093), true);
    strict_1.default.equal((0, arena_1.hasEnemyBodyFullyExitedPveSpawnSquareMilli)(14000, 15906), false);
    strict_1.default.equal((0, arena_1.hasEnemyBodyFullyExitedPveSpawnSquareMilli)(14000, 15907), true);
    strict_1.default.equal(arena_1.PVE_ENEMY_BODY_RADIUS_MILLI, 406);
    strict_1.default.equal(pve_stage_config_1.PVE_STAGE_DEFINITIONS.length, 10);
    strict_1.default.deepEqual(pve_stage_config_1.PVE_STAGE_DEFINITIONS.map(({ levelId }) => levelId), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const configuredMinionGlyphs = new Set();
    for (const stageDefinition of pve_stage_config_1.PVE_STAGE_DEFINITIONS) {
        strict_1.default.ok(stageDefinition.minionGlyphs.length >= 1 && stageDefinition.minionGlyphs.length <= 4);
        strict_1.default.equal(new Set(stageDefinition.minionGlyphs).size, stageDefinition.minionGlyphs.length);
        strict_1.default.equal(stageDefinition.waveGlyphPools.length, 20);
        for (const glyph of stageDefinition.minionGlyphs)
            configuredMinionGlyphs.add(glyph);
        for (const pool of stageDefinition.waveGlyphPools) {
            strict_1.default.ok(pool.length >= 1 && pool.length <= 4);
            strict_1.default.ok(pool.every((glyph) => stageDefinition.minionGlyphs.includes(glyph)));
        }
    }
    strict_1.default.deepEqual([...configuredMinionGlyphs].sort(), [...pve_stage_config_1.PVE_MINION_GLYPHS].sort());
    const webbedHollow = pve_stage_config_1.PVE_STAGE_DEFINITIONS.find(({ levelId }) => levelId === 7);
    strict_1.default.ok(webbedHollow);
    const themedRuntime = new runtime_1.PveGameRuntime({
        seed: 'stage-glyph-pool',
        prepDurationMs: 0,
        maxWaves: 1,
        waveGlyphPools: webbedHollow.waveGlyphPools,
    });
    strict_1.default.equal(themedRuntime.registerPlayer('themed-player', 'P1').ok, true);
    strict_1.default.equal(themedRuntime.start().ok, true);
    themedRuntime.tick();
    strict_1.default.ok(themedRuntime.snapshot().enemies.length > 0);
    strict_1.default.ok(themedRuntime.snapshot().enemies.every((enemy) => enemy.glyph === '蛛'));
    const fourLaneSpawnRuntime = new runtime_1.PveGameRuntime({
        seed: 'four-lane-body-exit',
        prepDurationMs: 0,
        maxWaves: 1,
    });
    for (const slot of ['P1', 'P2', 'P3', 'P4']) {
        strict_1.default.equal(fourLaneSpawnRuntime.registerPlayer(`spawn-${slot}`, slot).ok, true);
    }
    strict_1.default.equal(fourLaneSpawnRuntime.start().ok, true);
    const fourLaneSpawnSnapshot = fourLaneSpawnRuntime.tick();
    strict_1.default.equal(fourLaneSpawnSnapshot.enemies.length, 4);
    strict_1.default.ok(fourLaneSpawnSnapshot.enemies.every((enemy) => (enemy.spawnProtected === true && enemy.invulnerable === false)));
    let fourLaneExitSnapshot = fourLaneSpawnSnapshot;
    let enteredSlots = new Set();
    for (let tick = 0; tick < 30 && enteredSlots.size < 4; tick += 1) {
        fourLaneExitSnapshot = fourLaneSpawnRuntime.tick();
        const enteredEvents = fourLaneExitSnapshot.recentEvents.filter((event) => (event.type === 'ENEMY_ENTERED_BATTLEFIELD'));
        enteredSlots = new Set(enteredEvents.map((event) => String(event.data.laneSlot)));
        for (const event of enteredEvents) {
            strict_1.default.equal((0, arena_1.hasEnemyBodyFullyExitedPveSpawnSquareMilli)(Number(event.data.xMilli), Number(event.data.yMilli)), true);
        }
    }
    strict_1.default.deepEqual([...enteredSlots].sort(), ['P1', 'P2', 'P3', 'P4']);
    const bodyExitRuntime = new runtime_1.PveGameRuntime({ seed: 'body-exit-targeting', prepDurationMs: 0, maxWaves: 1 });
    strict_1.default.equal(bodyExitRuntime.registerPlayer('target-player', 'P1').ok, true);
    strict_1.default.equal(bodyExitRuntime.handleAction('target-player', { type: 'RECRUIT_BATCH', actionId: 'target-recruit' }).ok, true);
    const targetSoldier = firstSoldier(bodyExitRuntime.snapshot());
    strict_1.default.equal(bodyExitRuntime.handleAction('target-player', {
        type: 'SWAP_TRAY_BOARD', actionId: 'target-deploy', trayIndex: targetSoldier.index, boardX: 12, boardY: 16,
    }).ok, true);
    strict_1.default.equal(bodyExitRuntime.start().ok, true);
    let enteredBattlefieldEvent;
    let firstDamageEvent;
    for (let tick = 0; tick < 40 && !firstDamageEvent; tick += 1) {
        const next = bodyExitRuntime.tick();
        for (const enemy of next.enemies.filter((candidate) => candidate.spawnProtected)) {
            strict_1.default.equal(enemy.currentHp, enemy.maxHp);
            strict_1.default.equal((0, arena_1.hasEnemyBodyFullyExitedPveSpawnSquareMilli)(enemy.xMilli, enemy.yMilli), false);
        }
        enteredBattlefieldEvent ??= next.recentEvents.find((event) => (event.type === 'ENEMY_ENTERED_BATTLEFIELD'));
        firstDamageEvent = next.recentEvents.find((event) => event.type === 'DAMAGE_APPLIED');
    }
    strict_1.default.ok(enteredBattlefieldEvent);
    strict_1.default.ok(firstDamageEvent);
    strict_1.default.ok(firstDamageEvent.tick >= enteredBattlefieldEvent.tick);
    // 即使固定间隔已到，只要上一只仍在出生方格内，同一路线就不能生成下一只。
    // 自定义路线故意让第一只在中央方格内绕行超过第一波的 2.5 秒固定间隔。
    const spawnGateRuntime = new runtime_1.PveGameRuntime({
        seed: 'per-lane-spawn-gate',
        prepDurationMs: 0,
        maxWaves: 1,
        eventHistoryLimit: 500,
        laneRoutes: {
            P1: {
                waypoints: [
                    { x: 13, y: 15 },
                    { x: 15, y: 15 },
                    { x: 15, y: 13 },
                    { x: 10, y: 13 },
                    { x: 10, y: 7 },
                    { x: 7, y: 7 },
                ],
                loopStartIndex: 3,
            },
        },
    });
    strict_1.default.equal(spawnGateRuntime.registerPlayer('gate-player', 'P1').ok, true);
    strict_1.default.equal(spawnGateRuntime.start().ok, true);
    for (let tick = 0; tick < 30; tick += 1)
        spawnGateRuntime.tick();
    let spawnGateSnapshot = spawnGateRuntime.snapshot();
    strict_1.default.equal(spawnGateSnapshot.recentEvents.filter((event) => event.type === 'ENEMY_SPAWNED').length, 1);
    strict_1.default.equal(spawnGateSnapshot.enemies[0]?.spawnProtected, true);
    let secondSpawnEvent;
    for (let tick = 0; tick < 70 && !secondSpawnEvent; tick += 1) {
        spawnGateSnapshot = spawnGateRuntime.tick();
        const spawnEvents = spawnGateSnapshot.recentEvents.filter((event) => event.type === 'ENEMY_SPAWNED');
        secondSpawnEvent = spawnEvents[1];
    }
    const firstExitEvent = spawnGateSnapshot.recentEvents.find((event) => (event.type === 'ENEMY_ENTERED_BATTLEFIELD'));
    strict_1.default.ok(firstExitEvent);
    strict_1.default.ok(secondSpawnEvent);
    strict_1.default.ok(secondSpawnEvent.tick > firstExitEvent.tick);
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
        reserve: true,
        hero: true,
        waveTiming: true,
        combat: true,
    };
}
function isSoldierForSmoke(piece) {
    return piece?.kind === 'soldier';
}
