import { ACTIVE_ITEM_IDS, getItemDefinition, PASSIVE_ITEM_IDS } from './catalog'
import {
  ITEM_CATALOG_VERSION,
  ItemPurchaseAggregate,
  ItemPurchaseEntitlement,
  ItemPurchaseReceipt,
  ItemShopOffer,
  PurchaseItemUnlockCommand,
  PurchaseItemUnlockResult,
} from './types'

export const ITEM_UNLOCK_PRICE_META_GOLD = 10 as const
export const ITEM_SHOP_CANDIDATE_COUNT = 3 as const

export interface EnsureItemShopOfferResult {
  aggregate: ItemPurchaseAggregate
  offer: ItemShopOffer
}

export function ensureItemShopOffer(
  aggregate: ItemPurchaseAggregate,
  entitlementId: string,
): EnsureItemShopOfferResult | undefined {
  const entitlement = aggregate.entitlements[entitlementId]
  if (!entitlement || entitlement.status !== 'available') return undefined
  const existing = entitlement.offeredCandidateItemIds
  if (existing) return { aggregate, offer: toOffer(entitlement, existing) }

  const unlocked = new Set(
    entitlement.category === 'active_item'
      ? aggregate.account.unlockedActiveItemIds
      : aggregate.account.unlockedPassiveItemIds,
  )
  const allIds = entitlement.category === 'active_item' ? ACTIVE_ITEM_IDS : PASSIVE_ITEM_IDS
  const candidateItemIds = [...allIds]
    .filter((itemId) => !unlocked.has(itemId))
    .sort((left, right) => {
      const scoreDifference = stableHash(`${entitlement.entitlementId}:${left}`)
        - stableHash(`${entitlement.entitlementId}:${right}`)
      return scoreDifference || left.localeCompare(right)
    })
    .slice(0, ITEM_SHOP_CANDIDATE_COUNT)

  const nextEntitlement: ItemPurchaseEntitlement = {
    ...entitlement,
    offeredCandidateItemIds: candidateItemIds,
    version: entitlement.version + 1,
  }
  const nextAggregate: ItemPurchaseAggregate = {
    ...aggregate,
    entitlements: { ...aggregate.entitlements, [entitlementId]: nextEntitlement },
  }
  return { aggregate: nextAggregate, offer: toOffer(nextEntitlement, candidateItemIds) }
}

