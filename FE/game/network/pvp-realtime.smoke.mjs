import assert from 'node:assert/strict'
import { classifyPvpSequence, consumePvpSseBuffer, shouldRequestPvpFullRecovery } from './pvp-realtime.ts'

assert.equal(classifyPvpSequence(4, 5), 'accept')
assert.equal(classifyPvpSequence(5, 5), 'stale')
assert.equal(classifyPvpSequence(5, 4), 'stale')
assert.equal(classifyPvpSequence(5, 8), 'gap')
assert.equal(shouldRequestPvpFullRecovery(false, 1_000, 2_000), true)
assert.equal(shouldRequestPvpFullRecovery(true, 1_000, 3_000), false)
assert.equal(shouldRequestPvpFullRecovery(false, 1_500, 2_000), false)
const parsed = consumePvpSseBuffer('id: 2\nevent: pvp-state\ndata: {"seq":2}\n\n: heartbeat\n\ndata: {"seq":3')
assert.deepEqual(parsed.payloads, [{ seq: 2 }])
assert.match(parsed.remainder, /seq/)
console.log('pvp realtime smoke passed')
