import assert from 'node:assert/strict'
import { createDefaultPlayerAccount } from '../account-v1/service'
import { buildEncyclopediaCatalog } from './player-account-adapters'
import { BOSS_DEFINITIONS } from '../pve-v2/boss-catalog'
import { WAVE_MINION_CATALOG } from '../pve-v2/catalogs'
import { ITEM_DEFINITIONS } from '../item-v1/catalog'
import { WEAPON_CATALOG } from '../weapon-v1/catalog'
import { GENERAL_CATALOG } from '../core/hero-v1/catalog'

/** Contract smoke for the account-scoped encyclopedia projection. */
function main(): void {
  const account = createDefaultPlayerAccount('encyclopedia-smoke')
  const payload = buildEncyclopediaCatalog(account)

  assert.equal(payload.schemaVersion, 1)
  assert.equal(payload.catalogVersion, 'encyclopedia-v1')
  assert.equal(payload.generals.length, Object.keys(GENERAL_CATALOG).length)
  assert.equal(payload.items.length, ITEM_DEFINITIONS.length)
  assert.equal(payload.weapons.length, WEAPON_CATALOG.length)
  assert.equal(payload.minions.length, WAVE_MINION_CATALOG.length)
  assert.equal(payload.bosses.length, BOSS_DEFINITIONS.length)

  const starterGeneral = payload.generals.find((entry) => entry.generalId === 'houyi')
  assert.equal(starterGeneral?.unlocked, true, 'starter general must be marked unlocked')
  const lockedGeneral = payload.generals.find((entry) => entry.generalId === 'nazha')
  assert.equal(lockedGeneral?.unlocked, false, 'unowned general must be marked locked')

  const activeStarter = payload.items.find((entry) => entry.itemId === 'change_character_brush')
  assert.equal(activeStarter?.unlocked, true)
  const lockedItem = payload.items.find((entry) => entry.itemId === 'heavenly_thunder_order')
  assert.equal(lockedItem?.unlocked, false)

  const firstWeapon = payload.weapons[0]
  assert.equal(typeof firstWeapon.unlocked, 'boolean')
  // New accounts receive the complete PVE V2 catalog, but encounter-driven
  // entries remain grey/locked until a settlement records the wave reached.
  assert.equal(payload.minions.every((entry) => entry.unlocked === false), true)
  assert.equal(payload.bosses.every((entry) => entry.unlocked === false), true)

  // Simulate a run that reached wave 5 of stage 1.  The adapter should unlock
  // ordinary waves 1-5 and only the stage-1 Boss node at wave 5.
  const encounter = {
    settlementId: 'encounter:encyclopedia-smoke',
    matchId: 'encounter', playerId: account.playerId, reason: 'defeat',
    highestCompletedWave: 4, highestEncounteredWave: 5,
    rewardTier: 'none', retainedWeaponFragments: {}, goldGranted: 0,
    entitlementIds: [], stageSelection: { levelId: 1, difficulty: 'easy' },
    progressionUpdated: false, status: 'committed', committedAt: new Date().toISOString(),
    accountVersionAfter: account.version + 1,
  }
  account.settlementsById[encounter.settlementId] = encounter as never
  const encountered = buildEncyclopediaCatalog(account)
  assert.deepEqual(
    encountered.minions.map((entry) => entry.unlocked),
    WAVE_MINION_CATALOG.map((entry) => entry.waveNumber <= 5),
  )
  const stageOneWaveFiveBoss = BOSS_DEFINITIONS.find((entry) => entry.levelId === 1 && entry.waveNumber === 5)
  assert.equal(stageOneWaveFiveBoss ? encountered.bosses.find((entry) => entry.entryId === stageOneWaveFiveBoss.bossDefinitionId)?.unlocked : false, true)
  assert.equal(encountered.bosses.filter((entry) => entry.unlocked).length, 1)

  console.log('encyclopedia smoke checks passed')
}

main()
