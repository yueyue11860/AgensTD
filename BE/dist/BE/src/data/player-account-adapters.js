"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACCOUNT_CATALOGS = exports.V1MatchBuildDefinitionResolver = exports.V1AccountShopCatalog = void 0;
const catalog_1 = require("../core/hero-v1/catalog");
const roster_1 = require("../core/hero-v1/roster");
const catalog_2 = require("../item-v1/catalog");
const catalog_3 = require("../weapon-v1/catalog");
function toJsonObject(value) {
    return structuredClone(value);
}
const WEAPON_FRAGMENT_PRICES = {
    green: 5,
    blue: 10,
    purple: 15,
    orange: 25,
    red: 40,
};
/** 聚合账户的商店候选仅来自服务端权威目录。 */
class V1AccountShopCatalog {
    listEligibleProducts(kind, account) {
        if (kind === 'active_item' || kind === 'passive_item') {
            const itemKind = kind === 'active_item' ? 'active' : 'passive';
            const unlocked = new Set(itemKind === 'active'
                ? account.item.unlockedActiveItemIds
                : account.item.unlockedPassiveItemIds);
            return catalog_2.ITEM_DEFINITIONS
                .filter(item => item.itemKind === itemKind && !unlocked.has(item.itemId))
                .map(item => ({
                productId: `item:${item.itemId}`,
                entitlementKind: kind,
                priceGold: 10,
                reward: item.itemKind === 'active'
                    ? { type: 'unlock_active_item', itemId: item.itemId }
                    : { type: 'unlock_passive_item', itemId: item.itemId },
                metadata: {
                    name: item.name,
                    iconKey: item.ui.iconKey,
                    description: item.ui.shortDescription,
                },
            }));
        }
        const lowTier = kind === 'low_tier_weapon_fragment';
        return catalog_3.WEAPON_CATALOG
            .filter(weapon => lowTier
            ? weapon.quality === 'green' || weapon.quality === 'blue'
            : weapon.quality === 'purple' || weapon.quality === 'orange' || weapon.quality === 'red')
            .map(weapon => ({
            productId: `weapon-fragment:${weapon.weaponId}`,
            entitlementKind: kind,
            priceGold: WEAPON_FRAGMENT_PRICES[weapon.quality],
            reward: {
                type: 'weapon_fragment',
                weaponId: weapon.weaponId,
                amount: 1,
                quality: weapon.quality,
            },
            affinityGeneralIds: weapon.compatibility.exclusiveGeneralId
                ? [weapon.compatibility.exclusiveGeneralId]
                : [
                    ...(weapon.compatibility.allowedGeneralIds ?? []),
                    ...roster_1.GENERAL_ROSTER
                        .filter(general => weapon.compatibility.allowedArchetypes?.includes(general.profession))
                        .map(general => general.generalId),
                ],
            metadata: {
                name: weapon.name,
                iconKey: weapon.ui.iconKey,
                description: weapon.ui.shortDescription,
            },
        }));
    }
}
exports.V1AccountShopCatalog = V1AccountShopCatalog;
class V1MatchBuildDefinitionResolver {
    resolveItem(itemId) {
        const definition = catalog_2.ITEM_DEFINITIONS.find(item => item.itemId === itemId);
        return definition ? toJsonObject(definition) : null;
    }
    resolveWeapon(weaponId) {
        const definition = catalog_3.WEAPON_CATALOG.find(weapon => weapon.weaponId === weaponId);
        return definition ? toJsonObject(definition) : null;
    }
}
exports.V1MatchBuildDefinitionResolver = V1MatchBuildDefinitionResolver;
exports.ACCOUNT_CATALOGS = Object.freeze({
    items: catalog_2.ITEM_DEFINITIONS,
    weapons: catalog_3.WEAPON_CATALOG,
    generals: Object.values(catalog_1.GENERAL_CATALOG),
});
