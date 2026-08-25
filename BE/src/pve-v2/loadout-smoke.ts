import assert from 'node:assert/strict'
import {
  getActiveItemDefinition,
  getPassiveItemDefinition,
  type MatchItemLoadoutSnapshot,
} from '../item-v1'
import { getWeaponDefinition, type MatchWeaponLoadoutSnapshot } from '../weapon-v1'
import { PveGameRuntime } from './runtime'

const playerId = 'loadout-player'

function itemSnapshot(
  activeIds: readonly [string | null, string | null],
  passiveIds: readonly [string | null, string | null, string | null, string | null, string | null, string | null],
): MatchItemLoadoutSnapshot {
  return {
    snapshotVersion: 1,
    catalogVersion: 1,
    playerId,
    accountVersion: 7,
    activeSlots: activeIds,
    passiveSlots: passiveIds,
    activeItems: activeIds.flatMap((id) => id ? [getActiveItemDefinition(id)!] : []),
    passiveItems: passiveIds.flatMap((id) => id ? [getPassiveItemDefinition(id)!] : []),
  }
}

const passiveSnapshot = itemSnapshot(
  ['change_character_brush', 'cultivation_pill'],
  ['traveling_kitchen', 'talent_registry', 'reserve_expansion_talisman', 'army_expansion_order', null, null],
)

let brushRuntime: PveGameRuntime | null = null
for (let seed = 0; seed < 2000 && !brushRuntime; seed += 1) {
  const candidate = new PveGameRuntime({
    seed: `loadout-brush-${seed}`,
    prepDurationMs: 0,
    maxWaves: 1,
    characterTokens: { 后: 1, 羿: 1, 孙: 1 },
    itemLoadoutSnapshots: { [playerId]: passiveSnapshot },
  })
  assert.equal(candidate.registerPlayer(playerId, 'P1').ok, true)
  const opening = candidate.snapshot().players[0]!
  assert.equal(opening.rice, 15)
  assert.equal(opening.reserve.length, 3)
  assert.equal(opening.populationCap, 11)
  candidate.handleAction(playerId, { type: 'RECRUIT_BATCH', actionId: 'recruit' })
  if (candidate.snapshot().players[0]!.tray.some((piece) => piece?.kind === 'character')) brushRuntime = candidate
}
assert.ok(brushRuntime)
assert.equal(brushRuntime.start().ok, true)
const brushBefore = brushRuntime.snapshot().players[0]!
const brushPiece = brushBefore.tray.find((piece) => piece?.kind === 'character')!
assert.equal(brushPiece.kind, 'character')
const brushResult = brushRuntime.handleAction(playerId, {
  type: 'USE_ACTIVE_ITEM', actionId: 'brush-action-1', requestId: 'brush-request', slotIndex: 0,
  itemId: 'change_character_brush', target: { kind: 'piece', pieceId: brushPiece.id,
    expectedRevision: brushBefore.trayRevision }, expectedItemRuntimeVersion: 1,
})
assert.equal(brushResult.ok, true)
const brushAfter = brushRuntime.snapshot().players[0]!
assert.equal(brushAfter.discardedCharacters.some((piece) => piece.id === brushPiece.id), true)
assert.ok(brushAfter.tray.flatMap((piece) => piece?.kind === 'character' ? [piece.glyph] : []).length > 0)
const afterOneUse = brushAfter.itemRuntime
assert.equal(brushRuntime.handleAction(playerId, {
  type: 'USE_ACTIVE_ITEM', actionId: 'brush-action-replay', requestId: 'brush-request', slotIndex: 0,
  itemId: 'change_character_brush', target: { kind: 'piece', pieceId: brushPiece.id,
    expectedRevision: brushBefore.trayRevision }, expectedItemRuntimeVersion: 1,
}).code, 'ACTIVE_ITEM_REPLAYED')
assert.deepEqual(brushRuntime.snapshot().players[0]!.itemRuntime, afterOneUse)

const houyiItems = itemSnapshot(
  ['cultivation_pill', 'heavenly_thunder_order'],
  ['traveling_kitchen', null, null, null, null, null],
)
const weaponSnapshot: MatchWeaponLoadoutSnapshot = {
  snapshotVersion: 1,
  playerId,
  accountVersion: 9,
  byGeneralId: {
    houyi: {
      slots: ['qinggang_blade', 'houyi_sun_shooting_bow'],
      resolvedDefinitions: [getWeaponDefinition('qinggang_blade')!, getWeaponDefinition('houyi_sun_shooting_bow')!],
    },
  },
}

