import { getGeneralRosterEntry } from '../core/hero-v1/roster'
import { WEAPON_CATALOG, isWeaponCompatible } from './catalog'
import { InMemoryWeaponAccountService } from './account'
import { type WeaponQuality, WeaponDomainError } from './types'

export type WeaponPurchaseEntitlementType = 'low_tier_weapon_fragment' | 'high_tier_weapon_fragment'

export interface WeaponFragmentDrop {
  dropIndex: number
  weaponId: string
  quality: WeaponQuality
  amount: 1
}

export interface BossWeaponDropInput {
  matchSeed: string
  playerId: string
  bossWave: 5 | 10 | 15 | 20
  bossKillSequence: number
  activatedGeneralIds: readonly string[]
  discoveredGeneralIds: readonly string[]
  unlockedWeaponIds: readonly string[]
}

const BOSS_DROP_TABLE: Readonly<Record<5 | 10 | 15 | 20, {
  count: 1 | 2
  weights: readonly [WeaponQuality, number][]
}>> = {
  5: { count: 1, weights: [['green', 7500], ['blue', 2500]] },
  10: { count: 1, weights: [['green', 3000], ['blue', 4500], ['purple', 2500]] },
  15: { count: 1, weights: [['blue', 1500], ['purple', 4500], ['orange', 3000], ['red', 1000]] },
  20: { count: 2, weights: [['purple', 3000], ['orange', 4000], ['red', 3000]] },
}

const hashSeed = (seed: string): number => {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0 || 0x9e3779b9
}

class DeterministicRandom {
  private state: number
  constructor(seed: string) { this.state = hashSeed(seed) }
  nextInt(maxExclusive: number): number {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) throw new Error('maxExclusive must be positive')
    let value = this.state
    value ^= value << 13; value ^= value >>> 17; value ^= value << 5
    this.state = value >>> 0
    return this.state % maxExclusive
  }
}

const weightedQuality = (random: DeterministicRandom, weights: readonly [WeaponQuality, number][]): WeaponQuality => {
  const total = weights.reduce((sum, entry) => sum + entry[1], 0)
  let roll = random.nextInt(total)
  for (const [quality, weight] of weights) {
    if (roll < weight) return quality
    roll -= weight
  }
  return weights[weights.length - 1][0]
}

const weaponCandidates = (
  quality: WeaponQuality,
  activatedGeneralIds: readonly string[],
  discoveredGeneralIds: readonly string[],
  unlockedWeaponIds: readonly string[],
): readonly typeof WEAPON_CATALOG[number][] => {
  const discovered = new Set([...activatedGeneralIds, ...discoveredGeneralIds])
  const unlocked = new Set(unlockedWeaponIds)
  const eligible = WEAPON_CATALOG.filter((weapon) => weapon.quality === quality
    && (!weapon.compatibility.exclusiveGeneralId || discovered.has(weapon.compatibility.exclusiveGeneralId)))
  const preferred = eligible.filter((weapon) => !unlocked.has(weapon.weaponId)
    && activatedGeneralIds.some((generalId) => isWeaponCompatible(weapon, generalId)))
  if (preferred.length) return preferred
  const otherLocked = eligible.filter((weapon) => !unlocked.has(weapon.weaponId))
  return otherLocked.length ? otherLocked : eligible
}

export function rollBossWeaponDrops(input: BossWeaponDropInput): readonly WeaponFragmentDrop[] {
  validateGeneralIds(input.activatedGeneralIds)
  validateGeneralIds(input.discoveredGeneralIds)
  const table = BOSS_DROP_TABLE[input.bossWave]
  const random = new DeterministicRandom(`${input.matchSeed}:${input.playerId}:${input.bossKillSequence}`)
  const drops: WeaponFragmentDrop[] = []
  for (let dropIndex = 0; dropIndex < table.count; dropIndex += 1) {
    const quality = weightedQuality(random, table.weights)
    const candidates = weaponCandidates(quality, input.activatedGeneralIds, input.discoveredGeneralIds, input.unlockedWeaponIds)
    if (!candidates.length) throw new Error(`No eligible ${quality} weapon drop candidates`)
    const weapon = candidates[random.nextInt(candidates.length)]
    drops.push({ dropIndex, weaponId: weapon.weaponId, quality, amount: 1 })
  }
  return drops
}

export interface WeaponShopOffer {
  offerId: string
  weaponId: string
  quality: WeaponQuality
  fragmentAmount: 1
  priceGold: number
}

export interface GenerateWeaponShopOffersInput {
  entitlementId: string
  entitlementType: WeaponPurchaseEntitlementType
  activatedGeneralIds: readonly string[]
  discoveredGeneralIds: readonly string[]
  unlockedWeaponIds: readonly string[]
}

const PRICE_BY_QUALITY: Readonly<Record<WeaponQuality, number>> = {
  green: 5, blue: 10, purple: 15, orange: 25, red: 40,
}

const SHOP_QUALITY_WEIGHTS: Readonly<Record<WeaponPurchaseEntitlementType, readonly [WeaponQuality, number][]>> = {
  low_tier_weapon_fragment: [['green', 55], ['blue', 45]],
  high_tier_weapon_fragment: [['purple', 40], ['orange', 35], ['red', 25]],
}

