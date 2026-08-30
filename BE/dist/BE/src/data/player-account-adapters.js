"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACCOUNT_CATALOGS = exports.V1MatchBuildDefinitionResolver = exports.V1AccountShopCatalog = void 0;
exports.buildEncyclopediaCatalog = buildEncyclopediaCatalog;
const catalog_1 = require("../core/hero-v1/catalog");
const roster_1 = require("../core/hero-v1/roster");
const catalog_2 = require("../item-v1/catalog");
const catalog_3 = require("../weapon-v1/catalog");
const catalogs_1 = require("../pve-v2/catalogs");
const boss_catalog_1 = require("../pve-v2/boss-catalog");
const encyclopedia_1 = require("../../../shared/contracts/encyclopedia");
/** Player-facing surfaces may only advertise effects the runtime actually consumes. */
const RELEASED_WEAPONS = catalog_3.WEAPON_CATALOG.filter((weapon) => weapon.status === 'released');
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
        return RELEASED_WEAPONS
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
        const definition = RELEASED_WEAPONS.find(weapon => weapon.weaponId === weaponId);
        return definition ? toJsonObject(definition) : null;
    }
}
exports.V1MatchBuildDefinitionResolver = V1MatchBuildDefinitionResolver;
exports.ACCOUNT_CATALOGS = Object.freeze({
    items: catalog_2.ITEM_DEFINITIONS,
    weapons: RELEASED_WEAPONS,
    generals: Object.values(catalog_1.GENERAL_CATALOG),
});
/**
 * Build the account-scoped encyclopedia projection.  Definitions are copied
 * from the same authoritative catalogs used by runtime/shop code; unlock state
 * is an additive field so legacy `/account.catalogs` consumers remain intact.
 */
function buildEncyclopediaCatalog(account) {
    const unlockedGenerals = new Set(account.generalUnlock.unlockedGeneralIds);
    const unlockedActiveItems = new Set(account.item.unlockedActiveItemIds);
    const unlockedPassiveItems = new Set(account.item.unlockedPassiveItemIds);
    const unlockedWeapons = new Set(account.weapon.unlockedWeaponIds);
    const generals = Object.values(catalog_1.GENERAL_CATALOG).map((definition) => ({
        ...definition,
        unlocked: unlockedGenerals.has(definition.generalId),
    }));
    const items = catalog_2.ITEM_DEFINITIONS.map((definition) => ({
        ...definition,
        unlocked: definition.itemKind === 'active'
            ? unlockedActiveItems.has(definition.itemId)
            : unlockedPassiveItems.has(definition.itemId),
    }));
    // The encyclopedia is a complete catalog view (including definitions in
    // testing status); account/shop surfaces continue to use RELEASED_WEAPONS.
    const weapons = catalog_3.WEAPON_CATALOG.map((definition) => ({
        ...definition,
        unlocked: unlockedWeapons.has(definition.weaponId),
    }));
    // Encounter unlocks are derived from durable match settlements instead of
    // being accepted from the client.  This keeps the encyclopedia deterministic
    // and makes old accounts forward compatible with the new field.
    const encounteredWaves = new Set();
    const encounteredBosses = new Set();
    const addEncounter = (stageSelection, highestCompletedWave, highestEncounteredWave, reason) => {
        const wave = highestEncounteredWave
            ?? (reason === 'victory' ? 20 : Math.min(20, highestCompletedWave + 1));
        if (!Number.isSafeInteger(wave) || wave < 0)
            return;
        for (let number = 1; number <= Math.min(20, wave); number += 1)
            encounteredWaves.add(number);
        if (!stageSelection)
            return;
        boss_catalog_1.BOSS_DEFINITIONS
            .filter(definition => definition.levelId === stageSelection.levelId && definition.waveNumber <= wave)
            .forEach(definition => encounteredBosses.add(definition.bossDefinitionId));
    };
    Object.values(account.settlementsById).forEach((settlement) => {
        addEncounter(settlement.stageSelection, settlement.highestCompletedWave, settlement.highestEncounteredWave, settlement.reason);
    });
    // A stage clear is an authoritative legacy progression fact and implies the
    // player completed its final wave, even if the original settlement record
    // was compacted or predates encounter tracking.
    Object.values(account.pveProgress.clearsByStageKey).forEach((clear) => {
        if (!clear)
            return;
        addEncounter(clear.selection, 20, 20, 'victory');
    });
    // The wave catalog is the authoritative ordinary-monster encyclopedia;
    // summoned soldier archetypes are friendly units and are intentionally not
    // mixed into the monster list.
    const minions = catalogs_1.WAVE_MINION_CATALOG.map((definition) => ({
        ...definition,
        entryId: `wave:${definition.waveNumber}`,
        kind: 'wave_minion',
        displayName: `第${definition.waveNumber}波怪物`,
        unlocked: encounteredWaves.has(definition.waveNumber),
    }));
    const bosses = boss_catalog_1.BOSS_DEFINITIONS.map((definition) => ({
        ...definition,
        entryId: definition.bossDefinitionId,
        unlocked: encounteredBosses.has(definition.bossDefinitionId),
    }));
    return {
        schemaVersion: encyclopedia_1.ENCYCLOPEDIA_SCHEMA_VERSION,
        catalogVersion: encyclopedia_1.ENCYCLOPEDIA_CATALOG_VERSION,
        generals,
        items,
        weapons,
        minions,
        bosses,
    };
}