let houyiRuntime: PveGameRuntime | null = null
for (let seed = 0; seed < 5000 && !houyiRuntime; seed += 1) {
  const candidate = new PveGameRuntime({
    seed: `loadout-houyi-${seed}`,
    prepDurationMs: 0,
    maxWaves: 1,
    characterTokens: { 后: 1, 羿: 1 },
    itemLoadoutSnapshots: { [playerId]: houyiItems },
    weaponLoadoutSnapshots: { [playerId]: weaponSnapshot },
  })
  candidate.registerPlayer(playerId, 'P1')
  candidate.handleAction(playerId, { type: 'RECRUIT_BATCH', actionId: 'recruit' })
  const glyphs = candidate.snapshot().players[0]!.tray.flatMap((piece) => piece?.kind === 'character' ? [piece.glyph] : [])
  if (glyphs.includes('后') && glyphs.includes('羿')) houyiRuntime = candidate
}
assert.ok(houyiRuntime)
const tray = houyiRuntime.snapshot().players[0]!.tray
for (const [glyph, x] of [['后', 11], ['羿', 12]] as const) {
  const index = tray.findIndex((piece) => piece?.kind === 'character' && piece.glyph === glyph)
  assert.equal(houyiRuntime.handleAction(playerId, {
    type: 'SWAP_TRAY_BOARD', actionId: `deploy-${glyph}`, trayIndex: index, boardX: x, boardY: 17,
  }).ok, true)
}
let houyiState = houyiRuntime.snapshot().players[0]!
assert.equal(houyiState.generalProgress[0]?.attack, 36, '青钢刀攻击 +8% 必须来自冻结武器快照')
assert.deepEqual(houyiState.weaponLoadoutByGeneralId.houyi, ['qinggang_blade', 'houyi_sun_shooting_bow'])
const runtimeProbe = houyiRuntime as unknown as {
  resolveWeaponEffectParameter: (player: string, general: string, effect: string, parameter: string, value: number) => number
}
assert.equal(runtimeProbe.resolveWeaponEffectParameter(playerId, 'houyi', 'houyi_chuanyun_zhurijian_damage',
  'additionalTargetLimit', 0), 2)
assert.equal(houyiRuntime.start().ok, true)
const xpBefore = houyiState.generalProgress[0]!.experiencePoints
assert.equal(houyiRuntime.handleAction(playerId, {
  type: 'USE_ACTIVE_ITEM', actionId: 'pill-action', requestId: 'pill-request', slotIndex: 0,
  itemId: 'cultivation_pill', target: { kind: 'general', generalId: 'houyi' }, expectedItemRuntimeVersion: 1,
}).ok, true)
houyiState = houyiRuntime.snapshot().players[0]!
assert.ok(houyiState.generalProgress[0]!.experiencePoints > xpBefore)
const pillXp = houyiState.generalProgress[0]!.experiencePoints
assert.equal(houyiRuntime.handleAction(playerId, {
  type: 'USE_ACTIVE_ITEM', actionId: 'pill-replay', requestId: 'pill-request', slotIndex: 0,
  itemId: 'cultivation_pill', target: { kind: 'general', generalId: 'houyi' }, expectedItemRuntimeVersion: 1,
}).code, 'ACTIVE_ITEM_REPLAYED')
assert.equal(houyiRuntime.snapshot().players[0]!.generalProgress[0]!.experiencePoints, pillXp)
const thunderCharges = houyiRuntime.snapshot().players[0]!.itemRuntime!.slots[1]!.chargesRemaining
assert.equal(houyiRuntime.handleAction(playerId, {
  type: 'USE_ACTIVE_ITEM', actionId: 'thunder-invalid', requestId: 'thunder-invalid', slotIndex: 1,
  itemId: 'heavenly_thunder_order', target: { kind: 'battlefield_point', xMilli: 0, yMilli: 0 },
  expectedItemRuntimeVersion: 2,
}).ok, false)
assert.equal(houyiRuntime.snapshot().players[0]!.itemRuntime!.slots[1]!.chargesRemaining, thunderCharges,
  '失败不消耗次数')

const unsupportedWeaponSnapshot: MatchWeaponLoadoutSnapshot = {
  snapshotVersion: 1, playerId, accountVersion: 10,
  byGeneralId: { houyi: { slots: ['sun_piercing_bow', null],
    resolvedDefinitions: [getWeaponDefinition('sun_piercing_bow')!] } },
}
let unsupportedRuntime: PveGameRuntime | null = null
for (let seed = 0; seed < 5000 && !unsupportedRuntime; seed += 1) {
  const candidate = new PveGameRuntime({ seed: `unsupported-weapon-${seed}`, characterTokens: { 后: 1, 羿: 1 },
    weaponLoadoutSnapshots: { [playerId]: unsupportedWeaponSnapshot } })
  candidate.registerPlayer(playerId, 'P1')
  candidate.handleAction(playerId, { type: 'RECRUIT_BATCH', actionId: 'recruit' })
  const pieces = candidate.snapshot().players[0]!.tray
  if (!['后', '羿'].every((glyph) => pieces.some((piece) => piece?.kind === 'character' && piece.glyph === glyph))) continue
  for (const [glyph, x] of [['后', 11], ['羿', 12]] as const) {
    const index = candidate.snapshot().players[0]!.tray.findIndex((piece) => piece?.kind === 'character' && piece.glyph === glyph)
    candidate.handleAction(playerId, { type: 'SWAP_TRAY_BOARD', actionId: `deploy-${glyph}`, trayIndex: index,
      boardX: x, boardY: 17 })
  }
  unsupportedRuntime = candidate
}
assert.ok(unsupportedRuntime)
const unsupportedEvents = unsupportedRuntime.snapshot().recentEvents.filter((event) => event.type === 'WEAPON_EFFECT_UNSUPPORTED')
assert.ok(unsupportedEvents.length >= 1)
assert.ok(unsupportedEvents.every((event) => event.data.weaponId === 'sun_piercing_bow'
  && event.data.actionType === 'parameter_patch_requires_matching_effect'))
assert.equal(new Set(unsupportedEvents.map((event) => `${event.data.sourceKey}:${event.data.triggerId}:${event.data.actionType}`)).size,
  unsupportedEvents.length)

console.log('pve-v2 loadout vertical smoke checks passed')
