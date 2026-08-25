import assert from 'node:assert/strict'
import { GENERAL_IDS } from '../core/hero-v1/roster'
import { GENERAL_SYNERGY_PROFILES, SYNERGY_V1_CATALOG } from './catalog'
import { projectHeroV1GeneralStatModifiers } from './hero-v1-adapter'
import { reconcilePlayerSynergies } from './engine'
import {
  SynergyRuntimeProjectionRegistry,
  settleRuntimeSynergyParameter,
  settleRuntimeSynergyStat,
} from './runtime-projection'
import type {
  PlayerSynergyEvaluation,
  SynergyDefinition,
  SynergyEffect,
  SynergyReconcileCommand,
  SynergyStat,
} from './types'

const ALL_SYNERGY_STATS: readonly SynergyStat[] = [
  'attack',
  'attackSpeed',
  'attackRange',
  'critRate',
  'critDamage',
  'damageDealt',
  'physicalDamageBonus',
  'magicDamageBonus',
  'cooldownReduction',
  'controlDuration',
  'summonAttack',
  'summonAttackSpeed',
  'summonCritRate',
  'summonCritDamage',
  'summonDuration',
  'generalExperienceGain',
] as const

function targetForStat(stat: SynergyStat): SynergyEffect['target'] {
  if (stat === 'generalExperienceGain') return { scope: 'owner_player' }
  if (stat.startsWith('summon')) return { scope: 'owned_summons_of_synergy_members' }
  return { scope: 'synergy_members' }
}

function applyCommand(
  sourceId: string,
  effects: readonly SynergyEffect[],
  contributors: readonly string[] = [GENERAL_IDS.HOUYI, GENERAL_IDS.CHANG_E],
): SynergyReconcileCommand {
  return {
    kind: 'apply_effects',
    sourceKind: 'synergy',
    sourceId,
    activationLevel: 1,
    contributingGeneralIds: contributors,
    effects,
  }
}

