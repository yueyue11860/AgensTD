"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createItemRuntimeAggregate = createItemRuntimeAggregate;
exports.useActiveItem = useActiveItem;
const catalog_1 = require("./catalog");
function createItemRuntimeAggregate(matchId, snapshot) {
    const slots = snapshot.activeSlots.map((itemId, index) => {
        if (!itemId)
            return null;
        const definition = snapshot.activeItems.find((candidate) => candidate.itemId === itemId);
        if (!definition)
            throw new Error(`Snapshot is missing equipped active item ${itemId}`);
        return {
            itemId,
            slotIndex: index,
            chargesRemaining: definition.maxChargesPerMatch,
            cooldownEndsAtTick: 0,
            usesThisMatch: 0,
            enabled: true,
        };
    });
    return {
        matchId,
        playerId: snapshot.playerId,
        version: 1,
        nextUseSequence: 1,
        slots,
        processedRequests: {},
    };
}
function useActiveItem(state, command, context) {
    const previous = state.processedRequests[command.requestId];
    if (previous)
        return receiptToResult(previous, command.requestId, state);
    const reject = (error) => {
        const receipt = { ok: false, runtimeVersion: state.version, error };
        const next = {
            ...state,
            processedRequests: { ...state.processedRequests, [command.requestId]: receipt },
        };
        return { ok: false, requestId: command.requestId, runtimeVersion: state.version, error, state: next };
    };
    if (!command.requestId || command.playerId !== state.playerId)
        return reject('ITEM_NOT_EQUIPPED');
    if (command.expectedItemRuntimeVersion !== state.version)
        return reject('STALE_ITEM_RUNTIME_VERSION');
    const slot = state.slots[command.slotIndex];
    if (!slot || slot.itemId !== command.itemId)
        return reject('ITEM_NOT_EQUIPPED');
    const definition = (0, catalog_1.getActiveItemDefinition)(command.itemId);
    if (!definition)
        return reject('ITEM_NOT_FOUND');
    if (!slot.enabled || slot.chargesRemaining <= 0)
        return reject('NO_ITEM_CHARGES');
    if (context.currentTick < slot.cooldownEndsAtTick)
        return reject('ITEM_ON_COOLDOWN');
    if (context.phase === 'idle' || context.phase === 'complete'
        || !definition.availabilityPhases.includes(context.phase)) {
        return reject('ITEM_NOT_AVAILABLE_IN_PHASE');
    }
    if (!targetShapeMatches(definition.targeting.kind, command.target))
        return reject('INVALID_ITEM_TARGET');
    const validation = context.validateTarget(definition, command.target);
    if (!validation.ok)
        return reject(validation.error ?? 'INVALID_ITEM_TARGET');
    if (validation.hasLegalTarget === false)
        return reject('INVALID_ITEM_TARGET');
    const useSequence = state.nextUseSequence;
    const plan = {
        requestId: command.requestId,
        playerId: state.playerId,
        itemId: command.itemId,
        slotIndex: command.slotIndex,
        useSequence,
        tick: context.currentTick,
        target: command.target,
        sourceKey: `active_item:${state.matchId}:${state.playerId}:${command.slotIndex}:${command.itemId}:${useSequence}`,
        effects: definition.effects,
        actions: definition.actions,
    };
    const cooldownTicks = Math.ceil(definition.cooldownMs / context.tickDurationMs);
    const nextSlot = {
        ...slot,
        chargesRemaining: slot.chargesRemaining - 1,
        cooldownEndsAtTick: context.currentTick + cooldownTicks,
        usesThisMatch: slot.usesThisMatch + 1,
        enabled: slot.chargesRemaining - 1 > 0,
    };
    const nextSlots = [...state.slots];
    nextSlots[command.slotIndex] = nextSlot;
    const nextVersion = state.version + 1;
    const receipt = { ok: true, runtimeVersion: nextVersion, plan };
    const next = {
        ...state,
        version: nextVersion,
        nextUseSequence: useSequence + 1,
        slots: nextSlots,
        processedRequests: { ...state.processedRequests, [command.requestId]: receipt },
    };
    return { ok: true, requestId: command.requestId, runtimeVersion: nextVersion, state: next, plan };
}
function targetShapeMatches(expected, target) {
    switch (expected) {
        case 'none': return target.kind === 'none';
        case 'character_token': return target.kind === 'piece';
        case 'active_general': return target.kind === 'general';
        case 'battlefield_point': return target.kind === 'battlefield_point';
        case 'discarded_character_to_empty_slot': return target.kind === 'discarded_character_to_empty_slot';
    }
}
function receiptToResult(receipt, requestId, state) {
    return receipt.ok
        ? { ok: true, requestId, runtimeVersion: receipt.runtimeVersion, state, plan: receipt.plan }
        : { ok: false, requestId, runtimeVersion: receipt.runtimeVersion, state, error: receipt.error };
}
