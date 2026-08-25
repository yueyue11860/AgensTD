import assert from 'node:assert/strict'
import {
  baselineCombatEventStream,
  classifyStateEnvelope,
  createCombatEventStreamState,
  isCombatEventBatch,
  mergeCombatEventBatch,
  mergeCombatEventsIntoGameState,
} from './combat-event-stream.ts'

const event = (seq, type = 'DAMAGE_APPLIED') => ({ id: `event-${seq}`, seq, tick: seq, type, data: { finalDamage: seq } })
const batch = (fromSeq, toSeq, events = Array.from({ length: toSeq - fromSeq + 1 }, (_, index) => event(fromSeq + index))) => ({
  matchId: 'match-1', presentationVersion: 1, fromSeq, toSeq, events,
})

let stream = baselineCombatEventStream('match-1', 5)
let result = mergeCombatEventBatch(stream, batch(7, 7))
assert.equal(result.gapFromSeq, 6)
assert.deepEqual(result.accepted, [], 'out-of-order future batch waits for the missing cursor')
stream = result.state
result = mergeCombatEventBatch(stream, batch(6, 6))
assert.deepEqual(result.accepted.map(({ seq }) => seq), [6, 7], 'replay fills the gap and drains buffered future batch')
assert.equal(result.ackSeq, 7)
assert.equal(result.state.pending.size, 0, 'drained out-of-order batches are released')
stream = result.state

result = mergeCombatEventBatch(stream, batch(6, 7))
assert.deepEqual(result.accepted, [], 'duplicates never replay presentation events')
assert.equal(result.ackSeq, 7)
const truncated = mergeCombatEventBatch(result.state, batch(8, 10, [event(8), event(10)]))
assert.deepEqual(truncated.accepted.map(({ seq }) => seq), [8])
assert.equal(truncated.gapFromSeq, 9, 'a header/payload hole must request compensation instead of silently losing events')
assert.equal(isCombatEventBatch({ ...batch(8, 8), presentationVersion: 99 }), false, 'unknown presentation versions degrade safely')
const enriched = event(8, 'GENERAL_SKILL_CAST')
enriched.actionId = 'formation-yangjian:skill:8'
enriched.targetIds = ['enemy-1', 'enemy-2']
enriched.geometry = { kind: 'corridor', from: { xMilli: 1000, yMilli: 2000 }, to: { xMilli: 4000, yMilli: 2000 }, halfWidthMilliCells: 500 }
assert.equal(isCombatEventBatch(batch(8, 8, [enriched])), true)
assert.equal(isCombatEventBatch(batch(8, 8, [{ ...enriched, geometry: { kind: 'circle', xMilli: 0 } }])), false,
  'malformed geometry is rejected instead of guessed')

assert.equal(classifyStateEnvelope({ mode: 'patch', patch: {}, sentAt: 0, revision: 11, baseRevision: 10 }, 10), 'apply')
assert.equal(classifyStateEnvelope({ mode: 'patch', patch: {}, sentAt: 0, revision: 9, baseRevision: 8 }, 10), 'stale')
assert.equal(classifyStateEnvelope({ mode: 'patch', patch: {}, sentAt: 0, revision: 12, baseRevision: 11 }, 10), 'gap')
assert.equal(classifyStateEnvelope({ mode: 'checkpoint', patch: {}, sentAt: 0, revision: 12, baseRevision: 8 }, 10), 'apply')

const recovered = baselineCombatEventStream('match-1', 10)
assert.deepEqual(mergeCombatEventBatch(recovered, batch(8, 10)).accepted, [], 'reconnect full baseline does not replay historical batches')
assert.deepEqual(mergeCombatEventBatch(createCombatEventStreamState(), batch(1, 1, [event(1, 'FUTURE_UNKNOWN_EVENT')])).accepted.map(({ type }) => type), ['FUTURE_UNKNOWN_EVENT'])

const state = {
  tick: 1,
  status: 'running', result: null, map: { width: 1, height: 1, cells: [] }, resources: { gold: 0, lives: 1 }, towers: [], enemies: [], buildPalette: [],
  pve: { recentEvents: [] },
}
assert.deepEqual(mergeCombatEventsIntoGameState(state, [event(1, 'FUTURE_UNKNOWN_EVENT')])?.pve?.recentEvents.map(({ type }) => type), ['FUTURE_UNKNOWN_EVENT'])
const enrichedMerged = mergeCombatEventsIntoGameState(state, [enriched])?.pve?.recentEvents[0]
assert.equal(enrichedMerged?.actionId, enriched.actionId)
assert.deepEqual(enrichedMerged?.geometry, enriched.geometry)

console.log(JSON.stringify({
  ok: true,
  duplicateSuppressed: true,
  outOfOrderBuffered: true,
  gapReplayRequestedFrom: 6,
  malformedBatchGapRequestedFrom: 9,
  reconnectHistorySuppressed: true,
  stateRevisionGapDetected: true,
  unknownEventsSafe: true,
  choreographyMetadataPreserved: true,
}))
