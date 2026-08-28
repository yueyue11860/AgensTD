import type { PlayerAccountStore } from '../data/player-account-store'
import {
  isPveStageSelection,
  pveStageKey,
  type PveProgressionView,
  type PveStageSelection,
} from '../../../shared/contracts/pve-stage-config'
import { createDefaultPveProgress, derivePveProgressionView } from '../core/unlock-logic'
import {
  AccountDomainError,
  PLAYER_ACCOUNT_SCHEMA_VERSION,
  type AccountShopCatalogProvider,
  type FixedShopOffer,
  type FixedShopOfferSet,
  type ItemAccountPayload,
  type JsonObject,
  type JsonValue,
  type MatchBuildDefinitionResolver,
  type MatchBuildSnapshot,
  type MatchPlayerSettlement,
  type PlayerAccountRecord,
  type PurchaseEntitlement,
  type PurchaseEntitlementKind,
  type SettlementReason,
  type SettlementRewardTier,
  type ShopProduct,
  type WeaponAccountPayload,
} from './types'

const DEFAULT_ACTIVE_ITEMS = ['change_character_brush', 'cultivation_pill'] as const
const DEFAULT_PASSIVE_ITEMS = [
  'traveling_kitchen',
  'talent_registry',
  'reserve_expansion_talisman',
] as const
const MAX_CAS_RETRIES = 12

export interface SettleMatchInput {
  requestId: string
  matchId: string
  playerId: string
  reason: SettlementReason
  highestCompletedWave: number
  /** 只能由权威房间结束事件设置。 */
  officialVictory: boolean
  /** 由 Room 在点火时锁定，客户端不得传入或改写。 */
  stageSelection?: PveStageSelection
  retainedWeaponFragments: Readonly<Record<string, number>>
}

export interface GenerateOffersInput {
  playerId: string
  entitlementId: string
  recentActiveGeneralIds?: readonly string[]
}

export interface PurchaseOfferInput {
  requestId: string
  playerId: string
  entitlementId: string
  offerId: string
  expectedAccountVersion: number
}

export interface PurchaseOfferReceipt {
  requestId: string
  entitlementId: string
  offer: FixedShopOffer
  goldSpent: number
  goldAfter: number
  accountVersionAfter: number
}

export interface SaveSubsystemPayloadInput<T> {
  requestId: string
  playerId: string
  expectedAccountVersion: number
  payload: T
  /** Identifies the user intent so REST retries remain verifiable after later account mutations. */
  idempotencyContext?: JsonObject
}

export interface CreateBuildSnapshotInput {
  requestId: string
  matchId: string
  playerId: string
  expectedAccountVersion: number
}

export interface ApplyPvpRewardInput {
  /** Outbox event id; this is the account idempotency key. */
  eventId: string
  matchId: string
  playerId: string
  honor: number
  gold: number
}

export interface PvpRewardCreditResult {
  eventId: string
  matchId: string
  playerId: string
  honorGranted: number
  goldGranted: number
  accountVersionAfter: number
  duplicate: boolean
}

