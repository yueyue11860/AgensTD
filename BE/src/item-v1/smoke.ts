import assert from 'node:assert/strict'
import {
  ACTIVE_ITEM_DEFINITIONS,
  ACTIVE_ITEM_IDS,
  PASSIVE_ITEM_DEFINITIONS,
  PASSIVE_ITEM_IDS,
  validateItemCatalog,
} from './catalog'
import {
  createMatchItemLoadoutSnapshot,
  createPlayerItemAccount,
  saveItemLoadout,
  validateItemLoadout,
} from './account'
import { projectPassiveItemRules, resolveGeneralExperience, resolveGeneralLevelCap, resolvePaidRecruitCost } from './modifiers'
import { applyRecruitBatchGuarantees, buildRecruitRuleProfile, shouldGrantExtraBossFragment } from './rules'
import { createItemRuntimeAggregate, useActiveItem } from './runtime'
import { ensureItemShopOffer, purchaseItemUnlock } from './shop'
import { ItemPurchaseAggregate, ItemPurchaseEntitlement, PlayerItemAccount } from './types'

export function runItemV1SmokeChecks(): void {
  assert.deepEqual(validateItemCatalog(), [])
  assert.equal(ACTIVE_ITEM_DEFINITIONS.length, 8)
  assert.equal(PASSIVE_ITEM_DEFINITIONS.length, 15)
  assert.equal(new Set([...ACTIVE_ITEM_IDS, ...PASSIVE_ITEM_IDS]).size, 23)

  const fresh = createPlayerItemAccount('p1', '2026-08-25T00:00:00.000Z')
  assert.deepEqual(fresh.unlockedActiveItemIds, ['change_character_brush', 'cultivation_pill'])
  assert.equal(fresh.loadout.activeSlots.length, 2)
  assert.equal(fresh.loadout.passiveSlots.length, 6)
  assert.equal(validateItemLoadout(fresh, fresh.loadout.activeSlots, fresh.loadout.passiveSlots), undefined)
  assert.equal(
    validateItemLoadout(fresh, ['change_character_brush', 'change_character_brush'], fresh.loadout.passiveSlots),
    'DUPLICATE_ITEM_IN_LOADOUT',
  )
  assert.equal(
    validateItemLoadout(fresh, ['traveling_kitchen', null], fresh.loadout.passiveSlots),
    'DUPLICATE_ITEM_IN_LOADOUT',
  )
  assert.equal(
    validateItemLoadout(fresh, ['heavenly_thunder_order', null], fresh.loadout.passiveSlots),
    'ITEM_NOT_UNLOCKED',
  )

  const saved = saveItemLoadout(fresh, {
    playerId: 'p1',
    activeSlots: ['change_character_brush', null],
    passiveSlots: ['traveling_kitchen', null, null, null, null, null],
    expectedLoadoutVersion: 1,
    expectedAccountVersion: 1,
    expectedCatalogVersion: 1,
    nowIso: '2026-08-25T00:01:00.000Z',
  })
  if (!saved.ok) throw new Error(`save failed: ${saved.error}`)
  assert.equal(saved.value.version, 2)
  assert.equal(saved.value.loadout.version, 2)
  const staleSave = saveItemLoadout(saved.value, {
    playerId: 'p1',
    activeSlots: [null, null],
    passiveSlots: [null, null, null, null, null, null],
    expectedLoadoutVersion: 1,
    expectedAccountVersion: 1,
    expectedCatalogVersion: 1,
    nowIso: '2026-08-25T00:02:00.000Z',
  })
  assert.deepEqual(staleSave, { ok: false, error: 'ITEM_ACCOUNT_VERSION_MISMATCH' })

  const snapshot = createMatchItemLoadoutSnapshot(saved.value)
  assert.equal(Object.isFrozen(snapshot), true)
  assert.equal(Object.isFrozen(snapshot.activeItems[0]), true)
  const accountAfterMatchStart = saveItemLoadout(saved.value, {
    playerId: 'p1',
    activeSlots: ['cultivation_pill', null],
    passiveSlots: [null, null, null, null, null, null],
    expectedLoadoutVersion: 2,
    expectedAccountVersion: 2,
    expectedCatalogVersion: 1,
    nowIso: '2026-08-25T00:03:00.000Z',
  })
  assert.equal(accountAfterMatchStart.ok, true)
  assert.equal(snapshot.activeSlots[0], 'change_character_brush')

  checkShopTransaction(fresh)
  checkRuntime()
  checkPassiveProjection()
}

