import assert from 'node:assert/strict'
import { GENERAL_CATALOG, fullRankExperienceRequired, resolveGeneralStats } from '../core/hero-v1/catalog'
import { planGeneralEffectActions } from '../core/hero-v1/combat-engine'
import { GENERAL_IDS } from '../core/hero-v1/roster'
import type {
  GeneralCombatEnemy,
  GeneralDefinition,
  GeneralFormationState,
  GeneralProgressState,
  GeneralStatModifier,
} from '../core/hero-v1/types'
import {
  GENERAL_SYNERGY_PROFILES,
  SYNERGY_V1_CATALOG,
  SynergyRuntimeProjectionRegistry,
  settleRuntimeSynergyParameter,
  settleRuntimeSynergyStat,
} from '../synergy-v1'
import type { SynergyEffect, SynergyRuntimeSubject } from '../synergy-v1'
import { HOUYI_DEFINITION } from '../core/hero-v1/catalog-data'
import { PveGameRuntime } from './runtime'

function membersOf(effectOwner: typeof SYNERGY_V1_CATALOG[number]): string[] {
  return [...new Set(effectOwner.levels.flatMap((level) => level.requirements.flatMap((requirement) => (
    requirement.kind === 'all_generals' ? [...requirement.generalIds] : []
  ))))].sort()
}

function querySubject(effect: SynergyEffect, members: readonly string[]): SynergyRuntimeSubject {
  if (effect.target.scope === 'owner_player') return { kind: 'player', ownerPlayerId: 'matrix-player' }
  if (effect.target.scope === 'owned_summons_of_synergy_members') {
    return { kind: 'summon', ownerPlayerId: 'matrix-player', sourceGeneralId: members[0]!, summonUnitId: 'matrix-summon' }
  }
  if (effect.target.scope === 'owner_generals_with_facet') {
    const profile = GENERAL_SYNERGY_PROFILES.find((candidate) => {
      if (effect.target.scope !== 'owner_generals_with_facet') return false
      if (effect.target.dimension === 'profession') return candidate.profession === effect.target.facetId
      if (effect.target.dimension === 'faction') return candidate.factions.includes(effect.target.facetId)
      if (effect.target.dimension === 'playstyle') return candidate.playstyles.includes(effect.target.facetId)
      return candidate.namedCollections.includes(effect.target.facetId)
    })
    assert.ok(profile)
    return { kind: 'general', ownerPlayerId: 'matrix-player', generalId: profile.generalId }
  }
  return { kind: 'general', ownerPlayerId: 'matrix-player', generalId: members[0]! }
}

function assertAllCatalogEffectsQueryable(): void {
  assert.equal(SYNERGY_V1_CATALOG.length, 22)
  for (const definition of SYNERGY_V1_CATALOG) {
    const registry = new SynergyRuntimeProjectionRegistry(GENERAL_SYNERGY_PROFILES)
    const level = definition.levels[0]!
    const members = membersOf(definition)
    assert.doesNotThrow(() => registry.applyReconcileCommands({
      ownerPlayerId: 'matrix-player',
      commands: [{ kind: 'apply_effects', sourceKind: 'synergy', sourceId: definition.synergyId,
        activationLevel: level.level, contributingGeneralIds: members, effects: level.effects }],
    }), definition.synergyId)
    for (const effect of level.effects) {
      const result = registry.query({
        subject: querySubject(effect, members),
        targetTags: effect.type === 'stat_modifier' ? effect.condition?.targetTagsAny : undefined,
        effectTags: effect.type === 'stat_modifier' ? effect.condition?.effectTagsAny : undefined,
        targetEffectId: effect.type === 'effect_parameter_patch' ? effect.targetEffectId : undefined,
      })
      const found = effect.type === 'stat_modifier'
        ? result.statModifiers.some((candidate) => candidate.effectId === effect.effectId)
        : result.parameterPatches.some((candidate) => candidate.effectId === effect.effectId)
      assert.equal(found, true, `${definition.synergyId}.${effect.effectId} must be queryable`)
    }
  }
}

