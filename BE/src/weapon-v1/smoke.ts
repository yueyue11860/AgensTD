import assert from 'node:assert/strict'
import { GENERAL_ROSTER } from '../core/hero-v1/roster'
import { InMemoryWeaponAccountService, aggregateWeaponEventBudget, projectWeaponLoadout } from './account'
import {
  COMMON_WEAPONS,
  EXCLUSIVE_WEAPONS,
  WEAPON_CATALOG,
  getWeaponDefinition,
  validateWeaponCatalog,
} from './catalog'
import {
  InMemoryWeaponCommerceService,
  WAVE_MILESTONE_DROP_TABLE,
  generateWeaponShopOffers,
  rollHardVictoryExclusiveWeaponDrop,
  rollBossWeaponDrops,
  rollWaveMilestoneWeaponDrops,
  type PveRewardDifficulty,
} from './rewards'
import {
  WEAPON_FRAGMENT_REQUIREMENT,
  WeaponDomainError,
  type WeaponDefinition,
  type WeaponErrorCode,
  type WeaponQuality,
} from './types'

const expectCode = (code: WeaponErrorCode, action: () => unknown): void => {
  assert.throws(action, (error: unknown) => error instanceof WeaponDomainError && error.code === code)
}

const unlock = (accounts: InMemoryWeaponAccountService, playerId: string, weaponId: string, serial: string): void => {
  const weapon = getWeaponDefinition(weaponId)
  assert.ok(weapon)
  const beforeCredit = accounts.getAccount(playerId)
  accounts.creditFragments({ requestId: `credit-${serial}`, playerId, fragments: { [weaponId]: weapon.fragmentRequirement }, expectedAccountVersion: beforeCredit.version })
  const beforeCraft = accounts.getAccount(playerId)
  accounts.craftWeapon({ requestId: `craft-${serial}`, playerId, weaponId, expectedAccountVersion: beforeCraft.version })
}

const checkCatalog = (): void => {
  validateWeaponCatalog()
  assert.equal(WEAPON_CATALOG.length, 41)
  assert.equal(COMMON_WEAPONS.length, 20)
  assert.equal(EXCLUSIVE_WEAPONS.length, 21)
  const qualityCounts = Object.fromEntries((['green', 'blue', 'purple', 'orange', 'red'] as WeaponQuality[]).map((quality) => [quality, WEAPON_CATALOG.filter((weapon) => weapon.quality === quality).length]))
  assert.deepEqual(qualityCounts, { green: 4, blue: 4, purple: 4, orange: 4, red: 25 })
  assert.deepEqual(new Set(EXCLUSIVE_WEAPONS.map((weapon) => weapon.compatibility.exclusiveGeneralId)), new Set(GENERAL_ROSTER.map((general) => general.generalId)))
  for (const weapon of WEAPON_CATALOG) assert.equal(weapon.fragmentRequirement, WEAPON_FRAGMENT_REQUIREMENT[weapon.quality])

  const invalid = JSON.parse(JSON.stringify(WEAPON_CATALOG)) as WeaponDefinition[]
  invalid[0].fragmentRequirement = 5
  assert.throws(() => validateWeaponCatalog(invalid), /Fragment requirement mismatch/)
}