function checkShopTransaction(account: PlayerItemAccount): void {
  const entitlement: ItemPurchaseEntitlement = {
    entitlementId: 'active-entitlement-1',
    playerId: account.playerId,
    category: 'active_item',
    status: 'available',
    version: 1,
  }
  let aggregate: ItemPurchaseAggregate = {
    account,
    metaGold: 30,
    economyVersion: 1,
    entitlements: { [entitlement.entitlementId]: entitlement },
    processedRequests: {},
  }
  const generated = ensureItemShopOffer(aggregate, entitlement.entitlementId)
  assert.ok(generated)
  aggregate = generated.aggregate
  assert.equal(generated.offer.candidateItemIds.length, 3)
  const reopened = ensureItemShopOffer(aggregate, entitlement.entitlementId)
  assert.deepEqual(reopened?.offer.candidateItemIds, generated.offer.candidateItemIds)
  const itemId = generated.offer.candidateItemIds[0]
  const command = {
    requestId: 'purchase-request-1',
    playerId: account.playerId,
    entitlementId: entitlement.entitlementId,
    itemId,
    expectedAccountVersion: account.version,
    expectedEconomyVersion: aggregate.economyVersion,
    expectedEntitlementVersion: aggregate.entitlements[entitlement.entitlementId].version,
    expectedCatalogVersion: 1 as const,
  }
  const purchase = purchaseItemUnlock(aggregate, command)
  if (!purchase.ok) throw new Error(`purchase failed: ${purchase.error}`)
  aggregate = purchase.aggregate
  for (let index = 0; index < 100; index += 1) {
    const replay = purchaseItemUnlock(aggregate, command)
    assert.equal(replay.ok, true)
    aggregate = replay.aggregate
  }
  assert.equal(aggregate.metaGold, 20)
  assert.equal(aggregate.account.unlockedActiveItemIds.filter((id) => id === itemId).length, 1)
  assert.equal(aggregate.entitlements[entitlement.entitlementId].status, 'consumed')
}

function checkRuntime(): void {
  const account = accountWithAllItems('runtime-player')
  account.loadout.activeSlots = ['heavenly_thunder_order', 'war_drum_order']
  account.loadout.passiveSlots = [null, null, null, null, null, null]
  const snapshot = createMatchItemLoadoutSnapshot(account)
  let runtime = createItemRuntimeAggregate('match-1', snapshot)
  const command = {
    type: 'USE_ACTIVE_ITEM' as const,
    requestId: 'use-1',
    playerId: account.playerId,
    slotIndex: 0 as const,
    itemId: 'heavenly_thunder_order',
    target: { kind: 'battlefield_point' as const, xMilli: 1_000, yMilli: 2_000 },
    expectedItemRuntimeVersion: runtime.version,
  }
  const rejected = useActiveItem(runtime, command, {
    currentTick: 10,
    tickDurationMs: 50,
    phase: 'prep',
    validateTarget: () => ({ ok: true, hasLegalTarget: true }),
  })
  assert.equal(rejected.ok, false)
  if (rejected.ok) throw new Error('expected phase rejection')
  assert.equal(rejected.error, 'ITEM_NOT_AVAILABLE_IN_PHASE')
  assert.equal(rejected.state.slots[0]?.chargesRemaining, 2)

  const successfulCommand = { ...command, requestId: 'use-2' }
  const used = useActiveItem(rejected.state, successfulCommand, {
    currentTick: 100,
    tickDurationMs: 50,
    phase: 'spawning',
    validateTarget: () => ({ ok: true, hasLegalTarget: true }),
  })
  if (!used.ok) throw new Error(`use failed: ${used.error}`)
  runtime = used.state
  assert.equal(used.plan.effects[0].type, 'current_health_true_damage')
  assert.equal(runtime.slots[0]?.chargesRemaining, 1)
  assert.equal(runtime.slots[0]?.cooldownEndsAtTick, 600)
  assert.match(used.plan.sourceKey, /^active_item:match-1:runtime-player:0:/)
  for (let index = 0; index < 100; index += 1) {
    const replay = useActiveItem(runtime, successfulCommand, {
      currentTick: 1_000,
      tickDurationMs: 50,
      phase: 'spawning',
      validateTarget: () => ({ ok: true, hasLegalTarget: true }),
    })
    assert.equal(replay.ok, true)
    runtime = replay.state
  }
  assert.equal(runtime.slots[0]?.chargesRemaining, 1)
  assert.equal(runtime.slots[0]?.usesThisMatch, 1)

  const cooldownRejection = useActiveItem(runtime, {
    ...successfulCommand,
    requestId: 'use-3',
    expectedItemRuntimeVersion: runtime.version,
  }, {
    currentTick: 599,
    tickDurationMs: 50,
    phase: 'spawning',
    validateTarget: () => ({ ok: true, hasLegalTarget: true }),
  })
  assert.equal(cooldownRejection.ok, false)
  if (!cooldownRejection.ok) assert.equal(cooldownRejection.error, 'ITEM_ON_COOLDOWN')
}

