"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.E2E_RENDERER_STRESS_MATCH = exports.E2E_RENDERER_STRESS_ROOM = void 0;
exports.stressEnemies = stressEnemies;
exports.stressFullState = stressFullState;
exports.stressPatch = stressPatch;
exports.stressCombatBatch = stressCombatBatch;
exports.E2E_RENDERER_STRESS_ROOM = 'E2E-RENDERER-STRESS';
exports.E2E_RENDERER_STRESS_MATCH = 'e2e-renderer-protocol-stress';
const resources = { gold: 0, mana: 0, heat: 0, repair: 0, threat: 0, fortress: 100, fortressMax: 100 };
const boardPieces = Array.from({ length: 10 }, (_, index) => ({
    entityId: `stress-soldier-${index}`, ownerPlayerId: 'human-dev', kind: 'soldier',
    glyph: ['刀', '枪', '弓', '骑'][index % 4], soldierType: ['blade', 'spear', 'bow', 'cavalry'][index % 4],
    level: 3, nextAttackTick: 0, x: 10 + index % 5, y: 17 + Math.floor(index / 5) * 2,
}));
function stressEnemies(tick) {
    const glyphs = ['鬼', '怪', '妖', '魅'];
    return Array.from({ length: 80 }, (_, index) => {
        const progress = (index * 270 + tick * (8 + index % 5)) % 24_000;
        const side = Math.floor(progress / 6_000);
        const offset = (progress % 6_000) / 1000;
        const [x, y] = side === 0 ? [7 + offset, 7] : side === 1 ? [13, 7 + offset] : side === 2 ? [13 - offset, 13] : [7, 13 - offset];
        return {
            entityId: `stress-enemy-${index}`, entityKind: index === 79 ? 'boss' : 'ordinary_minion',
            bossDefinitionId: index === 79 ? 'stress-boss' : null, bossName: index === 79 ? '压力测试王' : null,
            controlResistanceBps: index === 79 ? 5000 : 0, bossPhase: index === 79 ? 2 : 0, activeCast: null,
            glyph: index === 79 ? '魔' : glyphs[index % glyphs.length], waveNumber: 20,
            homeLanePlayerId: 'human-dev', homeSlotId: 'P1', routeZone: 'public_loop', hp: 700 + index * 3, maxHp: 1000,
            armor: index % 4 === 2 ? 30 : 0, magicResistance: index % 4 === 3 ? 30 : 0,
            moveSpeedMilliCellsPerSecond: 1000 + index % 5 * 120, pathIndex: Math.floor(progress / 1000), pathProgressMilli: progress % 1000,
            lapCount: Math.floor((index * 270 + tick * (8 + index % 5)) / 24_000), spawnProtected: false, invulnerable: false, x, y,
        };
    });
}
function stressFullState(tick = 0) {
    const enemies = stressEnemies(tick);
    return {
        matchId: exports.E2E_RENDERER_STRESS_MATCH, tick, status: 'running', result: null,
        map: { width: 29, height: 29, cells: [] }, resources, towers: [], enemies: [], buildPalette: [],
        room: { playerCount: 1, enemyCount: 80, maxCapacity: 100, overloadTicks: 0, overloadCountdownSec: 0, totalGold: 0 },
        wave: { index: 20, label: '渲染协议压力' },
        pve: {
            schemaVersion: 2, combatRulesetVersion: 'pve-v2.3.0',
            configSnapshot: { schemaVersion: 1, runtimeKind: 'pve-v2', combatRulesetVersion: 'pve-v2.3.0', stageCatalogRevision: 'pve-stage-2026-08-25-v1', balanceCatalogRevision: 'pve-balance-2026-08-25-v3', stageId: 'e2e-renderer-stress', levelId: 1, difficulty: 'easy', balanceProfileId: 'renderer-only', tickRateMs: 100, prepDurationMs: 0, maxWaves: 20, initialWaveNumber: 20 },
            phase: 'running', tick,
            players: [{ playerId: 'human-dev', slotId: 'P1', rice: 0, recruitSequence: 0, nextRecruitCost: 999, populationUsed: 10, populationCap: 10, trayRevision: 0, reserveRevision: 0, boardRevision: 1, tray: Array.from({ length: 5 }, (_, index) => ({ index, piece: null })), reserve: Array.from({ length: 10 }, (_, index) => ({ index, piece: null })), discardedCharacters: [], itemRuntime: null, weaponLoadoutByGeneralId: {}, generalFormations: [], generalProgress: [], activeSynergies: [], clearedWaves: [], highestCompletedWave: 19 }],
            boardPieces, enemies, statuses: [], summonedUnits: [], zones: [], recentEvents: [],
            laneWaves: [{ playerId: 'human-dev', slotId: 'P1', waveNumber: 20, plannedSpawnCount: 80, spawnedCount: 80, aliveEnemyCount: 80, spawningCompleted: true, clearRewardRice: 0, clearRewardGranted: false }],
            currentWave: 20, maxWaves: 20, enemyCount: 80, maxCapacity: 100, overloadCountdownSec: 0,
        },
    };
}
function stressPatch(tick) {
    const enemies = stressEnemies(tick);
    return {
        tick, status: 'running', result: null, resources,
        room: { playerCount: 1, enemyCount: 80, maxCapacity: 100, overloadTicks: 0, overloadCountdownSec: 0, totalGold: 0 },
        wave: { index: 20, label: '渲染协议压力' }, enemies: [],
        pvePatch: { baseTick: tick - 10, tick, phase: 'running', currentWave: 20, maxWaves: 20, enemyCount: 80, maxCapacity: 100, overloadCountdownSec: 0, pveEnemyDelta: { upsert: enemies, remove: [] } },
    };
}
function stressCombatBatch(sequence, tick) {
    const target = `stress-enemy-${sequence % 80}`;
    return {
        matchId: exports.E2E_RENDERER_STRESS_MATCH, presentationVersion: 1, fromSeq: sequence, toSeq: sequence,
        events: [{ seq: sequence, id: `stress-event-${sequence}`, tick, type: sequence % 3 === 0 ? 'BASIC_ATTACK_STARTED' : 'DAMAGE_APPLIED', data: { sourcePieceId: `stress-soldier-${sequence % 10}`, targetEnemyId: target, damage: 33 }, actionId: `stress-action-${sequence}`, targetIds: [target], geometry: null }],
    };
}
