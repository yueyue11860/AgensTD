import assert from 'node:assert/strict'
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { GENERAL_ROSTER } from '../../BE/src/core/hero-v1/roster'
import { PveGameRuntime } from '../../BE/src/pve-v2/runtime'
import type { PveRuntimeEvent } from '../../BE/src/pve-v2/types'
import {
  WEAPON_CATALOG,
  getWeaponDefinition,
  type MatchWeaponLoadoutSnapshot,
  type WeaponDefinition,
} from '../../BE/src/weapon-v1'

const playerId = 'human-dev'
const apiBase = process.env.FUNCTIONAL_API_BASE ?? 'http://127.0.0.1:4420/api'

interface AccountResponse {
  account: {
    version: number
    weapon: {
      loadoutsByGeneralId: Record<string, { slots: [string | null, string | null], version: number }>
    }
  }
}

function resolved(ids: readonly (string | null)[]): WeaponDefinition[] {
  return ids.flatMap((id) => id ? [structuredClone(getWeaponDefinition(id)!)] : [])
}

function snapshot(slots: [string | null, string | null], accountVersion = 1): MatchWeaponLoadoutSnapshot {
  return {
    snapshotVersion: 1,
    playerId,
    accountVersion,
    byGeneralId: { houyi: { slots, resolvedDefinitions: resolved(slots) } },
  }
}

function formHouyi(input: MatchWeaponLoadoutSnapshot, label: string, combatStress = false) {
  for (let seed = 0; seed < 5000; seed += 1) {
    const events: PveRuntimeEvent[] = []
    const runtime = new PveGameRuntime({
      seed: `${label}-${seed}`,
      prepDurationMs: 0,
      maxWaves: combatStress ? 20 : 1,
      initialWaveNumber: combatStress ? 20 : 1,
      difficulty: combatStress ? 'hard' : 'easy',
      eventHistoryLimit: 5000,
      eventObserver: (event) => events.push(event),
      characterTokens: { 后: 1, 羿: 1 },
      weaponLoadoutSnapshots: { [playerId]: input },
    })
    assert.equal(runtime.registerPlayer(playerId, 'P1').ok, true)
    runtime.handleAction(playerId, { type: 'RECRUIT_BATCH', actionId: 'recruit' })
    const tray = runtime.snapshot().players[0]!.tray
    if (!['后', '羿'].every((glyph) => tray.some((piece) => piece?.kind === 'character' && piece.glyph === glyph))) continue
    for (const [glyph, x] of [['后', 11], ['羿', 12]] as const) {
      const index = runtime.snapshot().players[0]!.tray.findIndex((piece) => piece?.kind === 'character' && piece.glyph === glyph)
      const result = runtime.handleAction(playerId, {
        type: 'SWAP_TRAY_BOARD', actionId: `deploy-${glyph}`, trayIndex: index, boardX: x, boardY: 17,
      })
      assert.equal(result.ok, true)
    }
    return { runtime, events, seed: `${label}-${seed}` }
  }
  throw new Error(`Could not form Houyi for ${label}`)
}

function general(runtime: PveGameRuntime) {
  const value = runtime.snapshot().players[0]!.generalProgress.find((entry) => entry.generalId === 'houyi')
  assert.ok(value)
  return value
}

function classifyCatalog() {
  const matrix = WEAPON_CATALOG.map((weapon) => {
    const supportedStatEffects = weapon.statModifiers.length
    const supportedTriggerEffects = weapon.triggers.filter((trigger) => (
      trigger.kind === 'on_basic_attack_hit' && trigger.actions.every((action) => action.type === 'apply_status')
    )).length
    const supportedPatchEffects = weapon.compatibility.exclusiveGeneralId === 'houyi'
      ? weapon.parameterPatches.filter((patch) => patch.patchId.startsWith('houyi_')).length
      : 0
    const declaredEffects = weapon.statModifiers.length + weapon.triggers.length + weapon.parameterPatches.length
    const supportedEffects = supportedStatEffects + supportedTriggerEffects + supportedPatchEffects
    const unsupportedEffects = declaredEffects - supportedEffects
    return {
      weaponId: weapon.weaponId,
      name: weapon.name,
      exclusiveGeneralId: weapon.compatibility.exclusiveGeneralId ?? null,
      status: weapon.status,
      declaredEffects,
      supportedEffects,
      unsupportedEffects,
      runtimeClass: unsupportedEffects === 0 ? 'fully_consumed'
        : supportedEffects > 0 ? 'partially_consumed' : 'unsupported_shell',
      iconPresent: existsSync(path.resolve('../FE/public/art/equipment', `${weapon.ui.iconKey}.webp`)),
      compatibleGeneralCount: GENERAL_ROSTER.filter((entry) => {
        if (weapon.compatibility.exclusiveGeneralId) return weapon.compatibility.exclusiveGeneralId === entry.generalId
        return weapon.compatibility.allowedArchetypes?.includes(entry.profession) ?? false
      }).length,
    }
  })
  return {
    matrix,
    counts: {
      catalog: matrix.length,
      effectDefined: matrix.filter((entry) => entry.declaredEffects > 0).length,
      fullyConsumed: matrix.filter((entry) => entry.runtimeClass === 'fully_consumed').length,
      partiallyConsumed: matrix.filter((entry) => entry.runtimeClass === 'partially_consumed').length,
      unsupportedShell: matrix.filter((entry) => entry.runtimeClass === 'unsupported_shell').length,
      iconPresent: matrix.filter((entry) => entry.iconPresent).length,
      compatibleWithAtLeastOneGeneral: matrix.filter((entry) => entry.compatibleGeneralCount > 0).length,
      releasedStatus: matrix.filter((entry) => entry.status === 'released').length,
      testingStatus: matrix.filter((entry) => entry.status === 'testing').length,
      uniqueGroupConfigured: WEAPON_CATALOG.filter((weapon) => Boolean(weapon.uniqueGroup)).length,
    },
  }
}

