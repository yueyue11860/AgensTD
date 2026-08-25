"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PveRewardService = void 0;
const rewards_1 = require("../weapon-v1/rewards");
const ledger_1 = require("./ledger");
function stableStringify(value) {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(stableStringify).join(',')}]`;
    return `{${Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
        .join(',')}}`;
}
const milestoneBatchKey = (input) => [
    'pve-reward', input.matchId, input.playerId, input.stage.difficulty, `wave-${input.milestone}`,
    rewards_1.PVE_WEAPON_REWARD_TABLE_REVISION,
].join(':');
const outcomeBatchKey = (input) => [
    'pve-reward', input.matchId, input.playerId, input.stage.difficulty, 'match-outcome',
    rewards_1.PVE_WEAPON_REWARD_TABLE_REVISION,
].join(':');
class PveRewardService {
    ledger;
    constructor(ledger = new ledger_1.PveRewardLedger()) {
        this.ledger = ledger;
    }
    recordWaveMilestone(input) {
        const batchKey = milestoneBatchKey(input);
        const fingerprint = stableStringify(input);
        const replay = this.ledger.readBatch(batchKey, fingerprint);
        if (replay)
            return replay;
        const weaponState = this.effectiveWeaponState(input);
        const dropInput = {
            matchSeed: input.matchSeed,
            stageId: input.stage.stageId,
            levelId: input.stage.levelId,
            difficulty: input.stage.difficulty,
            playerId: input.playerId,
            milestone: input.milestone,
            activatedGeneralIds: input.activatedGeneralIds,
            discoveredGeneralIds: input.discoveredGeneralIds,
            weaponState,
        };
        const baseDrops = (0, rewards_1.rollWaveMilestoneWeaponDrops)(dropInput);
        const drops = [...baseDrops];
        const bonus = input.bossFragmentBonus;
        if (bonus && baseDrops.length > 0) {
            if (bonus.extraCount !== 1
                || bonus.maxExtraPerBoss !== 1
                || bonus.qualityPolicy !== 'same_quality_random_fragment')
                throw new Error('Unsupported Boss fragment bonus policy');
            const referenceDrop = baseDrops[baseDrops.length - 1];
            const bonusDrop = (0, rewards_1.rollBossFragmentBonusDrop)({
                ...dropInput,
                chanceBps: bonus.chanceBps,
                bonusDropIndex: baseDrops.length,
                quality: referenceDrop.quality,
            });
            if (bonusDrop)
                drops.push(bonusDrop);
        }
        const events = drops.map((drop) => ({
            schemaVersion: 1,
            eventId: [batchKey, `drop-${drop.dropIndex}`].join(':'),
            rewardTableRevision: rewards_1.PVE_WEAPON_REWARD_TABLE_REVISION,
            matchId: input.matchId,
            playerId: input.playerId,
            stage: { ...input.stage },
            source: drop.dropIndex < baseDrops.length ? 'wave_milestone' : 'boss_fragment_bonus',
            milestone: input.milestone,
            ...drop,
        }));
        return this.ledger.recordBatch(batchKey, fingerprint, events);
    }
    recordMatchOutcome(input) {
        const batchKey = outcomeBatchKey(input);
        const fingerprint = stableStringify(input);
        const replay = this.ledger.readBatch(batchKey, fingerprint);
        if (replay)
            return replay;
        if (!input.officialVictory || input.stage.difficulty !== 'hard') {
            return this.ledger.recordBatch(batchKey, fingerprint, []);
        }
        const drop = (0, rewards_1.rollHardVictoryExclusiveWeaponDrop)({
            matchSeed: input.matchSeed,
            stageId: input.stage.stageId,
            levelId: input.stage.levelId,
            playerId: input.playerId,
            activatedGeneralIds: input.activatedGeneralIds,
            discoveredGeneralIds: input.discoveredGeneralIds,
            weaponState: this.effectiveWeaponState(input),
        });
        const event = {
            schemaVersion: 1,
            eventId: [batchKey, 'exclusive-drop-0'].join(':'),
            rewardTableRevision: rewards_1.PVE_WEAPON_REWARD_TABLE_REVISION,
            matchId: input.matchId,
            playerId: input.playerId,
            stage: { ...input.stage },
            source: 'hard_victory_exclusive_guarantee',
            ...drop,
        };
        return this.ledger.recordBatch(batchKey, fingerprint, [event]);
    }
    effectiveWeaponState(input) {
        const pending = this.ledger.getPlayerFragmentBalances(input.matchId, input.playerId);
        const fragmentBalances = { ...input.weaponState.fragmentBalances };
        for (const [weaponId, amount] of Object.entries(pending)) {
            fragmentBalances[weaponId] = (fragmentBalances[weaponId] ?? 0) + amount;
        }
        return { fragmentBalances, unlockedWeaponIds: input.weaponState.unlockedWeaponIds };
    }
}
exports.PveRewardService = PveRewardService;
