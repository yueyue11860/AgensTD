"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlayerAccountService = void 0;
exports.createDefaultPlayerAccount = createDefaultPlayerAccount;
exports.settlementRewardTier = settlementRewardTier;
const pve_stage_config_1 = require("../../../shared/contracts/pve-stage-config");
const unlock_logic_1 = require("../core/unlock-logic");
const types_1 = require("./types");
const DEFAULT_ACTIVE_ITEMS = ['change_character_brush', 'cultivation_pill'];
const DEFAULT_PASSIVE_ITEMS = [
    'traveling_kitchen',
    'talent_registry',
    'reserve_expansion_talisman',
];
const MAX_CAS_RETRIES = 12;
function nowIso() {
    return new Date().toISOString();
}
function clone(value) {
    return structuredClone(value);
}
function stableStringify(value) {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(stableStringify).join(',')}]`;
    return `{${Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
        .join(',')}}`;
}
function hash32(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}
function seededOrder(values, seed, keyOf) {
    return [...values].sort((left, right) => {
        const score = hash32(`${seed}:${keyOf(left)}`) - hash32(`${seed}:${keyOf(right)}`);
        return score || keyOf(left).localeCompare(keyOf(right));
    });
}
function assertNonNegativeInteger(value, field) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new types_1.AccountDomainError('INVALID_ACCOUNT_MUTATION', `${field} must be a non-negative safe integer`);
    }
}
function isPveProgressPayload(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return false;
    const candidate = value;
    return Number.isSafeInteger(candidate.version)
        && candidate.version >= 1
        && typeof candidate.clearsByStageKey === 'object'
        && candidate.clearsByStageKey !== null
        && !Array.isArray(candidate.clearsByStageKey);
}
function createDefaultPlayerAccount(playerId, at = nowIso()) {
    if (!playerId)
        throw new types_1.AccountDomainError('INVALID_ACCOUNT_MUTATION', 'playerId is required');
    return {
        schemaVersion: types_1.PLAYER_ACCOUNT_SCHEMA_VERSION,
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
        pveProgress: (0, unlock_logic_1.createDefaultPveProgress)(),
        createdAt: at,
        updatedAt: at,
    };
}
function settlementRewardTier(highestCompletedWave, reason, officialVictory) {
    if (!Number.isInteger(highestCompletedWave) || highestCompletedWave < 0 || highestCompletedWave > 20) {
        throw new types_1.AccountDomainError('INVALID_SETTLEMENT', 'highestCompletedWave must be an integer from 0 to 20');
    }
    if (reason === 'victory') {
        if (!officialVictory)
            throw new types_1.AccountDomainError('INVALID_SETTLEMENT', 'victory requires an official victory event');
        return 'victory';
    }
    if (officialVictory)
        throw new types_1.AccountDomainError('INVALID_SETTLEMENT', 'officialVictory conflicts with a non-victory reason');
    if (highestCompletedWave >= 20) {
        throw new types_1.AccountDomainError('INVALID_SETTLEMENT', 'wave 20 without an official victory cannot grant victory rewards');
    }
    if (highestCompletedWave >= 15)
        return 'wave_15_19';
    if (highestCompletedWave >= 10)
        return 'wave_10_14';
    if (highestCompletedWave >= 5)
        return 'wave_5_9';
    return 'wave_0_4';
}
function tierGold(tier) {
    return { wave_0_4: 5, wave_5_9: 10, wave_10_14: 15, wave_15_19: 20, victory: 40 }[tier];
}
function tierEntitlements(tier) {
    switch (tier) {
        case 'wave_0_4': return [];
        case 'wave_5_9': return ['passive_item'];
        case 'wave_10_14': return ['passive_item', 'active_item'];
        case 'wave_15_19': return ['passive_item', 'active_item', 'low_tier_weapon_fragment'];
        case 'victory': return ['passive_item', 'active_item', 'high_tier_weapon_fragment'];
    }
}
function validateItemPayload(payload) {
    if (payload.loadout.activeSlots.length !== 2 || payload.loadout.passiveSlots.length !== 6) {
        throw new types_1.AccountDomainError('INVALID_ACCOUNT_MUTATION', 'item loadout must contain exactly 2 active and 6 passive slots');
    }
}
function validateWeaponPayload(payload) {
    for (const [weaponId, amount] of Object.entries(payload.fragmentBalances)) {
        assertNonNegativeInteger(amount, `fragmentBalances.${weaponId}`);
    }
    for (const [generalId, loadout] of Object.entries(payload.loadoutsByGeneralId)) {
        if (loadout.slots.length !== 2) {
            throw new types_1.AccountDomainError('INVALID_ACCOUNT_MUTATION', `weapon loadout ${generalId} must contain exactly 2 slots`);
        }
    }
}
class PlayerAccountService {
    store;
    shopCatalog;
    constructor(store, shopCatalog) {
        this.store = store;
        this.shopCatalog = shopCatalog;
    }
    async getOrCreate(playerId) {
        const existing = await this.store.get(playerId);
        const account = existing ?? await this.store.createIfAbsent(createDefaultPlayerAccount(playerId));
        return this.migrateAccountIfNeeded(playerId, account);
    }
    async get(playerId) {
        const account = await this.store.get(playerId);
        return account ? this.migrateAccountIfNeeded(playerId, account) : null;
    }
    /**
     * Applies one durable PVP reward event to the player account.
     *
     * The outbox event id is stored in the account's existing idempotency ledger,
     * so a worker crash after the account CAS but before outbox acknowledgement
     * cannot grant the same reward twice. The CAS loop also makes concurrent
     * workers safe when they race on the same account.
     */
    async applyPvpReward(input) {
        if (!input.eventId || !input.matchId || !input.playerId) {
            throw new types_1.AccountDomainError('INVALID_ACCOUNT_MUTATION', 'eventId, matchId and playerId are required');
        }
        assertNonNegativeInteger(input.honor, 'honor');
        assertNonNegativeInteger(input.gold, 'gold');
        const fingerprint = stableStringify({
            eventId: input.eventId,
            matchId: input.matchId,
            playerId: input.playerId,
            honor: input.honor,
            gold: input.gold,
        });
        for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt += 1) {
            const current = await this.getOrCreate(input.playerId);
            const existing = this.readIdempotent(current, input.eventId, 'pvp_reward', fingerprint);
            if (existing)
                return { ...existing, duplicate: true };
            const next = clone(current);
            next.wallet.gold += input.gold;
            next.wallet.honor += input.honor;
            const result = {
                eventId: input.eventId,
                matchId: input.matchId,
                playerId: input.playerId,
                honorGranted: input.honor,
                goldGranted: input.gold,
                accountVersionAfter: current.version + 1,
                duplicate: false,
            };
            this.finishMutation(next, current.version, input.eventId, 'pvp_reward', fingerprint, result);
            if (await this.store.compareAndSwap(input.playerId, current.version, next))
                return result;
        }
        throw new types_1.AccountDomainError('ACCOUNT_WRITE_CONFLICT', 'PVP reward account CAS retry budget exhausted');
    }
    async getPveProgression(playerId) {
        const account = await this.getOrCreate(playerId);
        return (0, unlock_logic_1.derivePveProgressionView)(account.pveProgress);
    }
    async settleMatch(input) {
        if (!input.requestId || !input.matchId || !input.playerId) {
            throw new types_1.AccountDomainError('INVALID_SETTLEMENT', 'requestId, matchId and playerId are required');
        }
        if (input.stageSelection !== undefined && !(0, pve_stage_config_1.isPveStageSelection)(input.stageSelection)) {
            throw new types_1.AccountDomainError('INVALID_SETTLEMENT', 'stageSelection must identify an existing PVE stage and difficulty');
        }
        if (input.officialVictory && !input.stageSelection) {
            throw new types_1.AccountDomainError('INVALID_SETTLEMENT', 'official PVE victory requires the server-locked stageSelection');
        }
        const settlementId = `${input.matchId}:${input.playerId}`;
        const fingerprint = stableStringify({ ...input, retainedWeaponFragments: input.retainedWeaponFragments });
        for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
            const current = await this.getOrCreate(input.playerId);
            this.assertIdempotencyAvailable(current, input.requestId, 'settle_match', fingerprint);
            const oldSettlement = current.settlementsById[settlementId];
            if (oldSettlement) {
                const sameSettlement = oldSettlement.matchId === input.matchId
                    && oldSettlement.playerId === input.playerId
                    && oldSettlement.reason === input.reason
                    && oldSettlement.highestCompletedWave === input.highestCompletedWave
                    && stableStringify(oldSettlement.stageSelection ?? null) === stableStringify(input.stageSelection ?? null)
                    && stableStringify(oldSettlement.retainedWeaponFragments) === stableStringify(input.retainedWeaponFragments);
                if (!sameSettlement) {
                    throw new types_1.AccountDomainError('INVALID_SETTLEMENT', 'settlementId is already committed with a different payload');
                }
                return clone(oldSettlement);
            }
            const tier = settlementRewardTier(input.highestCompletedWave, input.reason, input.officialVictory);
            const at = nowIso();
            const next = clone(current);
            for (const [weaponId, amount] of Object.entries(input.retainedWeaponFragments)) {
                assertNonNegativeInteger(amount, `retainedWeaponFragments.${weaponId}`);
                next.weapon.fragmentBalances[weaponId] = (next.weapon.fragmentBalances[weaponId] ?? 0) + amount;
            }
            if (Object.values(input.retainedWeaponFragments).some((amount) => amount > 0)) {
                next.weapon.version += 1;
            }
            const goldGranted = tierGold(tier);
            next.wallet.gold += goldGranted;
            const entitlementIds = [];
            tierEntitlements(tier).forEach((kind, ordinal) => {
                const entitlementId = `ent:${settlementId}:${kind}:${ordinal}`;
                const entitlement = {
                    entitlementId,
                    playerId: input.playerId,
                    sourceMatchId: input.matchId,
                    kind,
                    usesRemaining: 1,
                    status: 'available',
                    grantedAt: at,
                };
                next.entitlements[entitlementId] = entitlement;
                entitlementIds.push(entitlementId);
            });
            let progressionUpdated = false;
            if (input.officialVictory && input.stageSelection) {
                const stageKey = (0, pve_stage_config_1.pveStageKey)(input.stageSelection);
                const previousClear = next.pveProgress.clearsByStageKey[stageKey];
                if (previousClear && stableStringify(previousClear.selection) !== stableStringify(input.stageSelection)) {
                    throw new types_1.AccountDomainError('INVALID_SETTLEMENT', `stored PVE clear ${stageKey} has a conflicting selection`);
                }
                next.pveProgress.clearsByStageKey[stageKey] = {
                    stageKey,
                    selection: clone(input.stageSelection),
                    clearCount: (previousClear?.clearCount ?? 0) + 1,
                    firstClearedAt: previousClear?.firstClearedAt ?? at,
                    lastClearedAt: at,
                };
                next.pveProgress.version += 1;
                progressionUpdated = true;
            }
            const settlement = {
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
            };
            next.settlementsById[settlementId] = settlement;
            this.finishMutation(next, current.version, input.requestId, 'settle_match', fingerprint, settlement);
            if (await this.store.compareAndSwap(input.playerId, current.version, next))
                return clone(settlement);
        }
        throw new types_1.AccountDomainError('ACCOUNT_WRITE_CONFLICT', 'settlement CAS retry budget exhausted');
    }
    async generateFixedOffers(input) {
        if (!this.shopCatalog) {
            throw new types_1.AccountDomainError('NO_ELIGIBLE_SHOP_PRODUCTS', 'shop catalog provider is not configured');
        }
        for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
            const current = await this.getOrCreate(input.playerId);
            const entitlement = current.entitlements[input.entitlementId];
            this.assertAvailableEntitlement(entitlement, input.playerId);
            const existing = current.fixedOffersByEntitlementId[input.entitlementId];
            if (existing)
                return clone(existing);
            const eligible = this.shopCatalog.listEligibleProducts(entitlement.kind, current)
                .filter(product => product.entitlementKind === entitlement.kind);
            eligible.forEach(product => this.validateShopProduct(product, entitlement.kind));
            if (eligible.length < 3) {
                throw new types_1.AccountDomainError('NO_ELIGIBLE_SHOP_PRODUCTS', 'at least 3 eligible products are required; entitlement was preserved');
            }
            const ordered = this.pickOfferProducts(eligible, input.entitlementId, input.recentActiveGeneralIds ?? []);
            const at = nowIso();
            const offers = ordered.slice(0, 3).map((product, index) => ({
                offerId: `offer:${input.entitlementId}:${index}:${product.productId}`,
                entitlementId: input.entitlementId,
                productId: product.productId,
                entitlementKind: entitlement.kind,
                priceGold: product.priceGold,
                reward: clone(product.reward),
                metadata: clone(product.metadata ?? {}),
            }));
            const set = {
                entitlementId: input.entitlementId,
                generatedAt: at,
                seed: input.entitlementId,
                offers,
            };
            const next = clone(current);
            next.fixedOffersByEntitlementId[input.entitlementId] = set;
            next.version = current.version + 1;
            next.updatedAt = at;
            if (await this.store.compareAndSwap(input.playerId, current.version, next))
                return clone(set);
        }
        throw new types_1.AccountDomainError('ACCOUNT_WRITE_CONFLICT', 'offer generation CAS retry budget exhausted');
    }
    async purchaseOffer(input) {
        const fingerprint = stableStringify(input);
        for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
            const current = await this.getOrCreate(input.playerId);
            const replay = this.readIdempotent(current, input.requestId, 'purchase_offer', fingerprint);
            if (replay)
                return replay;
            if (current.version !== input.expectedAccountVersion) {
                throw new types_1.AccountDomainError('STALE_ACCOUNT_VERSION', `expected ${input.expectedAccountVersion}, got ${current.version}`);
            }
            const entitlement = current.entitlements[input.entitlementId];
            this.assertAvailableEntitlement(entitlement, input.playerId);
            const offerSet = current.fixedOffersByEntitlementId[input.entitlementId];
            const offer = offerSet?.offers.find(candidate => candidate.offerId === input.offerId);
            if (!offer)
                throw new types_1.AccountDomainError('OFFER_NOT_FOUND', 'offer does not belong to this fixed entitlement offer set');
            if (current.wallet.gold < offer.priceGold) {
                throw new types_1.AccountDomainError('INSUFFICIENT_GOLD', 'insufficient out-of-match gold; entitlement was preserved');
            }
            const at = nowIso();
            const next = clone(current);
            this.applyShopReward(next, offer);
            next.wallet.gold -= offer.priceGold;
            const nextEntitlement = next.entitlements[input.entitlementId];
            nextEntitlement.status = 'consumed';
            nextEntitlement.usesRemaining = 0;
            nextEntitlement.consumedAt = at;
            nextEntitlement.consumedByRequestId = input.requestId;
            const receipt = {
                requestId: input.requestId,
                entitlementId: input.entitlementId,
                offer: clone(offer),
                goldSpent: offer.priceGold,
                goldAfter: next.wallet.gold,
                accountVersionAfter: current.version + 1,
            };
            this.finishMutation(next, current.version, input.requestId, 'purchase_offer', fingerprint, receipt);
            if (await this.store.compareAndSwap(input.playerId, current.version, next))
                return receipt;
        }
        throw new types_1.AccountDomainError('ACCOUNT_WRITE_CONFLICT', 'purchase CAS retry budget exhausted');
    }
    async saveItemPayload(input) {
        validateItemPayload(input.payload);
        return this.saveSubsystem(input, 'save_item_payload', next => { next.item = clone(input.payload); });
    }
    async saveWeaponPayload(input) {
        validateWeaponPayload(input.payload);
        return this.saveSubsystem(input, 'save_weapon_payload', next => { next.weapon = clone(input.payload); });
    }
    async createBuildSnapshot(input, resolver) {
        const fingerprint = stableStringify(input);
        for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
            const current = await this.getOrCreate(input.playerId);
            const existing = current.buildSnapshotsByMatchId[input.matchId];
            if (existing)
                return clone(existing);
            this.assertIdempotencyAvailable(current, input.requestId, 'create_build_snapshot', fingerprint);
            if (current.version !== input.expectedAccountVersion) {
                throw new types_1.AccountDomainError('STALE_ACCOUNT_VERSION', `expected ${input.expectedAccountVersion}, got ${current.version}`);
            }
            const itemDefinitions = (ids, kind) => ids
                .filter((id) => id !== null)
                .map(id => {
                const definition = resolver.resolveItem(id);
                if (!definition)
                    throw new types_1.AccountDomainError('INVALID_ACCOUNT_MUTATION', `equipped ${kind} item ${id} cannot be resolved`);
                return clone(definition);
            });
            const byGeneralId = {};
            for (const [generalId, loadout] of Object.entries(current.weapon.loadoutsByGeneralId)) {
                byGeneralId[generalId] = {
                    slots: clone(loadout.slots),
                    resolvedDefinitions: loadout.slots
                        .filter((id) => id !== null)
                        .map(id => {
                        const definition = resolver.resolveWeapon(id);
                        if (!definition)
                            throw new types_1.AccountDomainError('INVALID_ACCOUNT_MUTATION', `equipped weapon ${id} cannot be resolved`);
                        return clone(definition);
                    }),
                };
            }
            const at = nowIso();
            const snapshot = {
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
            };
            const next = clone(current);
            next.buildSnapshotsByMatchId[input.matchId] = snapshot;
            this.finishMutation(next, current.version, input.requestId, 'create_build_snapshot', fingerprint, snapshot);
            if (await this.store.compareAndSwap(input.playerId, current.version, next))
                return clone(snapshot);
        }
        throw new types_1.AccountDomainError('ACCOUNT_WRITE_CONFLICT', 'snapshot CAS retry budget exhausted');
    }
    async saveSubsystem(input, operation, mutate) {
        const fingerprint = stableStringify(input);
        const current = await this.getOrCreate(input.playerId);
        const stored = current.idempotencyByRequestId[input.requestId];
        if (stored) {
            this.assertIdempotencyAvailable(current, input.requestId, operation, fingerprint);
            return current;
        }
        if (current.version !== input.expectedAccountVersion) {
            throw new types_1.AccountDomainError('STALE_ACCOUNT_VERSION', `expected ${input.expectedAccountVersion}, got ${current.version}`);
        }
        const next = clone(current);
        mutate(next);
        this.finishMutation(next, current.version, input.requestId, operation, fingerprint, {
            accountVersionAfter: current.version + 1,
            expectedAccountVersion: input.expectedAccountVersion,
            payload: clone(input.payload),
            context: clone(input.idempotencyContext ?? {}),
        });
        if (!await this.store.compareAndSwap(input.playerId, current.version, next)) {
            throw new types_1.AccountDomainError('STALE_ACCOUNT_VERSION', 'account changed during save');
        }
        return next;
    }
    async migrateAccountIfNeeded(playerId, initial) {
        let current = initial;
        for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
            const candidate = current;
            if (candidate.playerId !== playerId || !Number.isSafeInteger(candidate.version)) {
                throw new types_1.AccountDomainError('INVALID_ACCOUNT_MUTATION', 'stored player account identity or version is invalid');
            }
            const wallet = candidate.wallet;
            const hasValidPveProgress = isPveProgressPayload(candidate.pveProgress);
            if (candidate.schemaVersion === types_1.PLAYER_ACCOUNT_SCHEMA_VERSION
                && hasValidPveProgress
                && Number.isSafeInteger(wallet?.gold)
                && Number.isSafeInteger(wallet?.honor)
                && wallet?.gold >= 0
                && wallet?.honor >= 0) {
                return current;
            }
            // V1 关卡进度由客户端自报且关卡语义已变更，故不迁移；
            // 金币、道具、武器与已提交结算单均原样保留。
            const next = clone(current);
            next.schemaVersion = types_1.PLAYER_ACCOUNT_SCHEMA_VERSION;
            const legacyWallet = (next.wallet ?? { gold: 0 });
            next.wallet = {
                gold: Number.isSafeInteger(legacyWallet.gold) && legacyWallet.gold >= 0 ? legacyWallet.gold : 0,
                honor: Number.isSafeInteger(legacyWallet.honor) && legacyWallet.honor >= 0 ? legacyWallet.honor : 0,
            };
            if (!hasValidPveProgress)
                next.pveProgress = (0, unlock_logic_1.createDefaultPveProgress)();
            for (const settlement of Object.values(next.settlementsById)) {
                if (typeof settlement.progressionUpdated !== 'boolean')
                    settlement.progressionUpdated = false;
            }
            next.version = current.version + 1;
            next.updatedAt = nowIso();
            if (await this.store.compareAndSwap(playerId, current.version, next))
                return next;
            const reloaded = await this.store.get(playerId);
            if (!reloaded)
                throw new types_1.AccountDomainError('ACCOUNT_NOT_FOUND', 'player account disappeared during migration');
            current = reloaded;
        }
        throw new types_1.AccountDomainError('ACCOUNT_WRITE_CONFLICT', 'account migration CAS retry budget exhausted');
    }
    pickOfferProducts(products, seed, recentActiveGeneralIds) {
        const recent = new Set(recentActiveGeneralIds);
        const preferred = seededOrder(products.filter(product => product.affinityGeneralIds?.some(id => recent.has(id))), `${seed}:preferred`, product => product.productId);
        const first = preferred[0];
        const remainder = seededOrder(products.filter(product => product.productId !== first?.productId), `${seed}:all`, product => product.productId);
        return first ? [first, ...remainder] : remainder;
    }
    applyShopReward(account, offer) {
        const reward = offer.reward;
        switch (reward.type) {
            case 'unlock_active_item':
                if (account.item.unlockedActiveItemIds.includes(reward.itemId)) {
                    throw new types_1.AccountDomainError('SHOP_REWARD_CONFLICT', 'active item is already unlocked; entitlement was preserved');
                }
                account.item.unlockedActiveItemIds.push(reward.itemId);
                account.item.version += 1;
                return;
            case 'unlock_passive_item':
                if (account.item.unlockedPassiveItemIds.includes(reward.itemId)) {
                    throw new types_1.AccountDomainError('SHOP_REWARD_CONFLICT', 'passive item is already unlocked; entitlement was preserved');
                }
                account.item.unlockedPassiveItemIds.push(reward.itemId);
                account.item.version += 1;
                return;
            case 'weapon_fragment':
                if (!Number.isSafeInteger(reward.amount) || reward.amount <= 0) {
                    throw new types_1.AccountDomainError('SHOP_REWARD_CONFLICT', 'invalid weapon fragment reward');
                }
                account.weapon.fragmentBalances[reward.weaponId] = (account.weapon.fragmentBalances[reward.weaponId] ?? 0) + reward.amount;
                account.weapon.version += 1;
        }
    }
    validateShopProduct(product, kind) {
        if (!product.productId || !Number.isSafeInteger(product.priceGold) || product.priceGold < 0) {
            throw new types_1.AccountDomainError('NO_ELIGIBLE_SHOP_PRODUCTS', 'shop catalog returned an invalid product');
        }
        const reward = product.reward;
        const matches = kind === 'active_item'
            ? reward.type === 'unlock_active_item'
            : kind === 'passive_item'
                ? reward.type === 'unlock_passive_item'
                : reward.type === 'weapon_fragment'
                    && (kind === 'low_tier_weapon_fragment'
                        ? reward.quality === 'green' || reward.quality === 'blue'
                        : reward.quality === 'purple' || reward.quality === 'orange' || reward.quality === 'red');
        if (!matches) {
            throw new types_1.AccountDomainError('NO_ELIGIBLE_SHOP_PRODUCTS', `product ${product.productId} reward does not match ${kind}`);
        }
    }
    assertAvailableEntitlement(entitlement, playerId) {
        if (!entitlement || entitlement.playerId !== playerId) {
            throw new types_1.AccountDomainError('INVALID_ENTITLEMENT', 'entitlement does not exist for this player');
        }
        if (entitlement.status !== 'available' || entitlement.usesRemaining !== 1) {
            throw new types_1.AccountDomainError('ENTITLEMENT_ALREADY_CONSUMED', 'entitlement is already consumed');
        }
    }
    assertIdempotencyAvailable(account, requestId, operation, fingerprint) {
        const stored = account.idempotencyByRequestId[requestId];
        if (stored && (stored.operation !== operation || stored.fingerprint !== fingerprint)) {
            throw new types_1.AccountDomainError('REQUEST_ID_CONFLICT', 'requestId was already used with a different payload');
        }
    }
    readIdempotent(account, requestId, operation, fingerprint) {
        const stored = account.idempotencyByRequestId[requestId];
        if (!stored)
            return null;
        if (stored.operation !== operation || stored.fingerprint !== fingerprint) {
            throw new types_1.AccountDomainError('REQUEST_ID_CONFLICT', 'requestId was already used with a different payload');
        }
        return clone(stored.result);
    }
    finishMutation(next, previousVersion, requestId, operation, fingerprint, result) {
        const at = nowIso();
        next.version = previousVersion + 1;
        next.updatedAt = at;
        next.idempotencyByRequestId[requestId] = { requestId, operation, fingerprint, result: clone(result), createdAt: at };
    }
}
exports.PlayerAccountService = PlayerAccountService;