export function generateWeaponShopOffers(input: GenerateWeaponShopOffersInput): readonly WeaponShopOffer[] {
  validateGeneralIds(input.activatedGeneralIds)
  validateGeneralIds(input.discoveredGeneralIds)
  const random = new DeterministicRandom(`weapon-shop:${input.entitlementId}`)
  const selected = new Set<string>()
  const offers: WeaponShopOffer[] = []
  for (let offerIndex = 0; offerIndex < 3; offerIndex += 1) {
    const quality = weightedQuality(random, SHOP_QUALITY_WEIGHTS[input.entitlementType])
    let candidates = weaponCandidates(quality, offerIndex === 0 ? input.activatedGeneralIds : [], input.discoveredGeneralIds, input.unlockedWeaponIds)
      .filter((weapon) => !selected.has(weapon.weaponId))
    if (!candidates.length) {
      const allowedQualities = new Set(SHOP_QUALITY_WEIGHTS[input.entitlementType].map(([entry]) => entry))
      candidates = WEAPON_CATALOG.filter((weapon) => allowedQualities.has(weapon.quality) && !selected.has(weapon.weaponId))
    }
    if (!candidates.length) throw new Error(`Unable to generate three offers for ${input.entitlementId}`)
    const weapon = candidates[random.nextInt(candidates.length)]
    selected.add(weapon.weaponId)
    offers.push({ offerId: `${input.entitlementId}:${offerIndex}`, weaponId: weapon.weaponId, quality: weapon.quality, fragmentAmount: 1, priceGold: PRICE_BY_QUALITY[weapon.quality] })
  }
  return offers
}

interface EntitlementState extends GenerateWeaponShopOffersInput { consumed: boolean, offers?: readonly WeaponShopOffer[] }

export class InMemoryWeaponCommerceService {
  private readonly goldByPlayerId = new Map<string, number>()
  private readonly entitlementById = new Map<string, EntitlementState & { playerId: string }>()
  private readonly purchaseReceipts = new Map<string, { fingerprint: string, result: PurchaseWeaponFragmentResult }>()

  constructor(private readonly accounts: InMemoryWeaponAccountService) {}

  setGold(playerId: string, amount: number): void {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Gold must be a non-negative safe integer')
    this.goldByPlayerId.set(playerId, amount)
  }

  getGold(playerId: string): number { return this.goldByPlayerId.get(playerId) ?? 0 }

  grantEntitlement(input: GenerateWeaponShopOffersInput & { playerId: string }): void {
    if (this.entitlementById.has(input.entitlementId)) throw new WeaponDomainError('INVALID_PURCHASE_ENTITLEMENT', `Duplicate entitlement ${input.entitlementId}`)
    this.entitlementById.set(input.entitlementId, { ...input, consumed: false })
  }

  getOffers(playerId: string, entitlementId: string): readonly WeaponShopOffer[] {
    const entitlement = this.requireEntitlement(playerId, entitlementId)
    if (!entitlement.offers) entitlement.offers = generateWeaponShopOffers(entitlement)
    return JSON.parse(JSON.stringify(entitlement.offers)) as WeaponShopOffer[]
  }

  purchase(request: { requestId: string, playerId: string, entitlementId: string, offerId: string }): PurchaseWeaponFragmentResult {
    const fingerprint = JSON.stringify(request)
    const receiptKey = `${request.playerId}:${request.requestId}`
    const existing = this.purchaseReceipts.get(receiptKey)
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new WeaponDomainError('REQUEST_ID_CONFLICT', 'Purchase requestId payload mismatch')
      return { ...existing.result }
    }
    const entitlement = this.requireEntitlement(request.playerId, request.entitlementId)
    const offer = this.getOffers(request.playerId, request.entitlementId).find((candidate) => candidate.offerId === request.offerId)
    if (!offer) throw new WeaponDomainError('OFFER_NOT_FOUND', `Unknown offer ${request.offerId}`)
    const gold = this.getGold(request.playerId)
    if (gold < offer.priceGold) throw new WeaponDomainError('INSUFFICIENT_GOLD', `Requires ${offer.priceGold} gold`)
    const account = this.accounts.getAccount(request.playerId)
    this.accounts.creditFragments({
      requestId: `purchase-credit:${request.entitlementId}`,
      playerId: request.playerId,
      fragments: { [offer.weaponId]: offer.fragmentAmount },
      expectedAccountVersion: account.version,
    })
    this.goldByPlayerId.set(request.playerId, gold - offer.priceGold)
    entitlement.consumed = true
    const result: PurchaseWeaponFragmentResult = { weaponId: offer.weaponId, fragmentAmount: 1, spentGold: offer.priceGold, remainingGold: gold - offer.priceGold }
    this.purchaseReceipts.set(receiptKey, { fingerprint, result })
    return { ...result }
  }

  private requireEntitlement(playerId: string, entitlementId: string): EntitlementState & { playerId: string } {
    const entitlement = this.entitlementById.get(entitlementId)
    if (!entitlement || entitlement.playerId !== playerId || entitlement.consumed) throw new WeaponDomainError('INVALID_PURCHASE_ENTITLEMENT', `Invalid entitlement ${entitlementId}`)
    return entitlement
  }
}

export interface PurchaseWeaponFragmentResult {
  weaponId: string
  fragmentAmount: 1
  spentGold: number
  remainingGold: number
}

export function validateGeneralIds(generalIds: readonly string[]): void {
  for (const generalId of generalIds) if (!getGeneralRosterEntry(generalId)) throw new Error(`Unknown generalId ${generalId}`)
}
