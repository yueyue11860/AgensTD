import assert from 'node:assert/strict'
import {
  GENERAL_DEVELOPMENT_SEQUENCE,
  GENERAL_SYNERGY_IDS_BY_GENERAL,
  GENERAL_SYNERGY_PROFILES,
  MOON_PALACE_COMPANIONS,
  SYNERGY_V1_CATALOG,
  validateGeneralDevelopmentSequence,
} from './catalog'
import { GENERAL_IDS, GENERAL_ROSTER } from '../core/hero-v1/roster'
import {
  evaluatePlayerSynergies,
  reconcilePlayerSynergies,
  validateSynergyCatalog,
} from './engine'
import { inheritSummonStats, settleNumericStat, settleSkillCooldownMs } from './settlement'
import { HOUYI_DEFINITION, resolveGeneralStats } from '../core/hero-v1/catalog'
import { toHeroV1GeneralStatModifiers } from './hero-v1-adapter'
import { runSynergyRuntimeProjectionSmokeChecks } from './runtime-projection-smoke'
import type {
  GeneralFormationProjection,
  NumericModifier,
  SynergyDefinition,
} from './index'

function formed(
  generalId: string,
  overrides: Partial<GeneralFormationProjection> = {},
): GeneralFormationProjection {
  return {
    ownerPlayerId: 'player-1',
    generalId,
    zone: 'board',
    isFormed: true,
    isFixed: false,
    constituentTokenIds: [`${generalId}-glyph-1`, `${generalId}-glyph-2`],
    ...overrides,
  }
}

