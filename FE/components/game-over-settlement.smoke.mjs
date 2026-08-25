import assert from 'node:assert/strict'
import { nextRevealStage, normalizeSettlement, settlementLastError, settlementPayloadStatus } from './game-over-settlement.ts'

assert.equal(settlementPayloadStatus({ status: 'pending', settlement: null }), 'pending')
assert.equal(settlementPayloadStatus({ status: 'failed' }), 'failed')
assert.equal(settlementLastError({ lastError: ' durable outage ' }), 'durable outage')
assert.equal(nextRevealStage('verdict'), 'story')
assert.equal(nextRevealStage('actions'), 'actions')

const legacy = normalizeSettlement({ status: 'committed', settlement: {
  settlementId: 'm:p', matchId: 'm', status: 'committed', reason: 'victory', highestCompletedWave: 20,
  rewardTier: 'victory', retainedWeaponFragments: {}, goldGranted: 40, entitlementIds: [], progressionUpdated: true,
  committedAt: '2026-08-25T00:00:00Z',
} })
assert.equal(legacy?.detail, null, 'old committed settlements remain readable')

const detailed = normalizeSettlement({ status: 'committed', settlement: {
  ...legacy, settlementId: 'm:p', matchId: 'm', status: 'committed', retainedWeaponFragments: {}, entitlementIds: [],
  detail: {
    schemaVersion: 1,
    rules: { combatRulesetVersion: 'r', rewardTableRevision: 'w', stageCatalogRevision: 's', balanceCatalogRevision: 'b' },
    outcome: { victory: false, reason: 'defeat', highestCompletedWave: 4, maxWaves: 20 },
    story: { title: 'long story', summary: '一'.repeat(600), failureSuggestion: 'retry with control' },
    performance: { damageDealt: 0, kills: 0, controlAppliedMs: 0, rescues: 0, mostDangerousWave: null, coverage: 'complete' },
    lineup: { coreGeneral: null, activeSynergies: [] }, mvp: null, rewards: [], pity: null,
  },
} })
assert.equal(detailed?.detail?.rewards.length, 0, 'zero reward detail stays explicit')
assert.equal(detailed?.detail?.performance.damageDealt, 0, 'zero is not treated as unavailable')
assert.equal(detailed?.detail?.story.summary.length, 600, 'long server copy round-trips')

console.log('game over settlement smoke passed')
