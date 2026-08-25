import assert from 'node:assert/strict'
import {
  cumulativeExperienceRequiredForLevel,
  HOUYI_DEFINITION,
  resolveGeneralStats,
  validateGeneralDefinition,
} from './catalog'
import {
  planGeneralCombatFrame,
  planGeneralEffectActions,
  planGeneralPassiveTrigger,
  selectGeneralTarget,
  selectGeneralTargets,
  validateGeneralCombatDefinition,
} from './combat-engine'
import { GeneralFormationManager } from './formation-manager'
import type {
  GeneralCombatEnemy,
  GeneralDefinition,
  GeneralStatModifier,
  GeneralStructuredEffectDefinition,
  HeroCharacterToken,
} from './types'

const token = (
  tokenId: string,
  glyph: string,
  x: number,
  y = 5,
): HeroCharacterToken => ({ tokenId, ownerPlayerId: 'player-1', glyph, x, y })

export function runHeroV1Smoke(): void {
  validateGeneralDefinition(HOUYI_DEFINITION)
  assert.equal(HOUYI_DEFINITION.generalId, 'houyi')
  assert.deepEqual(HOUYI_DEFINITION.recipe.glyphs, ['后', '羿'])
  assert.deepEqual(HOUYI_DEFINITION.baseStats.attackRangeMilliCellsByLevel, [3000, 3000, 3000, 3000, 3000])
  assert.equal(cumulativeExperienceRequiredForLevel(HOUYI_DEFINITION, 5), 120000)

  const moonPalaceModifiers: GeneralStatModifier[] = [
    {
      source: { kind: 'synergy', sourceId: 'moon_palace_companions' },
      target: { scope: 'synergy_members', generalIds: ['houyi', 'chang_e'] },
      stat: 'attackRange',
      operation: 'add_flat',
      value: 500,
      stackGroup: 'moon_palace_companions_range',
    },
    {
      source: { kind: 'synergy', sourceId: 'moon_palace_companions' },
      target: { scope: 'synergy_members', generalIds: ['houyi', 'chang_e'] },
      stat: 'attackSpeed',
      operation: 'add_ratio',
      value: 1000,
      stackGroup: 'moon_palace_companions_attack_speed',
    },
  ]
  const levelThreeStats = resolveGeneralStats(HOUYI_DEFINITION, 3, moonPalaceModifiers)
  assert.equal(levelThreeStats.attack, 55)
  assert.equal(levelThreeStats.attackRangeMilliCells, 3500)
  assert.equal(levelThreeStats.attackIntervalMs, 1046)

  const manager = new GeneralFormationManager()
  const wrongOrder = manager.reconcilePlayer('player-1', [token('token-yi', '羿', 1), token('token-hou', '后', 2)], 0, 10, 10)
  assert.equal(wrongOrder.activeFormations.length, 0)
  const formed = manager.reconcilePlayer('player-1', [token('token-hou', '后', 1), token('token-yi', '羿', 2)], 9, 10, 11)
  assert.equal(formed.ok, true)
  assert.equal(formed.populationUsed, 10)
  assert.deepEqual(formed.activatedGeneralIds, ['houyi'])
  assert.deepEqual(formed.activeFormations[0].anchorMilli, { x: 1500, y: 5000 })

  const fixed = manager.setFixed('player-1', formed.activeFormations[0].formationId, true)
  assert.equal(fixed?.fixed, true)
  const movePlan = manager.planFixedFormationMove(
    'player-1',
    formed.activeFormations[0].formationId,
    { x: 4, y: 5 },
    () => true,
    () => false,
  )
  assert.equal(movePlan.ok, true)
  assert.deepEqual(movePlan.tokenMoves.map((move) => move.to), [{ x: 4, y: 5 }, { x: 5, y: 5 }])

  assert.equal(manager.addExperience('player-1', 'houyi', 120000)?.level, 3)
  const disbanded = manager.reconcilePlayer('player-1', [token('token-hou', '后', 1)], 9, 10, 20)
  assert.deepEqual(disbanded.deactivatedGeneralIds, ['houyi'])
  assert.equal(manager.getProgress('player-1', 'houyi')?.experiencePoints, 120000)
  const reformed = manager.reconcilePlayer(
    'player-1',
    [token('replacement-hou', '后', 7), token('replacement-yi', '羿', 8)],
    9,
    10,
    30,
  )
  assert.deepEqual(reformed.activatedGeneralIds, ['houyi'])
  assert.equal(manager.getProgress('player-1', 'houyi')?.level, 3)
  assert.equal(manager.setBreakthrough('player-1', 'houyi', true)?.level, 5)

  const blockedManager = new GeneralFormationManager()
  const blocked = blockedManager.reconcilePlayer(
    'player-1',
    [token('blocked-hou', '后', 1), token('blocked-yi', '羿', 2)],
    10,
    10,
    1,
  )
  assert.equal(blocked.ok, false)
  assert.equal(blocked.code, 'POPULATION_LIMIT')

  const formation = reformed.activeFormations[0]
  const progress = manager.getProgress('player-1', 'houyi')
  assert.ok(progress)
  const enemies: GeneralCombatEnemy[] = [
    {
      id: 'furthest',
      xMilli: 9500,
      yMilli: 5000,
      currentHp: 100,
      pathProgressMilli: 9000,
      spawnSequence: 1,
      targetable: true,
      tags: [],
    },
    {
      id: 'boss-high-hp',
      xMilli: 8500,
      yMilli: 5000,
      currentHp: 1000,
      pathProgressMilli: 8000,
      spawnSequence: 2,
      targetable: true,
      tags: ['boss'],
    },
    {
      id: 'outside-range',
      xMilli: 11501,
      yMilli: 5000,
      currentHp: 9999,
      pathProgressMilli: 9999,
      spawnSequence: 3,
      targetable: true,
      tags: [],
    },
  ]
  const target = selectGeneralTarget(
    formation,
    enemies,
    resolveGeneralStats(HOUYI_DEFINITION, progress.level),
    'furthest_progress',
  )
  assert.equal(target?.id, 'furthest')
  const exactBoundaryTarget = selectGeneralTarget(
    formation,
    [{ ...enemies[0], id: 'exact-boundary', xMilli: 10500, pathProgressMilli: 1 }],
    resolveGeneralStats(HOUYI_DEFINITION, progress.level),
    'furthest_progress',
  )
  assert.equal(exactBoundaryTarget?.id, 'exact-boundary')
  const outsideBoundaryTarget = selectGeneralTarget(
    formation,
    [{ ...enemies[0], id: 'outside-boundary', xMilli: 10501, pathProgressMilli: 1 }],
    resolveGeneralStats(HOUYI_DEFINITION, progress.level),
    'furthest_progress',
  )
  assert.equal(outsideBoundaryTarget, null)

  const initialized = planGeneralCombatFrame({
    definition: HOUYI_DEFINITION,
    formation,
    progress,
    currentTick: 100,
    tickRateMs: 100,
    enemies,
  })
  assert.equal(initialized.actions.length, 0)
  const readyTick = initialized.nextProgress.activeSkillReadyAtTick
  const combat = planGeneralCombatFrame({
    definition: HOUYI_DEFINITION,
    formation,
    progress: initialized.nextProgress,
    currentTick: readyTick,
    tickRateMs: 100,
    enemies,
  })
  assert.deepEqual(combat.actions.map((action) => action.actionKind), ['active_skill', 'basic_attack'])
  assert.equal(combat.actions[0].targetEnemyId, 'boss-high-hp')
  assert.equal(combat.actions[0].damage.coefficientBps, 32000)
  assert.equal(combat.actions[0].damage.damageDealtRatioBps, 12000)
  assert.equal(combat.actions[1].targetEnemyId, 'furthest')
  const noTarget = planGeneralCombatFrame({
    definition: HOUYI_DEFINITION,
    formation,
    progress: { ...combat.nextProgress, activeSkillReadyAtTick: readyTick, nextBasicAttackTick: readyTick },
    currentTick: readyTick,
    tickRateMs: 100,
    enemies: [],
  })
  assert.equal(noTarget.actions.length, 0)
  assert.equal(noTarget.nextProgress.activeSkillReadyAtTick, readyTick)
  assert.equal(noTarget.nextProgress.nextBasicAttackTick, readyTick)

  const plannerFormation = { ...formation, anchorMilli: { x: 0, y: 0 } }
  const plannerEnemies: GeneralCombatEnemy[] = [
    { id: 'a', xMilli: 1000, yMilli: 0, currentHp: 100, pathProgressMilli: 100, spawnSequence: 1, targetable: true, tags: [] },
    { id: 'b', xMilli: 1800, yMilli: 100, currentHp: 300, pathProgressMilli: 300, spawnSequence: 2, targetable: true, tags: [] },
    { id: 'c', xMilli: 2600, yMilli: 700, currentHp: 200, pathProgressMilli: 200, spawnSequence: 3, targetable: true, tags: ['boss'] },
    { id: 'd', xMilli: 6000, yMilli: 0, currentHp: 50, pathProgressMilli: 400, spawnSequence: 4, targetable: true, tags: [] },
  ]
  const plannerStats = resolveGeneralStats(HOUYI_DEFINITION, 1)
  assert.deepEqual(selectGeneralTargets({ formation: plannerFormation, enemies: plannerEnemies, stats: plannerStats, level: 1,
    targeting: { kind: 'single', scope: 'enemies_in_attack_range', priority: 'highest_current_hp', targetLimit: 1 } }).map((entry) => entry.id), ['b'])
  assert.deepEqual(selectGeneralTargets({ formation: plannerFormation, enemies: plannerEnemies, stats: plannerStats, level: 1,
    targeting: { kind: 'radius_aoe', scope: 'enemies_around_primary', priority: 'highest_current_hp', primarySearch: 'attack_range', radiusMilliCellsByLevel: [1000, 1000, 1000, 1000, 1000], targetLimit: 8 } }).map((entry) => entry.id), ['b', 'c', 'a'])
  assert.deepEqual(selectGeneralTargets({ formation: plannerFormation, enemies: plannerEnemies, stats: plannerStats, level: 1,
    targeting: { kind: 'line', scope: 'enemies_in_line_from_caster', priority: 'furthest_progress', primarySearch: 'line_length', lengthMilliCellsByLevel: [7000, 7000, 7000, 7000, 7000], halfWidthMilliCellsByLevel: [200, 200, 200, 200, 200], targetLimit: 8 } }).map((entry) => entry.id), ['a', 'b', 'd'])
  assert.deepEqual(selectGeneralTargets({ formation: plannerFormation, enemies: plannerEnemies, stats: plannerStats, level: 1,
    targeting: { kind: 'global', scope: 'all_targetable_enemies', priority: 'furthest_progress', targetLimit: 8 } }).map((entry) => entry.id), ['d', 'b', 'c', 'a'])
  assert.deepEqual(selectGeneralTargets({ formation: plannerFormation, enemies: plannerEnemies, stats: plannerStats, level: 1,
    targeting: { kind: 'chain', scope: 'chain_from_primary', priority: 'nearest_to_caster', primarySearch: 'attack_range', bounceRangeMilliCellsByLevel: [1200, 1200, 1200, 1200, 1200], targetLimit: 3 } }).map((entry) => entry.id), ['a', 'b', 'c'])

  const allEffects: GeneralStructuredEffectDefinition[] = [
    { effectId: 'multi', type: 'damage', damageType: 'physical', coefficientBpsByLevel: [10000, 10000, 10000, 10000, 10000], flatDamageByLevel: [0, 0, 0, 0, 0], criticalPolicy: 'can_crit', hitCountByLevel: [2, 2, 2, 2, 2], hitIntervalMs: 100, tags: [] },
    { effectId: 'dot', type: 'damage_over_time', damageType: 'magic', coefficientBpsPerTickByLevel: [1000, 1000, 1000, 1000, 1000], flatDamagePerTickByLevel: [1, 1, 1, 1, 1], tickIntervalMs: 500, durationMsByLevel: [2000, 2000, 2000, 2000, 2000], criticalPolicy: 'cannot_crit', stacking: { stackGroup: 'dot', policy: 'refresh', maxStacks: 1 }, tags: [] },
    { effectId: 'slow', type: 'status_apply', statusId: 'slow', magnitudeByLevel: [2000, 2000, 2000, 2000, 2000], durationMsByLevel: [3000, 3000, 3000, 3000, 3000], chanceBpsByLevel: [10000, 10000, 10000, 10000, 10000], stacking: { stackGroup: 'slow', policy: 'strongest_refresh', maxStacks: 1 }, tags: [] },
    { effectId: 'push', type: 'path_displacement', direction: 'backward', distanceMilliCellsByLevel: [500, 500, 500, 500, 500], bossDistanceRatioBps: 3000, tags: [] },
    { effectId: 'summon', type: 'summon_unit', targeting: { kind: 'self', scope: 'self', targetLimit: 0 }, summonUnitId: 'rabbit', countByLevel: [2, 2, 2, 2, 2], durationMsByLevel: [10000, 10000, 10000, 10000, 10000], maxOwnedAliveByLevel: [4, 4, 4, 4, 4], spawnPattern: 'self_surrounding_empty_cells', inheritStatRatiosBps: { attack: 5000 }, sourceInactivePolicy: 'despawn', tags: [] },
    { effectId: 'zone', type: 'spawn_zone', zoneId: 'thunder', shape: { kind: 'circle', radiusMilliCellsByLevel: [1500, 1500, 1500, 1500, 1500] }, durationMsByLevel: [3000, 3000, 3000, 3000, 3000], tickIntervalMs: 500, tickEffects: [{ effectId: 'zone_tick', type: 'damage', damageType: 'magic', coefficientBpsByLevel: [1000, 1000, 1000, 1000, 1000], flatDamageByLevel: [0, 0, 0, 0, 0], criticalPolicy: 'cannot_crit', tags: [] }], sourceInactivePolicy: 'finish_duration', tags: [] },
    { effectId: 'cooldown', type: 'cooldown_modify', targeting: { kind: 'self', scope: 'self', targetLimit: 0 }, targetSkill: 'active_skill', operation: 'add_ms', valueByLevel: [-300, -300, -300, -300, -300], maxTriggersPerCast: 1, tags: [] },
    { effectId: 'patch', type: 'effect_parameter_patch', targeting: { kind: 'self', scope: 'self', targetLimit: 0 }, targetEffectId: 'multi', parameter: 'hitCount', operation: 'add_flat', valueByLevel: [1, 1, 1, 1, 1], tags: [] },
  ]
  const plannerDefinition: GeneralDefinition = { ...HOUYI_DEFINITION, activeSkill: { ...HOUYI_DEFINITION.activeSkill,
    targeting: { kind: 'global', scope: 'all_targetable_enemies', priority: 'furthest_progress', targetLimit: 2 }, effects: allEffects } }
  validateGeneralCombatDefinition(plannerDefinition)
  const effectActions = planGeneralEffectActions({ definition: plannerDefinition, formation: plannerFormation, progress,
    stats: plannerStats, actionKind: 'active_skill', actionId: 'all-effects', defaultTargeting: plannerDefinition.activeSkill.targeting,
    effects: allEffects, enemies: plannerEnemies })
  assert.deepEqual(new Set(effectActions.map((action) => action.effectType)), new Set([
    'damage', 'damage_over_time', 'status_apply', 'path_displacement', 'summon_unit', 'spawn_zone', 'cooldown_modify', 'effect_parameter_patch',
  ]))
  assert.equal(effectActions.filter((action) => action.effectType === 'damage').length, 4)

  const passiveEffect = allEffects[6]
  const alwaysDefinition: GeneralDefinition = { ...HOUYI_DEFINITION, passiveSkill: { ...HOUYI_DEFINITION.passiveSkill,
    trigger: { kind: 'always' }, structuredEffects: [passiveEffect] } }
  assert.equal(planGeneralPassiveTrigger({ definition: alwaysDefinition, formation: plannerFormation, progress,
    currentTick: 10, tickRateMs: 100, event: 'initialize', enemies: [] }).actions.length, 1)
  const nthDefinition: GeneralDefinition = { ...alwaysDefinition, passiveSkill: { ...alwaysDefinition.passiveSkill,
    trigger: { kind: 'on_nth_basic_attack', every: 2 } } }
  assert.equal(planGeneralPassiveTrigger({ definition: nthDefinition, formation: plannerFormation,
    progress: { ...progress, basicAttackCount: 1 }, currentTick: 10, tickRateMs: 100, event: 'basic_attack', enemies: [] }).actions.length, 1)
  const periodicDefinition: GeneralDefinition = { ...alwaysDefinition, passiveSkill: { ...alwaysDefinition.passiveSkill,
    trigger: { kind: 'periodic', intervalMsByLevel: [1000, 1000, 1000, 1000, 1000] } } }
  const periodic = planGeneralPassiveTrigger({ definition: periodicDefinition, formation: plannerFormation,
    progress: { ...progress, nextPassiveTriggerTick: 10 }, currentTick: 10, tickRateMs: 100, event: 'initialize', enemies: [] })
  assert.equal(periodic.actions.length, 1)
  assert.equal(periodic.nextPassiveTriggerTick, 20)

  process.stdout.write('hero-v1 smoke passed\n')
}

if (require.main === module) {
  runHeroV1Smoke()
}
