"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryWeaponCommerceService = exports.WAVE_MILESTONE_DROP_TABLE = exports.PVE_WEAPON_REWARD_TABLE_REVISION = void 0;
exports.rollWaveMilestoneWeaponDrops = rollWaveMilestoneWeaponDrops;
exports.rollHardVictoryExclusiveWeaponDrop = rollHardVictoryExclusiveWeaponDrop;
exports.rollBossFragmentBonusDrop = rollBossFragmentBonusDrop;
exports.rollBossWeaponDrops = rollBossWeaponDrops;
exports.generateWeaponShopOffers = generateWeaponShopOffers;
exports.validateGeneralIds = validateGeneralIds;
const roster_1 = require("../core/hero-v1/roster");
const catalog_1 = require("./catalog");
const types_1 = require("./types");
exports.PVE_WEAPON_REWARD_TABLE_REVISION = 'pve-weapon-reward-v1';
exports.WAVE_MILESTONE_DROP_TABLE = {
    easy: {
        5: { count: 1, weights: [['green', 8000], ['blue', 2000]] },
        10: { count: 1, weights: [['green', 5000], ['blue', 4000], ['purple', 1000]] },
        15: { count: 1, weights: [['green', 2500], ['blue', 5000], ['purple', 2500]] },
        20: { count: 2, weights: [['blue', 4500], ['purple', 5500]] },
    },
    normal: {
        5: { count: 1, weights: [['green', 4500], ['blue', 4500], ['purple', 1000]] },
        10: { count: 1, weights: [['blue', 3500], ['purple', 5000], ['orange', 1500]] },
        15: { count: 1, weights: [['blue', 1500], ['purple', 5000], ['orange', 3500]] },
        20: { count: 2, weights: [['purple', 4500], ['orange', 5500]] },
    },
    hard: {
        5: { count: 1, weights: [['blue', 2000], ['purple', 5000], ['orange', 2500], ['red', 500]] },
        10: { count: 1, weights: [['purple', 4000], ['orange', 4500], ['red', 1500]] },
        15: { count: 1, weights: [['purple', 2000], ['orange', 5000], ['red', 3000]] },
        20: { count: 2, weights: [['orange', 4500], ['red', 5500]] },
    },
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
const commonWeaponCandidates = (quality, activatedGeneralIds, weaponState) => {
    const unlocked = new Set(weaponState.unlockedWeaponIds);
    // 阶段掉落的红色也只进入四件通用红武池；专武只由困难胜利保底产生。
    const eligible = catalog_1.WEAPON_CATALOG.filter((weapon) => weapon.quality === quality
        && !weapon.compatibility.exclusiveGeneralId);
    const incomplete = (weapon) => !unlocked.has(weapon.weaponId)
        && (weaponState.fragmentBalances[weapon.weaponId] ?? 0) < weapon.fragmentRequirement;
    const compatible = (weapon) => activatedGeneralIds
        .some((generalId) => (0, catalog_1.isWeaponCompatible)(weapon, generalId));
    const preferredIncomplete = eligible.filter((weapon) => incomplete(weapon) && compatible(weapon));
    if (preferredIncomplete.length)
        return preferredIncomplete;
    const otherIncomplete = eligible.filter(incomplete);
    if (otherIncomplete.length)
        return otherIncomplete;
    const preferred = eligible.filter(compatible);
    return preferred.length ? preferred : eligible;
};
const exclusiveWeaponCandidates = (activatedGeneralIds, discoveredGeneralIds, weaponState) => {
    const active = new Set(activatedGeneralIds);
    const discovered = new Set([...activatedGeneralIds, ...discoveredGeneralIds]);
    const unlocked = new Set(weaponState.unlockedWeaponIds);
    const exclusives = catalog_1.WEAPON_CATALOG.filter((weapon) => Boolean(weapon.compatibility.exclusiveGeneralId));
    const incomplete = (weapon) => !unlocked.has(weapon.weaponId)
        && (weaponState.fragmentBalances[weapon.weaponId] ?? 0) < weapon.fragmentRequirement;
    const belongsTo = (weapon, generalIds) => {
        const generalId = weapon.compatibility.exclusiveGeneralId;
        return Boolean(generalId && generalIds.has(generalId));
    };
    const activeIncomplete = exclusives.filter((weapon) => belongsTo(weapon, active) && incomplete(weapon));
    if (activeIncomplete.length)
        return activeIncomplete;
    const activeLocked = exclusives.filter((weapon) => belongsTo(weapon, active) && !unlocked.has(weapon.weaponId));
    if (activeLocked.length)
        return activeLocked;
    const activeAny = exclusives.filter((weapon) => belongsTo(weapon, active));
    if (activeAny.length)
        return activeAny;
    const discoveredIncomplete = exclusives.filter((weapon) => belongsTo(weapon, discovered) && incomplete(weapon));
    if (discoveredIncomplete.length)
        return discoveredIncomplete;
    const anyIncomplete = exclusives.filter(incomplete);
    return anyIncomplete.length ? anyIncomplete : exclusives;
};
const shopWeaponCandidates = (quality, activatedGeneralIds, discoveredGeneralIds, unlockedWeaponIds) => {
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
function rollWaveMilestoneWeaponDrops(input) {
    validateRewardInput(input);
    const table = exports.WAVE_MILESTONE_DROP_TABLE[input.difficulty][input.milestone];
    const revision = input.rewardTableRevision ?? exports.PVE_WEAPON_REWARD_TABLE_REVISION;
    const random = new DeterministicRandom([
        revision,
        input.matchSeed,
        input.stageId,
        input.levelId,
        input.difficulty,
        input.playerId,
        `wave-${input.milestone}`,
    ].join(':'));
    const drops = [];
    for (let dropIndex = 0; dropIndex < table.count; dropIndex += 1) {
        const quality = weightedQuality(random, table.weights);
        const candidates = commonWeaponCandidates(quality, input.activatedGeneralIds, input.weaponState);
        if (!candidates.length)
            throw new Error(`No eligible common ${quality} weapon drop candidates`);
        const weapon = candidates[random.nextInt(candidates.length)];
        drops.push({ dropIndex, weaponId: weapon.weaponId, quality, amount: 1 });
    }
    return drops;
}
function rollHardVictoryExclusiveWeaponDrop(input) {
    validateRewardInput({ ...input, difficulty: 'hard', milestone: 20 });
    const revision = input.rewardTableRevision ?? exports.PVE_WEAPON_REWARD_TABLE_REVISION;
    const random = new DeterministicRandom([
        revision,
        input.matchSeed,
        input.stageId,
        input.levelId,
        'hard',
        input.playerId,
        'official-victory-exclusive',
    ].join(':'));
    const candidates = exclusiveWeaponCandidates(input.activatedGeneralIds, input.discoveredGeneralIds, input.weaponState);
    if (!candidates.length)
        throw new Error('No eligible exclusive red weapon drop candidates');
    const weapon = candidates[random.nextInt(candidates.length)];
    return { dropIndex: 0, weaponId: weapon.weaponId, quality: 'red', amount: 1 };
}
/**
 * Boss 个人掉落后的同品质额外抽取。概率和候选均由服务端冻结快照决定，
 * 独立随机流保证是否触发不会改变基础掉落结果。
 */
function rollBossFragmentBonusDrop(input) {
    validateRewardInput(input);
    if (!Number.isInteger(input.chanceBps) || input.chanceBps < 0 || input.chanceBps > 10_000) {
        throw new Error('Boss fragment bonus chanceBps must be an integer in [0, 10000]');
    }
    if (!Number.isSafeInteger(input.bonusDropIndex) || input.bonusDropIndex < 0) {
        throw new Error('Boss fragment bonus drop index must be a non-negative safe integer');
    }
    const revision = input.rewardTableRevision ?? exports.PVE_WEAPON_REWARD_TABLE_REVISION;
    const random = new DeterministicRandom([
        revision,
        input.matchSeed,
        input.stageId,
        input.levelId,
        input.difficulty,
        input.playerId,
        `wave-${input.milestone}`,
        'boss-fragment-bonus',
        input.bonusDropIndex,
    ].join(':'));
    if (random.nextInt(10_000) >= input.chanceBps)
        return null;
    const candidates = commonWeaponCandidates(input.quality, input.activatedGeneralIds, input.weaponState);
    if (!candidates.length)
        throw new Error(`No eligible common ${input.quality} bonus weapon candidates`);
    const weapon = candidates[random.nextInt(candidates.length)];
    return {
        dropIndex: input.bonusDropIndex,
        weaponId: weapon.weaponId,
        quality: input.quality,
        amount: 1,
    };
}
/** @deprecated 仅保留旧调用兼容；新事件语义是波次节点而不是 Boss 击杀。 */
function rollBossWeaponDrops(input) {
    return rollWaveMilestoneWeaponDrops({
        matchSeed: `${input.matchSeed}:legacy-sequence-${input.bossKillSequence}`,
        stageId: input.stageId ?? 'legacy-stage',
        levelId: input.levelId ?? 1,
        difficulty: input.difficulty ?? 'easy',
        playerId: input.playerId,
        milestone: input.bossWave,
        activatedGeneralIds: input.activatedGeneralIds,
        discoveredGeneralIds: input.discoveredGeneralIds,
        weaponState: {
            fragmentBalances: input.fragmentBalances ?? {},
            unlockedWeaponIds: input.unlockedWeaponIds,
        },
    });
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
        let candidates = shopWeaponCandidates(quality, offerIndex === 0 ? input.activatedGeneralIds : [], input.discoveredGeneralIds, input.unlockedWeaponIds)
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
function validateRewardInput(input) {
    if (!input.matchSeed || !input.stageId || !input.playerId)
        throw new Error('matchSeed, stageId and playerId are required');
    if (!Number.isSafeInteger(input.levelId) || input.levelId <= 0)
        throw new Error('levelId must be a positive safe integer');
    if (!exports.WAVE_MILESTONE_DROP_TABLE[input.difficulty]?.[input.milestone])
        throw new Error('Invalid PVE difficulty or wave milestone');
    validateGeneralIds(input.activatedGeneralIds);
    validateGeneralIds(input.discoveredGeneralIds);
    for (const [weaponId, amount] of Object.entries(input.weaponState.fragmentBalances)) {
        if (!catalog_1.WEAPON_CATALOG.some((weapon) => weapon.weaponId === weaponId))
            throw new Error(`Unknown fragment weaponId ${weaponId}`);
        if (!Number.isSafeInteger(amount) || amount < 0)
            throw new Error(`Invalid fragment balance for ${weaponId}`);
    }
    for (const weaponId of input.weaponState.unlockedWeaponIds) {
        if (!catalog_1.WEAPON_CATALOG.some((weapon) => weapon.weaponId === weaponId))
            throw new Error(`Unknown unlocked weaponId ${weaponId}`);
    }
}
function validateGeneralIds(generalIds) {
    for (const generalId of generalIds)
        if (!(0, roster_1.getGeneralRosterEntry)(generalId))
            throw new Error(`Unknown generalId ${generalId}`);
}