function assertRatioSlotsAndCritRatios(): void {
  const registry = new SynergyRuntimeProjectionRegistry(GENERAL_SYNERGY_PROFILES)
  const effects: SynergyEffect[] = [
    { effectId: 'magic20', type: 'stat_modifier', target: { scope: 'synergy_members' },
      stat: 'magicDamageBonus', operation: 'add_ratio', value: 2000, stackGroup: 'magic' },
    { effectId: 'cdr10', type: 'stat_modifier', target: { scope: 'synergy_members' },
      stat: 'cooldownReduction', operation: 'add_ratio', value: 1000, stackGroup: 'cdr' },
    { effectId: 'control20', type: 'stat_modifier', target: { scope: 'synergy_members' },
      stat: 'controlDuration', operation: 'add_ratio', value: 2000, stackGroup: 'control' },
  ]
  registry.applyReconcileCommands({ ownerPlayerId: 'ratio-player', commands: [{ kind: 'apply_effects',
    sourceKind: 'synergy', sourceId: 'ratio-source', activationLevel: 1,
    contributingGeneralIds: [GENERAL_IDS.HOUYI], effects }] })
  const modifiers = registry.query({ subject: { kind: 'general', ownerPlayerId: 'ratio-player',
    generalId: GENERAL_IDS.HOUYI } }).statModifiers
  assert.equal(settleRuntimeSynergyStat({ baseValue: 10000, stat: 'magicDamageBonus', modifiers }), 12000)
  assert.equal(settleRuntimeSynergyStat({ baseValue: 10000, stat: 'cooldownReduction', modifiers }) - 10000, 1000)
  assert.equal(settleRuntimeSynergyStat({ baseValue: 5000, stat: 'controlDuration', modifiers }), 6000)

  const critModifiers: GeneralStatModifier[] = [
    { source: { kind: 'synergy', sourceId: 'ratio' }, target: { scope: 'self' },
      stat: 'critRate', operation: 'add_ratio', value: 2000, stackGroup: 'crit_rate' },
    { source: { kind: 'synergy', sourceId: 'ratio' }, target: { scope: 'self' },
      stat: 'critDamage', operation: 'add_ratio', value: 2000, stackGroup: 'crit_damage' },
  ]
  const stats = resolveGeneralStats(HOUYI_DEFINITION, 1, critModifiers)
  assert.equal(stats.critChanceBps, Math.floor(HOUYI_DEFINITION.baseStats.critChanceBpsByLevel[0] * 1.2))
  assert.equal(stats.critDamageBps, Math.floor(HOUYI_DEFINITION.baseStats.critDamageBpsByLevel[0] * 1.2))
}

