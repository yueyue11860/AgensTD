"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryWeaponCommerceService = void 0;
exports.rollBossWeaponDrops = rollBossWeaponDrops;
exports.generateWeaponShopOffers = generateWeaponShopOffers;
exports.validateGeneralIds = validateGeneralIds;
const roster_1 = require("../core/hero-v1/roster");
const catalog_1 = require("./catalog");
const types_1 = require("./types");
const BOSS_DROP_TABLE = {
    5: { count: 1, weights: [['green', 7500], ['blue', 2500]] },
    10: { count: 1, weights: [['green', 3000], ['blue', 4500], ['purple', 2500]] },
    15: { count: 1, weights: [['blue', 1500], ['purple', 4500], ['orange', 3000], ['red', 1000]] },
    20: { count: 2, weights: [['purple', 3000], ['orange', 4000], ['red', 3000]] },
};
const hashSeed = (seed) => {
    let hash = 2166136261;
    for (let index = 0; index < seed.length; index += 1) {
        hash ^= seed.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0 || 0x9e3779b9;
};
class DeterministicRandom {
    state;
    constructor(seed) { this.state = hashSeed(seed); }
    nextInt(maxExclusive) {
        if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0)
            throw new Error('maxExclusive must be positive');
        let value = this.state;
        value ^= value << 13;
        value ^= value >>> 17;
        value ^= value << 5;
        this.state = value >>> 0;
        return this.state % maxExclusive;
    }
}
const weightedQuality = (random, weights) => {
    const total = weights.reduce((sum, entry) => sum + entry[1], 0);
    let roll = random.nextInt(total);
    for (const [quality, weight] of weights) {
        if (roll < weight)
            return quality;
        roll -= weight;
    }
    return weights[weights.length - 1][0];
};
const weaponCandidates = (quality, activatedGeneralIds, discoveredGeneralIds, unlockedWeaponIds) => {
    const discovered = new Set([...activatedGeneralIds, ...discoveredGeneralIds]);
    const unlocked = new Set(unlockedWeaponIds);
    const eligible = catalog_1.WEAPON_CATALOG.filter((weapon) => weapon.quality === quality
        && (!weapon.compatibility.exclusiveGeneralId || discovered.has(weapon.compatibility.exclusiveGeneralId)));
    const preferred = eligible.filter((weapon) => !unlocked.has(weapon.weaponId)
        && activatedGeneralIds.some((generalId) => (0, catalog_1.isWeaponCompatible)(weapon, generalId)));
    if (preferred.length)
        return preferred;
    const otherLocked = eligible.filter((weapon) => !unlocked.has(weapon.weaponId));
    return otherLocked.length ? otherLocked : eligible;
};
function rollBossWeaponDrops(input) {
    validateGeneralIds(input.activatedGeneralIds);
    validateGeneralIds(input.discoveredGeneralIds);
    const table = BOSS_DROP_TABLE[input.bossWave];
    const random = new DeterministicRandom(`${input.matchSeed}:${input.playerId}:${input.bossKillSequence}`);
    const drops = [];
    for (let dropIndex = 0; dropIndex < table.count; dropIndex += 1) {
        const quality = weightedQuality(random, table.weights);
        const candidates = weaponCandidates(quality, input.activatedGeneralIds, input.discoveredGeneralIds, input.unlockedWeaponIds);
        if (!candidates.length)
            throw new Error(`No eligible ${quality} weapon drop candidates`);
        const weapon = candidates[random.nextInt(candidates.length)];
        drops.push({ dropIndex, weaponId: weapon.weaponId, quality, amount: 1 });
    }
    return drops;
}
const PRICE_BY_QUALITY = {
    green: 5, blue: 10, purple: 15, orange: 25, red: 40,
};
const SHOP_QUALITY_WEIGHTS = {
    low_tier_weapon_fragment: [['green', 55], ['blue', 45]],
    high_tier_weapon_fragment: [['purple', 40], ['orange', 35], ['red', 25]],
};
function generateWeaponShopOffers(input) {
    validateGeneralIds(input.activatedGeneralIds);
    validateGeneralIds(input.discoveredGeneralIds);
    const random = new DeterministicRandom(`weapon-shop:${input.entitlementId}`);
    const selected = new Set();
    const offers = [];
    for (let offerIndex = 0; offerIndex < 3; offerIndex += 1) {
        const quality = weightedQuality(random, SHOP_QUALITY_WEIGHTS[input.entitlementType]);
        let candidates = weaponCandidates(quality, offerIndex === 0 ? input.activatedGeneralIds : [], input.discoveredGeneralIds, input.unlockedWeaponIds)
            .filter((weapon) => !selected.has(weapon.weaponId));
        if (!candidates.length) {
            const allowedQualities = new Set(SHOP_QUALITY_WEIGHTS[input.entitlementType].map(([entry]) => entry));
            candidates = catalog_1.WEAPON_CATALOG.filter((weapon) => allowedQualities.has(weapon.quality) && !selected.has(weapon.weaponId));
        }
        if (!candidates.length)
            throw new Error(`Unable to generate three offers for ${input.entitlementId}`);
        const weapon = candidates[random.nextInt(candidates.length)];
        selected.add(weapon.weaponId);
        offers.push({ offerId: `${input.entitlementId}:${offerIndex}`, weaponId: weapon.weaponId, quality: weapon.quality, fragmentAmount: 1, priceGold: PRICE_BY_QUALITY[weapon.quality] });
    }
    return offers;
}
class InMemoryWeaponCommerceService {
    accounts;
    goldByPlayerId = new Map();
    entitlementById = new Map();
    purchaseReceipts = new Map();
    constructor(accounts) {
        this.accounts = accounts;
    }
    setGold(playerId, amount) {
        if (!Number.isSafeInteger(amount) || amount < 0)
            throw new Error('Gold must be a non-negative safe integer');
        this.goldByPlayerId.set(playerId, amount);
    }
    getGold(playerId) { return this.goldByPlayerId.get(playerId) ?? 0; }
    grantEntitlement(input) {
        if (this.entitlementById.has(input.entitlementId))
            throw new types_1.WeaponDomainError('INVALID_PURCHASE_ENTITLEMENT', `Duplicate entitlement ${input.entitlementId}`);
        this.entitlementById.set(input.entitlementId, { ...input, consumed: false });
    }
    getOffers(playerId, entitlementId) {
        const entitlement = this.requireEntitlement(playerId, entitlementId);
        if (!entitlement.offers)
            entitlement.offers = generateWeaponShopOffers(entitlement);
        return JSON.parse(JSON.stringify(entitlement.offers));
    }
    purchase(request) {
        const fingerprint = JSON.stringify(request);
        const receiptKey = `${request.playerId}:${request.requestId}`;
        const existing = this.purchaseReceipts.get(receiptKey);
        if (existing) {
            if (existing.fingerprint !== fingerprint)
                throw new types_1.WeaponDomainError('REQUEST_ID_CONFLICT', 'Purchase requestId payload mismatch');
            return { ...existing.result };
        }
        const entitlement = this.requireEntitlement(request.playerId, request.entitlementId);
        const offer = this.getOffers(request.playerId, request.entitlementId).find((candidate) => candidate.offerId === request.offerId);
        if (!offer)
            throw new types_1.WeaponDomainError('OFFER_NOT_FOUND', `Unknown offer ${request.offerId}`);
        const gold = this.getGold(request.playerId);
        if (gold < offer.priceGold)
            throw new types_1.WeaponDomainError('INSUFFICIENT_GOLD', `Requires ${offer.priceGold} gold`);
        const account = this.accounts.getAccount(request.playerId);
        this.accounts.creditFragments({
            requestId: `purchase-credit:${request.entitlementId}`,
            playerId: request.playerId,
            fragments: { [offer.weaponId]: offer.fragmentAmount },
            expectedAccountVersion: account.version,
        });
        this.goldByPlayerId.set(request.playerId, gold - offer.priceGold);
        entitlement.consumed = true;
        const result = { weaponId: offer.weaponId, fragmentAmount: 1, spentGold: offer.priceGold, remainingGold: gold - offer.priceGold };
        this.purchaseReceipts.set(receiptKey, { fingerprint, result });
        return { ...result };
    }
    requireEntitlement(playerId, entitlementId) {
        const entitlement = this.entitlementById.get(entitlementId);
        if (!entitlement || entitlement.playerId !== playerId || entitlement.consumed)
            throw new types_1.WeaponDomainError('INVALID_PURCHASE_ENTITLEMENT', `Invalid entitlement ${entitlementId}`);
        return entitlement;
    }
}
exports.InMemoryWeaponCommerceService = InMemoryWeaponCommerceService;
function validateGeneralIds(generalIds) {
    for (const generalId of generalIds)
        if (!(0, roster_1.getGeneralRosterEntry)(generalId))
            throw new Error(`Unknown generalId ${generalId}`);
}
