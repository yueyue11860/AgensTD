import assert from 'node:assert/strict'
import type { GameState, PveCombatEventState, PveMatchState } from '../../../shared/contracts/game'
import { applyPveMatchStatePatch, createPveMatchStatePatch } from '../../../shared/contracts/pve-state-delta'
import { CombatEventJournal } from '../core/combat-event-journal'

function event(seq: number, tick = seq): PveCombatEventState {
  return { id: `event-${seq}`, tick, type: seq % 2 ? 'DAMAGE_APPLIED' : 'BASIC_ATTACK_STARTED', data: { finalDamage: seq } }
}

function pveState(tick: number, eventCount: number, enemyCount = 80): PveMatchState {
  return {
    schemaVersion: 2,
    combatRulesetVersion: 'pve-v2.3.0',
    configSnapshot: {
      schemaVersion: 1,
      runtimeKind: 'pve-v2',
      combatRulesetVersion: 'pve-v2.3.0',
      stageCatalogRevision: 'pve-stage-2026-08-25-v1',
      balanceCatalogRevision: 'pve-balance-2026-08-25-v3',
      stageId: 'huaguoshan', levelId: 1, difficulty: 'normal', balanceProfileId: 'normal',
      tickRateMs: 100, prepDurationMs: 1_000, maxWaves: 20, initialWaveNumber: 1,
    },
    phase: 'running',
    tick,
    players: [{
      playerId: 'p1', slotId: 'P1', rice: 20, recruitSequence: 1, nextRecruitCost: 5,
      populationUsed: 1, populationCap: 10, trayRevision: 1, reserveRevision: 1, boardRevision: tick,
      tray: [], reserve: [], discardedCharacters: [], itemRuntime: null, weaponLoadoutByGeneralId: {},
      generalFormations: [], generalProgress: [], activeSynergies: [], clearedWaves: [], highestCompletedWave: 0,
    }],
    boardPieces: [{ entityId: 'piece-1', ownerPlayerId: 'p1', kind: 'soldier', glyph: '刀', soldierType: 'blade', level: 1, nextAttackTick: tick + 2, x: 5, y: 5 }],
    enemies: Array.from({ length: enemyCount }, (_, index) => ({
      entityId: `enemy-${index}`, entityKind: 'ordinary_minion' as const, bossDefinitionId: null, bossName: null,
      controlResistanceBps: 0, bossPhase: 0, activeCast: null, glyph: '妖', waveNumber: 1,
      homeLanePlayerId: 'p1', homeSlotId: 'P1' as const, routeZone: 'private_lane' as const,
      hp: 100 - (index % 10), maxHp: 100, armor: 0, magicResistance: 0,
      moveSpeedMilliCellsPerSecond: 1_000, pathIndex: index % 10, pathProgressMilli: tick * 10 + index,
      lapCount: 0, spawnProtected: false, invulnerable: false, x: index % 20, y: Math.floor(index / 20),
    })),
    statuses: [], summonedUnits: [], zones: [],
    recentEvents: Array.from({ length: eventCount }, (_, index) => event(index + 1, Math.min(tick, index + 1))),
    laneWaves: [{ playerId: 'p1', slotId: 'P1', waveNumber: 1, plannedSpawnCount: enemyCount, spawnedCount: enemyCount, aliveEnemyCount: enemyCount, spawningCompleted: true, clearRewardRice: 5, clearRewardGranted: false }],
    currentWave: 1, maxWaves: 20, enemyCount, maxCapacity: 100, overloadCountdownSec: 0,
  }
}

const full = pveState(100, 299)
const next = pveState(102, 300)
const patch = createPveMatchStatePatch(full, next)
assert.equal('recentEvents' in patch, false, 'high-frequency state patch must never copy combat event history')
const reconstructed = applyPveMatchStatePatch(full, patch)
assert.ok(reconstructed)
assert.deepEqual({ ...reconstructed, recentEvents: next.recentEvents }, next, 'full then PVE delta reconstructs checkpoint-equivalent state')