const checkCraftingAndIdempotency = (): void => {
  const byQuality: Readonly<Record<WeaponQuality, string>> = {
    green: 'qinggang_blade', blue: 'chasing_wind_bow', purple: 'armor_breaking_halberd', orange: 'sun_piercing_bow', red: 'battle_sky_axe',
  }
  for (const [quality, weaponId] of Object.entries(byQuality) as [WeaponQuality, string][]) {
    const accounts = new InMemoryWeaponAccountService(() => '2026-08-25T00:00:00.000Z')
    const playerId = `craft-${quality}`
    const required = WEAPON_FRAGMENT_REQUIREMENT[quality]
    accounts.creditFragments({ requestId: 'settle', playerId, fragments: { [weaponId]: required + 2 }, expectedAccountVersion: 0 })
    const request = { requestId: 'craft', playerId, weaponId, expectedAccountVersion: 1 }
    const first = accounts.craftWeapon(request)
    for (let repeat = 0; repeat < 100; repeat += 1) assert.deepEqual(accounts.craftWeapon(request), first)
    const account = accounts.getAccount(playerId)
    assert.equal(account.fragmentBalances[weaponId], 2)
    assert.deepEqual(account.unlockedWeaponIds, [weaponId])
    assert.equal(account.version, 2)
    expectCode('WEAPON_ALREADY_UNLOCKED', () => accounts.craftWeapon({ ...request, requestId: 'new-craft', expectedAccountVersion: 2 }))
    expectCode('REQUEST_ID_CONFLICT', () => accounts.craftWeapon({ ...request, weaponId: weaponId === 'qinggang_blade' ? 'peachwood_staff' : 'qinggang_blade' }))
  }

  const accounts = new InMemoryWeaponAccountService()
  accounts.creditFragments({ requestId: 'one', playerId: 'poor', fragments: { battle_sky_axe: 4 }, expectedAccountVersion: 0 })
  expectCode('INSUFFICIENT_FRAGMENTS', () => accounts.craftWeapon({ requestId: 'craft', playerId: 'poor', weaponId: 'battle_sky_axe', expectedAccountVersion: 1 }))
  assert.equal(accounts.getAccount('poor').fragmentBalances.battle_sky_axe, 4)
}

const checkLoadoutsAndSnapshot = (): void => {
  const accounts = new InMemoryWeaponAccountService(() => '2026-08-25T00:00:00.000Z')
  const playerId = 'loadout-player'
  for (const weaponId of ['qinggang_blade', 'chasing_wind_bow', 'peachwood_staff', 'houyi_sun_shooting_bow']) unlock(accounts, playerId, weaponId, weaponId)

  expectCode('DUPLICATE_WEAPON_IN_LOADOUT', () => accounts.saveLoadout({ requestId: 'duplicate', playerId, generalId: 'houyi', slots: ['qinggang_blade', 'qinggang_blade'], expectedLoadoutVersion: 0 }))
  expectCode('WEAPON_INCOMPATIBLE', () => accounts.saveLoadout({ requestId: 'incompatible', playerId, generalId: 'houyi', slots: ['peachwood_staff', null], expectedLoadoutVersion: 0 }))
  expectCode('EXCLUSIVE_GENERAL_MISMATCH', () => accounts.saveLoadout({ requestId: 'exclusive', playerId, generalId: 'yangjian', slots: ['houyi_sun_shooting_bow', null], expectedLoadoutVersion: 0 }))
  expectCode('WEAPON_NOT_UNLOCKED', () => accounts.saveLoadout({ requestId: 'locked', playerId, generalId: 'houyi', slots: ['armor_breaking_halberd', null], expectedLoadoutVersion: 0 }))

  const saved = accounts.saveLoadout({ requestId: 'save-houyi', playerId, generalId: 'houyi', slots: ['qinggang_blade', 'houyi_sun_shooting_bow'], expectedLoadoutVersion: 0 })
  assert.equal(saved.loadout.version, 1)
  expectCode('STALE_WEAPON_LOADOUT_VERSION', () => accounts.saveLoadout({ requestId: 'stale', playerId, generalId: 'houyi', slots: ['chasing_wind_bow', null], expectedLoadoutVersion: 0 }))
  // 图鉴解锁制：同一通用武器可同时保存在另一名同流派神将方案中。
  accounts.saveLoadout({ requestId: 'save-yangjian', playerId, generalId: 'yangjian', slots: ['qinggang_blade', null], expectedLoadoutVersion: 0 })

  const snapshot = accounts.createMatchSnapshot(playerId)
  assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.byGeneralId) && Object.isFrozen(snapshot.byGeneralId.houyi))
  assert.deepEqual(snapshot.byGeneralId.houyi.slots, ['qinggang_blade', 'houyi_sun_shooting_bow'])
  const sources = projectWeaponLoadout('match-1', snapshot, 'houyi')
  assert.equal(sources.length, 2)
  assert.equal(sources[0].sourceKey, 'weapon:match-1:loadout-player:houyi:0:qinggang_blade')
  assert.equal(sources[1].weaponId, 'houyi_sun_shooting_bow')
  assert.ok(sources[0].resolvedEffects.every((effect) => effect.sourceKey.startsWith(`${sources[0].sourceKey}:`)))
  assert.deepEqual(aggregateWeaponEventBudget(sources, { maxExtraDamageEventsPerSecond: 1, maxExtraTargetsPerCast: 1, maxOwnedZones: 1, maxExtraSummons: 1 }), { maxExtraDamageEventsPerSecond: 1, maxExtraTargetsPerCast: 1, maxOwnedZones: 0, maxExtraSummons: 0 })

  accounts.saveLoadout({ requestId: 'change-houyi', playerId, generalId: 'houyi', slots: ['chasing_wind_bow', null], expectedLoadoutVersion: 1 })
  assert.deepEqual(snapshot.byGeneralId.houyi.slots, ['qinggang_blade', 'houyi_sun_shooting_bow'])
  assert.deepEqual(accounts.createMatchSnapshot(playerId).byGeneralId.houyi.slots, ['chasing_wind_bow', null])
}

