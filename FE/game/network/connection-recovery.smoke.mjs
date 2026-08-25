import assert from 'node:assert/strict'
import {
  createConnectionRecoveryState,
  isAuthenticationFailure,
  isAuthoritativeFullTick,
  parsePlayerConnectionState,
  reconnectRemainingSeconds,
  reduceConnectionRecovery,
} from './connection-recovery.ts'
import {
  consumeCombatPresentation,
  createCombatPresentationState,
  synchronizeCombatPresentation,
} from '../presentation/combat-presentation-adapter.ts'

let recovery = createConnectionRecoveryState(45_000)
recovery = reduceConnectionRecovery(recovery, { type: 'full_snapshot' })
recovery = reduceConnectionRecovery(recovery, { type: 'transport_disconnected', now: 1_000 })
assert.equal(recovery.deadlineAt, 46_000)
assert.equal(reconnectRemainingSeconds(recovery.deadlineAt, 2_000), 44)
recovery = reduceConnectionRecovery(recovery, { type: 'transport_connected' })
assert.equal(recovery.phase, 'awaiting_snapshot', 'transport reconnect alone must not unlock UI')
const beforeFullRevision = recovery.syncRevision
recovery = reduceConnectionRecovery(recovery, { type: 'full_snapshot' })
assert.equal(recovery.phase, 'ready', 'full snapshot restores authority after a one-second outage')
assert.equal(recovery.syncRevision, beforeFullRevision + 1)
recovery = reduceConnectionRecovery(recovery, { type: 'deadline_tick', now: 50_000 })
assert.equal(recovery.phase, 'ready', 'stale deadline callback cannot expire a restored connection')

let expired = reduceConnectionRecovery(createConnectionRecoveryState(45_000), { type: 'transport_disconnected', now: 1_000 })
expired = reduceConnectionRecovery(expired, { type: 'deadline_tick', now: 46_000 })
assert.equal(expired.phase, 'expired')
assert.equal(reduceConnectionRecovery(expired, { type: 'replaced' }).phase, 'replaced')
assert.equal(reduceConnectionRecovery(expired, { type: 'auth_failed' }).phase, 'auth_failed')
assert.equal(isAuthenticationFailure('Missing or invalid gateway token'), true)
assert.equal(isAuthoritativeFullTick({ mode: 'full', gameState: { tick: 12 } }), true)
assert.equal(isAuthoritativeFullTick({ mode: 'patch', patch: { tick: 12 } }), false)
assert.deepEqual(parsePlayerConnectionState({
  playerId: 'p2', status: 'reconnecting', reconnectDeadlineAt: 50_000, reconnectRemainingMs: 12_000, graceMs: 45_000,
}), {
  playerId: 'p2', status: 'reconnecting', reconnectDeadlineAt: 50_000, reconnectRemainingMs: 12_000, graceMs: 45_000,
})

const snapshot = {
  tick: 100,
  tickRateMs: 100,
  pieces: [{ entityId: 'blade-1', ownerPlayerId: 'p1', kind: 'soldier', glyph: '刀', soldierType: 'blade', level: 1, x: 1, y: 1 }],
  enemies: [{ entityId: 'enemy-1', entityKind: 'ordinary_minion', glyph: '妖', hp: 80, maxHp: 100, x: 8, y: 8 }],
  statuses: [],
  summonedUnits: [],
  zones: [],
  recentEvents: [
    { id: 'offline-attack', tick: 99, type: 'BASIC_ATTACK_STARTED', data: { attackerId: 'blade-1', targetIds: ['enemy-1'] } },
    { id: 'offline-damage', tick: 99, type: 'DAMAGE_APPLIED', data: { attackerId: 'blade-1', enemyId: 'enemy-1', finalDamage: 20, isCritical: true } },
  ],
}
const presentation = createCombatPresentationState()
synchronizeCombatPresentation(snapshot, presentation)
assert.deepEqual(consumeCombatPresentation(snapshot, presentation), [], 'recovery baseline must not replay offline high-intensity events')
const next = structuredClone(snapshot)
next.tick = 101
next.recentEvents.push({ id: 'fresh-attack', tick: 101, type: 'BASIC_ATTACK_STARTED', data: { attackerId: 'blade-1', targetIds: ['enemy-1'] } })
assert.equal(consumeCombatPresentation(next, presentation).some((cue) => cue.id === 'fresh-attack'), true, 'new post-recovery events still animate')

console.log(JSON.stringify({
  ok: true,
  oneSecondRecovery: true,
  authoritativeSnapshotGate: true,
  staleDeadlineIgnored: true,
  deadlineExpiry: true,
  actionableTerminalStates: ['expired', 'replaced', 'auth_failed'],
  historicalPresentationSuppressed: true,
}))
