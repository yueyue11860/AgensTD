import assert from 'node:assert/strict'
import {
  FULL_BUILD_BOT_ARCHETYPES,
  FULL_BUILD_SUPPORT_LOADOUTS,
  assertBaseEconomyStillIntact,
  simulateRuntimeFullBuild,
} from './full-build-simulator'

export function runFullBuildBalanceSmoke() {
  assertBaseEconomyStillIntact()
  const runs = FULL_BUILD_BOT_ARCHETYPES.map((archetype, index) => simulateRuntimeFullBuild(
    `full-build-fast:${archetype.archetypeId}`, 1, 'easy', archetype.archetypeId, 12_000,
    FULL_BUILD_SUPPORT_LOADOUTS[index]!.loadoutId,
  ))
  for (const run of runs) {
    assert.ok(run.highestClearedWave >= 15, `${run.archetypeId} did not reach the late-build validation window`)
    assert.ok(run.recruitBatches >= 26 && run.recruitBatches <= 34)
    assert.ok(run.formedGeneralIds.length >= 2, `${run.archetypeId} did not form its two-general build`)
    assert.ok(run.activatedSynergyIds.length >= 1, `${run.archetypeId} did not activate a real synergy`)
    assert.ok(run.usedActiveItemIds.includes('cultivation_pill'))
    assert.ok(run.usedActiveItemIds.includes('heavenly_thunder_order'))
    const preferred = FULL_BUILD_BOT_ARCHETYPES.find(candidate => candidate.archetypeId === run.archetypeId)!
    assert.ok(run.soldierDeploymentsByType[preferred.preferredSoldierType] > 0)
    const soldier = run.contribution.soldiers[preferred.preferredSoldierType]
    assert.ok(soldier.actualDamage >= 5_000, `${run.archetypeId} preferred soldier contribution regressed`)
    assert.ok(soldier.hitCount > 0 && soldier.uniqueTargetCount > 0)
    assert.ok(soldier.rangeOpportunityTicks > 0 && soldier.rangeUptimeBps > 0)
    assert.ok(Object.values(run.contribution.generals).some(source => source.actualDamage > 0))
    assert.ok(Object.values(run.contribution.synergies).some(source => source.actualDamage > 0))
    assert.ok(Object.values(run.contribution.weapons).some(source => source.actualDamage > 0))
    assert.ok(run.contribution.activeItems.heavenly_thunder_order.hitCount > 0)
  }
  assert.ok(runs.filter(run => run.outcome === 'victory').length >= 2,
    'fast gate requires at least two distinct successful archetypes')
  return runs.map(run => ({ archetypeId: run.archetypeId, outcome: run.outcome,
    highestClearedWave: run.highestClearedWave, recruitBatches: run.recruitBatches,
    generalCount: run.formedGeneralIds.length, synergyCount: run.activatedSynergyIds.length,
    preferredDamage: run.contribution.soldiers[
      FULL_BUILD_BOT_ARCHETYPES.find(candidate => candidate.archetypeId === run.archetypeId)!.preferredSoldierType
    ].actualDamage }))
}

if (require.main === module) process.stdout.write(`${JSON.stringify(runFullBuildBalanceSmoke())}\n`)
