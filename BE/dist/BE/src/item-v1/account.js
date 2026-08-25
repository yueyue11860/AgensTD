"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FREE_PASSIVE_ITEM_IDS = exports.FREE_ACTIVE_ITEM_IDS = void 0;
exports.createPlayerItemAccount = createPlayerItemAccount;
exports.validateItemLoadout = validateItemLoadout;
exports.saveItemLoadout = saveItemLoadout;
exports.createMatchItemLoadoutSnapshot = createMatchItemLoadoutSnapshot;
const catalog_1 = require("./catalog");
const types_1 = require("./types");
exports.FREE_ACTIVE_ITEM_IDS = [
    'change_character_brush',
    'cultivation_pill',
];
exports.FREE_PASSIVE_ITEM_IDS = [
    'traveling_kitchen',
    'talent_registry',
    'reserve_expansion_talisman',
];
function createPlayerItemAccount(playerId, nowIso) {
    if (!playerId)
        throw new Error('playerId is required');
    return {
        playerId,
        unlockedActiveItemIds: [...exports.FREE_ACTIVE_ITEM_IDS],
        unlockedPassiveItemIds: [...exports.FREE_PASSIVE_ITEM_IDS],
        loadout: {
            activeSlots: [...exports.FREE_ACTIVE_ITEM_IDS],
            passiveSlots: [...exports.FREE_PASSIVE_ITEM_IDS, null, null, null],
            version: 1,
            updatedAt: nowIso,
        },
        version: 1,
    };
}
function validateItemLoadout(account, activeSlots, passiveSlots) {
    if (activeSlots.length !== 2 || passiveSlots.length !== 6)
        return 'INVALID_ITEM_LOADOUT';
    const allIds = [...activeSlots, ...passiveSlots].filter((id) => id !== null);
    if (new Set(allIds).size !== allIds.length)
        return 'DUPLICATE_ITEM_IN_LOADOUT';
    const unlockedActive = new Set(account.unlockedActiveItemIds);
    const unlockedPassive = new Set(account.unlockedPassiveItemIds);
    for (const id of activeSlots) {
        if (id === null)
            continue;
        const definition = (0, catalog_1.getItemDefinition)(id);
        if (!definition)
            return 'ITEM_NOT_FOUND';
        if (definition.itemKind !== 'active')
            return 'ITEM_KIND_MISMATCH';
        if (!unlockedActive.has(id))
            return 'ITEM_NOT_UNLOCKED';
    }
    for (const id of passiveSlots) {
        if (id === null)
            continue;
        const definition = (0, catalog_1.getItemDefinition)(id);
        if (!definition)
            return 'ITEM_NOT_FOUND';
        if (definition.itemKind !== 'passive')
            return 'ITEM_KIND_MISMATCH';
        if (!unlockedPassive.has(id))
            return 'ITEM_NOT_UNLOCKED';
    }
    const exclusiveGroups = new Set();
    for (const id of allIds) {
        const group = (0, catalog_1.getItemDefinition)(id)?.exclusiveGroup;
        if (!group)
            continue;
        if (exclusiveGroups.has(group))
            return 'ITEM_EXCLUSIVE_GROUP_CONFLICT';
        exclusiveGroups.add(group);
    }
    return undefined;
}
function saveItemLoadout(account, command) {
    if (command.playerId !== account.playerId)
        return { ok: false, error: 'ITEM_NOT_UNLOCKED' };
    if (command.expectedCatalogVersion !== types_1.ITEM_CATALOG_VERSION) {
        return { ok: false, error: 'ITEM_CATALOG_VERSION_MISMATCH' };
    }
    if (command.expectedAccountVersion !== account.version || command.expectedLoadoutVersion !== account.loadout.version) {
        return { ok: false, error: 'ITEM_ACCOUNT_VERSION_MISMATCH' };
    }
    const validationError = validateItemLoadout(account, command.activeSlots, command.passiveSlots);
    if (validationError)
        return { ok: false, error: validationError };
    return {
        ok: true,
        value: {
            ...account,
            loadout: {
                activeSlots: [...command.activeSlots],
                passiveSlots: [...command.passiveSlots],
                version: account.loadout.version + 1,
                updatedAt: command.nowIso,
            },
            version: account.version + 1,
        },
    };
}
function createMatchItemLoadoutSnapshot(account) {
    const validationError = validateItemLoadout(account, account.loadout.activeSlots, account.loadout.passiveSlots);
    if (validationError)
        throw new Error(`Cannot snapshot invalid item loadout: ${validationError}`);
    const activeItems = account.loadout.activeSlots
        .filter((id) => id !== null)
        .map((id) => {
        const definition = (0, catalog_1.getActiveItemDefinition)(id);
        if (!definition)
            throw new Error(`Missing active item definition: ${id}`);
        return definition;
    });
    const passiveItems = account.loadout.passiveSlots
        .filter((id) => id !== null)
        .map((id) => {
        const definition = (0, catalog_1.getPassiveItemDefinition)(id);
        if (!definition)
            throw new Error(`Missing passive item definition: ${id}`);
        return definition;
    });
    return deepFreeze({
        snapshotVersion: 1,
        catalogVersion: types_1.ITEM_CATALOG_VERSION,
        playerId: account.playerId,
        accountVersion: account.version,
        activeItems: activeItems.map(cloneDefinition),
        passiveItems: passiveItems.map(cloneDefinition),
        activeSlots: [...account.loadout.activeSlots],
        passiveSlots: [...account.loadout.passiveSlots],
    });
}
function cloneDefinition(value) {
    return JSON.parse(JSON.stringify(value));
}
function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value))
            deepFreeze(child);
    }
    return value;
}
