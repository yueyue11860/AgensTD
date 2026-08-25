"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SynergyRuntimeProjectionRegistry = void 0;
exports.settleRuntimeSynergyStat = settleRuntimeSynergyStat;
exports.settleRuntimeSynergyParameter = settleRuntimeSynergyParameter;
function profileValues(profile, dimension) {
    switch (dimension) {
        case 'faction': return profile.factions;
        case 'profession': return [profile.profession];
        case 'playstyle': return profile.playstyles;
        case 'named_collection': return profile.namedCollections;
    }
}
function intersects(required, actual) {
    if (!required || required.length === 0)
        return true;
    if (!actual || actual.length === 0)
        return false;
    const actualSet = new Set(actual);
    return required.some((tag) => actualSet.has(tag));
}
function sourceRegistryKey(ownerPlayerId, sourceId) {
    return `${ownerPlayerId}\u0000${sourceId}`;
}
/**
 * 统一羁绊运行时源注册表。
 *
 * - apply_effects 以 (ownerPlayerId, sourceId) 为原子替换单位，不叠加旧档位。
 * - remove_source 只删除精确玩家的精确羁绊源，不会伤及其他玩家或其他羁绊。
 * - 注册时保留所有合法 SynergyEffect，查询时再按主体、facet 和条件投影。
 */
