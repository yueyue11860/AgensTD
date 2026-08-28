import assert from 'node:assert/strict'
import { MemoryPlayerAccountStore } from './memory-store'
import { PlayerAccountService, createDefaultPlayerAccount, settlementRewardTier } from './service'
import type {
  AccountShopCatalogProvider,
  JsonObject,
  PlayerAccountRecord,
  PurchaseEntitlementKind,
  ShopProduct,
} from './types'

const PRODUCTS: readonly ShopProduct[] = [
  ...['passive_alpha', 'passive_beta', 'passive_gamma', 'passive_delta'].map((itemId): ShopProduct => ({
    productId: `unlock:${itemId}`,
    entitlementKind: 'passive_item',
    priceGold: 10,
    reward: { type: 'unlock_passive_item', itemId },
  })),
  ...['active_alpha', 'active_beta', 'active_gamma'].map((itemId): ShopProduct => ({
    productId: `unlock:${itemId}`,
    entitlementKind: 'active_item',
    priceGold: 10,
    reward: { type: 'unlock_active_item', itemId },
  })),
  ...[
    ['green_blade', 'green', 5],
    ['blue_blade', 'blue', 10],
    ['green_staff', 'green', 5],
  ].map(([weaponId, quality, price]): ShopProduct => ({
    productId: `fragment:${weaponId}`,
    entitlementKind: 'low_tier_weapon_fragment',
    priceGold: price as number,
    reward: { type: 'weapon_fragment', weaponId: weaponId as string, amount: 1, quality: quality as 'green' | 'blue' },
    affinityGeneralIds: weaponId === 'green_blade' ? ['houyi'] : [],
  })),
]

const catalog: AccountShopCatalogProvider = {
  listEligibleProducts(kind: PurchaseEntitlementKind, account: Readonly<PlayerAccountRecord>): readonly ShopProduct[] {
    return PRODUCTS.filter(product => {
      if (product.entitlementKind !== kind) return false
      if (product.reward.type === 'unlock_active_item') {
        return !account.item.unlockedActiveItemIds.includes(product.reward.itemId)
      }
      if (product.reward.type === 'unlock_passive_item') {
        return !account.item.unlockedPassiveItemIds.includes(product.reward.itemId)
      }
      return true
    })
  },
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, error => Boolean(error && typeof error === 'object' && 'code' in error && error.code === code))
}