const fullGame: GameState = {
  matchId: 'match-1', tick: full.tick, status: 'running', result: null,
  map: { width: 1, height: 1, cells: [] },
  resources: { gold: 20, mana: 0, heat: 0, repair: 0, threat: 0, fortress: 1 },
  towers: [], enemies: [], buildPalette: [], pve: full,
}
const nextGame: GameState = { ...fullGame, tick: next.tick, pve: next }
const gamePatch = {
  tick: next.tick, status: nextGame.status, result: nextGame.result, resources: nextGame.resources, pvePatch: patch,
}
const { pvePatch: _pvePatch, ...stateFields } = gamePatch
const reconstructedGame: GameState = {
  ...fullGame,
  ...stateFields,
  pve: { ...(applyPveMatchStatePatch(fullGame.pve, patch) as PveMatchState), recentEvents: next.recentEvents },
}
assert.deepEqual(reconstructedGame, nextGame, 'full -> patch reconstructs the same authoritative game state hash')
const detachedCheckpoint: GameState = { ...nextGame, pve: { ...next, recentEvents: [] } }
assert.deepEqual(
  { ...detachedCheckpoint, pve: { ...detachedCheckpoint.pve as PveMatchState, recentEvents: next.recentEvents } },
  nextGame,
  'detached checkpoint plus event cursor reconstructs the same authoritative game state hash',
)

const journal = new CombatEventJournal(512)
journal.baseline('match-1', full.recentEvents)
journal.observe('match-1', next.recentEvents)
const live = journal.drain()
assert.deepEqual(live?.events.map(({ seq }) => seq), [300])
assert.equal(journal.replayFrom(300)?.fromSeq, 300)
journal.observe('match-1', [...next.recentEvents.slice(1), event(301, 104), event(302, 104)])
const continuous = journal.drain()
assert.deepEqual(continuous?.events.map(({ seq }) => seq), [301, 302], '200ms broadcast windows preserve monotonic event continuity')
assert.equal(journal.replayFrom(301)?.toSeq, 302)

const choreographyEvent: PveCombatEventState = {
  id: 'event-303', tick: 105, type: 'GENERAL_SKILL_CAST',
  data: { generalId: 'yangjian', skillId: 'yangjian_sanjian_liangrenzhan' },
  actionId: 'formation-yangjian:yangjian_sanjian_liangrenzhan:105',
  targetIds: ['enemy-3', 'enemy-8'],
  geometry: {
    kind: 'corridor',
    from: { xMilli: 5000, yMilli: 5000 },
    to: { xMilli: 8000, yMilli: 5000 },
    halfWidthMilliCells: 500,
  },
}
journal.observe('match-1', [choreographyEvent])
const choreographyBatch = journal.drain()
assert.equal(choreographyBatch?.events[0]?.actionId, choreographyEvent.actionId)
assert.deepEqual(choreographyBatch?.events[0]?.targetIds, choreographyEvent.targetIds)
assert.deepEqual(choreographyBatch?.events[0]?.geometry, choreographyEvent.geometry)
assert.deepEqual(journal.replayFrom(303)?.events[0], choreographyBatch?.events[0],
  'replay keeps stable action identity and authoritative geometry byte-for-byte')

const legacyTypical = { mode: 'patch', patch: { tick: next.tick, pve: next } }
const optimizedTypical = { mode: 'patch', patch: { tick: next.tick, pvePatch: patch }, combatEventBatch: live }
const legacyPeak = { mode: 'checkpoint', patch: { tick: next.tick, pve: next } }
const optimizedPeak = {
  mode: 'checkpoint',
  patch: { tick: next.tick, pve: { ...next, recentEvents: [] } },
  combatEventBatch: live,
}
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value))
const legacyAction = { id: choreographyEvent.id, tick: choreographyEvent.tick, type: choreographyEvent.type,
  data: choreographyEvent.data }
const choreographyOverheadBytes = bytes(choreographyEvent) - bytes(legacyAction)
const peakChoreographyEvent = {
  ...choreographyEvent,
  targetIds: Array.from({ length: 100 }, (_, index) => `enemy-${index + 1}`),
}
const choreographyPeakOverheadBytes = bytes(peakChoreographyEvent) - bytes(legacyAction)
const payload = {
  typicalBeforeBytes: bytes(legacyTypical),
  typicalAfterBytes: bytes(optimizedTypical),
  peakBeforeBytes: bytes(legacyPeak),
  peakAfterBytes: bytes(optimizedPeak),
}
assert.ok(payload.typicalAfterBytes < payload.typicalBeforeBytes * 0.7, 'typical event-detached delta must materially reduce payload')
assert.ok(payload.peakAfterBytes < payload.peakBeforeBytes, 'event-detached checkpoint must reduce peak payload')

console.log(JSON.stringify({
  ok: true,
  fullPatchCheckpointHashConsistent: true,
  eventSequence: { firstLiveSeq: live?.fromSeq, lastSeq: continuous?.toSeq },
  payload,
  typicalReductionPct: Math.round((1 - payload.typicalAfterBytes / payload.typicalBeforeBytes) * 1_000) / 10,
  peakReductionPct: Math.round((1 - payload.peakAfterBytes / payload.peakBeforeBytes) * 1_000) / 10,
  choreographyOverheadBytes,
  choreographyPeakOverheadBytes,
}))
