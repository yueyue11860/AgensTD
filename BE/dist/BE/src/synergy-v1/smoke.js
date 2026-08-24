"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSynergyV1SmokeChecks = runSynergyV1SmokeChecks;
const strict_1 = __importDefault(require("node:assert/strict"));
const catalog_1 = require("./catalog");
const engine_1 = require("./engine");
const settlement_1 = require("./settlement");
const catalog_2 = require("../core/hero-v1/catalog");
const hero_v1_adapter_1 = require("./hero-v1-adapter");
function formed(generalId, overrides = {}) {
    return {
        ownerPlayerId: 'player-1',
        generalId,
        zone: 'board',
        isFormed: true,
        isFixed: false,
        constituentTokenIds: [`${generalId}-glyph-1`, `${generalId}-glyph-2`],
        ...overrides,
    };
}
function runSynergyV1SmokeChecks() {
    (0, engine_1.validateSynergyCatalog)({
        profiles: catalog_1.GENERAL_SYNERGY_PROFILES,
        definitions: catalog_1.SYNERGY_V1_CATALOG,
    });
    const noPartner = (0, engine_1.evaluatePlayerSynergies)({
        ownerPlayerId: 'player-1',
        formations: [formed('houyi')],
        profiles: catalog_1.GENERAL_SYNERGY_PROFILES,
        definitions: catalog_1.SYNERGY_V1_CATALOG,
    });
    strict_1.default.deepEqual(noPartner.activeSynergies, []);
    const active = (0, engine_1.evaluatePlayerSynergies)({
        ownerPlayerId: 'player-1',
        formations: [formed('houyi'), formed('chang_e', { isFixed: true })],
        profiles: catalog_1.GENERAL_SYNERGY_PROFILES,
        definitions: catalog_1.SYNERGY_V1_CATALOG,
    });
    strict_1.default.deepEqual(active.activeSynergies, [
        {
            synergyId: 'moon_palace_companions',
            level: 1,
            contributingGeneralIds: ['chang_e', 'houyi'],
        },
    ]);
    const unlocked = (0, engine_1.evaluatePlayerSynergies)({
        ownerPlayerId: 'player-1',
        formations: [formed('houyi'), formed('chang_e', { isFixed: false })],
        profiles: catalog_1.GENERAL_SYNERGY_PROFILES,
        definitions: catalog_1.SYNERGY_V1_CATALOG,
    });
    strict_1.default.deepEqual(unlocked, active, '固定/解除固定不得改变羁绊');
    const ignoredStorageAndOtherPlayer = (0, engine_1.evaluatePlayerSynergies)({
        ownerPlayerId: 'player-1',
        formations: [
            formed('houyi'),
            formed('chang_e', { zone: 'tray' }),
            formed('chang_e', { zone: 'reserve' }),
            formed('chang_e', { ownerPlayerId: 'player-2' }),
        ],
        profiles: catalog_1.GENERAL_SYNERGY_PROFILES,
        definitions: catalog_1.SYNERGY_V1_CATALOG,
    });
    strict_1.default.deepEqual(ignoredStorageAndOtherPlayer.activeSynergies, []);
    const broken = (0, engine_1.evaluatePlayerSynergies)({
        ownerPlayerId: 'player-1',
        formations: [formed('houyi'), formed('chang_e', { isFormed: false })],
        profiles: catalog_1.GENERAL_SYNERGY_PROFILES,
        definitions: catalog_1.SYNERGY_V1_CATALOG,
    });
    const disabled = (0, engine_1.reconcilePlayerSynergies)({
        previous: active,
        next: broken,
        definitions: catalog_1.SYNERGY_V1_CATALOG,
    });
    strict_1.default.deepEqual(disabled.deactivated, active.activeSynergies);
    strict_1.default.deepEqual(disabled.commands, [
        {
            kind: 'remove_source',
            sourceKind: 'synergy',
            sourceId: 'moon_palace_companions',
        },
    ]);
    const enabled = (0, engine_1.reconcilePlayerSynergies)({
        previous: noPartner,
        next: active,
        definitions: catalog_1.SYNERGY_V1_CATALOG,
    });
    strict_1.default.equal(enabled.commands.length, 1);
    strict_1.default.equal(enabled.commands[0]?.kind, 'apply_effects');
    strict_1.default.deepEqual(enabled.invalidateGeneralIds, ['chang_e', 'houyi']);
    strict_1.default.deepEqual(enabled.refreshSummonsOwnedByGeneralIds, ['chang_e', 'houyi']);
    const applyCommand = enabled.commands[0];
    strict_1.default.equal(applyCommand?.kind, 'apply_effects');
    if (applyCommand?.kind !== 'apply_effects')
        throw new Error('Expected apply command');
    const heroModifiers = (0, hero_v1_adapter_1.toHeroV1GeneralStatModifiers)({
        sourceSynergyId: applyCommand.sourceId,
        contributingGeneralIds: applyCommand.contributingGeneralIds,
        effects: applyCommand.effects,
    });
    const resolvedHouyi = (0, catalog_2.resolveGeneralStats)(catalog_2.HOUYI_DEFINITION, 1, heroModifiers);
    strict_1.default.equal(resolvedHouyi.attackRangeMilliCells, 3500);
    strict_1.default.equal(resolvedHouyi.attackIntervalMs, 1228);
    const physicalFacetSynergy = {
        schemaVersion: 1,
        synergyId: 'test_physical_pair',
        displayName: '测试物理二人',
        category: 'profession',
        activationScope: 'owner_board_formed_generals',
        levels: [
            {
                level: 1,
                requirements: [
                    { kind: 'facet_count', dimension: 'profession', facetId: 'physical', minimum: 2 },
                ],
                effects: [],
            },
        ],
        status: 'prototype',
    };
    const duplicatesDoNotCountTwice = (0, engine_1.evaluatePlayerSynergies)({
        ownerPlayerId: 'player-1',
        formations: [formed('houyi'), formed('houyi')],
        profiles: catalog_1.GENERAL_SYNERGY_PROFILES,
        definitions: [physicalFacetSynergy],
    });
    strict_1.default.deepEqual(duplicatesDoNotCountTwice.activeSynergies, []);
    const twoPhysicalGenerals = (0, engine_1.evaluatePlayerSynergies)({
        ownerPlayerId: 'player-1',
        formations: [formed('houyi'), formed('yangjian')],
        profiles: catalog_1.GENERAL_SYNERGY_PROFILES,
        definitions: [physicalFacetSynergy],
    });
    strict_1.default.equal(twoPhysicalGenerals.activeSynergies[0]?.synergyId, 'test_physical_pair');
    const tieredPhysicalSynergy = {
        ...physicalFacetSynergy,
        synergyId: 'test_tiered_physical',
        levels: [
            physicalFacetSynergy.levels[0],
            {
                level: 2,
                requirements: [
                    { kind: 'facet_count', dimension: 'profession', facetId: 'physical', minimum: 3 },
                ],
                effects: [],
            },
        ],
    };
    const highestTierOnly = (0, engine_1.evaluatePlayerSynergies)({
        ownerPlayerId: 'player-1',
        formations: [formed('houyi'), formed('yangjian'), formed('nazha')],
        profiles: catalog_1.GENERAL_SYNERGY_PROFILES,
        definitions: [tieredPhysicalSynergy],
    });
    strict_1.default.equal(highestTierOnly.activeSynergies[0]?.level, 2);
    strict_1.default.throws(() => (0, engine_1.validateSynergyCatalog)({
        profiles: catalog_1.GENERAL_SYNERGY_PROFILES,
        definitions: [{
                ...catalog_1.MOON_PALACE_COMPANIONS,
                synergyId: 'invalid_unknown_general',
                levels: [{
                        ...catalog_1.MOON_PALACE_COMPANIONS.levels[0],
                        requirements: [{ kind: 'all_generals', generalIds: ['houyi', 'not_registered'] }],
                    }],
            }],
    }), /Unknown general not_registered/);
    const attackSpeed = (0, settlement_1.settleNumericStat)(1, [
        {
            sourceKind: 'synergy',
            sourceId: catalog_1.MOON_PALACE_COMPANIONS.synergyId,
            stat: 'attackSpeed',
            operation: 'add_ratio',
            value: 1000,
        },
        {
            sourceKind: 'synergy',
            sourceId: 'another_synergy',
            stat: 'attackSpeed',
            operation: 'add_ratio',
            value: 1500,
        },
    ]);
    strict_1.default.equal(attackSpeed, 1.25, '同层 add_ratio 先加法汇总');
    strict_1.default.equal((0, settlement_1.settleSkillCooldownMs)({ baseCooldownMs: 10_000, reductionBps: [2500, 3000] }), 6_000, '常驻减 CD 不得超过 40%');
    strict_1.default.equal((0, settlement_1.settleSkillCooldownMs)({
        baseCooldownMs: 1_500,
        reductionBps: [4000],
        flatReductionMs: 500,
    }), 1_000, '最终技能 CD 不得低于 1 秒');
    const summonStats = (0, settlement_1.inheritSummonStats)({
        summonBaseStats: { attackRange: 2, critRate: 0.05 },
        ownerFinalStats: { attack: 200, attackSpeed: 1.5, attackRange: 3.5 },
        inheritance: [
            { ownerStat: 'attack', summonStat: 'summonAttack', ratio: 0.5 },
            { ownerStat: 'attackSpeed', summonStat: 'summonAttackSpeed', ratio: 1 },
        ],
    });
    strict_1.default.deepEqual(summonStats, {
        attackRange: 2,
        critRate: 0.05,
        summonAttack: 100,
        summonAttackSpeed: 1.5,
    });
}
if (require.main === module) {
    runSynergyV1SmokeChecks();
    console.log('synergy-v1 smoke checks passed');
}