export function purchaseItemUnlock(
  aggregate: ItemPurchaseAggregate,
  command: PurchaseItemUnlockCommand,
): PurchaseItemUnlockResult {
  const previousReceipt = aggregate.processedRequests[command.requestId]
  if (previousReceipt) return receiptToResult(previousReceipt, command.requestId, aggregate)

  const fail = (error: ItemPurchaseReceipt & { ok: false }): PurchaseItemUnlockResult => {
    const next = recordReceipt(aggregate, command.requestId, error)
    return { ok: false, requestId: command.requestId, error: error.error, aggregate: next }
  }

  if (command.playerId !== aggregate.account.playerId) return fail({ ok: false, error: 'ITEM_NOT_UNLOCKED' })
  if (command.expectedCatalogVersion !== ITEM_CATALOG_VERSION) {
    return fail({ ok: false, error: 'ITEM_CATALOG_VERSION_MISMATCH' })
  }
  if (command.expectedAccountVersion !== aggregate.account.version) {
    return fail({ ok: false, error: 'ITEM_ACCOUNT_VERSION_MISMATCH' })
  }
  if (command.expectedEconomyVersion !== aggregate.economyVersion) {
    return fail({ ok: false, error: 'ITEM_ACCOUNT_VERSION_MISMATCH' })
  }
  const entitlement = aggregate.entitlements[command.entitlementId]
  if (!entitlement || entitlement.playerId !== command.playerId) {
    return fail({ ok: false, error: 'ITEM_PURCHASE_ENTITLEMENT_NOT_FOUND' })
  }
  if (entitlement.status === 'consumed') {
    return fail({ ok: false, error: 'ITEM_PURCHASE_ENTITLEMENT_CONSUMED' })
  }
  if (entitlement.version !== command.expectedEntitlementVersion) {
    return fail({ ok: false, error: 'ITEM_ACCOUNT_VERSION_MISMATCH' })
  }
  if (!entitlement.offeredCandidateItemIds?.includes(command.itemId)) {
    return fail({ ok: false, error: 'ITEM_PURCHASE_OFFER_MISMATCH' })
  }
  const definition = getItemDefinition(command.itemId)
  const expectedKind = entitlement.category === 'active_item' ? 'active' : 'passive'
  if (!definition || definition.itemKind !== expectedKind) {
    return fail({ ok: false, error: definition ? 'ITEM_KIND_MISMATCH' : 'ITEM_NOT_FOUND' })
  }
  const unlocked = definition.itemKind === 'active'
    ? aggregate.account.unlockedActiveItemIds
    : aggregate.account.unlockedPassiveItemIds
  if (unlocked.includes(command.itemId)) return fail({ ok: false, error: 'ITEM_ALREADY_UNLOCKED' })
  if (aggregate.metaGold < ITEM_UNLOCK_PRICE_META_GOLD) {
    return fail({ ok: false, error: 'INSUFFICIENT_META_GOLD' })
  }

  const receipt: ItemPurchaseReceipt = { ok: true, unlockedItemId: command.itemId }
  const nextAccount = {
    ...aggregate.account,
    unlockedActiveItemIds: definition.itemKind === 'active'
      ? [...aggregate.account.unlockedActiveItemIds, command.itemId]
      : [...aggregate.account.unlockedActiveItemIds],
    unlockedPassiveItemIds: definition.itemKind === 'passive'
      ? [...aggregate.account.unlockedPassiveItemIds, command.itemId]
      : [...aggregate.account.unlockedPassiveItemIds],
    version: aggregate.account.version + 1,
  }
  const nextEntitlement: ItemPurchaseEntitlement = {
    ...entitlement,
    status: 'consumed',
    consumedByRequestId: command.requestId,
    version: entitlement.version + 1,
  }
  const nextAggregate: ItemPurchaseAggregate = {
    ...aggregate,
    account: nextAccount,
    metaGold: aggregate.metaGold - ITEM_UNLOCK_PRICE_META_GOLD,
    economyVersion: aggregate.economyVersion + 1,
    entitlements: { ...aggregate.entitlements, [entitlement.entitlementId]: nextEntitlement },
    processedRequests: { ...aggregate.processedRequests, [command.requestId]: receipt },
  }
  return { ok: true, requestId: command.requestId, aggregate: nextAggregate, unlockedItemId: command.itemId }
}

function recordReceipt(
  aggregate: ItemPurchaseAggregate,
  requestId: string,
  receipt: ItemPurchaseReceipt,
): ItemPurchaseAggregate {
  return {
    ...aggregate,
    processedRequests: { ...aggregate.processedRequests, [requestId]: receipt },
  }
}

function receiptToResult(
  receipt: ItemPurchaseReceipt,
  requestId: string,
  aggregate: ItemPurchaseAggregate,
): PurchaseItemUnlockResult {
  return receipt.ok
    ? { ok: true, requestId, aggregate, unlockedItemId: receipt.unlockedItemId }
    : { ok: false, requestId, aggregate, error: receipt.error }
}

function toOffer(entitlement: ItemPurchaseEntitlement, candidateItemIds: readonly string[]): ItemShopOffer {
  return {
    entitlementId: entitlement.entitlementId,
    playerId: entitlement.playerId,
    category: entitlement.category,
    catalogVersion: ITEM_CATALOG_VERSION,
    candidateItemIds,
    priceMetaGold: ITEM_UNLOCK_PRICE_META_GOLD,
  }
}

function stableHash(input: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}
