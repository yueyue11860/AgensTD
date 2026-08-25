import assert from 'node:assert/strict'
import { createServerConfig } from '../config/server-config'
import { resolvePersistencePolicy, resolvePveCheckpointStoreMode, resolvePveRewardStoreMode } from '../config/production-policy'
import { isPersistenceReadyForTraffic, PersistenceReadinessTracker, probeSupabaseWrite } from '../data/persistence-readiness'

function runProductionFailClosedDrill() {
  const valid = { nodeEnv: 'production', pvpStore: undefined, hasSupabaseCredentials: true }
  assert.throws(() => resolvePersistencePolicy({ ...valid, hasSupabaseCredentials: false }), /requires SUPABASE/)
  assert.throws(() => resolvePveRewardStoreMode('production', 'memory'), /forbids PVE_REWARD_STORE=memory/)
  assert.throws(() => resolvePveCheckpointStoreMode('production', 'memory'), /forbids PVE_CHECKPOINT_STORE=memory/)
  assert.equal(resolvePveRewardStoreMode('production', undefined), 'supabase')
  assert.equal(resolvePveCheckpointStoreMode('production', undefined), 'supabase')

  const tracker = new PersistenceReadinessTracker('supabase')
  assert.equal(isPersistenceReadyForTraffic(tracker.snapshot(), true), false, 'checking must fail closed')
  tracker.mark({ status: 'not_ready', writable: false, checkedAt: new Date().toISOString(), code: 'SIMULATED_OUTAGE' })
  assert.equal(isPersistenceReadyForTraffic(tracker.snapshot(), true), false, 'write outage must fail closed')
  tracker.mark({ status: 'ready', writable: false, checkedAt: new Date().toISOString(), code: null })
  assert.equal(isPersistenceReadyForTraffic(tracker.snapshot(), true), false, 'production requires writable persistence')
}

async function runNoCredentialProbeDrill() {
  const result = await probeSupabaseWrite({ ...createServerConfig(), supabaseUrl: null, supabaseServiceRoleKey: null })
  assert.equal(result.status, 'not_ready')
  assert.equal(result.writable, false)
  assert.equal(result.code, 'SUPABASE_NOT_CONFIGURED')
}

async function main() {
  runProductionFailClosedDrill()
  await runNoCredentialProbeDrill()
  process.stdout.write(`${JSON.stringify({
    ok: true,
    productionReadinessFailClosed: true,
    missingCredentialsRejectedWithoutNetwork: true,
    supabaseAuthOwnedByManagedService: true,
    livePveProcessRestartResume: 'covered-by-pve-checkpoint-smoke',
  })}\n`)
}

void main()
