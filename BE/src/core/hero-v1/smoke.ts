import assert from 'node:assert/strict'
import {
  cumulativeExperienceRequiredForLevel,
  HOUYI_DEFINITION,
  resolveGeneralStats,
  validateGeneralDefinition,
} from './catalog'
import { planGeneralCombatFrame, selectGeneralTarget } from './combat-engine'
import { GeneralFormationManager } from './formation-manager'
import type { GeneralCombatEnemy, GeneralStatModifier, HeroCharacterToken } from './types'

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

  process.stdout.write('hero-v1 smoke passed\n')
}

if (require.main === module) {
  runHeroV1Smoke()
}