function nowIso(): string {
  return new Date().toISOString()
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
    .join(',')}}`
}

function hash32(text: string): number {
  let hash = 2166136261
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function seededOrder<T>(values: readonly T[], seed: string, keyOf: (value: T) => string): T[] {
  return [...values].sort((left, right) => {
    const score = hash32(`${seed}:${keyOf(left)}`) - hash32(`${seed}:${keyOf(right)}`)
    return score || keyOf(left).localeCompare(keyOf(right))
  })
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AccountDomainError('INVALID_ACCOUNT_MUTATION', `${field} must be a non-negative safe integer`)
  }
}

function isPveProgressPayload(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as { version?: unknown; clearsByStageKey?: unknown }
  return Number.isSafeInteger(candidate.version)
    && (candidate.version as number) >= 1
    && typeof candidate.clearsByStageKey === 'object'
    && candidate.clearsByStageKey !== null
    && !Array.isArray(candidate.clearsByStageKey)
}

export function createDefaultPlayerAccount(playerId: string, at = nowIso()): PlayerAccountRecord {
  if (!playerId) throw new AccountDomainError('INVALID_ACCOUNT_MUTATION', 'playerId is required')
  return {
    schemaVersion: PLAYER_ACCOUNT_SCHEMA_VERSION,
    playerId,
    version: 0,
    wallet: { gold: 0, honor: 0 },
    entitlements: {},
    fixedOffersByEntitlementId: {},
    settlementsById: {},
    buildSnapshotsByMatchId: {},
    idempotencyByRequestId: {},
    item: {
      version: 1,
      unlockedActiveItemIds: [...DEFAULT_ACTIVE_ITEMS],
      unlockedPassiveItemIds: [...DEFAULT_PASSIVE_ITEMS],
      loadout: {
        activeSlots: [...DEFAULT_ACTIVE_ITEMS],
        passiveSlots: [...DEFAULT_PASSIVE_ITEMS, null, null, null],
        version: 1,
        updatedAt: at,
      },
      extensions: { bootstrapRevision: 1 },
    },
    weapon: {
      version: 0,
      fragmentBalances: {},
      unlockedWeaponIds: [],
      loadoutsByGeneralId: {},
      extensions: {},
    },
    pveProgress: createDefaultPveProgress(),
    createdAt: at,
    updatedAt: at,
  }
}

export function settlementRewardTier(
  highestCompletedWave: number,
  reason: SettlementReason,
  officialVictory: boolean,
): SettlementRewardTier {
  if (!Number.isInteger(highestCompletedWave) || highestCompletedWave < 0 || highestCompletedWave > 20) {
    throw new AccountDomainError('INVALID_SETTLEMENT', 'highestCompletedWave must be an integer from 0 to 20')
  }
  if (reason === 'victory') {
    if (!officialVictory) throw new AccountDomainError('INVALID_SETTLEMENT', 'victory requires an official victory event')
    return 'victory'
  }
  if (officialVictory) throw new AccountDomainError('INVALID_SETTLEMENT', 'officialVictory conflicts with a non-victory reason')
  if (highestCompletedWave >= 20) {
    throw new AccountDomainError('INVALID_SETTLEMENT', 'wave 20 without an official victory cannot grant victory rewards')
  }
  if (highestCompletedWave >= 15) return 'wave_15_19'
  if (highestCompletedWave >= 10) return 'wave_10_14'
  if (highestCompletedWave >= 5) return 'wave_5_9'
  return 'wave_0_4'
}

function tierGold(tier: SettlementRewardTier): number {
  return { wave_0_4: 5, wave_5_9: 10, wave_10_14: 15, wave_15_19: 20, victory: 40 }[tier]
}

function tierEntitlements(tier: SettlementRewardTier): PurchaseEntitlementKind[] {
  switch (tier) {
    case 'wave_0_4': return []
    case 'wave_5_9': return ['passive_item']
    case 'wave_10_14': return ['passive_item', 'active_item']
    case 'wave_15_19': return ['passive_item', 'active_item', 'low_tier_weapon_fragment']
    case 'victory': return ['passive_item', 'active_item', 'high_tier_weapon_fragment']
  }
}

function validateItemPayload(payload: ItemAccountPayload): void {
  if (payload.loadout.activeSlots.length !== 2 || payload.loadout.passiveSlots.length !== 6) {
    throw new AccountDomainError('INVALID_ACCOUNT_MUTATION', 'item loadout must contain exactly 2 active and 6 passive slots')
  }
}

function validateWeaponPayload(payload: WeaponAccountPayload): void {
  for (const [weaponId, amount] of Object.entries(payload.fragmentBalances)) {
    assertNonNegativeInteger(amount, `fragmentBalances.${weaponId}`)
  }
  for (const [generalId, loadout] of Object.entries(payload.loadoutsByGeneralId)) {
    if (loadout.slots.length !== 2) {
      throw new AccountDomainError('INVALID_ACCOUNT_MUTATION', `weapon loadout ${generalId} must contain exactly 2 slots`)
    }
  }
}

export class PlayerAccountService {
  constructor(
    private readonly store: PlayerAccountStore,
    private readonly shopCatalog?: AccountShopCatalogProvider,
  ) {}

  async getOrCreate(playerId: string): Promise<PlayerAccountRecord> {
    const existing = await this.store.get(playerId)
    const account = existing ?? await this.store.createIfAbsent(createDefaultPlayerAccount(playerId))
    return this.migrateAccountIfNeeded(playerId, account)
  }

  async get(playerId: string): Promise<PlayerAccountRecord | null> {
    const account = await this.store.get(playerId)
    return account ? this.migrateAccountIfNeeded(playerId, account) : null
  }

  /**
   * Applies one durable PVP reward event to the player account.
   *
   * The outbox event id is stored in the account's existing idempotency ledger,
   * so a worker crash after the account CAS but before outbox acknowledgement
   * cannot grant the same reward twice. The CAS loop also makes concurrent
   * workers safe when they race on the same account.
   */
  async applyPvpReward(input: ApplyPvpRewardInput): Promise<PvpRewardCreditResult> {
    if (!input.eventId || !input.matchId || !input.playerId) {
      throw new AccountDomainError('INVALID_ACCOUNT_MUTATION', 'eventId, matchId and playerId are required')
    }
    assertNonNegativeInteger(input.honor, 'honor')
    assertNonNegativeInteger(input.gold, 'gold')
    const fingerprint = stableStringify({
      eventId: input.eventId,
      matchId: input.matchId,
      playerId: input.playerId,
      honor: input.honor,
      gold: input.gold,
    })

    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt += 1) {
      const current = await this.getOrCreate(input.playerId)
      const existing = this.readIdempotent<PvpRewardCreditResult>(current, input.eventId, 'pvp_reward', fingerprint)
      if (existing) return { ...existing, duplicate: true }

      const next = clone(current)
      next.wallet.gold += input.gold
      next.wallet.honor += input.honor
      const result: PvpRewardCreditResult = {
        eventId: input.eventId,
        matchId: input.matchId,
        playerId: input.playerId,
        honorGranted: input.honor,
        goldGranted: input.gold,
        accountVersionAfter: current.version + 1,
        duplicate: false,
      }
      this.finishMutation(next, current.version, input.eventId, 'pvp_reward', fingerprint, result as unknown as JsonValue)
      if (await this.store.compareAndSwap(input.playerId, current.version, next)) return result
    }
    throw new AccountDomainError('ACCOUNT_WRITE_CONFLICT', 'PVP reward account CAS retry budget exhausted')
  }

  async getPveProgression(playerId: string): Promise<PveProgressionView> {
    const account = await this.getOrCreate(playerId)
    return derivePveProgressionView(account.pveProgress)
  }

  async settleMatch(input: SettleMatchInput): Promise<MatchPlayerSettlement> {
    if (!input.requestId || !input.matchId || !input.playerId) {
      throw new AccountDomainError('INVALID_SETTLEMENT', 'requestId, matchId and playerId are required')
    }
    if (input.stageSelection !== undefined && !isPveStageSelection(input.stageSelection)) {
      throw new AccountDomainError('INVALID_SETTLEMENT', 'stageSelection must identify an existing PVE stage and difficulty')
    }
    if (input.officialVictory && !input.stageSelection) {
      throw new AccountDomainError('INVALID_SETTLEMENT', 'official PVE victory requires the server-locked stageSelection')
    }
    const settlementId = `${input.matchId}:${input.playerId}`
    const fingerprint = stableStringify({ ...input, retainedWeaponFragments: input.retainedWeaponFragments })

    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const current = await this.getOrCreate(input.playerId)
      this.assertIdempotencyAvailable(current, input.requestId, 'settle_match', fingerprint)
      const oldSettlement = current.settlementsById[settlementId]
      if (oldSettlement) {
        const sameSettlement = oldSettlement.matchId === input.matchId
          && oldSettlement.playerId === input.playerId
          && oldSettlement.reason === input.reason
          && oldSettlement.highestCompletedWave === input.highestCompletedWave
          && stableStringify(oldSettlement.stageSelection ?? null) === stableStringify(input.stageSelection ?? null)
          && stableStringify(oldSettlement.retainedWeaponFragments) === stableStringify(input.retainedWeaponFragments)
        if (!sameSettlement) {
          throw new AccountDomainError('INVALID_SETTLEMENT', 'settlementId is already committed with a different payload')
        }
        return clone(oldSettlement)
      }

      const tier = settlementRewardTier(input.highestCompletedWave, input.reason, input.officialVictory)
      const at = nowIso()
      const next = clone(current)
      for (const [weaponId, amount] of Object.entries(input.retainedWeaponFragments)) {
        assertNonNegativeInteger(amount, `retainedWeaponFragments.${weaponId}`)
        next.weapon.fragmentBalances[weaponId] = (next.weapon.fragmentBalances[weaponId] ?? 0) + amount
      }
      if (Object.values(input.retainedWeaponFragments).some((amount) => amount > 0)) {
        next.weapon.version += 1
      }
      const goldGranted = tierGold(tier)
      next.wallet.gold += goldGranted
      const entitlementIds: string[] = []
      tierEntitlements(tier).forEach((kind, ordinal) => {
        const entitlementId = `ent:${settlementId}:${kind}:${ordinal}`
        const entitlement: PurchaseEntitlement = {
          entitlementId,
          playerId: input.playerId,
          sourceMatchId: input.matchId,
          kind,
          usesRemaining: 1,
          status: 'available',
          grantedAt: at,
        }
        next.entitlements[entitlementId] = entitlement
        entitlementIds.push(entitlementId)
      })
      let progressionUpdated = false
      if (input.officialVictory && input.stageSelection) {
        const stageKey = pveStageKey(input.stageSelection)
        const previousClear = next.pveProgress.clearsByStageKey[stageKey]
        if (previousClear && stableStringify(previousClear.selection) !== stableStringify(input.stageSelection)) {
          throw new AccountDomainError('INVALID_SETTLEMENT', `stored PVE clear ${stageKey} has a conflicting selection`)
        }
        next.pveProgress.clearsByStageKey[stageKey] = {
          stageKey,
          selection: clone(input.stageSelection),
          clearCount: (previousClear?.clearCount ?? 0) + 1,
          firstClearedAt: previousClear?.firstClearedAt ?? at,
          lastClearedAt: at,
        }
        next.pveProgress.version += 1
        progressionUpdated = true
      }
      const settlement: MatchPlayerSettlement = {
        settlementId,
        matchId: input.matchId,
        playerId: input.playerId,
        reason: input.reason,
        highestCompletedWave: input.highestCompletedWave,
        rewardTier: tier,
        retainedWeaponFragments: { ...input.retainedWeaponFragments },
        goldGranted,
        entitlementIds,
        ...(input.stageSelection ? { stageSelection: clone(input.stageSelection) } : {}),
        progressionUpdated,
        status: 'committed',
        committedAt: at,
        accountVersionAfter: current.version + 1,
      }
      next.settlementsById[settlementId] = settlement
      this.finishMutation(next, current.version, input.requestId, 'settle_match', fingerprint, settlement as unknown as JsonValue)
      if (await this.store.compareAndSwap(input.playerId, current.version, next)) return clone(settlement)
    }
    throw new AccountDomainError('ACCOUNT_WRITE_CONFLICT', 'settlement CAS retry budget exhausted')
  }

  async generateFixedOffers(input: GenerateOffersInput): Promise<FixedShopOfferSet> {
    if (!this.shopCatalog) {
      throw new AccountDomainError('NO_ELIGIBLE_SHOP_PRODUCTS', 'shop catalog provider is not configured')
    }
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const current = await this.getOrCreate(input.playerId)
      const entitlement = current.entitlements[input.entitlementId]
      this.assertAvailableEntitlement(entitlement, input.playerId)
      const existing = current.fixedOffersByEntitlementId[input.entitlementId]
      if (existing) return clone(existing)

      const eligible = this.shopCatalog.listEligibleProducts(entitlement.kind, current)
        .filter(product => product.entitlementKind === entitlement.kind)
      eligible.forEach(product => this.validateShopProduct(product, entitlement.kind))
      if (eligible.length < 3) {
        throw new AccountDomainError('NO_ELIGIBLE_SHOP_PRODUCTS', 'at least 3 eligible products are required; entitlement was preserved')
      }
      const ordered = this.pickOfferProducts(eligible, input.entitlementId, input.recentActiveGeneralIds ?? [])
      const at = nowIso()
      const offers = ordered.slice(0, 3).map((product, index): FixedShopOffer => ({
        offerId: `offer:${input.entitlementId}:${index}:${product.productId}`,
        entitlementId: input.entitlementId,
        productId: product.productId,
        entitlementKind: entitlement.kind,
        priceGold: product.priceGold,
        reward: clone(product.reward),
        metadata: clone(product.metadata ?? {}),
      })) as [FixedShopOffer, FixedShopOffer, FixedShopOffer]
      const set: FixedShopOfferSet = {
        entitlementId: input.entitlementId,
        generatedAt: at,
        seed: input.entitlementId,
        offers,
      }
      const next = clone(current)
      next.fixedOffersByEntitlementId[input.entitlementId] = set
      next.version = current.version + 1
      next.updatedAt = at
      if (await this.store.compareAndSwap(input.playerId, current.version, next)) return clone(set)
    }
    throw new AccountDomainError('ACCOUNT_WRITE_CONFLICT', 'offer generation CAS retry budget exhausted')
  }

  async purchaseOffer(input: PurchaseOfferInput): Promise<PurchaseOfferReceipt> {
    const fingerprint = stableStringify(input)
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const current = await this.getOrCreate(input.playerId)
      const replay = this.readIdempotent<PurchaseOfferReceipt>(current, input.requestId, 'purchase_offer', fingerprint)
      if (replay) return replay
      if (current.version !== input.expectedAccountVersion) {
        throw new AccountDomainError('STALE_ACCOUNT_VERSION', `expected ${input.expectedAccountVersion}, got ${current.version}`)
      }
      const entitlement = current.entitlements[input.entitlementId]
      this.assertAvailableEntitlement(entitlement, input.playerId)
      const offerSet = current.fixedOffersByEntitlementId[input.entitlementId]
      const offer = offerSet?.offers.find(candidate => candidate.offerId === input.offerId)
      if (!offer) throw new AccountDomainError('OFFER_NOT_FOUND', 'offer does not belong to this fixed entitlement offer set')
      if (current.wallet.gold < offer.priceGold) {
        throw new AccountDomainError('INSUFFICIENT_GOLD', 'insufficient out-of-match gold; entitlement was preserved')
      }

      const at = nowIso()
      const next = clone(current)
      this.applyShopReward(next, offer)
      next.wallet.gold -= offer.priceGold
      const nextEntitlement = next.entitlements[input.entitlementId]
      nextEntitlement.status = 'consumed'
      nextEntitlement.usesRemaining = 0
      nextEntitlement.consumedAt = at
      nextEntitlement.consumedByRequestId = input.requestId
      const receipt: PurchaseOfferReceipt = {
        requestId: input.requestId,
        entitlementId: input.entitlementId,
        offer: clone(offer),
        goldSpent: offer.priceGold,
        goldAfter: next.wallet.gold,
        accountVersionAfter: current.version + 1,
      }
      this.finishMutation(next, current.version, input.requestId, 'purchase_offer', fingerprint, receipt as unknown as JsonValue)
      if (await this.store.compareAndSwap(input.playerId, current.version, next)) return receipt
    }
    throw new AccountDomainError('ACCOUNT_WRITE_CONFLICT', 'purchase CAS retry budget exhausted')
  }

  async saveItemPayload(input: SaveSubsystemPayloadInput<ItemAccountPayload>): Promise<PlayerAccountRecord> {
    validateItemPayload(input.payload)
    return this.saveSubsystem(input, 'save_item_payload', next => { next.item = clone(input.payload) })
  }

  async saveWeaponPayload(input: SaveSubsystemPayloadInput<WeaponAccountPayload>): Promise<PlayerAccountRecord> {
    validateWeaponPayload(input.payload)
    return this.saveSubsystem(input, 'save_weapon_payload', next => { next.weapon = clone(input.payload) })
  }

  async createBuildSnapshot(
    input: CreateBuildSnapshotInput,
    resolver: MatchBuildDefinitionResolver,
  ): Promise<MatchBuildSnapshot> {
    const fingerprint = stableStringify(input)
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const current = await this.getOrCreate(input.playerId)
      const existing = current.buildSnapshotsByMatchId[input.matchId]
      if (existing) return clone(existing)
      this.assertIdempotencyAvailable(current, input.requestId, 'create_build_snapshot', fingerprint)
      if (current.version !== input.expectedAccountVersion) {
        throw new AccountDomainError('STALE_ACCOUNT_VERSION', `expected ${input.expectedAccountVersion}, got ${current.version}`)
      }
      const itemDefinitions = (ids: readonly (string | null)[], kind: 'active' | 'passive'): JsonObject[] => ids
        .filter((id): id is string => id !== null)
        .map(id => {
          const definition = resolver.resolveItem(id)
          if (!definition) throw new AccountDomainError('INVALID_ACCOUNT_MUTATION', `equipped ${kind} item ${id} cannot be resolved`)
          return clone(definition)
        })
      const byGeneralId: Record<string, {
        slots: readonly [string | null, string | null]
        resolvedDefinitions: readonly JsonObject[]
      }> = {}
      for (const [generalId, loadout] of Object.entries(current.weapon.loadoutsByGeneralId)) {
        byGeneralId[generalId] = {
          slots: clone(loadout.slots),
          resolvedDefinitions: loadout.slots
            .filter((id): id is string => id !== null)
            .map(id => {
              const definition = resolver.resolveWeapon(id)
              if (!definition) throw new AccountDomainError('INVALID_ACCOUNT_MUTATION', `equipped weapon ${id} cannot be resolved`)
              return clone(definition)
            }),
        }
      }
      const at = nowIso()
      const snapshot: MatchBuildSnapshot = {
        snapshotVersion: 1,
        snapshotId: `build:${input.matchId}:${input.playerId}`,
        matchId: input.matchId,
        playerId: input.playerId,
        accountVersion: current.version,
        createdAt: at,
        item: {
          accountVersion: current.item.version,
          activeSlots: clone(current.item.loadout.activeSlots),
          passiveSlots: clone(current.item.loadout.passiveSlots),
          resolvedActiveDefinitions: itemDefinitions(current.item.loadout.activeSlots, 'active'),
          resolvedPassiveDefinitions: itemDefinitions(current.item.loadout.passiveSlots, 'passive'),
        },
        weapon: { accountVersion: current.weapon.version, byGeneralId },
      }
      const next = clone(current)
      next.buildSnapshotsByMatchId[input.matchId] = snapshot
      this.finishMutation(next, current.version, input.requestId, 'create_build_snapshot', fingerprint, snapshot as unknown as JsonValue)
      if (await this.store.compareAndSwap(input.playerId, current.version, next)) return clone(snapshot)
    }
    throw new AccountDomainError('ACCOUNT_WRITE_CONFLICT', 'snapshot CAS retry budget exhausted')
  }

  private async saveSubsystem<T>(
    input: SaveSubsystemPayloadInput<T>,
    operation: string,
    mutate: (account: PlayerAccountRecord) => void,
  ): Promise<PlayerAccountRecord> {
    const fingerprint = stableStringify(input)
    const current = await this.getOrCreate(input.playerId)
    const stored = current.idempotencyByRequestId[input.requestId]
    if (stored) {
      this.assertIdempotencyAvailable(current, input.requestId, operation, fingerprint)
      return current
    }
    if (current.version !== input.expectedAccountVersion) {
      throw new AccountDomainError('STALE_ACCOUNT_VERSION', `expected ${input.expectedAccountVersion}, got ${current.version}`)
    }
    const next = clone(current)
    mutate(next)
    this.finishMutation(next, current.version, input.requestId, operation, fingerprint, {
      accountVersionAfter: current.version + 1,
      expectedAccountVersion: input.expectedAccountVersion,
      payload: clone(input.payload) as JsonValue,
      context: clone(input.idempotencyContext ?? {}),
    })
    if (!await this.store.compareAndSwap(input.playerId, current.version, next)) {
      throw new AccountDomainError('STALE_ACCOUNT_VERSION', 'account changed during save')
    }
    return next
  }

  private async migrateAccountIfNeeded(
    playerId: string,
    initial: PlayerAccountRecord,
  ): Promise<PlayerAccountRecord> {
    let current = initial
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const candidate = current as unknown as {
        playerId?: unknown
        schemaVersion?: unknown
        pveProgress?: unknown
        version?: unknown
        wallet?: unknown
      }
      if (candidate.playerId !== playerId || !Number.isSafeInteger(candidate.version)) {
        throw new AccountDomainError('INVALID_ACCOUNT_MUTATION', 'stored player account identity or version is invalid')
      }
      const wallet = candidate.wallet as { gold?: unknown; honor?: unknown } | undefined
      const hasValidPveProgress = isPveProgressPayload(candidate.pveProgress)
      if (candidate.schemaVersion === PLAYER_ACCOUNT_SCHEMA_VERSION
        && hasValidPveProgress
        && Number.isSafeInteger(wallet?.gold)
        && Number.isSafeInteger(wallet?.honor)
        && (wallet?.gold as number) >= 0
        && (wallet?.honor as number) >= 0) {
        return current
      }

      // V1 关卡进度由客户端自报且关卡语义已变更，故不迁移；
      // 金币、道具、武器与已提交结算单均原样保留。
      const next = clone(current)
      next.schemaVersion = PLAYER_ACCOUNT_SCHEMA_VERSION
      const legacyWallet = (next.wallet ?? { gold: 0 }) as { gold?: unknown; honor?: unknown }
      next.wallet = {
        gold: Number.isSafeInteger(legacyWallet.gold) && (legacyWallet.gold as number) >= 0 ? legacyWallet.gold as number : 0,
        honor: Number.isSafeInteger(legacyWallet.honor) && (legacyWallet.honor as number) >= 0 ? legacyWallet.honor as number : 0,
      }
      // Older schema progress was client-authored and is intentionally not
      // trusted; only preserve a valid payload when upgrading the current
      // schema for the additive honor-wallet field.
      if (candidate.schemaVersion !== PLAYER_ACCOUNT_SCHEMA_VERSION || !hasValidPveProgress) {
        next.pveProgress = createDefaultPveProgress()
      }
      for (const settlement of Object.values(next.settlementsById)) {
        if (typeof settlement.progressionUpdated !== 'boolean') settlement.progressionUpdated = false
      }
      next.version = current.version + 1
      next.updatedAt = nowIso()
      if (await this.store.compareAndSwap(playerId, current.version, next)) return next
      const reloaded = await this.store.get(playerId)
      if (!reloaded) throw new AccountDomainError('ACCOUNT_NOT_FOUND', 'player account disappeared during migration')
      current = reloaded
    }
    throw new AccountDomainError('ACCOUNT_WRITE_CONFLICT', 'account migration CAS retry budget exhausted')
  }

  private pickOfferProducts(
    products: readonly ShopProduct[],
    seed: string,
    recentActiveGeneralIds: readonly string[],
  ): ShopProduct[] {
    const recent = new Set(recentActiveGeneralIds)
    const preferred = seededOrder(
      products.filter(product => product.affinityGeneralIds?.some(id => recent.has(id))),
      `${seed}:preferred`,
      product => product.productId,
    )
    const first = preferred[0]
    const remainder = seededOrder(
      products.filter(product => product.productId !== first?.productId),
      `${seed}:all`,
      product => product.productId,
    )
    return first ? [first, ...remainder] : remainder
  }

  private applyShopReward(account: PlayerAccountRecord, offer: FixedShopOffer): void {
    const reward = offer.reward
    switch (reward.type) {
      case 'unlock_active_item':
        if (account.item.unlockedActiveItemIds.includes(reward.itemId)) {
          throw new AccountDomainError('SHOP_REWARD_CONFLICT', 'active item is already unlocked; entitlement was preserved')
        }
        account.item.unlockedActiveItemIds.push(reward.itemId)
        account.item.version += 1
        return
      case 'unlock_passive_item':
        if (account.item.unlockedPassiveItemIds.includes(reward.itemId)) {
          throw new AccountDomainError('SHOP_REWARD_CONFLICT', 'passive item is already unlocked; entitlement was preserved')
        }
        account.item.unlockedPassiveItemIds.push(reward.itemId)
        account.item.version += 1
        return
      case 'weapon_fragment':
        if (!Number.isSafeInteger(reward.amount) || reward.amount <= 0) {
          throw new AccountDomainError('SHOP_REWARD_CONFLICT', 'invalid weapon fragment reward')
        }
        account.weapon.fragmentBalances[reward.weaponId] = (account.weapon.fragmentBalances[reward.weaponId] ?? 0) + reward.amount
        account.weapon.version += 1
    }
  }

  private validateShopProduct(product: ShopProduct, kind: PurchaseEntitlementKind): void {
    if (!product.productId || !Number.isSafeInteger(product.priceGold) || product.priceGold < 0) {
      throw new AccountDomainError('NO_ELIGIBLE_SHOP_PRODUCTS', 'shop catalog returned an invalid product')
    }
    const reward = product.reward
    const matches = kind === 'active_item'
      ? reward.type === 'unlock_active_item'
      : kind === 'passive_item'
        ? reward.type === 'unlock_passive_item'
        : reward.type === 'weapon_fragment'
          && (kind === 'low_tier_weapon_fragment'
            ? reward.quality === 'green' || reward.quality === 'blue'
            : reward.quality === 'purple' || reward.quality === 'orange' || reward.quality === 'red')
    if (!matches) {
      throw new AccountDomainError('NO_ELIGIBLE_SHOP_PRODUCTS', `product ${product.productId} reward does not match ${kind}`)
    }
  }

  private assertAvailableEntitlement(entitlement: PurchaseEntitlement | undefined, playerId: string): asserts entitlement is PurchaseEntitlement {
    if (!entitlement || entitlement.playerId !== playerId) {
      throw new AccountDomainError('INVALID_ENTITLEMENT', 'entitlement does not exist for this player')
    }
    if (entitlement.status !== 'available' || entitlement.usesRemaining !== 1) {
      throw new AccountDomainError('ENTITLEMENT_ALREADY_CONSUMED', 'entitlement is already consumed')
    }
  }

  private assertIdempotencyAvailable(
    account: PlayerAccountRecord,
    requestId: string,
    operation: string,
    fingerprint: string,
  ): void {
    const stored = account.idempotencyByRequestId[requestId]
    if (stored && (stored.operation !== operation || stored.fingerprint !== fingerprint)) {
      throw new AccountDomainError('REQUEST_ID_CONFLICT', 'requestId was already used with a different payload')
    }
  }

  private readIdempotent<T>(
    account: PlayerAccountRecord,
    requestId: string,
    operation: string,
    fingerprint: string,
  ): T | null {
    const stored = account.idempotencyByRequestId[requestId]
    if (!stored) return null
    if (stored.operation !== operation || stored.fingerprint !== fingerprint) {
      throw new AccountDomainError('REQUEST_ID_CONFLICT', 'requestId was already used with a different payload')
    }
    return clone(stored.result) as T
  }

  private finishMutation(
    next: PlayerAccountRecord,
    previousVersion: number,
    requestId: string,
    operation: string,
    fingerprint: string,
    result: JsonValue,
  ): void {
    const at = nowIso()
    next.version = previousVersion + 1
    next.updatedAt = at
    next.idempotencyByRequestId[requestId] = { requestId, operation, fingerprint, result: clone(result), createdAt: at }
  }
}
