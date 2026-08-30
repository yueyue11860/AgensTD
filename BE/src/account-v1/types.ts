import type { PveStageKey, PveStageSelection } from '../../../shared/contracts/pve-stage-config'
import type { GeneralUnlockState } from '../../../shared/contracts/general'

export const PLAYER_ACCOUNT_SCHEMA_VERSION = 3 as const

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export interface JsonObject {
  [key: string]: JsonValue
}

export type PurchaseEntitlementKind =
  | 'passive_item'
  | 'active_item'
  | 'low_tier_weapon_fragment'
  | 'high_tier_weapon_fragment'

export type SettlementReason = 'defeat' | 'voluntary_exit' | 'disconnect_exit' | 'victory'
export type SettlementRewardTier =
  | 'wave_0_4'
  | 'wave_5_9'
  | 'wave_10_14'
  | 'wave_15_19'
  | 'victory'

export interface PurchaseEntitlement {
  entitlementId: string
  playerId: string
  sourceMatchId: string
  kind: PurchaseEntitlementKind
  usesRemaining: 0 | 1
  status: 'available' | 'consumed'
  grantedAt: string
  consumedAt?: string
  consumedByRequestId?: string
}

export interface ItemAccountPayload {
  /** 道具专项自身版本，与外层账户 CAS 版本分离。 */
  version: number
  unlockedActiveItemIds: string[]
  unlockedPassiveItemIds: string[]
  loadout: {
    activeSlots: [string | null, string | null]
    passiveSlots: [
      string | null,
      string | null,
      string | null,
      string | null,
      string | null,
      string | null,
    ]
    version: number
    updatedAt: string
  }
  /** 保留给道具专项的扩展字段。 */
  extensions: JsonObject
}

export interface WeaponAccountPayload {
  /** 武器专项自身版本，与外层账户 CAS 版本分离。 */
  version: number
  fragmentBalances: Record<string, number>
  unlockedWeaponIds: string[]
  loadoutsByGeneralId: Record<string, {
    slots: [string | null, string | null]
    version: number
    updatedAt: string
  }>
  /** 保留给武器专项的扩展字段。 */
  extensions: JsonObject
}

export interface PveStageClearRecord {
  stageKey: PveStageKey
  selection: PveStageSelection
  clearCount: number
  firstClearedAt: string
  lastClearedAt: string
}

/**
 * 只持久化权威胜利事实，解锁矩阵由纯函数派生。
 * 这样调整解锁规则时不需要批量回写玩家账户。
 */
export interface PveProgressPayload {
  version: number
  clearsByStageKey: Partial<Record<PveStageKey, PveStageClearRecord>>
}

export type ShopReward =
  | { type: 'unlock_active_item'; itemId: string }
  | { type: 'unlock_passive_item'; itemId: string }
  | { type: 'weapon_fragment'; weaponId: string; amount: number; quality: 'green' | 'blue' | 'purple' | 'orange' | 'red' }

/** 只能由服务端目录提供器生成，不接受客户端传入价格或奖励。 */
export interface ShopProduct {
  productId: string
  entitlementKind: PurchaseEntitlementKind
  priceGold: number
  reward: ShopReward
  /** 用于武器候选优先适配上一局激活过的神将。 */
  affinityGeneralIds?: readonly string[]
  metadata?: JsonObject
}

export interface FixedShopOffer {
  offerId: string
  entitlementId: string
  productId: string
  entitlementKind: PurchaseEntitlementKind
  priceGold: number
  reward: ShopReward
  metadata: JsonObject
}

export interface FixedShopOfferSet {
  entitlementId: string
  generatedAt: string
  seed: string
  offers: [FixedShopOffer, FixedShopOffer, FixedShopOffer]
}

export interface MatchPlayerSettlement {
  settlementId: string
  matchId: string
  playerId: string
  reason: SettlementReason
  highestCompletedWave: number
  /**
   * Highest wave actually entered by the player.  This is optional so
   * settlements written before encounter tracking was introduced remain
   * readable; the account service derives a conservative legacy fallback.
   */
  highestEncounteredWave?: number
  rewardTier: SettlementRewardTier
  retainedWeaponFragments: Record<string, number>
  goldGranted: number
  entitlementIds: string[]
  stageSelection?: PveStageSelection
  progressionUpdated: boolean
  status: 'committed'
  committedAt: string
  accountVersionAfter: number
}

export interface MatchBuildSnapshot {
  snapshotVersion: 1
  snapshotId: string
  matchId: string
  playerId: string
  accountVersion: number
  createdAt: string
  /** 神将解锁与本局预选池快照；旧快照缺失时运行时回退全量目录。 */
  unlockedGeneralIds?: readonly string[]
  selectedGeneralIds?: readonly string[]
  item: {
    accountVersion: number
    activeSlots: readonly [string | null, string | null]
    passiveSlots: readonly [
      string | null,
      string | null,
      string | null,
      string | null,
      string | null,
      string | null,
    ]
    resolvedActiveDefinitions: readonly JsonObject[]
    resolvedPassiveDefinitions: readonly JsonObject[]
  }
  weapon: {
    accountVersion: number
    byGeneralId: Readonly<Record<string, {
      slots: readonly [string | null, string | null]
      resolvedDefinitions: readonly JsonObject[]
    }>>
  }
}

export interface StoredIdempotencyResult {
  requestId: string
  operation: string
  fingerprint: string
  result: JsonValue
  createdAt: string
}

export interface PlayerAccountRecord {
  schemaVersion: typeof PLAYER_ACCOUNT_SCHEMA_VERSION
  playerId: string
  version: number
  /** Persistent out-of-match currencies. Honor is the PVP reward currency. */
  wallet: { gold: number; honor: number }
  entitlements: Record<string, PurchaseEntitlement>
  fixedOffersByEntitlementId: Record<string, FixedShopOfferSet>
  settlementsById: Record<string, MatchPlayerSettlement>
  buildSnapshotsByMatchId: Record<string, MatchBuildSnapshot>
  idempotencyByRequestId: Record<string, StoredIdempotencyResult>
  item: ItemAccountPayload
  weapon: WeaponAccountPayload
  pveProgress: PveProgressPayload
  /** Durable general unlocks; migrated from legacy accounts on first read. */
  generalUnlock: GeneralUnlockState
  createdAt: string
  updatedAt: string
}

export type AccountErrorCode =
  | 'ACCOUNT_NOT_FOUND'
  | 'STALE_ACCOUNT_VERSION'
  | 'REQUEST_ID_CONFLICT'
  | 'INVALID_SETTLEMENT'
  | 'INVALID_ENTITLEMENT'
  | 'ENTITLEMENT_ALREADY_CONSUMED'
  | 'NO_ELIGIBLE_SHOP_PRODUCTS'
  | 'OFFER_NOT_FOUND'
  | 'INSUFFICIENT_GOLD'
  | 'SHOP_REWARD_CONFLICT'
  | 'INVALID_ACCOUNT_MUTATION'
  | 'ACCOUNT_WRITE_CONFLICT'

export class AccountDomainError extends Error {
  constructor(readonly code: AccountErrorCode, message: string) {
    super(message)
    this.name = 'AccountDomainError'
  }
}

export interface AccountShopCatalogProvider {
  listEligibleProducts(
    kind: PurchaseEntitlementKind,
    account: Readonly<PlayerAccountRecord>,
  ): readonly ShopProduct[]
}

export interface MatchBuildDefinitionResolver {
  resolveItem(itemId: string): JsonObject | null
  resolveWeapon(weaponId: string): JsonObject | null
}