const checkDrops = (): void => {
  const allowedQualities: Readonly<Record<PveRewardDifficulty, Readonly<Record<5 | 10 | 15 | 20, readonly WeaponQuality[]>>>> = {
    easy: { 5: ['green', 'blue'], 10: ['green', 'blue', 'purple'], 15: ['green', 'blue', 'purple'], 20: ['blue', 'purple'] },
    normal: { 5: ['green', 'blue', 'purple'], 10: ['blue', 'purple', 'orange'], 15: ['blue', 'purple', 'orange'], 20: ['purple', 'orange'] },
    hard: { 5: ['blue', 'purple', 'orange', 'red'], 10: ['purple', 'orange', 'red'], 15: ['purple', 'orange', 'red'], 20: ['orange', 'red'] },
  }
  assert.deepEqual(WAVE_MILESTONE_DROP_TABLE.easy[5].weights, [['green', 8000], ['blue', 2000]])
  assert.deepEqual(WAVE_MILESTONE_DROP_TABLE.normal[20].weights, [['purple', 4500], ['orange', 5500]])
  assert.deepEqual(WAVE_MILESTONE_DROP_TABLE.hard[15].weights, [['purple', 2000], ['orange', 5000], ['red', 3000]])
  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    for (const wave of [5, 10, 15, 20] as const) {
      const configuredQualities = new Set(WAVE_MILESTONE_DROP_TABLE[difficulty][wave].weights.map(([quality]) => quality))
      assert.equal(WAVE_MILESTONE_DROP_TABLE[difficulty][wave].weights.reduce((sum, [, weight]) => sum + weight, 0), 10000)
      const observedQualities = new Set<WeaponQuality>()
      for (let seedIndex = 0; seedIndex < 500; seedIndex += 1) {
        const input = {
          matchSeed: `match-seed-${seedIndex}`, stageId: 'flower_fruit_mountain_v1', levelId: 1,
          difficulty, playerId: 'p1', milestone: wave,
          activatedGeneralIds: ['houyi'], discoveredGeneralIds: ['houyi'],
          weaponState: { fragmentBalances: {}, unlockedWeaponIds: [] },
        }
        const first = rollWaveMilestoneWeaponDrops(input)
        assert.deepEqual(rollWaveMilestoneWeaponDrops(input), first)
        assert.equal(first.length, wave === 20 ? 2 : 1)
        for (const drop of first) {
          observedQualities.add(drop.quality)
          assert.ok(allowedQualities[difficulty][wave].includes(drop.quality))
          assert.equal(getWeaponDefinition(drop.weaponId)?.compatibility.exclusiveGeneralId, undefined)
        }
      }
      assert.deepEqual(observedQualities, configuredQualities)
    }
  }

  // 旧函数保留兼容，但语义与新版简单难度波次节点一致。
  const legacy = { matchSeed: 'legacy', playerId: 'p1', bossWave: 20 as const, bossKillSequence: 4, activatedGeneralIds: ['houyi'], discoveredGeneralIds: ['houyi'], unlockedWeaponIds: [] }
  assert.deepEqual(rollBossWeaponDrops(legacy), rollBossWeaponDrops(legacy))

  const guaranteed = rollHardVictoryExclusiveWeaponDrop({
    matchSeed: 'hard-win', stageId: 'flower_fruit_mountain_v1', levelId: 1, playerId: 'p1',
    activatedGeneralIds: ['houyi'], discoveredGeneralIds: ['houyi'],
    weaponState: { fragmentBalances: {}, unlockedWeaponIds: [] },
  })
  assert.equal(guaranteed.quality, 'red')
  assert.equal(guaranteed.amount, 1)
  assert.equal(getWeaponDefinition(guaranteed.weaponId)?.compatibility.exclusiveGeneralId, 'houyi')
}