async function main(): Promise<void> {
  const store = new MemoryPlayerAccountStore()
  const service = new PlayerAccountService(store, catalog)

  const [createdA, createdB] = await Promise.all([
    service.getOrCreate('static-agent:alpha'),
    service.getOrCreate('static-agent:alpha'),
  ])
  assert.deepEqual(createdA.item.unlockedActiveItemIds, ['change_character_brush', 'cultivation_pill'])
  assert.deepEqual(createdA.item.unlockedPassiveItemIds, ['traveling_kitchen', 'talent_registry', 'reserve_expansion_talisman'])
  assert.deepEqual(createdA, createdB, '并发初始化必须只发一次默认包')
  assert.equal(createdA.schemaVersion, 2)
  assert.deepEqual((await service.getPveProgression(createdA.playerId)).clearedStageKeys, [])

  assert.equal(settlementRewardTier(4, 'defeat', false), 'wave_0_4')
  assert.equal(settlementRewardTier(5, 'defeat', false), 'wave_5_9')
  assert.equal(settlementRewardTier(10, 'voluntary_exit', false), 'wave_10_14')
  assert.equal(settlementRewardTier(15, 'disconnect_exit', false), 'wave_15_19')
  assert.equal(settlementRewardTier(20, 'victory', true), 'victory')
  await expectCode(service.settleMatch({
    requestId: 'invalid-victory-without-stage',
    matchId: 'invalid-victory-without-stage',
    playerId: 'static-agent:alpha',
    reason: 'victory',
    highestCompletedWave: 20,
    officialVictory: true,
    retainedWeaponFragments: {},
  }), 'INVALID_SETTLEMENT')

  const settlementInput = {
    requestId: 'settle:match-1:alpha',
    matchId: 'match-1',
    playerId: 'static-agent:alpha',
    reason: 'defeat' as const,
    highestCompletedWave: 5,
    officialVictory: false,
    retainedWeaponFragments: { green_blade: 1 },
  }
  const firstSettlement = await service.settleMatch(settlementInput)
  for (let retry = 0; retry < 100; retry++) {
    assert.deepEqual(await service.settleMatch(settlementInput), firstSettlement)
  }
  let account = await service.getOrCreate('static-agent:alpha')
  assert.equal(account.wallet.gold, 10)
  assert.equal(account.wallet.honor, 0)
  assert.equal(account.weapon.fragmentBalances.green_blade, 1)
  assert.equal(account.weapon.version, 1, '结算写入碎片时必须推进武器子版本')
  assert.equal(Object.keys(account.entitlements).length, 1)

  const pvpReward = {
    eventId: 'reward:match-pvp:static-agent:pvp',
    matchId: 'match-pvp',
    playerId: 'static-agent:pvp',
    honor: 20,
    gold: 10,
  }
  const firstPvpCredit = await service.applyPvpReward(pvpReward)
  assert.equal(firstPvpCredit.duplicate, false)
  const duplicatePvpCredit = await service.applyPvpReward(pvpReward)
  assert.equal(duplicatePvpCredit.duplicate, true)
  const pvpAccount = await service.getOrCreate('static-agent:pvp')
  assert.equal(pvpAccount.wallet.gold, 10, 'PVP gold must be credited exactly once')
  assert.equal(pvpAccount.wallet.honor, 20, 'PVP honor must be credited exactly once')
  await expectCode(service.applyPvpReward({ ...pvpReward, gold: 11 }), 'REQUEST_ID_CONFLICT')
  account = await service.getOrCreate('static-agent:alpha')

  const entitlementId = firstSettlement.entitlementIds[0]
  const offersA = await service.generateFixedOffers({
    playerId: account.playerId,
    entitlementId,
    recentActiveGeneralIds: ['houyi'],
  })
  const offersB = await service.generateFixedOffers({
    playerId: account.playerId,
    entitlementId,
    recentActiveGeneralIds: ['some_other_general'],
  })
  assert.deepEqual(offersA, offersB, '候选一旦生成就不得换种刷新')
  assert.equal(offersA.offers.length, 3)

  account = await service.getOrCreate(account.playerId)
  const purchaseInput = {
    requestId: 'purchase:match-1:passive',
    playerId: account.playerId,
    entitlementId,
    offerId: offersA.offers[0].offerId,
    expectedAccountVersion: account.version,
  }
  const receipt = await service.purchaseOffer(purchaseInput)
  for (let retry = 0; retry < 100; retry++) {
    assert.deepEqual(await service.purchaseOffer(purchaseInput), receipt)
  }
  account = await service.getOrCreate(account.playerId)
  assert.equal(account.wallet.gold, 0)
  assert.equal(account.entitlements[entitlementId].status, 'consumed')
  assert.equal(account.item.unlockedPassiveItemIds.length, 4)
  assert.equal(account.item.version, 2, '购买并解锁道具时必须推进道具子版本')

  await expectCode(service.purchaseOffer({ ...purchaseInput, offerId: offersA.offers[1].offerId }), 'REQUEST_ID_CONFLICT')

  const beforeSaveVersion = account.version
  const payloadA = structuredClone(account.item)
  payloadA.extensions = { ...payloadA.extensions, chosen: 'A' }
  const payloadB = structuredClone(account.item)
  payloadB.extensions = { ...payloadB.extensions, chosen: 'B' }
  const concurrent = await Promise.allSettled([
    service.saveItemPayload({ requestId: 'save:A', playerId: account.playerId, expectedAccountVersion: beforeSaveVersion, payload: payloadA }),
    service.saveItemPayload({ requestId: 'save:B', playerId: account.playerId, expectedAccountVersion: beforeSaveVersion, payload: payloadB }),
  ])
  assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(concurrent.filter(result => result.status === 'rejected').length, 1)

  account = await service.getOrCreate(account.playerId)
  const snapshot = await service.createBuildSnapshot({
    requestId: 'snapshot:match-2:alpha',
    matchId: 'match-2',
    playerId: account.playerId,
    expectedAccountVersion: account.version,
  }, {
    resolveItem(itemId: string): JsonObject { return { itemId, resolved: true } },
    resolveWeapon(weaponId: string): JsonObject { return { weaponId, resolved: true } },
  })
  const accountAfterSnapshot = await service.getOrCreate(account.playerId)
  const sameSnapshot = await service.createBuildSnapshot({
    requestId: 'snapshot:another-request-is-ignored-after-lock',
    matchId: 'match-2',
    playerId: account.playerId,
    expectedAccountVersion: accountAfterSnapshot.version,
  }, {
    resolveItem(): JsonObject { return { shouldNotReplace: true } },
    resolveWeapon(): JsonObject { return { shouldNotReplace: true } },
  })
  assert.deepEqual(snapshot, sameSnapshot, '同一对局构筑快照必须不可变')

  const progressionStore = new MemoryPlayerAccountStore()
  const progressionService = new PlayerAccountService(progressionStore, catalog)
  const victory = await progressionService.settleMatch({
    requestId: 'settle:easy-1:first-clear',
    matchId: 'easy-1:first-clear',
    playerId: 'progression-player',
    reason: 'victory',
    highestCompletedWave: 20,
    officialVictory: true,
    stageSelection: { levelId: 1, difficulty: 'easy' },
    retainedWeaponFragments: {},
  })
  assert.equal(victory.progressionUpdated, true)
  assert.deepEqual(victory.stageSelection, { levelId: 1, difficulty: 'easy' })
  assert.deepEqual(await progressionService.settleMatch({
    requestId: 'settle:easy-1:first-clear',
    matchId: 'easy-1:first-clear',
    playerId: 'progression-player',
    reason: 'victory',
    highestCompletedWave: 20,
    officialVictory: true,
    stageSelection: { levelId: 1, difficulty: 'easy' },
    retainedWeaponFragments: {},
  }), victory)
  assert.deepEqual(
    (await progressionService.getPveProgression('progression-player')).clearedStageKeys,
    ['easy:1'],
  )
  const progressionAccount = await progressionService.getOrCreate('progression-player')
  assert.equal(progressionAccount.pveProgress.clearsByStageKey['easy:1']?.clearCount, 1)

  const migrationStore = new MemoryPlayerAccountStore()
  const legacy = createLegacyAccount('legacy-player')
  await migrationStore.createIfAbsent(legacy)
  const migrated = await new PlayerAccountService(migrationStore, catalog).getOrCreate('legacy-player')
  assert.equal(migrated.schemaVersion, 2)
  assert.equal(migrated.wallet.gold, 77)
  assert.equal(migrated.wallet.honor, 0, 'legacy accounts gain an explicit honor wallet during migration')
  assert.deepEqual(migrated.pveProgress.clearsByStageKey, {}, '不迁移旧版可伪造的关卡进度')

  console.log('account-v1 smoke passed')
}

function createLegacyAccount(playerId: string): PlayerAccountRecord {
  const account = structuredClone(createDefaultPlayerAccount(playerId)) as unknown as Record<string, unknown>
  account.schemaVersion = 1
  ;(account.wallet as { gold: number }).gold = 77
  delete account.pveProgress
  return account as unknown as PlayerAccountRecord
}

void main()