class SynergyRuntimeProjectionRegistry {
    profilesById;
    sources = new Map();
    constructor(profiles) {
        const byId = new Map();
        for (const profile of profiles) {
            if (byId.has(profile.generalId)) {
                throw new Error(`Duplicate synergy runtime profile: ${profile.generalId}`);
            }
            byId.set(profile.generalId, profile);
        }
        this.profilesById = byId;
    }
    applyReconcileCommands(input) {
        const appliedSourceIds = [];
        const removedSourceIds = [];
        let appliedEffectCount = 0;
        for (const command of input.commands) {
            if (command.sourceKind !== 'synergy') {
                throw new Error(`Unsupported source kind: ${String(command.sourceKind)}`);
            }
            const key = sourceRegistryKey(input.ownerPlayerId, command.sourceId);
            if (command.kind === 'remove_source') {
                if (this.sources.delete(key))
                    removedSourceIds.push(command.sourceId);
                continue;
            }
            const contributorIds = [...new Set(command.contributingGeneralIds)].sort();
            for (const generalId of contributorIds) {
                if (!this.profilesById.has(generalId)) {
                    throw new Error(`Unknown contributing general ${generalId} in runtime source ${command.sourceId}`);
                }
            }
            const effectIds = new Set();
            for (const effect of command.effects) {
                if (effectIds.has(effect.effectId)) {
                    throw new Error(`Duplicate effect ${effect.effectId} in runtime source ${command.sourceId}`);
                }
                effectIds.add(effect.effectId);
            }
            // 上面校验全部成功后再替换，保证单源原子性。
            this.sources.set(key, {
                source: {
                    sourceKind: 'synergy',
                    sourceId: command.sourceId,
                    ownerPlayerId: input.ownerPlayerId,
                    activationLevel: command.activationLevel,
                    contributingGeneralIds: contributorIds,
                },
                effects: [...command.effects],
            });
            appliedSourceIds.push(command.sourceId);
            appliedEffectCount += command.effects.length;
        }
        return { appliedSourceIds, removedSourceIds, appliedEffectCount };
    }
    removePlayer(ownerPlayerId) {
        let removed = 0;
        for (const [key, source] of this.sources) {
            if (source.source.ownerPlayerId !== ownerPlayerId)
                continue;
            this.sources.delete(key);
            removed += 1;
        }
        return removed;
    }
    query(query) {
        const result = {
            statModifiers: [],
            parameterPatches: [],
            excluded: [],
        };
        const candidates = [...this.sources.values()]
            .filter((stored) => stored.source.ownerPlayerId === query.subject.ownerPlayerId)
            .sort((left, right) => left.source.sourceId.localeCompare(right.source.sourceId));
        for (const stored of candidates) {
            for (const effect of stored.effects) {
                const targetMatches = this.targetMatches(effect, stored.source, query.subject);
                if (!targetMatches) {
                    result.excluded.push({
                        sourceId: stored.source.sourceId,
                        effect,
                        reason: 'target_scope_mismatch',
                    });
                    continue;
                }
                if (effect.type === 'stat_modifier') {
                    if (!intersects(effect.condition?.targetTagsAny, query.targetTags)) {
                        result.excluded.push({ sourceId: stored.source.sourceId, effect, reason: 'target_condition_mismatch' });
                        continue;
                    }
                    if (!intersects(effect.condition?.effectTagsAny, query.effectTags)) {
                        result.excluded.push({ sourceId: stored.source.sourceId, effect, reason: 'effect_condition_mismatch' });
                        continue;
                    }
                    result.statModifiers.push({
                        ...stored.source,
                        effectId: effect.effectId,
                        type: effect.type,
                        stat: effect.stat,
                        operation: effect.operation,
                        value: effect.value,
                        stackGroup: effect.stackGroup,
                    });
                    continue;
                }
                if (query.targetEffectId && effect.targetEffectId !== query.targetEffectId) {
                    result.excluded.push({ sourceId: stored.source.sourceId, effect, reason: 'target_effect_mismatch' });
                    continue;
                }
                result.parameterPatches.push({
                    ...stored.source,
                    effectId: effect.effectId,
                    type: effect.type,
                    targetEffectId: effect.targetEffectId,
                    parameter: effect.parameter,
                    operation: effect.operation,
                    value: effect.value,
                    stackGroup: effect.stackGroup,
                });
            }
        }
        result.statModifiers.sort(compareRuntimeEffect);
        result.parameterPatches.sort(compareRuntimeEffect);
        return result;
    }
    activeSources(ownerPlayerId) {
        return [...this.sources.values()]
            .filter((stored) => ownerPlayerId === undefined || stored.source.ownerPlayerId === ownerPlayerId)
            .map((stored) => ({ ...stored.source }))
            .sort((left, right) => left.ownerPlayerId.localeCompare(right.ownerPlayerId)
            || left.sourceId.localeCompare(right.sourceId));
    }
    targetMatches(effect, source, subject) {
        switch (effect.target.scope) {
            case 'synergy_members':
                return subject.kind === 'general'
                    && source.contributingGeneralIds.includes(subject.generalId);
            case 'owner_generals_with_facet': {
                if (subject.kind !== 'general')
                    return false;
                const profile = this.profilesById.get(subject.generalId);
                return Boolean(profile && profileValues(profile, effect.target.dimension).includes(effect.target.facetId));
            }
            case 'owned_summons_of_synergy_members':
                return subject.kind === 'summon'
                    && source.contributingGeneralIds.includes(subject.sourceGeneralId);
            case 'owner_player':
                return subject.kind === 'player';
        }
    }
}
exports.SynergyRuntimeProjectionRegistry = SynergyRuntimeProjectionRegistry;
function compareRuntimeEffect(left, right) {
    return left.sourceId.localeCompare(right.sourceId) || left.effectId.localeCompare(right.effectId);
}
/** 按统一操作顺序结算单项属性，支持 SynergyModifierOperation 全集。 */
function settleRuntimeSynergyStat(input) {
    let addFlat = 0;
    let addRatio = 0;
    let multiplier = 1;
    let lowerBound = Number.NEGATIVE_INFINITY;
    let upperBound = Number.POSITIVE_INFINITY;
    for (const modifier of input.modifiers) {
        if (modifier.stat !== input.stat)
            continue;
        switch (modifier.operation) {
            case 'add_flat':
                addFlat += modifier.value;
                break;
            case 'add_ratio':
                addRatio += modifier.value;
                break;
            case 'multiply':
                multiplier *= modifier.value;
                break;
            case 'min':
                upperBound = Math.min(upperBound, modifier.value);
                break;
            case 'max':
                lowerBound = Math.max(lowerBound, modifier.value);
                break;
        }
    }
    return Math.min(upperBound, Math.max(lowerBound, (input.baseValue + addFlat) * (10000 + addRatio) / 10000 * multiplier));
}
/**
 * 结算某个具名技能参数。add_ratio 使用基点，multiply 使用直接倍率；
 * 同层先汇总 add_flat/add_ratio，再乘以全部 multiply，从而不依赖 catalog 顺序。
 */
function settleRuntimeSynergyParameter(input) {
    let addFlat = 0;
    let addRatio = 0;
    let multiplier = 1;
    for (const patch of input.patches) {
        if (patch.parameter !== input.parameter)
            continue;
        switch (patch.operation) {
            case 'add_flat':
                addFlat += patch.value;
                break;
            case 'add_ratio':
                addRatio += patch.value;
                break;
            case 'multiply':
                multiplier *= patch.value;
                break;
        }
    }
    return (input.baseValue + addFlat) * (10000 + addRatio) / 10000 * multiplier;
}
