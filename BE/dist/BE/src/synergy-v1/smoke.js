"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSynergyV1SmokeChecks = runSynergyV1SmokeChecks;
const strict_1 = __importDefault(require("node:assert/strict"));
const catalog_1 = require("./catalog");
const roster_1 = require("../core/hero-v1/roster");
const engine_1 = require("./engine");
const settlement_1 = require("./settlement");
const catalog_2 = require("../core/hero-v1/catalog");
const hero_v1_adapter_1 = require("./hero-v1-adapter");
const runtime_projection_smoke_1 = require("./runtime-projection-smoke");
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
    (0, runtime_projection_smoke_1.runSynergyRuntimeProjectionSmokeChecks)();
    strict_1.default.equal(roster_1.GENERAL_ROSTER.length, 21);
    strict_1.default.equal(catalog_1.GENERAL_SYNERGY_PROFILES.length, 21);
    strict_1.default.equal(catalog_1.SYNERGY_V1_CATALOG.length, 22);
    strict_1.default.deepEqual(catalog_1.GENERAL_SYNERGY_PROFILES.map((profile) => profile.generalId).sort(), roster_1.GENERAL_ROSTER.map((entry) => entry.generalId).sort(), '羁绊画像必须从权威 roster 一对一派生');
    (0, engine_1.validateSynergyCatalog)({
        profiles: catalog_1.GENERAL_SYNERGY_PROFILES,
        definitions: catalog_1.SYNERGY_V1_CATALOG,
    });
    (0, catalog_1.validateGeneralDevelopmentSequence)();
    strict_1.default.equal(catalog_1.GENERAL_DEVELOPMENT_SEQUENCE.length, roster_1.GENERAL_ROSTER.length);
    strict_1.default.equal(new Set(catalog_1.GENERAL_DEVELOPMENT_SEQUENCE.map((step) => step.generalId)).size, roster_1.GENERAL_ROSTER.length);
    const closedSynergies = catalog_1.GENERAL_DEVELOPMENT_SEQUENCE.flatMap((step) => [...step.closesSynergies]);
    strict_1.default.equal(closedSynergies.length, catalog_1.SYNERGY_V1_CATALOG.length);
    strict_1.default.equal(new Set(closedSynergies).size, catalog_1.SYNERGY_V1_CATALOG.length);
    const knownGeneralIds = new Set(roster_1.GENERAL_ROSTER.map((entry) => entry.generalId));
    for (const definition of catalog_1.SYNERGY_V1_CATALOG) {
        strict_1.default.equal(definition.levels.length, 1, `${definition.synergyId} 首版必须只有一个固定成员档位`);
        const fixedMembers = definition.levels[0].requirements.flatMap((requirement) => requirement.kind === 'all_generals' ? [...requirement.generalIds] : []);
        strict_1.default.ok(fixedMembers.length >= 2, `${definition.synergyId} 必须是至少二人的固定组合`);
        fixedMembers.forEach((generalId) => strict_1.default.ok(knownGeneralIds.has(generalId), `${definition.synergyId} 引用了未注册神将 ${generalId}`));
        strict_1.default.ok(definition.levels[0].effects.length > 0, `${definition.synergyId} 不得使用空效果占位`);
    }
    for (const profile of catalog_1.GENERAL_SYNERGY_PROFILES) {
        strict_1.default.ok((catalog_1.GENERAL_SYNERGY_IDS_BY_GENERAL[profile.generalId]?.length ?? 0) >= 1, `${profile.displayName} 必须至少参与一条羁绊`);
    }
    strict_1.default.equal(JSON.stringify(catalog_1.SYNERGY_V1_CATALOG).includes('allAttributes'), false);
    const buddhistFerry = catalog_1.SYNERGY_V1_CATALOG.find((entry) => entry.synergyId === 'buddhist_ferry');
    strict_1.default.ok(buddhistFerry.levels[0].effects.some((effect) => effect.type === 'stat_modifier'
        && effect.stat === 'controlDuration'
        && effect.value === 2000));
    strict_1.default.equal(buddhistFerry.levels[0].effects.filter((effect) => effect.type === 'effect_parameter_patch'
        && effect.parameter === 'magnitude'
        && effect.operation === 'add_ratio'
        && effect.value === 1000).length, 2);
    const curtainDragon = catalog_1.SYNERGY_V1_CATALOG.find((entry) => entry.synergyId === 'curtain_dragon');
    strict_1.default.ok(curtainDragon.levels[0].effects.some((effect) => effect.type === 'stat_modifier'
        && effect.stat === 'damageDealt'
        && effect.value === 1500
        && effect.condition?.effectTagsAny?.includes('active_skill')));
    strict_1.default.ok(curtainDragon.levels[0].effects.some((effect) => effect.type === 'stat_modifier'
        && effect.stat === 'attackSpeed'
        && effect.value === 1000));
    const pilgrimageFive = catalog_1.SYNERGY_V1_CATALOG.find((entry) => entry.synergyId === 'pilgrimage_five');
    strict_1.default.ok(pilgrimageFive.levels[0].effects.some((effect) => effect.type === 'stat_modifier'
        && effect.target.scope === 'owner_player'
        && effect.stat === 'generalExperienceGain'
        && effect.value === 2000));
    const longevityDefinition = catalog_1.SYNERGY_V1_CATALOG.find((entry) => entry.synergyId === 'longevity_immortals');
    strict_1.default.deepEqual(longevityDefinition.levels[0].effects.map((effect) => effect.type === 'stat_modifier' ? [effect.stat, effect.operation, effect.value] : null), [
        ['controlDuration', 'add_ratio', 1500],
        ['cooldownReduction', 'add_ratio', 1000],
    ]);
    const heavenlyCluster = (0, engine_1.evaluatePlayerSynergies)({
        ownerPlayerId: 'player-1',
        formations: [
            roster_1.GENERAL_IDS.YANGJIAN,
            roster_1.GENERAL_IDS.NAZHA,
            roster_1.GENERAL_IDS.LIJING,
            roster_1.GENERAL_IDS.HOUYI,
            roster_1.GENERAL_IDS.YU_HUANG_DADI,
            roster_1.GENERAL_IDS.LEI_GONG,
            roster_1.GENERAL_IDS.DIAN_MU,
        ].map((generalId) => formed(generalId)),
        profiles: catalog_1.GENERAL_SYNERGY_PROFILES,
        definitions: catalog_1.SYNERGY_V1_CATALOG,
    });
    strict_1.default.deepEqual(heavenlyCluster.activeSynergies.map((entry) => entry.synergyId), [
        'heaven_vanguard',
        'heavenly_court_saints',
        'lotus_father_and_son',
        'physical_heavenly_venerates',
        'piercing_cloud_duo',
        'thunder_duo',
    ]);
    const pilgrimageFormations = [
        roster_1.GENERAL_IDS.TANG_SANZANG,
        roster_1.GENERAL_IDS.SUNWUKONG,
        roster_1.GENERAL_IDS.ZHU_BAJIE,
        roster_1.GENERAL_IDS.SHA_WUJING,
        roster_1.GENERAL_IDS.BAI_LONGMA,
    ].map((generalId) => formed(generalId));
    const pilgrimageCluster = (0, engine_1.evaluatePlayerSynergies)({
        ownerPlayerId: 'player-1',
        formations: pilgrimageFormations,
        profiles: catalog_1.GENERAL_SYNERGY_PROFILES,
        definitions: catalog_1.SYNERGY_V1_CATALOG,
    });
    strict_1.default.deepEqual(pilgrimageCluster.activeSynergies.map((entry) => entry.synergyId), [
        'curtain_canopy',
        'curtain_dragon',
        'mentor_and_disciple',
        'pilgrimage_five',
        'pilgrimage_three_disciples',
        'senior_brothers',
    ]);
    const pilgrimageWithoutWhiteDragon = (0, engine_1.evaluatePlayerSynergies)({
        ownerPlayerId: 'player-1',
        formations: pilgrimageFormations.filter((formation) => formation.generalId !== roster_1.GENERAL_IDS.BAI_LONGMA),
        profiles: catalog_1.GENERAL_SYNERGY_PROFILES,
        definitions: catalog_1.SYNERGY_V1_CATALOG,
    });
    const pilgrimageRemoval = (0, engine_1.reconcilePlayerSynergies)({
        previous: pilgrimageCluster,
        next: pilgrimageWithoutWhiteDragon,
        definitions: catalog_1.SYNERGY_V1_CATALOG,
    });
    strict_1.default.deepEqual(pilgrimageRemoval.deactivated.map((entry) => entry.synergyId), [
        'curtain_dragon',
        'pilgrimage_five',
    ]);
    strict_1.default.deepEqual(pilgrimageRemoval.commands.filter((command) => command.kind === 'remove_source').map((command) => command.sourceId), [
        'curtain_dragon',
        'pilgrimage_five',
    ]);
    const longevity = (0, engine_1.evaluatePlayerSynergies)({
        ownerPlayerId: 'player-1',
        formations: [formed(roster_1.GENERAL_IDS.SHOU_XING), formed(roster_1.GENERAL_IDS.TAI_SHANG_LAOJUN)],
        profiles: catalog_1.GENERAL_SYNERGY_PROFILES,
        definitions: catalog_1.SYNERGY_V1_CATALOG,
    });
    strict_1.default.deepEqual(longevity.activeSynergies.map((entry) => entry.synergyId), ['longevity_immortals']);
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
