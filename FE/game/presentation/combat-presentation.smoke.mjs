import assert from 'node:assert/strict'
import {
  consumeCombatPresentation,
  createCombatPresentationState,
} from './combat-presentation-adapter.ts'
import {
  bossTelegraphPattern,
  enemyMoveProfile,
  enemyVisualStyle,
  resolveEnemyVisualRole,
  telegraphProgress,
  withinPresentationBudget,
} from './enemy-visual-language.ts'

const piece = (entityId, soldierType, x) => ({
  entityId,
  ownerPlayerId: 'p1',
  kind: 'soldier',
  glyph: soldierType.slice(0, 1),
  soldierType,
  level: 1,
  x,
  y: 2,
})

const enemy = (hp = 100, bossPhase = 1) => ({
  entityId: 'enemy-1',
  entityKind: 'boss',
  bossDefinitionId: 'boss-1',
  bossName: '混世魔王',
  controlResistanceBps: 5000,
  bossPhase,
  activeCast: null,
  glyph: '魔',
  hp,
  maxHp: 100,
  x: 10,
  y: 10,
})

const base = (tick, hp = 100) => ({
  tick,
  tickRateMs: 100,
  pieces: [
    piece('blade-1', 'blade', 1),
    piece('spear-1', 'spear', 2),
    piece('bow-1', 'bow', 3),
    piece('cavalry-1', 'cavalry', 4),
    { entityId: 'char-1', ownerPlayerId: 'p1', kind: 'character', glyph: '后', formationId: 'formation-1', generalId: 'houyi', generalName: '后羿', generalQuality: 'purple', generalArchetype: 'physical', x: 5, y: 3 },
  ],
  enemies: [enemy(hp)],
  statuses: [],
  summonedUnits: [{ entityId: 'summon-1', ownerPlayerId: 'p1', sourceGeneralId: 'houyi', summonUnitId: 'celestial', glyph: '灵', ownerLevel: 1, expiresAtTick: 30, x: 6, y: 4 }],
  zones: [],
  recentEvents: [],
})

const state = createCombatPresentationState()
assert.deepEqual(consumeCombatPresentation(base(10), state), [])

const snapshot = base(11, 85)
snapshot.recentEvents = [
  ...['blade', 'spear', 'bow', 'cavalry'].map((style, index) => ({
    id: `attack-${style}`,
    tick: 11,
    type: 'BASIC_ATTACK_STARTED',
    data: { attackerId: `${style}-1`, playerId: 'p1', targetIds: ['enemy-1'] },
  })),
  { id: 'damage-1', tick: 11, type: 'DAMAGE_APPLIED', data: { attackerId: 'blade-1', enemyId: 'enemy-1', finalDamage: 15, isCritical: true } },
  { id: 'summon-1-event', tick: 11, type: 'SUMMON_SPAWNED', data: { summonId: 'summon-1', summonUnitId: 'celestial', xMilli: 6500, yMilli: 4500 } },
  { id: 'merge-1', tick: 11, type: 'SOLDIER_MERGED', data: { mergedPieceId: 'blade-1', level: 2 } },
  { id: 'general-1', tick: 11, type: 'GENERAL_ACTIVATED', data: { formationId: 'formation-1', generalId: 'houyi', characterPieceIds: ['char-1'] } },
  { id: 'synergy-1', tick: 11, type: 'SYNERGY_ACTIVATED', data: { synergyId: 'sun_moon', contributingGeneralIds: ['houyi'] } },
  { id: 'wave-11', tick: 11, type: 'WAVE_STARTED', data: { waveNumber: 5, bossPerLane: 1 } },
  { id: 'boss-warning-1', tick: 11, type: 'BOSS_CAST_WARNING', actionId: 'enemy-1:guard:cast-1', targetIds: ['enemy-1'], geometry: { kind: 'circle', xMilli: 10500, yMilli: 10500, radiusMilliCells: 1200 }, data: { bossEnemyId: 'enemy-1', skillName: '护体', pluginId: 'phase_guard_v1', executeAtTick: 20 } },
  { id: 'boss-phase-1', tick: 11, type: 'BOSS_PHASE_CHANGED', data: { bossEnemyId: 'enemy-1', phase: 2 } },
  { id: 'damage-1', tick: 11, type: 'DAMAGE_APPLIED', data: { attackerId: 'blade-1', enemyId: 'enemy-1', finalDamage: 15, isCritical: true } },
]
const cues = consumeCombatPresentation(snapshot, state)
assert.deepEqual(cues.filter((cue) => cue.kind === 'attack').map((cue) => cue.style), ['blade', 'spear', 'bow', 'cavalry'])
assert.equal(cues.filter((cue) => cue.id === 'damage-1').length, 1, 'duplicate event ids must be idempotent within one projection')
assert.equal(cues.some((cue) => cue.kind === 'boss-warning'), true)
const bossWarningCue = cues.find((cue) => cue.kind === 'boss-warning')
assert.equal(bossWarningCue?.geometry?.kind, 'circle', 'Boss warning area is carried by the server event')
assert.deepEqual(new Set(cues.map((cue) => cue.kind)), new Set(['attack', 'damage', 'summon', 'merge', 'general-formed', 'synergy', 'wave-start', 'boss-warning', 'boss-phase']))
assert.deepEqual(consumeCombatPresentation(snapshot, state), [], 'replayed recentEvents must not replay presentation')

