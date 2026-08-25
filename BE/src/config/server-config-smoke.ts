import assert from 'node:assert/strict'
import { createServerConfig } from './server-config'
import { isE2eControlAvailable } from '../network/e2e-control-api'
import { stressCombatBatch, stressEnemies, stressFullState, stressPatch } from '../network/e2e-renderer-stress'

const keys = ['NODE_ENV', 'TICK_RATE_MS', 'PVE_E2E_ENABLED', 'HOST_LOOP_INTERVAL_MS'] as const
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]))

try {
  process.env.NODE_ENV = 'test'
  process.env.TICK_RATE_MS = '100'
  delete process.env.PVE_E2E_ENABLED
  process.env.HOST_LOOP_INTERVAL_MS = '20'
  assert.equal(createServerConfig().hostLoopIntervalMs, 100, 'host acceleration requires the explicit E2E gate')

  process.env.PVE_E2E_ENABLED = 'true'
  const e2eConfig = createServerConfig()
  assert.equal(e2eConfig.hostLoopIntervalMs, 20, 'explicit non-production E2E may accelerate host ticks')
  assert.equal(isE2eControlAvailable(e2eConfig, 'test'), true)

  process.env.NODE_ENV = 'production'
  const productionConfig = createServerConfig()
  assert.equal(productionConfig.hostLoopIntervalMs, 100, 'production must always use the logical tick cadence')
  assert.equal(productionConfig.pveE2eEnabled, false)
  assert.equal(isE2eControlAvailable(productionConfig, 'production'), false, 'production must reject the E2E control route')

  assert.equal(stressEnemies(0).length, 80)
  assert.equal(stressFullState(0).pve?.enemies.length, 80)
  assert.equal(stressPatch(10).pvePatch?.pveEnemyDelta?.upsert.length, 80)
  assert.equal(stressCombatBatch(300, 3000).toSeq, 300)
} finally {
  for (const key of keys) {
    const value = original[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

console.log('server config smoke passed')
