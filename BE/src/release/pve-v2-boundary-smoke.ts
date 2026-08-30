import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createDefaultPlayerAccount } from '../account-v1/service'
import { parseClientAction } from '../domain/actions'
import { buildEncyclopediaCatalog } from '../data/player-account-adapters'

/**
 * Release guard for the PVE runtime cut-over.
 *
 * The old tower/wave action names remain in shared wire types so an older
 * frontend can still type-check, but they must not cross the server ingress.
 * Likewise, production-facing source must not import the retired catalogs or
 * expose their monster identifiers in an enabled artifact.
 */
const LEGACY_ACTIONS = [
  { action: 'BUILD_TOWER', type: 'arrow', x: 1, y: 1 },
  { action: 'UPGRADE_TOWER', towerId: 'tower-1' },
  { action: 'SELL_TOWER', towerId: 'tower-1' },
] as const

const LEGACY_MONSTER_MARKERS = [
  'Grunt', 'Speedster', 'Tank-Fortress', 'Grunt-Armored',
  'Shielded', 'Cleanser-Pro', 'Swarm-Drone', 'Swarm-Runner',
  'Lord-01', 'Lord-02', 'Lord-03',
  "'runner'", '"runner"', "'swift'", '"swift"', "'brute'", '"brute"',
]

const RETIRED_SOURCE_FILES = [
  'BE/src/domain/enemy-catalog.ts',
  'BE/src/domain/wave-catalog.ts',
  'BE/src/core/enemy-factory.ts',
  'BE/src/core/WaveManager.ts',
  'BE/src/config/default-wave-configs.ts',
]

const ENABLED_SOURCE_FILES = [
  'BE/src/server.ts',
  'BE/src/config/server-config.ts',
  'BE/src/config/level-config.ts',
  'BE/src/network/rest-api.ts',
  'BE/src/network/socket-gateway.ts',
  'BE/src/core/Room.ts',
  'BE/src/core/game-engine.ts',
  'BE/src/data/player-account-adapters.ts',
  'shared/contracts/encyclopedia.ts',
  'FE/pages/codex-page.tsx',
]

const PVP_SOURCE_FILES = [
  'shared/contracts/pvp.ts',
  'BE/src/pvp-v1/runtime.ts',
  'BE/src/pvp-platform-v1/service.ts',
  'BE/src/network/pvp-rest-api.ts',
]

function repoRoot(): string {
  return path.resolve(__dirname, '../../..')
}

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot(), relativePath), 'utf8')
}

function main(): void {
  for (const legacyAction of LEGACY_ACTIONS) {
    assert.equal(parseClientAction(legacyAction), null, `retired action must be rejected: ${legacyAction.action}`)
  }
  assert.deepEqual(
    parseClientAction({ action: 'RECRUIT_BATCH', expectedTrayRevision: 0 }),
    { action: 'RECRUIT_BATCH', expectedTrayRevision: 0 },
    'PVE V2 actions must remain accepted at the ingress',
  )

  const encyclopedia = buildEncyclopediaCatalog(createDefaultPlayerAccount('pve-v2-boundary-smoke'))
  assert.ok(encyclopedia.minions.length > 0, 'PVE V2 minion catalog must be present')
  assert.ok(encyclopedia.bosses.length > 0, 'PVE V2 boss catalog must be present')
  assert.equal(encyclopedia.minions.every((entry) => entry.unlocked === false), true,
    'new accounts must not reveal unencountered PVE V2 monsters')
  assert.equal(encyclopedia.bosses.every((entry) => entry.unlocked === false), true,
    'new accounts must not reveal unencountered PVE V2 Bosses')
  const serializedEncyclopedia = JSON.stringify(encyclopedia)
  for (const marker of LEGACY_MONSTER_MARKERS) {
    assert.equal(serializedEncyclopedia.includes(marker), false, `encyclopedia contains retired monster marker: ${marker}`)
  }

  for (const relativePath of RETIRED_SOURCE_FILES) {
    assert.equal(fs.existsSync(path.join(repoRoot(), relativePath)), false, `retired source file is still present: ${relativePath}`)
  }

  for (const relativePath of ENABLED_SOURCE_FILES) {
    const absolutePath = path.join(repoRoot(), relativePath)
    if (!fs.existsSync(absolutePath)) continue
    const source = fs.readFileSync(absolutePath, 'utf8')
    assert.doesNotMatch(source, /(?:enemy-catalog|wave-catalog|WaveManager|enemy-factory|default-wave-configs)/,
      `enabled source still references retired PVE runtime in ${relativePath}`)
    for (const marker of LEGACY_MONSTER_MARKERS) {
      assert.equal(source.includes(marker), false, `enabled source contains retired monster marker ${marker}: ${relativePath}`)
    }
  }

  // PVP owns a separate contract/runtime and must remain available after the
  // PVE catalog retirement.  This check intentionally only guards the import
  // boundary; PVP's own enemy kinds (base/elite/boss/pressure) are valid.
  for (const relativePath of PVP_SOURCE_FILES) {
    const source = readRepoFile(relativePath)
    assert.doesNotMatch(source, /(?:enemy-catalog|wave-catalog|WaveManager|enemy-factory|default-wave-configs)/,
      `PVP source must not depend on retired PVE runtime: ${relativePath}`)
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    retiredActionsRejected: LEGACY_ACTIONS.map((entry) => entry.action),
    encyclopediaRuntime: 'pve-v2',
    retiredSourcesAbsent: true,
    pvpContractsUntouched: true,
  })}\n`)
}

main()
