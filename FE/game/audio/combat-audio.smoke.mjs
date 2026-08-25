import assert from 'node:assert/strict'
import {
  CombatAudioVoiceLimiter,
  mapCueToCombatSound,
} from './combat-audio.ts'

const point = { x: 1, y: 1 }
const mappingOptions = { lowEffects: false, currentTick: 10, tickRateMs: 100 }
const damageCue = (sourceStyle) => ({
  id: `damage-${sourceStyle}`,
  tick: 10,
  detail: 'full',
  kind: 'damage',
  targetId: 'enemy-1',
  target: point,
  amount: 10,
  critical: false,
  showText: true,
  isBoss: false,
  sourceStyle,
  impactDelayMs: 0,
})

assert.deepEqual(
  ['blade', 'spear', 'bow', 'cavalry'].map((style) => mapCueToCombatSound(damageCue(style), mappingOptions)?.soundId),
  ['hit_blade', 'hit_spear', 'hit_bow', 'hit_cavalry'],
  'the four soldier impacts must remain audibly distinct',
)

const heroCues = [
  { id: 'houyi-skill', tick: 10, detail: 'full', kind: 'general-action', actionKind: 'skill', visual: 'sun-arrow', generalId: 'houyi', skillId: 'chuanyun_zhurijian', skillName: '穿云逐日箭', source: point, targets: [{ x: 2, y: 2 }] },
  { id: 'yangjian-skill', tick: 10, detail: 'full', kind: 'general-action', actionKind: 'skill', visual: 'three-point-blade', generalId: 'yangjian', skillId: 'yangjian_sanjian_liangrenzhan', skillName: '三尖两刃斩', source: point, targets: [{ x: 2, y: 2 }] },
  { id: 'moon', tick: 10, detail: 'full', kind: 'synergy', target: point, label: '月宫旧侣', synergyId: 'moon_palace_companions', state: 'activated', level: 1, memberPoints: [point, { x: 2, y: 2 }] },
]
assert.deepEqual(heroCues.map(cue => mapCueToCombatSound(cue, mappingOptions)?.soundId), ['houyi_motif', 'yangjian_motif', 'moon_palace_motif'])
assert.equal(mapCueToCombatSound({ ...heroCues[0], tick: 1 }, { ...mappingOptions, currentTick: 40 }), null, 'stale hero motifs remain silent after reconnect')

const strategicCues = [
  { id: 'summon', tick: 10, detail: 'full', kind: 'summon', target: point, label: '召' },
  { id: 'merge', tick: 10, detail: 'full', kind: 'merge', target: point, level: 2 },
  { id: 'general', tick: 10, detail: 'full', kind: 'general-formed', target: point, label: '后羿' },
  { id: 'warning', tick: 10, detail: 'full', kind: 'boss-warning', targetId: 'boss-1', target: point, label: '群妖号令', executeAtTick: 20 },
  { id: 'boss-death', tick: 10, detail: 'full', kind: 'boss-death', targetId: 'boss-1', target: point, label: '混世魔王' },
]
assert.deepEqual(
  strategicCues.map((cue) => mapCueToCombatSound(cue, mappingOptions)?.soundId),
  ['summon', 'merge', 'general_formed', 'boss_warning', 'boss_death'],
)

const normal = mapCueToCombatSound(damageCue('blade'), mappingOptions)
const lowEffects = mapCueToCombatSound(damageCue('blade'), { ...mappingOptions, lowEffects: true })
assert.ok(normal && lowEffects && lowEffects.throttleMs > normal.throttleMs && lowEffects.gain < normal.gain,
  'low-effects mode must reduce high-frequency attack audio without muting strategic sounds')
assert.equal(mapCueToCombatSound({ ...damageCue('blade'), tick: 1 }, { ...mappingOptions, currentTick: 40 }), null,
  'stale combat events must not replay audio after reconnect')

const request = { soundId: 'hit_blade', throttleKey: 'hit_blade', throttleMs: 100, priority: 1, gain: 0.1 }
const throttleLimiter = new CombatAudioVoiceLimiter(3)
const first = throttleLimiter.admit(request, 0)
assert.equal(first.admitted, true)
assert.equal(throttleLimiter.admit(request, 50).reason, 'throttled')
throttleLimiter.complete(first.voiceId)
assert.equal(throttleLimiter.admit(request, 101).admitted, true)

const capacityLimiter = new CombatAudioVoiceLimiter(2)
const lowA = capacityLimiter.admit({ ...request, throttleKey: 'a', throttleMs: 0 }, 0)
const lowB = capacityLimiter.admit({ ...request, throttleKey: 'b', throttleMs: 0 }, 1)
assert.equal(lowA.admitted && lowB.admitted, true)
const boss = capacityLimiter.admit({ soundId: 'boss_warning', throttleKey: 'boss', throttleMs: 0, priority: 4, gain: 0.2 }, 2)
assert.equal(boss.admitted, true)
assert.equal(boss.preemptedVoiceId, lowA.voiceId, 'Boss audio preempts the oldest lowest-priority voice')
assert.equal(capacityLimiter.activeCount, 2, 'preemption must preserve the hard concurrency ceiling')
assert.equal(capacityLimiter.admit({ ...request, throttleKey: 'c', throttleMs: 0 }, 3).reason, 'capacity')

console.log(JSON.stringify({
  ok: true,
  soldierSounds: ['hit_blade', 'hit_spear', 'hit_bow', 'hit_cavalry'],
  strategicSounds: ['summon', 'merge', 'general_formed', 'boss_warning', 'boss_death'],
  heroMotifs: ['houyi_motif', 'yangjian_motif', 'moon_palace_motif'],
  throttle: true,
  concurrencyPreemption: true,
  staleSuppression: true,
}))
