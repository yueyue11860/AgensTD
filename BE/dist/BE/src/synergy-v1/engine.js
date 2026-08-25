"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluatePlayerSynergies = evaluatePlayerSynergies;
exports.reconcilePlayerSynergies = reconcilePlayerSynergies;
exports.validateSynergyCatalog = validateSynergyCatalog;
function valuesForDimension(profile, dimension) {
    switch (dimension) {
        case 'faction':
            return profile.factions;
        case 'profession':
            return [profile.profession];
        case 'playstyle':
            return profile.playstyles;
        case 'named_collection':
            return profile.namedCollections;
    }
}
function requirementSatisfied(requirement, activeGeneralIds, profilesById) {
    if (requirement.kind === 'all_generals') {
        return requirement.generalIds.every((generalId) => activeGeneralIds.has(generalId));
    }
    let count = 0;
    for (const generalId of activeGeneralIds) {
        const profile = profilesById.get(generalId);
        if (profile &&
            valuesForDimension(profile, requirement.dimension).includes(requirement.facetId)) {
            count += 1;
        }
    }
    return count >= requirement.minimum;
}
function getContributingGeneralIds(definition, level, activeGeneralIds, profilesById) {
    const activation = definition.levels.find((candidate) => candidate.level === level);
    if (!activation)
        return [];
    const contributors = new Set();
    for (const requirement of activation.requirements) {
        if (requirement.kind === 'all_generals') {
            requirement.generalIds.forEach((generalId) => contributors.add(generalId));
            continue;
        }
        for (const generalId of activeGeneralIds) {
            const profile = profilesById.get(generalId);
            if (profile &&
                valuesForDimension(profile, requirement.dimension).includes(requirement.facetId)) {
                contributors.add(generalId);
            }
        }
    }
    return [...contributors].sort();
}
function evaluatePlayerSynergies(input) {
    const profilesById = new Map(input.profiles.map((profile) => [profile.generalId, profile]));
    const activeGeneralIds = new Set(input.formations
        .filter((formation) => formation.ownerPlayerId === input.ownerPlayerId &&
        formation.zone === 'board' &&
        formation.isFormed)
        .map((formation) => formation.generalId));
    const activeSynergies = [];
    for (const definition of input.definitions) {
        const highestMatchingLevel = [...definition.levels]
            .sort((left, right) => right.level - left.level)
            .find((level) => level.requirements.every((requirement) => requirementSatisfied(requirement, activeGeneralIds, profilesById)));
        if (!highestMatchingLevel)
            continue;
        activeSynergies.push({
            synergyId: definition.synergyId,
            level: highestMatchingLevel.level,
            contributingGeneralIds: getContributingGeneralIds(definition, highestMatchingLevel.level, activeGeneralIds, profilesById),
        });
    }
    return {
        ownerPlayerId: input.ownerPlayerId,
        activeGeneralIds: [...activeGeneralIds].sort(),
        activeSynergies: activeSynergies.sort((left, right) => left.synergyId.localeCompare(right.synergyId)),
    };
}
function reconcilePlayerSynergies(input) {
    if (input.previous.ownerPlayerId !== input.next.ownerPlayerId) {
        throw new Error('Cannot reconcile synergy states owned by different players');
    }
    const definitionsById = new Map(input.definitions.map((definition) => [definition.synergyId, definition]));
    const previousById = new Map(input.previous.activeSynergies.map((synergy) => [synergy.synergyId, synergy]));
    const nextById = new Map(input.next.activeSynergies.map((synergy) => [synergy.synergyId, synergy]));
    const activated = [];
    const deactivated = [];
    const changedLevels = [];
    const reconfigured = [];
    for (const [synergyId, previous] of previousById) {
        const next = nextById.get(synergyId);
        if (!next)
            deactivated.push(previous);
        else if (next.level !== previous.level)
            changedLevels.push({ previous, next });
        else if (next.contributingGeneralIds.length !== previous.contributingGeneralIds.length
            || next.contributingGeneralIds.some((generalId, index) => generalId !== previous.contributingGeneralIds[index])) {
            reconfigured.push({ previous, next });
        }
    }
    for (const [synergyId, next] of nextById) {
        if (!previousById.has(synergyId))
            activated.push(next);
    }
    const commands = [];
    for (const synergy of [
        ...deactivated,
        ...changedLevels.map((entry) => entry.previous),
        ...reconfigured.map((entry) => entry.previous),
    ]) {
        commands.push({
            kind: 'remove_source',
            sourceKind: 'synergy',
            sourceId: synergy.synergyId,
        });
    }
    for (const synergy of [
        ...activated,
        ...changedLevels.map((entry) => entry.next),
        ...reconfigured.map((entry) => entry.next),
    ]) {
        const definition = definitionsById.get(synergy.synergyId);
        const activation = definition?.levels.find((level) => level.level === synergy.level);
        if (!definition || !activation) {
            throw new Error(`Missing synergy definition for ${synergy.synergyId} level ${synergy.level}`);
        }
        commands.push({
            kind: 'apply_effects',
            sourceKind: 'synergy',
            sourceId: synergy.synergyId,
            activationLevel: synergy.level,
            contributingGeneralIds: synergy.contributingGeneralIds,
            effects: activation.effects,
        });
    }
    const affectedGenerals = new Set();
    for (const synergy of [...activated, ...deactivated]) {
        synergy.contributingGeneralIds.forEach((generalId) => affectedGenerals.add(generalId));
    }
    for (const change of changedLevels) {
        change.previous.contributingGeneralIds.forEach((generalId) => affectedGenerals.add(generalId));
        change.next.contributingGeneralIds.forEach((generalId) => affectedGenerals.add(generalId));
    }
    for (const change of reconfigured) {
        change.previous.contributingGeneralIds.forEach((generalId) => affectedGenerals.add(generalId));
        change.next.contributingGeneralIds.forEach((generalId) => affectedGenerals.add(generalId));
    }
    const invalidateGeneralIds = [...affectedGenerals].sort();
    return {
        next: input.next,
        activated,
        deactivated,
        changedLevels,
        reconfigured,
        commands,
        invalidateGeneralIds,
        // 统一效果系统依继承白名单重算存活召唤物，不是把成员加成盲目复制给召唤物。
        refreshSummonsOwnedByGeneralIds: invalidateGeneralIds,
    };
}
function validateSynergyCatalog(input) {
    const profileIds = new Set();
    for (const profile of input.profiles) {
        if (!profile.generalId.trim() || !profile.displayName.trim()) {
            throw new Error('General synergy profile requires non-empty identity and display name');
        }
        if (profileIds.has(profile.generalId)) {
            throw new Error(`Duplicate general synergy profile: ${profile.generalId}`);
        }
        if (profile.glyphs.length < 2 || profile.glyphs.length > 4) {
            throw new Error(`General ${profile.generalId} must contain 2-4 glyphs`);
        }
        if (profile.glyphs.some((glyph) => [...glyph].length !== 1)) {
            throw new Error(`General ${profile.generalId} synergy glyphs must be single characters`);
        }
        if (new Set(profile.glyphs).size !== profile.glyphs.length) {
            throw new Error(`General ${profile.generalId} contains duplicate recipe glyphs`);
        }
        for (const facets of [profile.factions, profile.playstyles, profile.namedCollections]) {
            if (facets.some((facet) => !facet.trim()) || new Set(facets).size !== facets.length) {
                throw new Error(`General ${profile.generalId} contains invalid or duplicate facets`);
            }
        }
        profileIds.add(profile.generalId);
    }
    const synergyIds = new Set();
    for (const definition of input.definitions) {
        if (!definition.synergyId.trim() || !definition.displayName.trim()) {
            throw new Error('Synergy definition requires non-empty identity and display name');
        }
        if (synergyIds.has(definition.synergyId)) {
            throw new Error(`Duplicate synergy definition: ${definition.synergyId}`);
        }
        synergyIds.add(definition.synergyId);
        if (definition.levels.length === 0) {
            throw new Error(`Synergy ${definition.synergyId} requires at least one level`);
        }
        const levels = new Set();
        const effectIds = new Set();
        for (const activation of definition.levels) {
            if (levels.has(activation.level) || activation.level < 1) {
                throw new Error(`Invalid duplicate synergy level: ${definition.synergyId}/${activation.level}`);
            }
            levels.add(activation.level);
            if (activation.requirements.length === 0) {
                throw new Error(`Synergy level requires at least one requirement: ${definition.synergyId}/${activation.level}`);
            }
            for (const requirement of activation.requirements) {
                if (requirement.kind === 'all_generals') {
                    if (requirement.generalIds.length === 0) {
                        throw new Error(`Empty fixed member list in synergy ${definition.synergyId}`);
                    }
                    if (new Set(requirement.generalIds).size !== requirement.generalIds.length) {
                        throw new Error(`Duplicate fixed member in synergy ${definition.synergyId}`);
                    }
                    for (const generalId of requirement.generalIds) {
                        if (!profileIds.has(generalId)) {
                            throw new Error(`Unknown general ${generalId} in synergy ${definition.synergyId}`);
                        }
                    }
                }
                else if (requirement.minimum < 1) {
                    throw new Error(`Facet count minimum must be positive in ${definition.synergyId}`);
                }
                else if (!input.profiles.some((profile) => valuesForDimension(profile, requirement.dimension).includes(requirement.facetId))) {
                    throw new Error(`Unknown ${requirement.dimension} facet ${requirement.facetId} in synergy ${definition.synergyId}`);
                }
            }
            for (const effect of activation.effects) {
                if (effectIds.has(effect.effectId)) {
                    throw new Error(`Duplicate effect ${effect.effectId} in synergy ${definition.synergyId}`);
                }
                if (!Number.isFinite(effect.value)) {
                    throw new Error(`Non-finite effect value ${effect.effectId} in synergy ${definition.synergyId}`);
                }
                if ((effect.operation === 'add_flat' || effect.operation === 'add_ratio')
                    && !Number.isInteger(effect.value)) {
                    throw new Error(`V1 modifier value must be an integer: ${effect.effectId}`);
                }
                if (!effect.effectId.trim() || !effect.stackGroup.trim()) {
                    throw new Error(`Synergy effect requires non-empty identity and stack group in ${definition.synergyId}`);
                }
                const effectTarget = effect.target;
                if (effectTarget.scope === 'owner_generals_with_facet'
                    && !input.profiles.some((profile) => valuesForDimension(profile, effectTarget.dimension).includes(effectTarget.facetId))) {
                    throw new Error(`Unknown effect target facet ${effectTarget.facetId} in ${definition.synergyId}`);
                }
                if (effect.type === 'effect_parameter_patch'
                    && (!effect.targetEffectId.trim() || !effect.parameter.trim())) {
                    throw new Error(`Parameter patch requires target effect and parameter in ${definition.synergyId}`);
                }
                if (effect.type === 'stat_modifier') {
                    if (effect.target.scope === 'owner_player' && effect.stat !== 'generalExperienceGain') {
                        throw new Error(`Player-scoped synergy stat must be generalExperienceGain: ${effect.effectId}`);
                    }
                    if (effect.stat === 'generalExperienceGain' && effect.target.scope !== 'owner_player') {
                        throw new Error(`generalExperienceGain must target owner_player: ${effect.effectId}`);
                    }
                    if (effect.condition) {
                        const targetTags = effect.condition.targetTagsAny ?? [];
                        const effectTags = effect.condition.effectTagsAny ?? [];
                        if (targetTags.length === 0 && effectTags.length === 0) {
                            throw new Error(`Empty effect condition in ${effect.effectId}`);
                        }
                        if ([...targetTags, ...effectTags].some((tag) => !tag.trim())
                            || new Set(targetTags).size !== targetTags.length
                            || new Set(effectTags).size !== effectTags.length) {
                            throw new Error(`Invalid or duplicate effect condition tags in ${effect.effectId}`);
                        }
                    }
                }
                effectIds.add(effect.effectId);
            }
        }
    }
}
