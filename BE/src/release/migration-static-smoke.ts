import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const migrationDir = path.resolve(__dirname, '../../supabase/migrations')
const expected = [
  '202608250003_pve_reward_outbox.sql',
  '202608250004_auth_sessions_readiness.sql',
  '202608250005_encrypt_auth_provider_tokens.sql',
  '202608250006_pve_settlement_detail.sql',
] as const

const present = fs.readdirSync(migrationDir)
  .filter((name) => /^20260825000[3-6]_.*\.sql$/.test(name))
  .sort()
assert.deepEqual(present, [...expected], 'release migrations 003-006 must be complete and lexically ordered')

const sql = Object.fromEntries(expected.map((name) => [name, fs.readFileSync(path.join(migrationDir, name), 'utf8')]))
for (const name of expected) {
  const source = sql[name]
  assert.match(source, /\bbegin\s*;/i, `${name} must be atomic`)
  assert.match(source, /\bcommit\s*;/i, `${name} must commit explicitly`)
  assert.doesNotMatch(source, /\b(drop\s+table|drop\s+column|truncate|delete\s+from)\b/i,
    `${name} must remain additive/forward-fixable`)
  assert.match(source, /(?:re-run|safe to re-run|idempotent)/i, `${name} must document re-run semantics`)
  assert.match(source, /rollback policy/i, `${name} must document rollback semantics`)
}

assert.match(sql[expected[0]], /create table if not exists public\.pve_reward_batches/i)
assert.match(sql[expected[0]], /create table if not exists public\.pve_settlement_outbox/i)
assert.match(sql[expected[0]], /status in \('pending', 'committed', 'failed'\)/i)
assert.match(sql[expected[0]], /revoke all on public\.pve_settlement_outbox from anon, authenticated/i)

assert.match(sql[expected[1]], /create table if not exists public\.auth_sessions/i)
assert.match(sql[expected[1]], /create table if not exists public\.service_persistence_probes/i)
assert.match(sql[expected[2]], /depends on 004_auth_sessions_readiness/i)
assert.match(sql[expected[2]], /add column if not exists access_token_ciphertext/i)
assert.match(sql[expected[3]], /depends on 003_pve_reward_outbox/i)
assert.match(sql[expected[3]], /add column if not exists detail_json/i)
assert.match(sql[expected[3]], /drop constraint if exists pve_settlement_outbox_detail_json_check/i)

const checkpointMigrationName = '202608250007_pve_match_checkpoint.sql'
const checkpointSql = fs.readFileSync(path.join(migrationDir, checkpointMigrationName), 'utf8')
assert.match(checkpointSql, /\bbegin\s*;/i)
assert.match(checkpointSql, /\bcommit\s*;/i)
assert.match(checkpointSql, /create table if not exists public\.pve_match_leases/i)
assert.match(checkpointSql, /create table if not exists public\.pve_match_checkpoints/i)
assert.match(checkpointSql, /create table if not exists public\.pve_match_actions/i)
assert.match(checkpointSql, /claim_pve_match_lease/i)
assert.match(checkpointSql, /else lease\.generation \+ 1/i)
assert.match(checkpointSql, /PVE_LEASE_HELD/i)
assert.match(checkpointSql, /PVE_LEASE_FENCED/i)
assert.match(checkpointSql, /reserve_pve_match_action/i)
assert.match(checkpointSql, /returns table\(disposition text, record_json jsonb\)/i)
assert.match(checkpointSql, /lease_expires_at = clock_timestamp\(\) \+ make_interval[\s\S]*select \* into existing[\s\S]*insert into public\.pve_match_actions/i)
assert.doesNotMatch(checkpointSql, /\b(drop\s+table|drop\s+column|truncate|delete\s+from)\b/i)

const authIdentityMigrationName = '202608250008_supabase_auth_identity.sql'
const authIdentitySql = fs.readFileSync(path.join(migrationDir, authIdentityMigrationName), 'utf8')
assert.match(authIdentitySql, /\bbegin\s*;/i)
assert.match(authIdentitySql, /\bcommit\s*;/i)
assert.match(authIdentitySql, /sync_auth_user_to_game_profile/i)
assert.match(authIdentitySql, /after insert or update of email, raw_user_meta_data on auth\.users/i)
assert.match(authIdentitySql, /insert into public\.user_progress/i)
assert.doesNotMatch(authIdentitySql, /\b(drop\s+table|drop\s+column|truncate|delete\s+from)\b/i)

const runbook = path.resolve(__dirname, '../../PRODUCTION_RELEASE_RUNBOOK.md')
assert.ok(fs.existsSync(runbook), 'production release runbook is required')
const runbookText = fs.readFileSync(runbook, 'utf8')
for (const name of expected) assert.ok(runbookText.includes(name), `runbook must name ${name}`)
assert.ok(runbookText.includes(checkpointMigrationName), `runbook must name ${checkpointMigrationName}`)
assert.ok(runbookText.includes(authIdentityMigrationName), `runbook must name ${authIdentityMigrationName}`)
assert.match(runbookText, /未在本机实际应用|not applied locally/i)
assert.match(runbookText, /PVE.*跨进程|cross-process.*PVE/i)

process.stdout.write(`${JSON.stringify({
  ok: true,
  scope: 'static-sql-only',
  migrations: [...expected, checkpointMigrationName, authIdentityMigrationName],
  actualDatabaseApplyVerified: false,
})}\n`)
