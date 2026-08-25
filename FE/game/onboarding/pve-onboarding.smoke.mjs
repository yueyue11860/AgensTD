import assert from 'node:assert/strict'
import {
  PVE_ONBOARDING_STEPS,
  PVE_ONBOARDING_VERSION,
  createPveOnboardingProgress,
  currentPveOnboardingStep,
  derivePveOnboardingFacts,
  parsePveOnboardingProgress,
  pausePveOnboarding,
  reconcilePveOnboardingProgress,
  resumePveOnboarding,
  shouldResetPveOnboardingFromQuery,
  skipAllPveOnboarding,
  skipPveOnboardingStep,
} from './pve-onboarding.ts'

const baseObservation = (overrides = {}) => ({
  status: 'running',
  currentWave: 1,
  nextRecruitCost: 5,
  trayRevision: 0,
  boardRevision: 0,
  tray: [null, null, null, null, null],
  reserve: [null, null],
  boardPieces: [],
  generalFormations: [],
  enemies: [],
  recentEvents: [],
  selectedTrayIndex: null,
  ...overrides,
})

// An already-progressed authoritative snapshot jumps directly to the first unfinished concept.
const progressedFacts = derivePveOnboardingFacts(baseObservation({
  trayRevision: 2,
  boardRevision: 4,
  boardPieces: [{ kind: 'soldier', soldierType: 'blade', level: 2 }],
  generalFormations: [{ fixed: true }],
}))
const progressed = reconcilePveOnboardingProgress(createPveOnboardingProgress(), progressedFacts)
assert.deepEqual(progressed.completedSteps, ['recruit', 'select-tray', 'deploy', 'merge', 'general'])
assert.equal(currentPveOnboardingStep(progressed, progressedFacts), 'boss-warning')

// Event order is irrelevant: receipts/events are evidence, never a command sequence replay.
const outOfOrderFacts = derivePveOnboardingFacts(baseObservation({
  currentWave: 5,
  recentEvents: [
    { id: '5', type: 'BOSS_CAST_WARNING' },
    { id: '3', type: 'SOLDIER_MERGED' },
    { id: '1', type: 'RECRUITED' },
    { id: '4', type: 'GENERAL_FIXED_CHANGED', data: { fixed: true } },
    { id: '2', type: 'TRAY_BOARD_SWAPPED' },
  ],
}))
const bossPriority = reconcilePveOnboardingProgress(createPveOnboardingProgress(), outOfOrderFacts)
assert.equal(currentPveOnboardingStep(bossPriority, outOfOrderFacts), 'boss-warning')
assert.deepEqual(bossPriority.completedSteps, PVE_ONBOARDING_STEPS.slice(0, -1))

// A reconnect snapshot with a short recent-event window cannot roll back persisted milestones.
const beforeReconnect = reconcilePveOnboardingProgress(createPveOnboardingProgress(), derivePveOnboardingFacts(baseObservation({
  trayRevision: 1,
  boardRevision: 1,
  tray: [{ kind: 'soldier', soldierType: 'bow', level: 1 }, null, null, null, null],
  boardPieces: [{ kind: 'soldier', soldierType: 'blade', level: 1 }],
})))
const afterReconnect = reconcilePveOnboardingProgress(beforeReconnect, derivePveOnboardingFacts(baseObservation()))
assert.deepEqual(afterReconnect.completedSteps, beforeReconnect.completedSteps)
assert.ok(afterReconnect.maxReachedIndex >= beforeReconnect.maxReachedIndex)

// Crossing the authoritative 1–5 wave tutorial boundary completes the final Boss concept even
// when reconnect trimming removed the short warning event; it must not repeat next match.
const afterIntroWaves = reconcilePveOnboardingProgress(bossPriority, derivePveOnboardingFacts(baseObservation({
  currentWave: 6,
  recentEvents: [],
})))
assert.equal(afterIntroWaves.status, 'completed')
assert.ok(afterIntroWaves.completedSteps.includes('boss-warning'))

// A pool without a same-type/same-level pair keeps merge as an optional direction, not fake progress.
const noPairFacts = derivePveOnboardingFacts(baseObservation({
  trayRevision: 1,
  boardRevision: 1,
  tray: [{ kind: 'soldier', soldierType: 'bow', level: 1 }, null, null, null, null],
  boardPieces: [{ kind: 'soldier', soldierType: 'blade', level: 1 }],
}))
let noPairProgress = reconcilePveOnboardingProgress(createPveOnboardingProgress(), noPairFacts)
assert.equal(noPairFacts.mergeAvailable, false)
assert.equal(currentPveOnboardingStep(noPairProgress, noPairFacts), 'merge')
noPairProgress = skipPveOnboardingStep(noPairProgress, 'merge')
assert.equal(currentPveOnboardingStep(noPairProgress, noPairFacts), 'general')

// Pause/resume and skip controls are explicit and never mutate gameplay state.
const paused = pausePveOnboarding(createPveOnboardingProgress())
assert.equal(paused.status, 'paused')
assert.equal(resumePveOnboarding(paused).status, 'active')
const skipped = skipAllPveOnboarding(createPveOnboardingProgress())
assert.equal(skipped.status, 'skipped')
assert.deepEqual(skipped.skippedSteps, PVE_ONBOARDING_STEPS)

// A new onboarding version creates a clean record; query resets stay development-only.
const upgraded = parsePveOnboardingProgress({
  version: PVE_ONBOARDING_VERSION - 1,
  status: 'completed',
  completedSteps: PVE_ONBOARDING_STEPS,
}, PVE_ONBOARDING_VERSION)
assert.deepEqual(upgraded, createPveOnboardingProgress())
assert.equal(shouldResetPveOnboardingFromQuery(true, '?onboardingReset=1'), true)
assert.equal(shouldResetPveOnboardingFromQuery(false, '?onboardingReset=1'), false)
assert.equal(shouldResetPveOnboardingFromQuery(true, '?onboardingReset=0'), false)

console.log('pve onboarding smoke: ok')
