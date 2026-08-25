import assert from 'node:assert/strict'
import { GENERAL_SYNERGY_IDS_BY_GENERAL, SYNERGY_V1_CATALOG } from '../../synergy-v1/catalog'
import {
  ALL_GENERAL_DEFINITIONS,
  fullRankExperienceRequired,
  GENERAL_CATALOG,
  HOUYI_DEFINITION,
  validateGeneralCatalog,
  validateSynergyEffectParameterPatches,
} from './catalog'
import { collectNestedEffects } from './catalog-data'
import { planGeneralCombatFrame, planGeneralPassiveTrigger } from './combat-engine'
import { GENERAL_IDS, GENERAL_ROSTER } from './roster'
import { SUMMON_UNIT_CATALOG, validateSummonUnitCatalog } from './summon-catalog'
import type { SynergyDefinition } from '../../synergy-v1/types'
import type {
  GeneralCombatEnemy,
  GeneralDefinition,
  GeneralFormationState,
  GeneralProgressState,
  GeneralStructuredEffectDefinition,
} from './types'

export function runFullGeneralCatalogSmokeChecks(): void {
  validateSummonUnitCatalog()
  validateGeneralCatalog()
  validateSynergyEffectParameterPatches()

  assert.equal(ALL_GENERAL_DEFINITIONS.length, 21)
  assert.equal(Object.keys(GENERAL_CATALOG).length, 21)
  assert.equal(Object.keys(SUMMON_UNIT_CATALOG).length, 4)
  assert.deepEqual(
    Object.keys(GENERAL_CATALOG).sort(),
    GENERAL_ROSTER.map((entry) => entry.generalId).sort(),
  )

  for (const roster of GENERAL_ROSTER) {
    const definition = GENERAL_CATALOG[roster.generalId]
    assert.ok(definition, `missing definition for ${roster.generalId}`)
    assert.equal(definition.name, roster.displayName)
    assert.deepEqual(definition.recipe.glyphs, roster.glyphs)
    assert.equal(definition.quality, roster.quality)
    assert.equal(definition.archetype, roster.profession)
    assert.deepEqual(
      [...definition.relatedSynergyIds].sort(),
      [...(GENERAL_SYNERGY_IDS_BY_GENERAL[roster.generalId] ?? [])].sort(),
      `relatedSynergyIds drifted for ${roster.generalId}`,
    )
  }

  // 后羿纵向切片数值必须逐项保持。
  assert.equal(HOUYI_DEFINITION.generalId, GENERAL_IDS.HOUYI)
  assert.deepEqual(HOUYI_DEFINITION.baseStats.attackByLevel, [34, 43, 55, 71, 92])
  assert.deepEqual(HOUYI_DEFINITION.baseStats.attackIntervalMsByLevel, [1350, 1250, 1150, 1050, 950])
  assert.deepEqual(HOUYI_DEFINITION.baseStats.attackRangeMilliCellsByLevel, [3000, 3000, 3000, 3000, 3000])
  assert.deepEqual(HOUYI_DEFINITION.activeSkill.cooldownMsByLevel, [12000, 11600, 11200, 10600, 10000])
  assert.deepEqual(
    HOUYI_DEFINITION.activeSkill.effects[0]?.type === 'damage'
      ? HOUYI_DEFINITION.activeSkill.effects[0].coefficientBpsByLevel
      : null,
    [22000, 24000, 26000, 28500, 32000],
  )

  const activeEffects = ALL_GENERAL_DEFINITIONS.flatMap((definition) =>
    collectNestedEffects(definition.activeSkill.effects))
  const passiveEffects = ALL_GENERAL_DEFINITIONS.flatMap((definition) =>
    collectNestedEffects(definition.passiveSkill.structuredEffects ?? []))
  const allStructuredEffects = [...activeEffects, ...passiveEffects]
  const activeEffectTypes = new Set(activeEffects.map((effect) => effect.type))
  for (const effectType of [
    'damage',
    'damage_over_time',
    'status_apply',
    'path_displacement',
    'summon_unit',
    'spawn_zone',
  ] as const) {
    assert.ok(activeEffectTypes.has(effectType), `active catalog missing ${effectType}`)
  }
  assert.ok(allStructuredEffects.some((effect) => effect.type === 'cooldown_modify'))
  assert.ok(allStructuredEffects.some((effect) => effect.type === 'effect_parameter_patch'))
  assert.ok(allStructuredEffects.some((effect) => effect.type === 'damage'
    && effect.hitCountByLevel?.some((count) => count > 1)), 'catalog must retain multi-hit skills')

  const targetingKinds = new Set(ALL_GENERAL_DEFINITIONS.map((definition) =>
    definition.activeSkill.targeting.kind ?? 'single'))
  for (const kind of ['single', 'radius_aoe', 'line', 'global', 'chain', 'self'] as const) {
    assert.ok(targetingKinds.has(kind), `catalog missing ${kind} targeting`)
  }

  const summonedIds = new Set(activeEffects
    .filter((effect): effect is Extract<GeneralStructuredEffectDefinition, { type: 'summon_unit' }> =>
      effect.type === 'summon_unit')
    .map((effect) => effect.summonUnitId))
  assert.deepEqual([...summonedIds].sort(), Object.keys(SUMMON_UNIT_CATALOG).sort())

  const leiGongPassive = GENERAL_CATALOG[GENERAL_IDS.LEI_GONG]!.passiveSkill
  assert.equal(leiGongPassive.trigger?.kind, 'on_skill_hit')
  assert.ok(leiGongPassive.structuredEffects?.some((effect) => effect.type === 'status_apply'))
  const zhenYuanziPassive = GENERAL_CATALOG[GENERAL_IDS.ZHEN_YUANZI]!.passiveSkill
  assert.equal(zhenYuanziPassive.trigger?.kind, 'on_skill_hit')
  assert.ok(zhenYuanziPassive.structuredEffects?.some((effect) => effect.type === 'status_apply'))

  // 21 名神将必须能通过同一规划入口产出可追溯的到期主动技能动作；召唤/自目标也不例外。
  const enemies: GeneralCombatEnemy[] = Array.from({ length: 12 }, (_, index) => ({
    id: `enemy-${index + 1}`,
    xMilli: 200 + index * 100,
    yMilli: index % 2 === 0 ? 0 : 100,
    currentHp: 100000,
    pathProgressMilli: 12000 - index * 100,
    spawnSequence: index + 1,
    targetable: true,
    tags: index === 0 ? ['boss'] : ['minion'],
  }))
  for (const definition of ALL_GENERAL_DEFINITIONS) {
    const formation: GeneralFormationState = {
      formationId: `formation-${definition.generalId}`,
      ownerPlayerId: 'smoke-player',
      generalId: definition.generalId,
      characterTokenIds: definition.recipe.glyphs.map((_, index) => `${definition.generalId}-glyph-${index}`),
      cells: definition.recipe.glyphs.map((_, index) => ({ x: index, y: 0 })),
      anchorMilli: { x: 0, y: 0 },
      fixed: true,
      active: true,
      revision: 1,
    }
    const progress: GeneralProgressState = {
      progressId: `progress-${definition.generalId}`,
      ownerPlayerId: 'smoke-player',
      generalId: definition.generalId,
      firstActivatedAtTick: 0,
      experiencePoints: 0,
      level: 1,
      maxLevel: 5,
      fullRankExperiencePoints: fullRankExperienceRequired(definition),
      hasTriggeredFirstActivationReward: true,
      nextBasicAttackTick: 999999,
      activeSkillReadyAtTick: 1,
      basicAttackCount: 0,
      nextPassiveTriggerTick: 0,
    }
    const plan = planGeneralCombatFrame({
      definition,
      formation,
      progress,
      currentTick: 100,
      tickRateMs: 100,
      enemies,
    })
    assert.ok(plan.combatActions.length >= 1, `${definition.generalId} active skill produced no combat action`)
    const traceableEffectIds = new Set(collectNestedEffects(definition.activeSkill.effects).map((effect) => effect.effectId))
    for (const action of plan.combatActions) {
      assert.equal(action.actionKind, 'active_skill')
      assert.equal(action.sourceGeneralId, definition.generalId)
      assert.equal(action.sourceFormationId, formation.formationId)
      assert.equal(action.sourceProgressId, progress.progressId)
      assert.ok(traceableEffectIds.has(action.effectId), `${definition.generalId} emitted unknown effect ${action.effectId}`)
    }
    if (definition.generalId === GENERAL_IDS.LEI_GONG || definition.generalId === GENERAL_IDS.ZHEN_YUANZI) {
      const passivePlan = planGeneralPassiveTrigger({
        definition,
        formation,
        progress,
        currentTick: 100,
        tickRateMs: 100,
        event: 'skill_hit',
        enemies,
      })
      assert.ok(passivePlan.actions.length >= 1, `${definition.generalId} on_skill_hit passive produced no action`)
      assert.ok(passivePlan.actions.every((action) => action.actionKind === 'passive'
        && action.sourceGeneralId === definition.generalId))
    }
  }

  const summonPatchSynergy = SYNERGY_V1_CATALOG.find((synergy) => synergy.synergyId === 'heavenly_soldier_moon_rabbit')!
  const invalidSummonRadiusPatch: SynergyDefinition = {
    ...summonPatchSynergy,
    levels: summonPatchSynergy.levels.map((level) => ({
      ...level,
      effects: level.effects.map((effect) => effect.type === 'effect_parameter_patch'
        && effect.targetEffectId === 'lijing_tianbing_summon'
        ? { ...effect, parameter: 'radiusMilliCells' }
        : effect),
    })),
  }
  assert.throws(
    () => validateSynergyEffectParameterPatches([invalidSummonRadiusPatch]),
    /Invalid parameter patch radiusMilliCells for summon_unit/,
  )

  assert.throws(
    () => validateGeneralCatalog(Object.fromEntries(Object.entries(GENERAL_CATALOG).slice(0, 20))),
    /exactly 21 definitions/,
  )

  const wrongIdentity = { ...GENERAL_CATALOG } as Record<string, GeneralDefinition>
  wrongIdentity[GENERAL_IDS.YANGJIAN] = {
    ...wrongIdentity[GENERAL_IDS.YANGJIAN]!,
    name: '错误名称',
  }
  assert.throws(() => validateGeneralCatalog(wrongIdentity), /identity does not match roster/)

  const duplicateEffect = { ...GENERAL_CATALOG } as Record<string, GeneralDefinition>
  const yangjianEffectId = duplicateEffect[GENERAL_IDS.YANGJIAN]!.activeSkill.effects[0]!.effectId
  const nazha = duplicateEffect[GENERAL_IDS.NAZHA]!
  duplicateEffect[GENERAL_IDS.NAZHA] = {
    ...nazha,
    activeSkill: {
      ...nazha.activeSkill,
      effects: [{ ...nazha.activeSkill.effects[0]!, effectId: yangjianEffectId }, ...nazha.activeSkill.effects.slice(1)],
    },
  }
  assert.throws(() => validateGeneralCatalog(duplicateEffect), /Duplicate effect ID/)
}

if (require.main === module) {
  runFullGeneralCatalogSmokeChecks()
  console.log('hero-v1 full catalog smoke checks passed')
}