function assertRestoredNamedSynergyParameters(): void {
  const registry = new SynergyRuntimeProjectionRegistry(GENERAL_SYNERGY_PROFILES)
  for (const synergyId of ['thunder_duo', 'earth_immortal_circle']) {
    const definition = SYNERGY_V1_CATALOG.find((candidate) => candidate.synergyId === synergyId)
    assert.ok(definition)
    const members = membersOf(definition)
    registry.applyReconcileCommands({ ownerPlayerId: 'named-player', commands: [{
      kind: 'apply_effects', sourceKind: 'synergy', sourceId: definition.synergyId,
      activationLevel: definition.levels[0]!.level, contributingGeneralIds: members,
      effects: definition.levels[0]!.effects,
    }] })
  }

  const patchesFor = (generalId: string, targetEffectId: string) => registry.query({
    subject: { kind: 'general' as const, ownerPlayerId: 'named-player', generalId },
    targetEffectId,
  }).parameterPatches

  assert.equal(settleRuntimeSynergyParameter({
    baseValue: 5,
    parameter: 'targetLimit',
    patches: patchesFor(GENERAL_IDS.DIAN_MU, 'dian_mu_shandianlian'),
  }), 6, '雷部双神必须让电母闪电链多弹射 1 个目标')

  for (const effectId of ['zhen_yuanzi_xiulikun', 'zhen_yuanzi_qiankun_dot']) {
    assert.equal(settleRuntimeSynergyParameter({
      baseValue: 3000,
      parameter: 'radiusMilliCells',
      patches: patchesFor(GENERAL_IDS.ZHEN_YUANZI, effectId),
    }), 4000, `地仙之流必须让 ${effectId} 技能范围 +1 格`)
  }
  assert.equal(settleRuntimeSynergyParameter({
    baseValue: 1000,
    parameter: 'spawnRadiusMilliCells',
    patches: patchesFor(GENERAL_IDS.TAI_YI_ZHENREN, 'tai_yi_zhenren_xiantong_summon'),
  }), 2000, '地仙之流必须让太乙真人仙童召唤范围 +1 格')

  const fixture = (definition: GeneralDefinition): {
    formation: GeneralFormationState
    progress: GeneralProgressState
  } => ({
    formation: {
      formationId: `named-${definition.generalId}`,
      ownerPlayerId: 'named-player',
      generalId: definition.generalId,
      characterTokenIds: definition.recipe.glyphs.map((_, index) => `glyph-${index}`),
      cells: definition.recipe.glyphs.map((_, index) => ({ x: index, y: 0 })),
      anchorMilli: { x: 0, y: 0 },
      fixed: true,
      active: true,
      revision: 1,
    },
    progress: {
      progressId: `progress-${definition.generalId}`,
      ownerPlayerId: 'named-player',
      generalId: definition.generalId,
      firstActivatedAtTick: 0,
      experiencePoints: 0,
      level: 1,
      maxLevel: 5,
      fullRankExperiencePoints: fullRankExperienceRequired(definition),
      hasTriggeredFirstActivationReward: true,
      nextBasicAttackTick: 0,
      activeSkillReadyAtTick: 0,
      basicAttackCount: 0,
      nextPassiveTriggerTick: 0,
    },
  })
  const plan = (definition: GeneralDefinition, enemies: readonly GeneralCombatEnemy[]) => {
    const state = fixture(definition)
    return planGeneralEffectActions({
      definition,
      ...state,
      stats: resolveGeneralStats(definition, 1),
      actionKind: 'active_skill',
      actionId: `named-${definition.generalId}-cast`,
      defaultTargeting: definition.activeSkill.targeting,
      effects: definition.activeSkill.effects,
      enemies,
      parameterResolver: (effectId, parameter, baseValue) => settleRuntimeSynergyParameter({
        baseValue,
        parameter,
        patches: patchesFor(definition.generalId, effectId),
      }),
    })
  }

  const chainEnemies: GeneralCombatEnemy[] = Array.from({ length: 6 }, (_, index) => ({
    id: `chain-${index}`,
    xMilli: 1000 + index * 400,
    yMilli: 0,
    currentHp: 100000,
    pathProgressMilli: 10000 - index,
    spawnSequence: index,
    targetable: true,
    tags: ['minion'],
  }))
  const dianActions = plan(GENERAL_CATALOG[GENERAL_IDS.DIAN_MU]!, chainEnemies)
    .filter((action) => action.effectType === 'damage' && action.effectId === 'dian_mu_shandianlian')
  assert.equal(dianActions.length, 6, '目标上限 +1 必须真实进入链式目标规划器')

  const radiusEnemies: GeneralCombatEnemy[] = [
    { id: 'radius-primary', xMilli: 1000, yMilli: 0, currentHp: 100000,
      pathProgressMilli: 10000, spawnSequence: 1, targetable: true, tags: ['minion'] },
    { id: 'radius-edge', xMilli: 4500, yMilli: 0, currentHp: 100000,
      pathProgressMilli: 9000, spawnSequence: 2, targetable: true, tags: ['minion'] },
  ]
  const zhenActions = plan(GENERAL_CATALOG[GENERAL_IDS.ZHEN_YUANZI]!, radiusEnemies)
  for (const effectId of ['zhen_yuanzi_xiulikun', 'zhen_yuanzi_qiankun_dot']) {
    const action = zhenActions.find((candidate) => candidate.effectId === effectId)
    assert.ok(action)
    assert.deepEqual(action.targetEnemyIds, ['radius-primary', 'radius-edge'],
      `${effectId} 的 +1 格必须真实扩大目标冻结范围`)
  }

  const taiyiAction = plan(GENERAL_CATALOG[GENERAL_IDS.TAI_YI_ZHENREN]!, [])
    .find((action) => action.effectType === 'summon_unit')
  assert.ok(taiyiAction?.effectType === 'summon_unit')
  assert.equal(taiyiAction.spawnRadiusMilliCells, 2000,
    '太乙真人 +1 格必须真实进入召唤动作的 spawnRadiusMilliCells')
}

