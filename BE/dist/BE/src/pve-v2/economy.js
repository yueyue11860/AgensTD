"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PVE_FULL_MATCH_BASE_GROSS_RICE = exports.PVE_BOSS_RICE_REWARD_BY_WAVE = exports.PVE_CONTROL_XP_SHARE_CAP_BPS = exports.PVE_PAID_RECRUIT_SOFT_CAP_BATCHES = exports.PVE_ORDINARY_ENEMY_RICE_REWARD = exports.PVE_STARTING_RICE = void 0;
exports.resolvePvePaidRecruitBaseCost = resolvePvePaidRecruitBaseCost;
exports.resolvePveLaneClearRiceReward = resolvePveLaneClearRiceReward;
exports.resolvePveBossRiceReward = resolvePveBossRiceReward;
exports.allocatePveBaseXpByContribution = allocatePveBaseXpByContribution;
exports.PVE_STARTING_RICE = 10;
exports.PVE_ORDINARY_ENEMY_RICE_REWARD = 1;
exports.PVE_PAID_RECRUIT_SOFT_CAP_BATCHES = 30;
exports.PVE_CONTROL_XP_SHARE_CAP_BPS = 2000;
exports.PVE_BOSS_RICE_REWARD_BY_WAVE = Object.freeze({
    5: 3,
    10: 5,
    15: 8,
    20: 12,
});
/** completedPaidBatches is zero before the first paid batch; free refreshes never increment it. */
function resolvePvePaidRecruitBaseCost(completedPaidBatches) {
    if (!Number.isSafeInteger(completedPaidBatches) || completedPaidBatches < 0) {
        throw new Error('completedPaidBatches must be a non-negative safe integer');
    }
    return 5 + Math.floor(completedPaidBatches / 3)
        + (completedPaidBatches >= exports.PVE_PAID_RECRUIT_SOFT_CAP_BATCHES ? 2 : 0);
}
function resolvePveLaneClearRiceReward(waveNumber) {
    if (!Number.isSafeInteger(waveNumber) || waveNumber < 1 || waveNumber > 20) {
        throw new Error('waveNumber must be an integer from 1 to 20');
    }
    if (waveNumber <= 4)
        return 3;
    if (waveNumber <= 9)
        return 4;
    if (waveNumber <= 14)
        return 5;
    if (waveNumber <= 19)
        return 6;
    return 10;
}
function resolvePveBossRiceReward(waveNumber) {
    return exports.PVE_BOSS_RICE_REWARD_BY_WAVE[waveNumber] ?? 0;
}
exports.PVE_FULL_MATCH_BASE_GROSS_RICE = exports.PVE_STARTING_RICE
    + 20 * 10 * exports.PVE_ORDINARY_ENEMY_RICE_REWARD
    + Object.values(exports.PVE_BOSS_RICE_REWARD_BY_WAVE).reduce((sum, reward) => sum + reward, 0)
    + Array.from({ length: 20 }, (_, index) => resolvePveLaneClearRiceReward(index + 1))
        .reduce((sum, reward) => sum + reward, 0);
function allocateEqual(points, entries) {
    const allocations = new Map();
    if (points <= 0 || entries.length === 0)
        return allocations;
    const sorted = [...entries].sort((left, right) => left.contributionKey.localeCompare(right.contributionKey));
    const quotient = Math.floor(points / sorted.length);
    let remainder = points % sorted.length;
    for (const entry of sorted) {
        allocations.set(entry.contributionKey, quotient + (remainder > 0 ? 1 : 0));
        remainder = Math.max(0, remainder - 1);
    }
    return allocations;
}
/**
 * Current contribution telemetry records contributor/category/last tick, not exact damage or control duration.
 * This deterministic minimum split therefore divides each pool equally by eligible contributor. Control uses
 * at most 20% of base XP; when no damage contribution exists the unassigned 80% is deliberately not invented.
 */
function allocatePveBaseXpByContribution(baseExperiencePoints, contributions) {
    if (!Number.isSafeInteger(baseExperiencePoints) || baseExperiencePoints < 0) {
        throw new Error('baseExperiencePoints must be a non-negative safe integer');
    }
    const unique = [...new Map(contributions.map(entry => [entry.contributionKey, entry])).values()];
    const control = unique.filter(entry => entry.category === 'control');
    const damage = unique.filter(entry => entry.category !== 'control');
    const controlCap = Math.floor(baseExperiencePoints * exports.PVE_CONTROL_XP_SHARE_CAP_BPS / 10_000);
    const weightedControlShare = control.length === 0 ? 0 : Math.floor(baseExperiencePoints * control.length / (control.length + damage.length * 4));
    const controlPoints = Math.min(controlCap, weightedControlShare);
    const damagePoints = damage.length > 0 ? baseExperiencePoints - controlPoints : 0;
    const result = allocateEqual(damagePoints, damage);
    for (const [key, points] of allocateEqual(controlPoints, control)) {
        result.set(key, (result.get(key) ?? 0) + points);
    }
    return result;
}