export function runSynergyRuntimeProjectionSmokeChecks(): void {
  const registry = new SynergyRuntimeProjectionRegistry(GENERAL_SYNERGY_PROFILES)
  const allStatEffects: SynergyEffect[] = ALL_SYNERGY_STATS.map((stat, index) => ({
    effectId: `all_stats_${stat}`,
    type: 'stat_modifier',
    target: targetForStat(stat),
    stat,
    operation: 'add_ratio',
    value: 100 + index,
    stackGroup: `test_${stat}`,
  }))
  const specialEffects: SynergyEffect[] = [
    {
      effectId: 'conditional_damage',
      type: 'stat_modifier',
      target: { scope: 'synergy_members' },
      stat: 'damageDealt',
      operation: 'add_ratio',
      value: 2000,
      stackGroup: 'test_conditional_damage',
      condition: { targetTagsAny: ['boss'], effectTagsAny: ['active_skill'] },
    },
    {
      effectId: 'physical_facet_attack',
      type: 'stat_modifier',
      target: { scope: 'owner_generals_with_facet', dimension: 'profession', facetId: 'physical' },
      stat: 'attack',
      operation: 'add_ratio',
      value: 500,
      stackGroup: 'test_facet',
    },
    {
      effectId: 'patch_houyi_damage',
      type: 'effect_parameter_patch',
      target: { scope: 'synergy_members' },
      targetEffectId: 'houyi_luori_damage',
      parameter: 'coefficientBps',
      operation: 'add_ratio',
      value: 1000,
      stackGroup: 'test_parameter',
    },
  ]
  const applied = registry.applyReconcileCommands({
    ownerPlayerId: 'player-1',
    commands: [applyCommand('complete_runtime_source', [...allStatEffects, ...specialEffects])],
  })
  assert.equal(applied.appliedEffectCount, ALL_SYNERGY_STATS.length + specialEffects.length)

  const generalQuery = registry.query({
    subject: { kind: 'general', ownerPlayerId: 'player-1', generalId: GENERAL_IDS.HOUYI },
    targetTags: ['boss'],
    effectTags: ['active_skill'],
    targetEffectId: 'houyi_luori_damage',
  })
  const generalStats = new Set(generalQuery.statModifiers.map((effect) => effect.stat))
  for (const stat of ALL_SYNERGY_STATS.filter((candidate) =>
    candidate !== 'generalExperienceGain' && !candidate.startsWith('summon'))) {
    assert.ok(generalStats.has(stat), `general query must preserve ${stat}`)
  }
  assert.ok(generalQuery.statModifiers.some((effect) => effect.effectId === 'conditional_damage'))
  assert.ok(generalQuery.statModifiers.some((effect) => effect.effectId === 'physical_facet_attack'))
  assert.equal(generalQuery.parameterPatches[0]?.effectId, 'patch_houyi_damage')

  const conditionMiss = registry.query({
    subject: { kind: 'general', ownerPlayerId: 'player-1', generalId: GENERAL_IDS.HOUYI },
    targetTags: ['normal'],
    effectTags: ['basic_attack'],
  })
  assert.ok(conditionMiss.excluded.some((entry) =>
    entry.effect.effectId === 'conditional_damage' && entry.reason === 'target_condition_mismatch'))

  const summonQuery = registry.query({
    subject: {
      kind: 'summon',
      ownerPlayerId: 'player-1',
      sourceGeneralId: GENERAL_IDS.CHANG_E,
      summonUnitId: 'moon_rabbit',
    },
  })
  assert.deepEqual(
    summonQuery.statModifiers.map((effect) => effect.stat).sort(),
    ALL_SYNERGY_STATS.filter((stat) => stat.startsWith('summon')).sort(),
  )
  const playerQuery = registry.query({ subject: { kind: 'player', ownerPlayerId: 'player-1' } })
  assert.deepEqual(playerQuery.statModifiers.map((effect) => effect.stat), ['generalExperienceGain'])

  assert.equal(settleRuntimeSynergyStat({
    baseValue: 100,
    stat: 'attack',
    modifiers: [
      { ...generalQuery.statModifiers.find((effect) => effect.stat === 'attack')!, operation: 'add_flat', value: 10 },
      { ...generalQuery.statModifiers.find((effect) => effect.stat === 'attack')!, operation: 'add_ratio', value: 1000 },
      { ...generalQuery.statModifiers.find((effect) => effect.stat === 'attack')!, operation: 'multiply', value: 2 },
      { ...generalQuery.statModifiers.find((effect) => effect.stat === 'attack')!, operation: 'max', value: 0 },
      { ...generalQuery.statModifiers.find((effect) => effect.stat === 'attack')!, operation: 'min', value: 250 },
    ],
  }), 242)
  assert.equal(settleRuntimeSynergyParameter({
    baseValue: 1000,
    parameter: 'coefficientBps',
    patches: [
      { ...generalQuery.parameterPatches[0]!, operation: 'add_flat', value: 100 },
      { ...generalQuery.parameterPatches[0]!, operation: 'add_ratio', value: 1000 },
      { ...generalQuery.parameterPatches[0]!, operation: 'multiply', value: 2 },
    ],
  }), 2420)

  // 同名 source 在不同玩家下必须隔离；重算时要原子替换旧效果。
  registry.applyReconcileCommands({
    ownerPlayerId: 'player-2',
    commands: [applyCommand('complete_runtime_source', [allStatEffects[0]!])],
  })
  registry.applyReconcileCommands({
    ownerPlayerId: 'player-1',
    commands: [applyCommand('complete_runtime_source', [allStatEffects[1]!])],
  })
  const replacedPlayerOne = registry.query({
    subject: { kind: 'general', ownerPlayerId: 'player-1', generalId: GENERAL_IDS.HOUYI },
  })
  assert.deepEqual(replacedPlayerOne.statModifiers.map((entry) => entry.effectId), ['all_stats_attackSpeed'])
  const untouchedPlayerTwo = registry.query({
    subject: { kind: 'general', ownerPlayerId: 'player-2', generalId: GENERAL_IDS.HOUYI },
  })
  assert.deepEqual(untouchedPlayerTwo.statModifiers.map((entry) => entry.effectId), ['all_stats_attack'])

  const removal = registry.applyReconcileCommands({
    ownerPlayerId: 'player-1',
    commands: [{ kind: 'remove_source', sourceKind: 'synergy', sourceId: 'complete_runtime_source' }],
  })
  assert.deepEqual(removal.removedSourceIds, ['complete_runtime_source'])
  assert.equal(registry.query({
    subject: { kind: 'general', ownerPlayerId: 'player-1', generalId: GENERAL_IDS.HOUYI },
  }).statModifiers.length, 0)
  assert.equal(registry.activeSources('player-2').length, 1)

  const facetDefinition: SynergyDefinition = {
    schemaVersion: 1,
    synergyId: 'runtime_facet_reconfigure',
    displayName: '运行时贡献者换位',
    category: 'profession',
    activationScope: 'owner_board_formed_generals',
    levels: [{
      level: 1,
      requirements: [{ kind: 'facet_count', dimension: 'profession', facetId: 'physical', minimum: 2 }],
      effects: [allStatEffects[0]!],
    }],
    status: 'prototype',
  }
  const previous: PlayerSynergyEvaluation = {
    ownerPlayerId: 'player-1',
    activeGeneralIds: [GENERAL_IDS.HOUYI, GENERAL_IDS.YANGJIAN],
    activeSynergies: [{
      synergyId: facetDefinition.synergyId,
      level: 1,
      contributingGeneralIds: [GENERAL_IDS.HOUYI, GENERAL_IDS.YANGJIAN].sort(),
    }],
  }
  const next: PlayerSynergyEvaluation = {
    ownerPlayerId: 'player-1',
    activeGeneralIds: [GENERAL_IDS.HOUYI, GENERAL_IDS.NAZHA],
    activeSynergies: [{
      synergyId: facetDefinition.synergyId,
      level: 1,
      contributingGeneralIds: [GENERAL_IDS.HOUYI, GENERAL_IDS.NAZHA].sort(),
    }],
  }
  const contributorRefresh = reconcilePlayerSynergies({ previous, next, definitions: [facetDefinition] })
  assert.equal(contributorRefresh.changedLevels.length, 0)
  assert.equal(contributorRefresh.reconfigured.length, 1)
  assert.deepEqual(contributorRefresh.commands.map((command) => command.kind), [
    'remove_source',
    'apply_effects',
  ])
  assert.deepEqual(contributorRefresh.invalidateGeneralIds, [
    GENERAL_IDS.HOUYI,
    GENERAL_IDS.NAZHA,
    GENERAL_IDS.YANGJIAN,
  ].sort())

  // 旧 hero-v1 适配器遍历完整 catalog 时不得因新 effect/target/stat 崩溃。
  let legacyUnprojectedCount = 0
  for (const definition of SYNERGY_V1_CATALOG) {
    const activation = definition.levels[0]!
    const members = activation.requirements.flatMap((requirement) =>
      requirement.kind === 'all_generals' ? [...requirement.generalIds] : [])
    const projection = projectHeroV1GeneralStatModifiers({
      sourceSynergyId: definition.synergyId,
      contributingGeneralIds: members,
      effects: activation.effects,
    })
    legacyUnprojectedCount += projection.unprojected.length
  }
  assert.ok(legacyUnprojectedCount > 0, '旧适配器必须显式报告无法投影的新效果')
}

if (require.main === module) {
  runSynergyRuntimeProjectionSmokeChecks()
  console.log('synergy-v1 runtime projection smoke checks passed')
}
