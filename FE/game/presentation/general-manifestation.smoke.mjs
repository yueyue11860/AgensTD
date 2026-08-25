import assert from 'node:assert/strict'
import {
  activeSynergyPresentationLinks,
  consumeCombatPresentation,
  createCombatPresentationState,
  synchronizeCombatPresentation,
} from './combat-presentation-adapter.ts'
import {
  buildGeneralActionPath,
  generalActionVisual,
  generalManifestationRecipe,
  isMoonPalaceSynergy,
} from './general-manifestation.ts'
import { withinPresentationBudget } from './enemy-visual-language.ts'

const character = (entityId, glyph, generalId, formationId, x, y) => ({
  entityId, ownerPlayerId: 'p1', kind: 'character', glyph, generalId, formationId,
  generalName: generalManifestationRecipe(generalId).name, generalQuality: 'purple', generalArchetype: 'physical', x, y,
})
const enemy = (entityId, x, y) => ({
  entityId, entityKind: 'ordinary_minion', bossDefinitionId: null, bossName: null,
  controlResistanceBps: 0, bossPhase: 0, activeCast: null, glyph: '妖', hp: 100, maxHp: 100, x, y,
})
const base = (tick) => ({
  tick, tickRateMs: 100,
  pieces: [
    character('hou', '后', 'houyi', 'formation-houyi', 4, 5),
    character('yi', '羿', 'houyi', 'formation-houyi', 5, 5),
    character('yang', '杨', 'yangjian', 'formation-yangjian', 4, 8),
    character('jian', '戬', 'yangjian', 'formation-yangjian', 5, 8),
    character('chang', '嫦', 'chang_e', 'formation-chang-e', 8, 5),
    character('e', '娥', 'chang_e', 'formation-chang-e', 9, 5),
  ],
  enemies: [enemy('enemy-a', 12, 5), enemy('enemy-b', 15, 6)],
  statuses: [], summonedUnits: [], zones: [], recentEvents: [],
})

assert.equal(generalManifestationRecipe('houyi').name, '后羿')
assert.equal(generalManifestationRecipe('yangjian').skillVisual, 'three-point-blade')
assert.equal(generalManifestationRecipe('not_registered').id, 'unknown')
assert.equal(generalActionVisual('houyi', 'skill', 'chuanyun_zhurijian'), 'sun-arrow')
assert.equal(generalActionVisual('houyi', 'skill', 'protocol_drift'), 'generic', 'unknown skills must not borrow a named recipe')
assert.equal(isMoonPalaceSynergy('moon_palace_companions'), true)

const path = buildGeneralActionPath({ x: 1, y: 1 }, [{ x: 3, y: 2 }, { x: 3, y: 2 }, { x: 6, y: 4 }])
assert.equal(path.targets.length, 2)
assert.deepEqual(path.segments.map(segment => segment.to), [{ x: 3, y: 2 }, { x: 6, y: 4 }], 'paths contain only supplied authoritative targets')

const state = createCombatPresentationState()
assert.deepEqual(consumeCombatPresentation(base(10), state), [])
const snapshot = base(11)
snapshot.recentEvents = [
  { id: 'formed-houyi', tick: 11, type: 'GENERAL_ACTIVATED', data: { generalId: 'houyi', formationId: 'formation-houyi', characterPieceIds: ['hou', 'yi'] } },
  { id: 'fixed-houyi', tick: 11, type: 'GENERAL_FIXED_CHANGED', data: { generalId: 'houyi', formationId: 'formation-houyi', fixed: true } },
  { id: 'houyi-basic', tick: 11, type: 'GENERAL_BASIC_ATTACK_STARTED', data: { generalId: 'houyi', formationId: 'formation-houyi', targetEnemyId: 'enemy-a' } },
  { id: 'houyi-skill', tick: 11, type: 'GENERAL_SKILL_CAST', actionId: 'formation-houyi:skill:11', targetIds: ['enemy-a', 'enemy-b'], geometry: { kind: 'polyline', points: [{ xMilli: 5000, yMilli: 5500 }, { xMilli: 12500, yMilli: 5500 }, { xMilli: 15500, yMilli: 6500 }] }, data: { generalId: 'houyi', formationId: 'formation-houyi', skillId: 'chuanyun_zhurijian', skillName: '穿云逐日箭' } },
  { id: 'houyi-skill-retry', tick: 11, type: 'GENERAL_SKILL_CAST', actionId: 'formation-houyi:skill:11', targetIds: ['enemy-a', 'enemy-b'], data: { generalId: 'houyi', formationId: 'formation-houyi', skillId: 'chuanyun_zhurijian', skillName: '穿云逐日箭' } },
  { id: 'yangjian-skill', tick: 11, type: 'GENERAL_SKILL_CAST', actionId: 'formation-yangjian:skill:11', targetIds: ['enemy-a', 'enemy-b'], geometry: { kind: 'corridor', from: { xMilli: 5000, yMilli: 8500 }, to: { xMilli: 8000, yMilli: 8500 }, halfWidthMilliCells: 500 }, data: { generalId: 'yangjian', formationId: 'formation-yangjian', skillId: 'yangjian_sanjian_liangrenzhan', skillName: '三尖两刃斩' } },
  { id: 'armor-break', tick: 11, type: 'STATUS_APPLIED', data: { generalId: 'yangjian', enemyId: 'enemy-b', statusId: 'armor_break' } },
  { id: 'moon-on', tick: 11, type: 'SYNERGY_ACTIVATED', data: { synergyId: 'moon_palace_companions', level: 1, contributingGeneralIds: ['houyi', 'chang_e'] } },
]
const cues = consumeCombatPresentation(snapshot, state)
const formed = cues.find(cue => cue.id === 'formed-houyi')
assert.deepEqual(formed?.glyphs, ['后', '羿'])
assert.equal(formed?.label, '后羿')
assert.equal(cues.find(cue => cue.id === 'fixed-houyi')?.state, 'fixed')
assert.equal(cues.find(cue => cue.id === 'houyi-basic')?.visual, 'sun-arrow')
assert.equal(cues.find(cue => cue.id === 'houyi-skill')?.targets.length, 2)
assert.equal(cues.some(cue => cue.id === 'houyi-skill-retry'), false, 'same logical action is idempotent across different event ids')
assert.equal(cues.find(cue => cue.id === 'yangjian-skill')?.visual, 'three-point-blade')
assert.equal(cues.find(cue => cue.id === 'yangjian-skill')?.geometry?.kind, 'corridor')
assert.equal(cues.find(cue => cue.id === 'armor-break')?.statusId, 'armor_break')
assert.equal(cues.find(cue => cue.id === 'moon-on')?.label, '月宫旧侣')
assert.equal(activeSynergyPresentationLinks(state)[0]?.memberPoints.length, 2)
assert.deepEqual(consumeCombatPresentation(snapshot, state), [], 'event ids are idempotent')