export function runSynergyV1SmokeChecks(): void {
  runSynergyRuntimeProjectionSmokeChecks()
  assert.equal(GENERAL_ROSTER.length, 21)
  assert.equal(GENERAL_SYNERGY_PROFILES.length, 21)
  assert.equal(SYNERGY_V1_CATALOG.length, 22)
  assert.deepEqual(
    GENERAL_SYNERGY_PROFILES.map((profile) => profile.generalId).sort(),
    GENERAL_ROSTER.map((entry) => entry.generalId).sort(),
    '羁绊画像必须从权威 roster 一对一派生',
  )
  validateSynergyCatalog({
    profiles: GENERAL_SYNERGY_PROFILES,
    definitions: SYNERGY_V1_CATALOG,
  })
  validateGeneralDevelopmentSequence()
  assert.equal(GENERAL_DEVELOPMENT_SEQUENCE.length, GENERAL_ROSTER.length)
  assert.equal(new Set(GENERAL_DEVELOPMENT_SEQUENCE.map((step) => step.generalId)).size, GENERAL_ROSTER.length)
  const closedSynergies = GENERAL_DEVELOPMENT_SEQUENCE.flatMap((step) => [...step.closesSynergies])
  assert.equal(closedSynergies.length, SYNERGY_V1_CATALOG.length)
  assert.equal(new Set(closedSynergies).size, SYNERGY_V1_CATALOG.length)

  const knownGeneralIds = new Set(GENERAL_ROSTER.map((entry) => entry.generalId))
  for (const definition of SYNERGY_V1_CATALOG) {
    assert.equal(definition.levels.length, 1, `${definition.synergyId} 首版必须只有一个固定成员档位`)
    const fixedMembers = definition.levels[0]!.requirements.flatMap((requirement) =>
      requirement.kind === 'all_generals' ? [...requirement.generalIds] : [])
    assert.ok(fixedMembers.length >= 2, `${definition.synergyId} 必须是至少二人的固定组合`)
    fixedMembers.forEach((generalId) => assert.ok(
      knownGeneralIds.has(generalId as typeof GENERAL_ROSTER[number]['generalId']),
      `${definition.synergyId} 引用了未注册神将 ${generalId}`,
    ))
    assert.ok(definition.levels[0]!.effects.length > 0, `${definition.synergyId} 不得使用空效果占位`)
  }
  for (const profile of GENERAL_SYNERGY_PROFILES) {
    assert.ok(
      (GENERAL_SYNERGY_IDS_BY_GENERAL[profile.generalId]?.length ?? 0) >= 1,
      `${profile.displayName} 必须至少参与一条羁绊`,
    )
  }
  assert.equal(JSON.stringify(SYNERGY_V1_CATALOG).includes('allAttributes'), false)
  const buddhistFerry = SYNERGY_V1_CATALOG.find((entry) => entry.synergyId === 'buddhist_ferry')!
  assert.ok(buddhistFerry.levels[0]!.effects.some((effect) =>
    effect.type === 'stat_modifier'
    && effect.stat === 'controlDuration'
    && effect.value === 2000))
  assert.equal(buddhistFerry.levels[0]!.effects.filter((effect) =>
    effect.type === 'effect_parameter_patch'
    && effect.parameter === 'magnitude'
    && effect.operation === 'add_ratio'
    && effect.value === 1000).length, 2)
  const curtainDragon = SYNERGY_V1_CATALOG.find((entry) => entry.synergyId === 'curtain_dragon')!
  assert.ok(curtainDragon.levels[0]!.effects.some((effect) =>
    effect.type === 'stat_modifier'
    && effect.stat === 'damageDealt'
    && effect.value === 1500
    && effect.condition?.effectTagsAny?.includes('active_skill')))
  assert.ok(curtainDragon.levels[0]!.effects.some((effect) =>
    effect.type === 'stat_modifier'
    && effect.stat === 'attackSpeed'
    && effect.value === 1000))
  const pilgrimageFive = SYNERGY_V1_CATALOG.find((entry) => entry.synergyId === 'pilgrimage_five')!
  assert.ok(pilgrimageFive.levels[0]!.effects.some((effect) =>
    effect.type === 'stat_modifier'
    && effect.target.scope === 'owner_player'
    && effect.stat === 'generalExperienceGain'
    && effect.value === 2000))
  const longevityDefinition = SYNERGY_V1_CATALOG.find((entry) => entry.synergyId === 'longevity_immortals')!
  assert.deepEqual(longevityDefinition.levels[0]!.effects.map((effect) =>
    effect.type === 'stat_modifier' ? [effect.stat, effect.operation, effect.value] : null), [
    ['controlDuration', 'add_ratio', 1500],
    ['cooldownReduction', 'add_ratio', 1000],
  ])

  const heavenlyCluster = evaluatePlayerSynergies({
    ownerPlayerId: 'player-1',
    formations: [
      GENERAL_IDS.YANGJIAN,
      GENERAL_IDS.NAZHA,
      GENERAL_IDS.LIJING,
      GENERAL_IDS.HOUYI,
      GENERAL_IDS.YU_HUANG_DADI,
      GENERAL_IDS.LEI_GONG,
      GENERAL_IDS.DIAN_MU,
    ].map((generalId) => formed(generalId)),
    profiles: GENERAL_SYNERGY_PROFILES,
    definitions: SYNERGY_V1_CATALOG,
  })
  assert.deepEqual(heavenlyCluster.activeSynergies.map((entry) => entry.synergyId), [
    'heaven_vanguard',
    'heavenly_court_saints',
    'lotus_father_and_son',
    'physical_heavenly_venerates',
    'piercing_cloud_duo',
    'thunder_duo',
  ])

  const pilgrimageFormations = [
    GENERAL_IDS.TANG_SANZANG,
    GENERAL_IDS.SUNWUKONG,
    GENERAL_IDS.ZHU_BAJIE,
    GENERAL_IDS.SHA_WUJING,
    GENERAL_IDS.BAI_LONGMA,
  ].map((generalId) => formed(generalId))
  const pilgrimageCluster = evaluatePlayerSynergies({
    ownerPlayerId: 'player-1',
    formations: pilgrimageFormations,
    profiles: GENERAL_SYNERGY_PROFILES,
    definitions: SYNERGY_V1_CATALOG,
  })
  assert.deepEqual(pilgrimageCluster.activeSynergies.map((entry) => entry.synergyId), [
    'curtain_canopy',
    'curtain_dragon',
    'mentor_and_disciple',
    'pilgrimage_five',
    'pilgrimage_three_disciples',
    'senior_brothers',
  ])
  const pilgrimageWithoutWhiteDragon = evaluatePlayerSynergies({
    ownerPlayerId: 'player-1',
    formations: pilgrimageFormations.filter((formation) => formation.generalId !== GENERAL_IDS.BAI_LONGMA),
    profiles: GENERAL_SYNERGY_PROFILES,
    definitions: SYNERGY_V1_CATALOG,
  })
  const pilgrimageRemoval = reconcilePlayerSynergies({
    previous: pilgrimageCluster,
    next: pilgrimageWithoutWhiteDragon,
    definitions: SYNERGY_V1_CATALOG,
  })
  assert.deepEqual(pilgrimageRemoval.deactivated.map((entry) => entry.synergyId), [
    'curtain_dragon',
    'pilgrimage_five',
  ])
  assert.deepEqual(pilgrimageRemoval.commands.filter((command) => command.kind === 'remove_source').map((command) => command.sourceId), [
    'curtain_dragon',
    'pilgrimage_five',
  ])

  const longevity = evaluatePlayerSynergies({
    ownerPlayerId: 'player-1',
    formations: [formed(GENERAL_IDS.SHOU_XING), formed(GENERAL_IDS.TAI_SHANG_LAOJUN)],
    profiles: GENERAL_SYNERGY_PROFILES,
    definitions: SYNERGY_V1_CATALOG,
  })
  assert.deepEqual(longevity.activeSynergies.map((entry) => entry.synergyId), ['longevity_immortals'])

  const noPartner = evaluatePlayerSynergies({
    ownerPlayerId: 'player-1',
    formations: [formed('houyi')],
    profiles: GENERAL_SYNERGY_PROFILES,
    definitions: SYNERGY_V1_CATALOG,
  })
  assert.deepEqual(noPartner.activeSynergies, [])

  const active = evaluatePlayerSynergies({
    ownerPlayerId: 'player-1',
    formations: [formed('houyi'), formed('chang_e', { isFixed: true })],
    profiles: GENERAL_SYNERGY_PROFILES,
    definitions: SYNERGY_V1_CATALOG,
  })
  assert.deepEqual(active.activeSynergies, [
    {
      synergyId: 'moon_palace_companions',
      level: 1,
      contributingGeneralIds: ['chang_e', 'houyi'],
    },
  ])

  const unlocked = evaluatePlayerSynergies({
    ownerPlayerId: 'player-1',
    formations: [formed('houyi'), formed('chang_e', { isFixed: false })],
    profiles: GENERAL_SYNERGY_PROFILES,
    definitions: SYNERGY_V1_CATALOG,
  })
  assert.deepEqual(unlocked, active, '固定/解除固定不得改变羁绊')

  const ignoredStorageAndOtherPlayer = evaluatePlayerSynergies({
    ownerPlayerId: 'player-1',
    formations: [
      formed('houyi'),
      formed('chang_e', { zone: 'tray' }),
      formed('chang_e', { zone: 'reserve' }),
      formed('chang_e', { ownerPlayerId: 'player-2' }),
    ],
    profiles: GENERAL_SYNERGY_PROFILES,
    definitions: SYNERGY_V1_CATALOG,
  })
  assert.deepEqual(ignoredStorageAndOtherPlayer.activeSynergies, [])

  const broken = evaluatePlayerSynergies({
    ownerPlayerId: 'player-1',
    formations: [formed('houyi'), formed('chang_e', { isFormed: false })],
    profiles: GENERAL_SYNERGY_PROFILES,
    definitions: SYNERGY_V1_CATALOG,
  })
  const disabled = reconcilePlayerSynergies({
    previous: active,
    next: broken,
    definitions: SYNERGY_V1_CATALOG,
  })
  assert.deepEqual(disabled.deactivated, active.activeSynergies)
  assert.deepEqual(disabled.commands, [
    {
      kind: 'remove_source',
      sourceKind: 'synergy',
      sourceId: 'moon_palace_companions',
    },
  ])

  const enabled = reconcilePlayerSynergies({
    previous: noPartner,
    next: active,
    definitions: SYNERGY_V1_CATALOG,
  })
  assert.equal(enabled.commands.length, 1)
  assert.equal(enabled.commands[0]?.kind, 'apply_effects')
  assert.deepEqual(enabled.invalidateGeneralIds, ['chang_e', 'houyi'])
  assert.deepEqual(enabled.refreshSummonsOwnedByGeneralIds, ['chang_e', 'houyi'])
  const applyCommand = enabled.commands[0]
  assert.equal(applyCommand?.kind, 'apply_effects')
  if (applyCommand?.kind !== 'apply_effects') throw new Error('Expected apply command')
  const heroModifiers = toHeroV1GeneralStatModifiers({
    sourceSynergyId: applyCommand.sourceId,
    contributingGeneralIds: applyCommand.contributingGeneralIds,
    effects: applyCommand.effects,
  })
  const resolvedHouyi = resolveGeneralStats(HOUYI_DEFINITION, 1, heroModifiers)
  assert.equal(resolvedHouyi.attackRangeMilliCells, 3500)
  assert.equal(resolvedHouyi.attackIntervalMs, 1228)

  const physicalFacetSynergy: SynergyDefinition = {
    schemaVersion: 1,
    synergyId: 'test_physical_pair',
    displayName: '测试物理二人',
    category: 'profession',
    activationScope: 'owner_board_formed_generals',
    levels: [
      {
        level: 1,
        requirements: [
          { kind: 'facet_count', dimension: 'profession', facetId: 'physical', minimum: 2 },
        ],
        effects: [],
      },
    ],
    status: 'prototype',
  }
  const duplicatesDoNotCountTwice = evaluatePlayerSynergies({
    ownerPlayerId: 'player-1',
    formations: [formed('houyi'), formed('houyi')],
    profiles: GENERAL_SYNERGY_PROFILES,
    definitions: [physicalFacetSynergy],
  })
  assert.deepEqual(duplicatesDoNotCountTwice.activeSynergies, [])

  const twoPhysicalGenerals = evaluatePlayerSynergies({
    ownerPlayerId: 'player-1',
    formations: [formed('houyi'), formed('yangjian')],
    profiles: GENERAL_SYNERGY_PROFILES,
    definitions: [physicalFacetSynergy],
  })
  assert.equal(twoPhysicalGenerals.activeSynergies[0]?.synergyId, 'test_physical_pair')

  const tieredPhysicalSynergy: SynergyDefinition = {
    ...physicalFacetSynergy,
    synergyId: 'test_tiered_physical',
    levels: [
      physicalFacetSynergy.levels[0]!,
      {
        level: 2,
        requirements: [
          { kind: 'facet_count', dimension: 'profession', facetId: 'physical', minimum: 3 },
        ],
        effects: [],
      },
    ],
  }
  const highestTierOnly = evaluatePlayerSynergies({
    ownerPlayerId: 'player-1',
    formations: [formed('houyi'), formed('yangjian'), formed('nazha')],
    profiles: GENERAL_SYNERGY_PROFILES,
    definitions: [tieredPhysicalSynergy],
  })
  assert.equal(highestTierOnly.activeSynergies[0]?.level, 2)

  assert.throws(() => validateSynergyCatalog({
    profiles: GENERAL_SYNERGY_PROFILES,
    definitions: [{
      ...MOON_PALACE_COMPANIONS,
      synergyId: 'invalid_unknown_general',
      levels: [{
        ...MOON_PALACE_COMPANIONS.levels[0]!,
        requirements: [{ kind: 'all_generals', generalIds: ['houyi', 'not_registered'] }],
      }],
    }],
  }), /Unknown general not_registered/)

  const attackSpeed = settleNumericStat(1, [
    {
      sourceKind: 'synergy',
      sourceId: MOON_PALACE_COMPANIONS.synergyId,
      stat: 'attackSpeed',
      operation: 'add_ratio',
      value: 1000,
    },
    {
      sourceKind: 'synergy',
      sourceId: 'another_synergy',
      stat: 'attackSpeed',
      operation: 'add_ratio',
      value: 1500,
    },
  ] satisfies NumericModifier[])
  assert.equal(attackSpeed, 1.25, '同层 add_ratio 先加法汇总')
  assert.equal(
    settleSkillCooldownMs({ baseCooldownMs: 10_000, reductionBps: [2500, 3000] }),
    6_000,
    '常驻减 CD 不得超过 40%',
  )
  assert.equal(
    settleSkillCooldownMs({
      baseCooldownMs: 1_500,
      reductionBps: [4000],
      flatReductionMs: 500,
    }),
    1_000,
    '最终技能 CD 不得低于 1 秒',
  )

  const summonStats = inheritSummonStats({
    summonBaseStats: { attackRange: 2, critRate: 0.05 },
    ownerFinalStats: { attack: 200, attackSpeed: 1.5, attackRange: 3.5 },
    inheritance: [
      { ownerStat: 'attack', summonStat: 'summonAttack', ratio: 0.5 },
      { ownerStat: 'attackSpeed', summonStat: 'summonAttackSpeed', ratio: 1 },
    ],
  })
  assert.deepEqual(summonStats, {
    attackRange: 2,
    critRate: 0.05,
    summonAttack: 100,
    summonAttackSpeed: 1.5,
  })
}

if (require.main === module) {
  runSynergyV1SmokeChecks()
  console.log('synergy-v1 smoke checks passed')
}
