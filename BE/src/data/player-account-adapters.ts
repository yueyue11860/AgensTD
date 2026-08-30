import type {
  AccountShopCatalogProvider,
  JsonObject,
  MatchBuildDefinitionResolver,
  PlayerAccountRecord,
  PurchaseEntitlementKind,
  ShopProduct,
} from '../account-v1/types'
import { GENERAL_CATALOG } from '../core/hero-v1/catalog'
import { GENERAL_ROSTER } from '../core/hero-v1/roster'
import { ITEM_DEFINITIONS } from '../item-v1/catalog'
import { WEAPON_CATALOG } from '../weapon-v1/catalog'
import { WAVE_MINION_CATALOG } from '../pve-v2/catalogs'
import { BOSS_DEFINITIONS } from '../pve-v2/boss-catalog'
import {
  ENCYCLOPEDIA_CATALOG_VERSION,
  ENCYCLOPEDIA_SCHEMA_VERSION,
  type EncyclopediaCatalogPayload,
} from '../../../shared/contracts/encyclopedia'

/** Player-facing surfaces may only advertise effects the runtime actually consumes. */
const RELEASED_WEAPONS = WEAPON_CATALOG.filter((weapon) => weapon.status === 'released')

function toJsonObject(value: unknown): JsonObject {
  return structuredClone(value) as JsonObject
}

const WEAPON_FRAGMENT_PRICES = {
  green: 5,
  blue: 10,
  purple: 15,
  orange: 25,
  red: 40,
} as const

/** 聚合账户的商店候选仅来自服务端权威目录。 */
export class V1AccountShopCatalog implements AccountShopCatalogProvider {
  listEligibleProducts(
    kind: PurchaseEntitlementKind,
    account: Readonly<PlayerAccountRecord>,
  ): readonly ShopProduct[] {
    if (kind === 'active_item' || kind === 'passive_item') {
      const itemKind = kind === 'active_item' ? 'active' : 'passive'
      const unlocked = new Set(itemKind === 'active'
        ? account.item.unlockedActiveItemIds
        : account.item.unlockedPassiveItemIds)
      return ITEM_DEFINITIONS
        .filter(item => item.itemKind === itemKind && !unlocked.has(item.itemId))
        .map(item => ({
          productId: `item:${item.itemId}`,
          entitlementKind: kind,
          priceGold: 10,
          reward: item.itemKind === 'active'
            ? { type: 'unlock_active_item' as const, itemId: item.itemId }
            : { type: 'unlock_passive_item' as const, itemId: item.itemId },
          metadata: {
            name: item.name,
            iconKey: item.ui.iconKey,
            description: item.ui.shortDescription,
          },
        }))
    }

    const lowTier = kind === 'low_tier_weapon_fragment'
    return RELEASED_WEAPONS
      .filter(weapon => lowTier
        ? weapon.quality === 'green' || weapon.quality === 'blue'
        : weapon.quality === 'purple' || weapon.quality === 'orange' || weapon.quality === 'red')
      .map(weapon => ({
        productId: `weapon-fragment:${weapon.weaponId}`,
        entitlementKind: kind,
        priceGold: WEAPON_FRAGMENT_PRICES[weapon.quality],
        reward: {
          type: 'weapon_fragment' as const,
          weaponId: weapon.weaponId,
          amount: 1,
          quality: weapon.quality,
        },
        affinityGeneralIds: weapon.compatibility.exclusiveGeneralId
          ? [weapon.compatibility.exclusiveGeneralId]
          : [
              ...(weapon.compatibility.allowedGeneralIds ?? []),
              ...GENERAL_ROSTER
                .filter(general => weapon.compatibility.allowedArchetypes?.includes(general.profession))
                .map(general => general.generalId),
            ],
        metadata: {
          name: weapon.name,
          iconKey: weapon.ui.iconKey,
          description: weapon.ui.shortDescription,
        },
      }))
  }
}

export class V1MatchBuildDefinitionResolver implements MatchBuildDefinitionResolver {
  resolveItem(itemId: string): JsonObject | null {
    const definition = ITEM_DEFINITIONS.find(item => item.itemId === itemId)
    return definition ? toJsonObject(definition) : null
  }

  resolveWeapon(weaponId: string): JsonObject | null {
    const definition = RELEASED_WEAPONS.find(weapon => weapon.weaponId === weaponId)
    return definition ? toJsonObject(definition) : null
  }
}

export const ACCOUNT_CATALOGS = Object.freeze({
  items: ITEM_DEFINITIONS,
  weapons: RELEASED_WEAPONS,
  generals: Object.values(GENERAL_CATALOG),
})

/**
 * Build the account-scoped encyclopedia projection.  Definitions are copied
 * from the same authoritative catalogs used by runtime/shop code; unlock state
 * is an additive field so legacy `/account.catalogs` consumers remain intact.
 */
export function buildEncyclopediaCatalog(account: Readonly<PlayerAccountRecord>): EncyclopediaCatalogPayload {
  const unlockedGenerals = new Set(account.generalUnlock.unlockedGeneralIds)
  const unlockedActiveItems = new Set(account.item.unlockedActiveItemIds)
  const unlockedPassiveItems = new Set(account.item.unlockedPassiveItemIds)
  const unlockedWeapons = new Set(account.weapon.unlockedWeaponIds)

  const generals = Object.values(GENERAL_CATALOG).map((definition) => ({
    ...definition,
    unlocked: unlockedGenerals.has(definition.generalId),
  }))
  const items = ITEM_DEFINITIONS.map((definition) => ({
    ...definition,
    unlocked: definition.itemKind === 'active'
      ? unlockedActiveItems.has(definition.itemId)
      : unlockedPassiveItems.has(definition.itemId),
  }))
  // The encyclopedia is a complete catalog view (including definitions in
  // testing status); account/shop surfaces continue to use RELEASED_WEAPONS.
  const weapons = WEAPON_CATALOG.map((definition) => ({
    ...definition,
    unlocked: unlockedWeapons.has(definition.weaponId),
  }))

  // The wave catalog is the authoritative ordinary-monster encyclopedia;
  // summoned soldier archetypes are friendly units and are intentionally not
  // mixed into the monster list.
  const minions = WAVE_MINION_CATALOG.map((definition) => ({
    ...definition,
    entryId: `wave:${definition.waveNumber}`,
    kind: 'wave_minion' as const,
    displayName: `第${definition.waveNumber}波怪物`,
    unlocked: true,
  }))
  const bosses = BOSS_DEFINITIONS.map((definition) => ({
    ...definition,
    entryId: definition.bossDefinitionId,
    unlocked: true,
  }))

  return {
    schemaVersion: ENCYCLOPEDIA_SCHEMA_VERSION,
    catalogVersion: ENCYCLOPEDIA_CATALOG_VERSION,
    generals,
    items,
    weapons,
    minions,
    bosses,
  } as EncyclopediaCatalogPayload
}