const reconnectState = createCombatPresentationState()
synchronizeCombatPresentation(snapshot, reconnectState)
assert.equal(activeSynergyPresentationLinks(reconnectState)[0]?.memberPoints.length, 2, 'reconnect rebuilds the persistent link without replaying cues')
assert.deepEqual(consumeCombatPresentation(snapshot, reconnectState), [])

const off = base(12)
off.recentEvents = [{ id: 'moon-off', tick: 12, type: 'SYNERGY_DEACTIVATED', data: { synergyId: 'moon_palace_companions', level: 1 } }]
const offCues = consumeCombatPresentation(off, state)
assert.equal(offCues[0]?.state, 'deactivated')
assert.deepEqual(activeSynergyPresentationLinks(state), [], 'deactivation removes the persistent link')

const reducedState = createCombatPresentationState()
const reducedSnapshot = base(20)
reducedSnapshot.recentEvents = [{ id: 'reduced-skill', tick: 20, type: 'GENERAL_SKILL_CAST', data: { generalId: 'houyi', formationId: 'formation-houyi', skillId: 'chuanyun_zhurijian', skillName: '穿云逐日箭', targetEnemyId: 'enemy-a' } }]
assert.equal(consumeCombatPresentation(reducedSnapshot, reducedState, { reducedMotion: true })[0]?.detail, 'result', 'reduced motion keeps static skill information')
const staleState = createCombatPresentationState()
const staleSnapshot = base(50)
staleSnapshot.recentEvents = [{ id: 'stale-skill', tick: 1, type: 'GENERAL_SKILL_CAST', data: { generalId: 'houyi', formationId: 'formation-houyi', skillId: 'chuanyun_zhurijian', skillName: '穿云逐日箭', targetEnemyId: 'enemy-a' } }]
assert.deepEqual(consumeCombatPresentation(staleSnapshot, staleState), [], 'historical skill choreography is not replayed')

const saturated = [
  ...Array.from({ length: 40 }, (_, index) => ({ kind: 'attack', index })),
  { kind: 'general-formed', index: 40 },
  { kind: 'synergy', index: 41 },
  { kind: 'general-action', index: 42 },
]
const low = withinPresentationBudget(saturated, { reducedMotion: false, lowEffects: true })
const reduced = withinPresentationBudget(saturated, { reducedMotion: true, lowEffects: true })
assert.equal(low.length, 14)
assert.equal(reduced.length, 6)
assert.equal(low.some(cue => cue.kind === 'general-formed'), true)
assert.equal(low.some(cue => cue.kind === 'synergy'), true)

console.log(JSON.stringify({
  ok: true,
  recipes: ['houyi', 'yangjian'],
  authoritativeMultiTargetPath: true,
  unknownFallback: true,
  idempotent: true,
  actionIdIdempotent: true,
  reconnectHistorySuppressed: true,
  reducedMotionInformationEquivalent: true,
  moonPalaceLifecycle: ['activated', 'deactivated'],
  lowEffectsBudget: low.length,
  reducedMotionBudget: reduced.length,
}))