function checkPassiveProjection(): void {
  const account = accountWithAllItems('passive-player')
  account.loadout.activeSlots = [null, null]
  account.loadout.passiveSlots = [
    'talent_registry',
    'talent_pity_order',
    'reserve_expansion_talisman',
    'army_expansion_order',
    'purple_breakthrough_manual',
    'lineage_training_manual',
  ]
  const projection = projectPassiveItemRules('match-passive', createMatchItemLoadoutSnapshot(account))
  const profile = buildRecruitRuleProfile(projection)
  assert.equal(profile.characterProbabilityBps, 1_200)
  assert.equal(profile.reserveCapacity, 3)
  assert.equal(profile.populationCap, 11)
  assert.equal(resolveGeneralLevelCap('purple', 3, projection), 5)
  assert.equal(resolveGeneralLevelCap('orange', 4, projection), 4)
  assert.equal(resolveGeneralExperience(1_001, projection), 1_151)

  const pity = applyRecruitBatchGuarantees({
    isPaidRecruit: true,
    isFirstBatch: false,
    generatedKinds: ['soldier', 'soldier', 'soldier', 'soldier', 'soldier'],
    hasRemainingCharacterToken: true,
    pityState: { noCharacterPaidBatchStreak: 2 },
    chooseIndex: (indexes) => indexes[0],
  }, projection)
  assert.equal(pity.pityCharacterIndex, 0)
  assert.equal(pity.finalKinds.filter((kind) => kind === 'character').length, 1)
  assert.equal(pity.nextPityState.noCharacterPaidBatchStreak, 0)

  account.loadout.passiveSlots = [
    'traveling_kitchen',
    'frugal_recruitment_order',
    'army_breaking_banner',
    'myriad_spirit_banner',
    'realm_stabilizing_pearl',
    'treasure_hunting_compass',
  ]
  const combatProjection = projectPassiveItemRules('match-passive', createMatchItemLoadoutSnapshot(account))
  assert.equal(combatProjection.startingRationsBonus, 5)
  assert.equal(resolvePaidRecruitCost(5, combatProjection), 5)
  assert.equal(resolvePaidRecruitCost(9, combatProjection), 8)
  assert.equal(combatProjection.combatEffects.length, 4)
  assert.equal(shouldGrantExtraBossFragment(1_999, combatProjection), true)
  assert.equal(shouldGrantExtraBossFragment(2_000, combatProjection), false)
}

function accountWithAllItems(playerId: string): PlayerItemAccount {
  const account = createPlayerItemAccount(playerId, '2026-08-25T00:00:00.000Z')
  account.unlockedActiveItemIds = [...ACTIVE_ITEM_IDS]
  account.unlockedPassiveItemIds = [...PASSIVE_ITEM_IDS]
  return account
}

if (require.main === module) {
  runItemV1SmokeChecks()
  process.stdout.write('item-v1 smoke: ok\n')
}
