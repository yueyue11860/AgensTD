import assert from 'node:assert/strict'
import {
  acceptClientActionIntent,
  appendClientActionIntent,
  CLIENT_ACTION_INTENT_LIMIT,
  createClientActionIntent,
  reconcileClientActionIntents,
  rejectClientActionIntent,
} from './client-action-intents.ts'

const move = createClientActionIntent({
  requestId: 'move-1',
  payload: { action: 'MOVE_BOARD_PIECE', entityId: 'piece-1', x: 7, y: 9 },
  submittedAt: 1_000,
  baselineTick: 20,
})
assert.deepEqual(move.target, { x: 7, y: 9 })
assert.equal(move.label, '移动')

const item = createClientActionIntent({
  requestId: 'item-1',
  payload: { action: 'USE_ACTIVE_ITEM', target: { kind: 'battlefield_point', xMilli: 12_500, yMilli: 8_500 } },
  submittedAt: 1_000,
  baselineTick: 20,
})
assert.deepEqual(item.target, { x: 12, y: 8 })

const accepted = acceptClientActionIntent([move], 'move-1', 21)
assert.equal(accepted[0].acceptedAtServerTick, 21)
assert.equal(reconcileClientActionIntents(accepted, 21, 1_200).length, 1, 'acceptance alone does not mutate authoritative presentation')
assert.equal(reconcileClientActionIntents(accepted, 22, 1_200).length, 0, 'new authoritative tick reconciles accepted intent')
assert.equal(reconcileClientActionIntents([move], 20, 4_000).length, 0, 'unacknowledged intent expires safely')
assert.equal(rejectClientActionIntent([move, item], 'move-1')[0].requestId, 'item-1')
assert.equal(rejectClientActionIntent([move, item], null).length, 0)

const capped = Array.from({ length: CLIENT_ACTION_INTENT_LIMIT + 3 }, (_, index) => ({ ...move, requestId: `move-${index}` }))
  .reduce((intents, intent) => appendClientActionIntent(intents, intent), [])
assert.equal(capped.length, CLIENT_ACTION_INTENT_LIMIT)
assert.equal(capped[0].requestId, 'move-3')

console.log(JSON.stringify({
  ok: true,
  immediateSpatialIntent: true,
  serverAcceptanceTracked: true,
  authoritativeReconciliation: true,
  rejectionAndTimeoutSafe: true,
  boundedLedger: CLIENT_ACTION_INTENT_LIMIT,
}))