async function main() {
  const accountResponse = await fetch(`${apiBase}/account`, {
    headers: { authorization: 'Bearer human-dev-token' },
  })
  assert.equal(accountResponse.status, 200)
  const account = (await accountResponse.json() as AccountResponse).account
  const uiSlots = account.weapon.loadoutsByGeneralId.houyi?.slots
  assert.deepEqual(uiSlots, ['qinggang_blade', 'houyi_sun_shooting_bow'])

  const empty = formHouyi(snapshot([null, null], 0), 'weapon-baseline')
  const baseline = general(empty.runtime)

  const dual = formHouyi(snapshot(['qinggang_blade', 'chasing_wind_bow'], 1), 'weapon-dual')
  const dualStats = general(dual.runtime)
  assert.ok(dualStats.attack > baseline.attack)
  assert.ok(dualStats.attackIntervalMs < baseline.attackIntervalMs)
  assert.equal(dualStats.attackRangeMilliCells - baseline.attackRangeMilliCells, 250)

  const frozenInput = snapshot(['qinggang_blade', 'chasing_wind_bow'], 2)
  const frozen = formHouyi(frozenInput, 'weapon-frozen')
  ;(frozenInput.byGeneralId.houyi!.slots as [string | null, string | null])[0] = null
  ;(frozenInput.byGeneralId.houyi!.resolvedDefinitions[0]!.statModifiers[0] as { value: number }).value = -9999
  const frozenAfterMutation = general(frozen.runtime)
  assert.equal(frozenAfterMutation.attack, dualStats.attack)
  assert.equal(frozenAfterMutation.attackRangeMilliCells, dualStats.attackRangeMilliCells)
  assert.deepEqual(frozen.runtime.snapshot().players[0]!.weaponLoadoutByGeneralId.houyi,
    ['qinggang_blade', 'chasing_wind_bow'])

  const uiRuntime = formHouyi(snapshot(uiSlots, account.version), 'weapon-ui-loadout', true)
  const uiStats = general(uiRuntime.runtime)
  const probe = uiRuntime.runtime as unknown as {
    resolveWeaponEffectParameter: (player: string, generalId: string, effectId: string, parameter: string, value: number) => number
  }
  const additionalTargets = probe.resolveWeaponEffectParameter(
    playerId, 'houyi', 'houyi_chuanyun_zhurijian_damage', 'additionalTargetLimit', 0,
  )
  assert.equal(additionalTargets, 2)
  assert.equal(uiRuntime.runtime.start().ok, true)
  for (let tick = 0; tick < 1200 && uiRuntime.runtime.snapshot().status !== 'finished'; tick += 1) uiRuntime.runtime.tick()
  const houyiExtensionDamage = uiRuntime.events.filter((event) => (
    event.type === 'DAMAGE_APPLIED' && String(event.data.actionId ?? '').includes('houyi-weapon-')
  ))
  assert.ok(houyiExtensionDamage.length > 0)

  const unsupported = formHouyi(snapshot(['sun_piercing_bow', null], 3), 'weapon-unsupported')
  const unsupportedEvents = unsupported.events.filter((event) => event.type === 'WEAPON_EFFECT_UNSUPPORTED')
  assert.ok(unsupportedEvents.length >= 2)

  const catalog = classifyCatalog()
  assert.equal(catalog.counts.catalog, 41)
  assert.equal(catalog.counts.effectDefined, 41)
  assert.equal(catalog.counts.iconPresent, 41)
  assert.equal(catalog.counts.compatibleWithAtLeastOneGeneral, 41)

  const report = {
    generatedAt: new Date().toISOString(),
    sourceAccount: { accountVersion: account.version, uiSavedSlots: uiSlots },
    baseline: {
      seed: empty.seed,
      attack: baseline.attack,
      attackIntervalMs: baseline.attackIntervalMs,
      attackRangeMilliCells: baseline.attackRangeMilliCells,
    },
    dualCommonWeapons: {
      seed: dual.seed,
      slots: ['qinggang_blade', 'chasing_wind_bow'],
      attack: dualStats.attack,
      attackIntervalMs: dualStats.attackIntervalMs,
      attackRangeMilliCells: dualStats.attackRangeMilliCells,
    },
    uiSavedCommonPlusExclusive: {
      seed: uiRuntime.seed,
      slots: uiSlots,
      attack: uiStats.attack,
      additionalTargets,
      houyiExtensionDamageEvents: houyiExtensionDamage.length,
      sample: houyiExtensionDamage.slice(0, 4),
    },
    snapshotFreeze: {
      sourceWasMutatedAfterRuntimeConstruction: true,
      runtimeSlotsAfterMutation: frozen.runtime.snapshot().players[0]!.weaponLoadoutByGeneralId.houyi,
      attackAfterMutation: frozenAfterMutation.attack,
      rangeAfterMutation: frozenAfterMutation.attackRangeMilliCells,
      passed: true,
    },
    explicitUnsupportedEvidence: unsupportedEvents,
    catalog,
  }
  writeFileSync('../output/functional/weapon-runtime-report.json', `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify({
    baseline: report.baseline,
    dual: report.dualCommonWeapons,
    ui: report.uiSavedCommonPlusExclusive,
    freeze: report.snapshotFreeze,
    counts: catalog.counts,
    unsupportedEvents: unsupportedEvents.length,
  }, null, 2)}\n`)
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