function createMoonPalaceRuntime(): PveGameRuntime {
  for (let seed = 0; seed < 40000; seed += 1) {
    const runtime = new PveGameRuntime({ seed: `pve-synergy-${seed}`, prepDurationMs: 0, maxWaves: 1,
      characterTokens: { 后: 1, 羿: 1, 嫦: 1, 娥: 1 } })
    runtime.registerPlayer('moon-player', 'P1')
    runtime.handleAction('moon-player', { type: 'RECRUIT_BATCH', actionId: 'recruit' })
    const glyphs = runtime.snapshot().players[0]!.tray.flatMap((piece) => piece?.kind === 'character' ? [piece.glyph] : [])
    if (['后', '羿', '嫦', '娥'].every((glyph) => glyphs.includes(glyph))) return runtime
  }
  throw new Error('No deterministic seed recruited the four Moon Palace glyphs')
}

function assertPveActivationAndExactRemoval(): void {
  const runtime = createMoonPalaceRuntime()
  const placements = new Map([['后', 8], ['羿', 9], ['嫦', 11], ['娥', 12]])
  for (const [glyph, x] of placements) {
    const tray = runtime.snapshot().players[0]!.tray
    const trayIndex = tray.findIndex((piece) => piece?.kind === 'character' && piece.glyph === glyph)
    assert.ok(trayIndex >= 0)
    assert.equal(runtime.handleAction('moon-player', { type: 'SWAP_TRAY_BOARD', actionId: `deploy-${glyph}`,
      trayIndex, boardX: x, boardY: 17 }).ok, true)
  }
  let player = runtime.snapshot().players[0]!
  assert.ok(player.activeSynergies.some((entry) => entry.synergyId === 'moon_palace_companions'))
  assert.equal(player.generalProgress.find((entry) => entry.generalId === GENERAL_IDS.HOUYI)?.attackRangeMilliCells, 3500)
  assert.ok(runtime.snapshot().recentEvents.some((event) => event.type === 'SYNERGY_ACTIVATED'))

  assert.equal(runtime.handleAction('moon-player', { type: 'SWAP_RESERVE_BOARD', actionId: 'break-change',
    reserveIndex: 0, boardX: 12, boardY: 17 }).ok, true)
  player = runtime.snapshot().players[0]!
  assert.equal(player.activeSynergies.some((entry) => entry.synergyId === 'moon_palace_companions'), false)
  assert.equal(player.generalProgress.find((entry) => entry.generalId === GENERAL_IDS.HOUYI)?.attackRangeMilliCells, 3000)
  assert.ok(runtime.snapshot().recentEvents.some((event) => event.type === 'SYNERGY_DEACTIVATED'))
}

export function runPveSynergySmokeChecks(): void {
  assertAllCatalogEffectsQueryable()
  assertRatioSlotsAndCritRatios()
  assertRestoredNamedSynergyParameters()
  assertPveActivationAndExactRemoval()
}

if (require.main === module) {
  runPveSynergySmokeChecks()
  console.log('pve-v2 synergy smoke checks passed')
}