const checkShop = (): void => {
  const generated = generateWeaponShopOffers({ entitlementId: 'ent-fixed', entitlementType: 'high_tier_weapon_fragment', activatedGeneralIds: ['houyi'], discoveredGeneralIds: ['houyi'], unlockedWeaponIds: [] })
  assert.equal(generated.length, 3)
  assert.equal(new Set(generated.map((offer) => offer.weaponId)).size, 3)
  assert.deepEqual(generateWeaponShopOffers({ entitlementId: 'ent-fixed', entitlementType: 'high_tier_weapon_fragment', activatedGeneralIds: ['houyi'], discoveredGeneralIds: ['houyi'], unlockedWeaponIds: [] }), generated)
  assert.ok(generated.every((offer) => ['purple', 'orange', 'red'].includes(offer.quality)))
  assert.ok(isCompatibleWithHouyi(generated[0].weaponId))

  const accounts = new InMemoryWeaponAccountService()
  const commerce = new InMemoryWeaponCommerceService(accounts)
  commerce.setGold('buyer', 100)
  commerce.grantEntitlement({ playerId: 'buyer', entitlementId: 'buy-1', entitlementType: 'low_tier_weapon_fragment', activatedGeneralIds: ['houyi'], discoveredGeneralIds: ['houyi'], unlockedWeaponIds: [] })
  const offers = commerce.getOffers('buyer', 'buy-1')
  const selected = offers[0]
  const request = { requestId: 'purchase', playerId: 'buyer', entitlementId: 'buy-1', offerId: selected.offerId }
  const first = commerce.purchase(request)
  for (let repeat = 0; repeat < 100; repeat += 1) assert.deepEqual(commerce.purchase(request), first)
  assert.equal(accounts.getAccount('buyer').fragmentBalances[selected.weaponId], 1)
  assert.equal(commerce.getGold('buyer'), 100 - selected.priceGold)
  expectCode('INVALID_PURCHASE_ENTITLEMENT', () => commerce.getOffers('buyer', 'buy-1'))

  commerce.setGold('poor-buyer', 0)
  commerce.grantEntitlement({ playerId: 'poor-buyer', entitlementId: 'buy-poor', entitlementType: 'high_tier_weapon_fragment', activatedGeneralIds: ['houyi'], discoveredGeneralIds: ['houyi'], unlockedWeaponIds: [] })
  const expensive = commerce.getOffers('poor-buyer', 'buy-poor')[0]
  expectCode('INSUFFICIENT_GOLD', () => commerce.purchase({ requestId: 'poor-purchase', playerId: 'poor-buyer', entitlementId: 'buy-poor', offerId: expensive.offerId }))
  assert.equal(commerce.getOffers('poor-buyer', 'buy-poor').length, 3)
}

const isCompatibleWithHouyi = (weaponId: string): boolean => {
  const weapon = getWeaponDefinition(weaponId)
  return Boolean(weapon && (weapon.compatibility.allowedArchetypes?.includes('physical') || weapon.compatibility.exclusiveGeneralId === 'houyi'))
}

export function runWeaponV1SmokeChecks(): { weaponCount: number, exclusiveCount: number, checks: string[] } {
  checkCatalog()
  checkCraftingAndIdempotency()
  checkLoadoutsAndSnapshot()
  checkDrops()
  checkShop()
  return { weaponCount: WEAPON_CATALOG.length, exclusiveCount: EXCLUSIVE_WEAPONS.length, checks: ['catalog', 'craft-idempotency', 'loadouts-snapshot', 'wave-milestone-drops', 'shop-commerce'] }
}

if (require.main === module) process.stdout.write(`${JSON.stringify(runWeaponV1SmokeChecks())}\n`)
