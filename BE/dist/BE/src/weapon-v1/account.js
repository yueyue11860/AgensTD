"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_GENERAL_WEAPON_EVENT_BUDGET = exports.InMemoryWeaponAccountService = void 0;
exports.validateWeaponLoadout = validateWeaponLoadout;
exports.projectWeaponLoadout = projectWeaponLoadout;
exports.aggregateWeaponEventBudget = aggregateWeaponEventBudget;
const roster_1 = require("../core/hero-v1/roster");
const catalog_1 = require("./catalog");
const types_1 = require("./types");
const clone = (value) => JSON.parse(JSON.stringify(value));
const deepFreeze = (value) => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value))
            deepFreeze(child);
    }
    return value;
};
/**
 * 供 REST/持久化适配层复用的纯校验函数。不修改账户，失败时抛出稳定的 WeaponDomainError。
 */
function validateWeaponLoadout(account, generalId, slots) {
    if (!(0, roster_1.getGeneralRosterEntry)(generalId)) {
        throw new types_1.WeaponDomainError('WEAPON_INCOMPATIBLE', `Unknown general ${generalId}`);
    }
    if (slots[0] && slots[0] === slots[1]) {
        throw new types_1.WeaponDomainError('DUPLICATE_WEAPON_IN_LOADOUT', `Cannot equip ${slots[0]} twice`);
    }
    const resolved = slots.map((weaponId) => {
        if (!weaponId)
            return null;
        const weapon = (0, catalog_1.getWeaponDefinition)(weaponId);
        if (!weapon)
            throw new types_1.WeaponDomainError('WEAPON_NOT_FOUND', `Unknown weapon ${weaponId}`);
        if (!account.unlockedWeaponIds.includes(weaponId)) {
            throw new types_1.WeaponDomainError('WEAPON_NOT_UNLOCKED', `Weapon ${weaponId} is not unlocked`);
        }
        if (weapon.compatibility.exclusiveGeneralId && weapon.compatibility.exclusiveGeneralId !== generalId) {
            throw new types_1.WeaponDomainError('EXCLUSIVE_GENERAL_MISMATCH', `${weaponId} is exclusive to ${weapon.compatibility.exclusiveGeneralId}`);
        }
        if (!(0, catalog_1.isWeaponCompatible)(weapon, generalId)) {
            throw new types_1.WeaponDomainError('WEAPON_INCOMPATIBLE', `${weaponId} is incompatible with ${generalId}`);
        }
        return weapon;
    });
    if (resolved[0]?.uniqueGroup && resolved[0].uniqueGroup === resolved[1]?.uniqueGroup) {
        throw new types_1.WeaponDomainError('UNIQUE_GROUP_CONFLICT', `Weapons share unique group ${resolved[0].uniqueGroup}`);
    }
}
class InMemoryWeaponAccountService {
    now;
    accounts = new Map();
    receipts = new Map();
    constructor(now = () => new Date().toISOString()) {
        this.now = now;
    }
    getAccount(playerId) {
        return clone(this.ensureAccount(playerId));
    }
    creditFragments(request) {
        const fingerprint = JSON.stringify({ type: 'credit', playerId: request.playerId, fragments: request.fragments, expectedAccountVersion: request.expectedAccountVersion });
        return this.idempotent(request.playerId, request.requestId, fingerprint, () => {
            const account = this.ensureAccount(request.playerId);
            if (request.expectedAccountVersion !== undefined && request.expectedAccountVersion !== account.version) {
                throw new types_1.WeaponDomainError('STALE_WEAPON_ACCOUNT_VERSION', `Expected account version ${request.expectedAccountVersion}, received ${account.version}`);
            }
            const entries = Object.entries(request.fragments);
            for (const [weaponId, amount] of entries) {
                if (!(0, catalog_1.getWeaponDefinition)(weaponId))
                    throw new types_1.WeaponDomainError('WEAPON_NOT_FOUND', `Unknown weapon ${weaponId}`);
                if (!Number.isSafeInteger(amount) || amount <= 0)
                    throw new types_1.WeaponDomainError('INVALID_FRAGMENT_AMOUNT', `Invalid fragment amount for ${weaponId}`);
            }
            for (const [weaponId, amount] of entries)
                account.fragmentBalances[weaponId] = (account.fragmentBalances[weaponId] ?? 0) + amount;
            if (entries.length)
                account.version += 1;
            return clone(account);
        });
    }
    craftWeapon(request) {
        const fingerprint = JSON.stringify({ type: 'craft', playerId: request.playerId, weaponId: request.weaponId, expectedAccountVersion: request.expectedAccountVersion });
        return this.idempotent(request.playerId, request.requestId, fingerprint, () => {
            const weapon = (0, catalog_1.getWeaponDefinition)(request.weaponId);
            if (!weapon)
                throw new types_1.WeaponDomainError('WEAPON_NOT_FOUND', `Unknown weapon ${request.weaponId}`);
            const account = this.ensureAccount(request.playerId);
            if (account.version !== request.expectedAccountVersion)
                throw new types_1.WeaponDomainError('STALE_WEAPON_ACCOUNT_VERSION', `Expected account version ${request.expectedAccountVersion}, received ${account.version}`);
            if (account.unlockedWeaponIds.includes(request.weaponId))
                throw new types_1.WeaponDomainError('WEAPON_ALREADY_UNLOCKED', `Weapon ${request.weaponId} is already unlocked`);
            const balance = account.fragmentBalances[request.weaponId] ?? 0;
            if (balance < weapon.fragmentRequirement)
                throw new types_1.WeaponDomainError('INSUFFICIENT_FRAGMENTS', `Weapon ${request.weaponId} requires ${weapon.fragmentRequirement} fragments`);
            account.fragmentBalances[request.weaponId] = balance - weapon.fragmentRequirement;
            account.unlockedWeaponIds.push(request.weaponId);
            account.unlockedWeaponIds.sort();
            account.version += 1;
            return {
                status: 'unlocked',
                weaponId: request.weaponId,
                spentFragments: weapon.fragmentRequirement,
                fragmentBalance: account.fragmentBalances[request.weaponId],
                accountVersion: account.version,
            };
        });
    }
    saveLoadout(request) {
        const fingerprint = JSON.stringify({ type: 'loadout', ...request });
        return this.idempotent(request.playerId, request.requestId, fingerprint, () => {
            if (!(0, roster_1.getGeneralRosterEntry)(request.generalId))
                throw new types_1.WeaponDomainError('WEAPON_INCOMPATIBLE', `Unknown general ${request.generalId}`);
            const account = this.ensureAccount(request.playerId);
            const current = account.loadoutsByGeneralId[request.generalId];
            const currentVersion = current?.version ?? 0;
            if (currentVersion !== request.expectedLoadoutVersion)
                throw new types_1.WeaponDomainError('STALE_WEAPON_LOADOUT_VERSION', `Expected loadout version ${request.expectedLoadoutVersion}, received ${currentVersion}`);
            validateWeaponLoadout(account, request.generalId, request.slots);
            const loadout = {
                slots: [request.slots[0], request.slots[1]],
                version: currentVersion + 1,
                updatedAt: this.now(),
            };
            account.loadoutsByGeneralId[request.generalId] = loadout;
            account.version += 1;
            return { generalId: request.generalId, loadout: clone(loadout), accountVersion: account.version };
        });
    }
    createMatchSnapshot(playerId, generalIds) {
        const account = this.ensureAccount(playerId);
        const included = generalIds ?? Object.keys(account.loadoutsByGeneralId);
        const byGeneralId = {};
        for (const generalId of included) {
            const loadout = account.loadoutsByGeneralId[generalId];
            if (!loadout)
                continue;
            validateWeaponLoadout(account, generalId, loadout.slots);
            byGeneralId[generalId] = {
                slots: [loadout.slots[0], loadout.slots[1]],
                resolvedDefinitions: loadout.slots.flatMap((weaponId) => {
                    if (!weaponId)
                        return [];
                    const definition = (0, catalog_1.getWeaponDefinition)(weaponId);
                    if (!definition)
                        throw new types_1.WeaponDomainError('WEAPON_NOT_FOUND', `Unknown weapon ${weaponId}`);
                    return [clone(definition)];
                }),
            };
        }
        return deepFreeze({ snapshotVersion: 1, playerId, accountVersion: account.version, byGeneralId });
    }
    ensureAccount(playerId) {
        let account = this.accounts.get(playerId);
        if (!account) {
            account = { playerId, fragmentBalances: {}, unlockedWeaponIds: [], loadoutsByGeneralId: {}, version: 0 };
            this.accounts.set(playerId, account);
        }
        return account;
    }
    idempotent(playerId, requestId, fingerprint, operation) {
        if (!requestId)
            throw new types_1.WeaponDomainError('REQUEST_ID_CONFLICT', 'requestId is required');
        const key = `${playerId}:${requestId}`;
        const existing = this.receipts.get(key);
        if (existing) {
            if (existing.fingerprint !== fingerprint)
                throw new types_1.WeaponDomainError('REQUEST_ID_CONFLICT', `requestId ${requestId} was reused with another payload`);
            return clone(existing.result);
        }
        const result = operation();
        this.receipts.set(key, { fingerprint, result: clone(result) });
        return clone(result);
    }
}
exports.InMemoryWeaponAccountService = InMemoryWeaponAccountService;
function projectWeaponLoadout(matchId, snapshot, generalId) {
    const loadout = snapshot.byGeneralId[generalId];
    if (!loadout)
        return [];
    return loadout.slots.flatMap((weaponId, slotIndex) => {
        if (!weaponId)
            return [];
        const weapon = loadout.resolvedDefinitions.find((candidate) => candidate.weaponId === weaponId);
        if (!weapon)
            throw new types_1.WeaponDomainError('WEAPON_NOT_FOUND', `Snapshot definition missing for ${weaponId}`);
        return [{
                sourceKey: `weapon:${matchId}:${snapshot.playerId}:${generalId}:${slotIndex}:${weaponId}`,
                slotIndex: slotIndex,
                weaponId,
                generalId,
                statModifiers: weapon.statModifiers,
                triggers: weapon.triggers,
                parameterPatches: weapon.parameterPatches,
                resolvedEffects: [
                    ...weapon.statModifiers.map((definition) => ({ kind: 'stat_modifier', sourceKey: `weapon:${matchId}:${snapshot.playerId}:${generalId}:${slotIndex}:${weaponId}:${definition.effectId}`, definition })),
                    ...weapon.triggers.map((definition) => ({ kind: 'trigger', sourceKey: `weapon:${matchId}:${snapshot.playerId}:${generalId}:${slotIndex}:${weaponId}:${definition.triggerId}`, definition })),
                    ...weapon.parameterPatches.map((definition) => ({ kind: 'parameter_patch', sourceKey: `weapon:${matchId}:${snapshot.playerId}:${generalId}:${slotIndex}:${weaponId}:${definition.patchId}`, definition })),
                ],
                eventBudget: weapon.eventBudget,
            }];
    });
}
exports.DEFAULT_GENERAL_WEAPON_EVENT_BUDGET = {
    maxExtraDamageEventsPerSecond: 12,
    maxExtraTargetsPerCast: 8,
    maxOwnedZones: 3,
    maxExtraSummons: 2,
};
function aggregateWeaponEventBudget(sources, caps = exports.DEFAULT_GENERAL_WEAPON_EVENT_BUDGET) {
    const sum = sources.reduce((budget, source) => ({
        maxExtraDamageEventsPerSecond: budget.maxExtraDamageEventsPerSecond + source.eventBudget.maxExtraDamageEventsPerSecond,
        maxExtraTargetsPerCast: budget.maxExtraTargetsPerCast + source.eventBudget.maxExtraTargetsPerCast,
        maxOwnedZones: budget.maxOwnedZones + source.eventBudget.maxOwnedZones,
        maxExtraSummons: budget.maxExtraSummons + source.eventBudget.maxExtraSummons,
    }), { maxExtraDamageEventsPerSecond: 0, maxExtraTargetsPerCast: 0, maxOwnedZones: 0, maxExtraSummons: 0 });
    return {
        maxExtraDamageEventsPerSecond: Math.min(sum.maxExtraDamageEventsPerSecond, caps.maxExtraDamageEventsPerSecond),
        maxExtraTargetsPerCast: Math.min(sum.maxExtraTargetsPerCast, caps.maxExtraTargetsPerCast),
        maxOwnedZones: Math.min(sum.maxOwnedZones, caps.maxOwnedZones),
        maxExtraSummons: Math.min(sum.maxExtraSummons, caps.maxExtraSummons),
    };
}
