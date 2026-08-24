import assert from 'node:assert/strict'
import {
  GENERAL_SYNERGY_PROFILES,
  MOON_PALACE_COMPANIONS,
  SYNERGY_V1_CATALOG,
} from './catalog'
import {
  evaluatePlayerSynergies,
  reconcilePlayerSynergies,
  validateSynergyCatalog,
} from './engine'
import { inheritSummonStats, settleNumericStat, settleSkillCooldownMs } from './settlement'
import { HOUYI_DEFINITION, resolveGeneralStats } from '../core/hero-v1/catalog'
import { toHeroV1GeneralStatModifiers } from './hero-v1-adapter'
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
  validateSynergyCatalog({
    profiles: GENERAL_SYNERGY_PROFILES,
    definitions: SYNERGY_V1_CATALOG,
  })

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
