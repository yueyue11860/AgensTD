"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRecruitRuleProfile = buildRecruitRuleProfile;
exports.applyRecruitBatchGuarantees = applyRecruitBatchGuarantees;
exports.shouldGrantExtraBossFragment = shouldGrantExtraBossFragment;
function buildRecruitRuleProfile(projection, baseCharacterProbabilityBps = 1_000, baseReserveCapacity = 2, basePopulationCap = 10) {
    return {
        characterProbabilityBps: projection.characterProbabilityBps ?? baseCharacterProbabilityBps,
        pityTriggerAfterNoCharacterBatches: projection.characterPity?.triggerAfterNoCharacterBatches,
        reserveCapacity: baseReserveCapacity + projection.reserveCapacityBonus,
        populationCap: basePopulationCap + projection.populationCapBonus,
    };
}
/**
 * 实现设计稿锁定顺序中的第 3、4、6 步。字符 Token 的实际消费由征兵适配器原子提交，
 * 本函数只产出确定的槽位种类决策，不复制、创建或移动 Token。
 */
function applyRecruitBatchGuarantees(input, projection) {
    const finalKinds = [...input.generatedKinds];
    let forcedSoldierIndex;
    let pityCharacterIndex;
    if (input.isFirstBatch && finalKinds.length > 0 && finalKinds.every((kind) => kind === 'character')) {
        forcedSoldierIndex = chooseValidatedIndex(input.chooseIndex, finalKinds.map((_, index) => index), 'first_batch_soldier');
        setRecruitKind(finalKinds, forcedSoldierIndex, 'soldier');
    }
    const pity = projection.characterPity;
    const isPityBatch = Boolean(input.isPaidRecruit
        && pity
        && input.pityState.noCharacterPaidBatchStreak >= pity.triggerAfterNoCharacterBatches);
    if (isPityBatch
        && input.hasRemainingCharacterToken
        && finalKinds.every((kind) => kind === 'soldier')) {
        const candidates = finalKinds
            .map((_, index) => index)
            .filter((index) => index !== forcedSoldierIndex);
        if (candidates.length > 0) {
            pityCharacterIndex = chooseValidatedIndex(input.chooseIndex, candidates, 'character_pity');
            setRecruitKind(finalKinds, pityCharacterIndex, 'character');
        }
    }
    const hasCharacter = finalKinds.some((kind) => kind === 'character');
    const nextStreak = input.isPaidRecruit
        ? (hasCharacter ? 0 : input.pityState.noCharacterPaidBatchStreak + 1)
        : input.pityState.noCharacterPaidBatchStreak;
    return {
        finalKinds,
        forcedSoldierIndex,
        pityCharacterIndex,
        nextPityState: { noCharacterPaidBatchStreak: nextStreak },
    };
}
function shouldGrantExtraBossFragment(rollBps, projection) {
    if (!Number.isInteger(rollBps) || rollBps < 0 || rollBps >= 10_000) {
        throw new Error('rollBps must be an integer in [0, 10000)');
    }
    return Boolean(projection.bossFragmentBonus && rollBps < projection.bossFragmentBonus.chanceBps);
}
function chooseValidatedIndex(chooseIndex, candidates, reason) {
    const selected = chooseIndex(candidates, reason);
    if (!candidates.includes(selected))
        throw new Error(`PRNG adapter selected illegal ${reason} index ${selected}`);
    return selected;
}
function setRecruitKind(kinds, index, kind) {
    kinds[index] = kind;
}