const fallback = base(12, 70)
fallback.recentEvents = undefined
const fallbackCues = consumeCombatPresentation(fallback, state)
assert.equal(fallbackCues.some((cue) => cue.kind === 'damage' && cue.id.startsWith('snapshot:')), true, 'HP deltas provide a legacy fallback')

const staleState = createCombatPresentationState()
const stale = base(50, 90)
stale.recentEvents = [
  { id: 'old-attack', tick: 1, type: 'BASIC_ATTACK_STARTED', data: { attackerId: 'blade-1', targetIds: ['enemy-1'] } },
  { id: 'old-damage', tick: 1, type: 'DAMAGE_APPLIED', data: { enemyId: 'enemy-1', finalDamage: 10, isCritical: true } },
]
const staleCues = consumeCombatPresentation(stale, staleState)
assert.equal(staleCues.some((cue) => cue.id === 'old-attack'), false, 'stale attack choreography is skipped')
assert.equal(staleCues.find((cue) => cue.id === 'old-damage')?.detail, 'result', 'stale results degrade instead of replaying full choreography')

const reset = base(2)
reset.recentEvents = [{ id: 'old-damage', tick: 2, type: 'DAMAGE_APPLIED', data: { enemyId: 'enemy-1', finalDamage: 3, isCritical: false } }]
assert.equal(consumeCombatPresentation(reset, staleState).some((cue) => cue.id === 'old-damage'), true, 'tick regression resets the event ledger for a new match')

const visualEnemy = (glyph, overrides = {}) => ({
  entityId: `visual-${glyph}`,
  entityKind: 'ordinary_minion',
  glyph,
  armor: 4,
  magicResistance: 4,
  moveSpeedMilliCellsPerSecond: 1000,
  ...overrides,
})
const roles = ['鬼', '妖', '魔', '魅', '怪'].map(glyph => resolveEnemyVisualRole(visualEnemy(glyph)))
assert.deepEqual(roles, ['basic', 'fast', 'armored', 'mystic', 'swarm'])
const roleStyles = ['鬼', '妖', '魔', '魅', '怪'].map(glyph => enemyVisualStyle(visualEnemy(glyph)))
assert.equal(new Set(roleStyles.map(style => style.silhouette)).size, 5, 'roles need distinct silhouettes')
assert.equal(new Set(roleStyles.map(style => style.marker)).size, 5, 'roles need non-color markers')
assert.equal(new Set(roleStyles.map(style => style.moveDurationMs)).size, 5, 'roles need distinct movement rhythms')
assert.equal(resolveEnemyVisualRole(visualEnemy('¿')), 'unknown', 'unknown roles use a safe fallback')
assert.equal(resolveEnemyVisualRole(visualEnemy('鬼', { enemyRole: 'tank' })), 'armored', 'future explicit role wins')
assert.equal(resolveEnemyVisualRole(visualEnemy('鬼', { moveSpeedMilliCellsPerSecond: 1300 })), 'fast', 'authoritative speed supports compatibility inference')
assert.deepEqual(enemyMoveProfile(visualEnemy('妖'), { reducedMotion: true, lowEffects: false }), { durationMs: 0, ease: 'Linear' })
assert.ok(enemyMoveProfile(visualEnemy('魔'), { reducedMotion: false, lowEffects: true }).durationMs < enemyVisualStyle(visualEnemy('魔')).moveDurationMs)
assert.equal(bossTelegraphPattern('phase_guard_v1', null, null), 'impact')
assert.equal(bossTelegraphPattern('unregistered-plugin', 'unknown-skill', '未知妖术'), 'ring')
assert.deepEqual(telegraphProgress(10, 20, 15), { progress: 0.5, remainingTicks: 5 })
assert.deepEqual(telegraphProgress(10, 20, 30), { progress: 1, remainingTicks: 0 })

const saturatedCues = Array.from({ length: 50 }, (_, index) => ({ kind: index === 49 ? 'boss-warning' : 'attack', index }))
const lowBudget = withinPresentationBudget(saturatedCues, { reducedMotion: false, lowEffects: true })
const reducedBudget = withinPresentationBudget(saturatedCues, { reducedMotion: true, lowEffects: true })
assert.equal(lowBudget.length, 14)
assert.equal(reducedBudget.length, 6)
assert.equal(lowBudget.some(cue => cue.kind === 'boss-warning'), true, 'Boss warnings survive VFX saturation')

console.log(JSON.stringify({
  ok: true,
  attackStyles: cues.filter((cue) => cue.kind === 'attack').map((cue) => cue.style),
  deduplicated: true,
  stalePolicy: 'result-only',
  snapshotFallback: true,
  enemyRoles: roles,
  unknownRoleFallback: true,
  telegraphLifecycle: true,
  lowEffectsBudget: lowBudget.length,
  reducedMotionBudget: reducedBudget.length,
}))
