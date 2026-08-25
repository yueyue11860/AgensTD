"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runHeroV1Smoke = runHeroV1Smoke;
const strict_1 = __importDefault(require("node:assert/strict"));
const catalog_1 = require("./catalog");
const combat_engine_1 = require("./combat-engine");
const formation_manager_1 = require("./formation-manager");
const token = (tokenId, glyph, x, y = 5) => ({ tokenId, ownerPlayerId: 'player-1', glyph, x, y });
function runHeroV1Smoke() {
    (0, catalog_1.validateGeneralDefinition)(catalog_1.HOUYI_DEFINITION);
    strict_1.default.equal(catalog_1.HOUYI_DEFINITION.generalId, 'houyi');
    strict_1.default.deepEqual(catalog_1.HOUYI_DEFINITION.recipe.glyphs, ['后', '羿']);
    strict_1.default.deepEqual(catalog_1.HOUYI_DEFINITION.baseStats.attackRangeMilliCellsByLevel, [3000, 3000, 3000, 3000, 3000]);
    strict_1.default.equal((0, catalog_1.cumulativeExperienceRequiredForLevel)(catalog_1.HOUYI_DEFINITION, 5), 120000);
    const moonPalaceModifiers = [
        {
            source: { kind: 'synergy', sourceId: 'moon_palace_companions' },
            target: { scope: 'synergy_members', generalIds: ['houyi', 'chang_e'] },
            stat: 'attackRange',
            operation: 'add_flat',
            value: 500,
            stackGroup: 'moon_palace_companions_range',
        },
        {
            source: { kind: 'synergy', sourceId: 'moon_palace_companions' },
            target: { scope: 'synergy_members', generalIds: ['houyi', 'chang_e'] },
            stat: 'attackSpeed',
            operation: 'add_ratio',
            value: 1000,
            stackGroup: 'moon_palace_companions_attack_speed',
        },
    ];
    const levelThreeStats = (0, catalog_1.resolveGeneralStats)(catalog_1.HOUYI_DEFINITION, 3, moonPalaceModifiers);
    strict_1.default.equal(levelThreeStats.attack, 55);
    strict_1.default.equal(levelThreeStats.attackRangeMilliCells, 3500);
    strict_1.default.equal(levelThreeStats.attackIntervalMs, 1046);
    const manager = new formation_manager_1.GeneralFormationManager();
    const wrongOrder = manager.reconcilePlayer('player-1', [token('token-yi', '羿', 1), token('token-hou', '后', 2)], 0, 10, 10);
    strict_1.default.equal(wrongOrder.activeFormations.length, 0);
    const formed = manager.reconcilePlayer('player-1', [token('token-hou', '后', 1), token('token-yi', '羿', 2)], 9, 10, 11);
    strict_1.default.equal(formed.ok, true);
    strict_1.default.equal(formed.populationUsed, 10);
    strict_1.default.deepEqual(formed.activatedGeneralIds, ['houyi']);
    strict_1.default.deepEqual(formed.activeFormations[0].anchorMilli, { x: 1500, y: 5000 });
    const fixed = manager.setFixed('player-1', formed.activeFormations[0].formationId, true);
    strict_1.default.equal(fixed?.fixed, true);
    const movePlan = manager.planFixedFormationMove('player-1', formed.activeFormations[0].formationId, { x: 4, y: 5 }, () => true, () => false);
    strict_1.default.equal(movePlan.ok, true);
    strict_1.default.deepEqual(movePlan.tokenMoves.map((move) => move.to), [{ x: 4, y: 5 }, { x: 5, y: 5 }]);
    strict_1.default.equal(manager.addExperience('player-1', 'houyi', 120000)?.level, 3);
    const disbanded = manager.reconcilePlayer('player-1', [token('token-hou', '后', 1)], 9, 10, 20);
    strict_1.default.deepEqual(disbanded.deactivatedGeneralIds, ['houyi']);
    strict_1.default.equal(manager.getProgress('player-1', 'houyi')?.experiencePoints, 120000);
    const reformed = manager.reconcilePlayer('player-1', [token('replacement-hou', '后', 7), token('replacement-yi', '羿', 8)], 9, 10, 30);
    strict_1.default.deepEqual(reformed.activatedGeneralIds, ['houyi']);
    strict_1.default.equal(manager.getProgress('player-1', 'houyi')?.level, 3);
    strict_1.default.equal(manager.setBreakthrough('player-1', 'houyi', true)?.level, 5);
    const blockedManager = new formation_manager_1.GeneralFormationManager();
    const blocked = blockedManager.reconcilePlayer('player-1', [token('blocked-hou', '后', 1), token('blocked-yi', '羿', 2)], 10, 10, 1);
    strict_1.default.equal(blocked.ok, false);
    strict_1.default.equal(blocked.code, 'POPULATION_LIMIT');
    const formation = reformed.activeFormations[0];
    const progress = manager.getProgress('player-1', 'houyi');
    strict_1.default.ok(progress);
    const enemies = [
        {
            id: 'furthest',
            xMilli: 9500,
            yMilli: 5000,
            currentHp: 100,
            pathProgressMilli: 9000,
            spawnSequence: 1,
            targetable: true,
            tags: [],
        },
        {
            id: 'boss-high-hp',
            xMilli: 8500,
            yMilli: 5000,
            currentHp: 1000,
            pathProgressMilli: 8000,
            spawnSequence: 2,
            targetable: true,
            tags: ['boss'],
        },
        {
            id: 'outside-range',
            xMilli: 11501,
            yMilli: 5000,
            currentHp: 9999,
            pathProgressMilli: 9999,
            spawnSequence: 3,
            targetable: true,
            tags: [],
        },
    ];
    const target = (0, combat_engine_1.selectGeneralTarget)(formation, enemies, (0, catalog_1.resolveGeneralStats)(catalog_1.HOUYI_DEFINITION, progress.level), 'furthest_progress');
    strict_1.default.equal(target?.id, 'furthest');
    const exactBoundaryTarget = (0, combat_engine_1.selectGeneralTarget)(formation, [{ ...enemies[0], id: 'exact-boundary', xMilli: 10500, pathProgressMilli: 1 }], (0, catalog_1.resolveGeneralStats)(catalog_1.HOUYI_DEFINITION, progress.level), 'furthest_progress');
    strict_1.default.equal(exactBoundaryTarget?.id, 'exact-boundary');
    const outsideBoundaryTarget = (0, combat_engine_1.selectGeneralTarget)(formation, [{ ...enemies[0], id: 'outside-boundary', xMilli: 10501, pathProgressMilli: 1 }], (0, catalog_1.resolveGeneralStats)(catalog_1.HOUYI_DEFINITION, progress.level), 'furthest_progress');
    strict_1.default.equal(outsideBoundaryTarget, null);
    const initialized = (0, combat_engine_1.planGeneralCombatFrame)({
        definition: catalog_1.HOUYI_DEFINITION,
        formation,
        progress,
        currentTick: 100,
        tickRateMs: 100,
        enemies,
    });
    strict_1.default.equal(initialized.actions.length, 0);
    const readyTick = initialized.nextProgress.activeSkillReadyAtTick;
    const combat = (0, combat_engine_1.planGeneralCombatFrame)({
        definition: catalog_1.HOUYI_DEFINITION,
        formation,
        progress: initialized.nextProgress,
        currentTick: readyTick,
        tickRateMs: 100,
        enemies,
    });
    strict_1.default.deepEqual(combat.actions.map((action) => action.actionKind), ['active_skill', 'basic_attack']);
    strict_1.default.equal(combat.actions[0].targetEnemyId, 'boss-high-hp');
    strict_1.default.equal(combat.actions[0].damage.coefficientBps, 32000);
    strict_1.default.equal(combat.actions[0].damage.damageDealtRatioBps, 12000);
    strict_1.default.equal(combat.actions[1].targetEnemyId, 'furthest');
    const noTarget = (0, combat_engine_1.planGeneralCombatFrame)({
        definition: catalog_1.HOUYI_DEFINITION,
        formation,
        progress: { ...combat.nextProgress, activeSkillReadyAtTick: readyTick, nextBasicAttackTick: readyTick },
        currentTick: readyTick,
        tickRateMs: 100,
        enemies: [],
    });
    strict_1.default.equal(noTarget.actions.length, 0);
    strict_1.default.equal(noTarget.nextProgress.activeSkillReadyAtTick, readyTick);
    strict_1.default.equal(noTarget.nextProgress.nextBasicAttackTick, readyTick);
    const plannerFormation = { ...formation, anchorMilli: { x: 0, y: 0 } };
    const plannerEnemies = [
        { id: 'a', xMilli: 1000, yMilli: 0, currentHp: 100, pathProgressMilli: 100, spawnSequence: 1, targetable: true, tags: [] },
        { id: 'b', xMilli: 1800, yMilli: 100, currentHp: 300, pathProgressMilli: 300, spawnSequence: 2, targetable: true, tags: [] },
        { id: 'c', xMilli: 2600, yMilli: 700, currentHp: 200, pathProgressMilli: 200, spawnSequence: 3, targetable: true, tags: ['boss'] },
        { id: 'd', xMilli: 6000, yMilli: 0, currentHp: 50, pathProgressMilli: 400, spawnSequence: 4, targetable: true, tags: [] },
    ];
    const plannerStats = (0, catalog_1.resolveGeneralStats)(catalog_1.HOUYI_DEFINITION, 1);
    strict_1.default.deepEqual((0, combat_engine_1.selectGeneralTargets)({ formation: plannerFormation, enemies: plannerEnemies, stats: plannerStats, level: 1,
        targeting: { kind: 'single', scope: 'enemies_in_attack_range', priority: 'highest_current_hp', targetLimit: 1 } }).map((entry) => entry.id), ['b']);
    strict_1.default.deepEqual((0, combat_engine_1.selectGeneralTargets)({ formation: plannerFormation, enemies: plannerEnemies, stats: plannerStats, level: 1,
        targeting: { kind: 'radius_aoe', scope: 'enemies_around_primary', priority: 'highest_current_hp', primarySearch: 'attack_range', radiusMilliCellsByLevel: [1000, 1000, 1000, 1000, 1000], targetLimit: 8 } }).map((entry) => entry.id), ['b', 'c', 'a']);
    strict_1.default.deepEqual((0, combat_engine_1.selectGeneralTargets)({ formation: plannerFormation, enemies: plannerEnemies, stats: plannerStats, level: 1,
        targeting: { kind: 'line', scope: 'enemies_in_line_from_caster', priority: 'furthest_progress', primarySearch: 'line_length', lengthMilliCellsByLevel: [7000, 7000, 7000, 7000, 7000], halfWidthMilliCellsByLevel: [200, 200, 200, 200, 200], targetLimit: 8 } }).map((entry) => entry.id), ['a', 'b', 'd']);
    strict_1.default.deepEqual((0, combat_engine_1.selectGeneralTargets)({ formation: plannerFormation, enemies: plannerEnemies, stats: plannerStats, level: 1,
        targeting: { kind: 'global', scope: 'all_targetable_enemies', priority: 'furthest_progress', targetLimit: 8 } }).map((entry) => entry.id), ['d', 'b', 'c', 'a']);
    strict_1.default.deepEqual((0, combat_engine_1.selectGeneralTargets)({ formation: plannerFormation, enemies: plannerEnemies, stats: plannerStats, level: 1,
        targeting: { kind: 'chain', scope: 'chain_from_primary', priority: 'nearest_to_caster', primarySearch: 'attack_range', bounceRangeMilliCellsByLevel: [1200, 1200, 1200, 1200, 1200], targetLimit: 3 } }).map((entry) => entry.id), ['a', 'b', 'c']);
    const allEffects = [
        { effectId: 'multi', type: 'damage', damageType: 'physical', coefficientBpsByLevel: [10000, 10000, 10000, 10000, 10000], flatDamageByLevel: [0, 0, 0, 0, 0], criticalPolicy: 'can_crit', hitCountByLevel: [2, 2, 2, 2, 2], hitIntervalMs: 100, tags: [] },
        { effectId: 'dot', type: 'damage_over_time', damageType: 'magic', coefficientBpsPerTickByLevel: [1000, 1000, 1000, 1000, 1000], flatDamagePerTickByLevel: [1, 1, 1, 1, 1], tickIntervalMs: 500, durationMsByLevel: [2000, 2000, 2000, 2000, 2000], criticalPolicy: 'cannot_crit', stacking: { stackGroup: 'dot', policy: 'refresh', maxStacks: 1 }, tags: [] },
        { effectId: 'slow', type: 'status_apply', statusId: 'slow', magnitudeByLevel: [2000, 2000, 2000, 2000, 2000], durationMsByLevel: [3000, 3000, 3000, 3000, 3000], chanceBpsByLevel: [10000, 10000, 10000, 10000, 10000], stacking: { stackGroup: 'slow', policy: 'strongest_refresh', maxStacks: 1 }, tags: [] },
        { effectId: 'push', type: 'path_displacement', direction: 'backward', distanceMilliCellsByLevel: [500, 500, 500, 500, 500], bossDistanceRatioBps: 3000, tags: [] },
        { effectId: 'summon', type: 'summon_unit', targeting: { kind: 'self', scope: 'self', targetLimit: 0 }, summonUnitId: 'rabbit', countByLevel: [2, 2, 2, 2, 2], durationMsByLevel: [10000, 10000, 10000, 10000, 10000], maxOwnedAliveByLevel: [4, 4, 4, 4, 4], spawnPattern: 'self_surrounding_empty_cells', inheritStatRatiosBps: { attack: 5000 }, sourceInactivePolicy: 'despawn', tags: [] },
        { effectId: 'zone', type: 'spawn_zone', zoneId: 'thunder', shape: { kind: 'circle', radiusMilliCellsByLevel: [1500, 1500, 1500, 1500, 1500] }, durationMsByLevel: [3000, 3000, 3000, 3000, 3000], tickIntervalMs: 500, tickEffects: [{ effectId: 'zone_tick', type: 'damage', damageType: 'magic', coefficientBpsByLevel: [1000, 1000, 1000, 1000, 1000], flatDamageByLevel: [0, 0, 0, 0, 0], criticalPolicy: 'cannot_crit', tags: [] }], sourceInactivePolicy: 'finish_duration', tags: [] },
        { effectId: 'cooldown', type: 'cooldown_modify', targeting: { kind: 'self', scope: 'self', targetLimit: 0 }, targetSkill: 'active_skill', operation: 'add_ms', valueByLevel: [-300, -300, -300, -300, -300], maxTriggersPerCast: 1, tags: [] },
        { effectId: 'patch', type: 'effect_parameter_patch', targeting: { kind: 'self', scope: 'self', targetLimit: 0 }, targetEffectId: 'multi', parameter: 'hitCount', operation: 'add_flat', valueByLevel: [1, 1, 1, 1, 1], tags: [] },
    ];
    const plannerDefinition = { ...catalog_1.HOUYI_DEFINITION, activeSkill: { ...catalog_1.HOUYI_DEFINITION.activeSkill,
            targeting: { kind: 'global', scope: 'all_targetable_enemies', priority: 'furthest_progress', targetLimit: 2 }, effects: allEffects } };
    (0, combat_engine_1.validateGeneralCombatDefinition)(plannerDefinition);
    const effectActions = (0, combat_engine_1.planGeneralEffectActions)({ definition: plannerDefinition, formation: plannerFormation, progress,
        stats: plannerStats, actionKind: 'active_skill', actionId: 'all-effects', defaultTargeting: plannerDefinition.activeSkill.targeting,
        effects: allEffects, enemies: plannerEnemies });
    strict_1.default.deepEqual(new Set(effectActions.map((action) => action.effectType)), new Set([
        'damage', 'damage_over_time', 'status_apply', 'path_displacement', 'summon_unit', 'spawn_zone', 'cooldown_modify', 'effect_parameter_patch',
    ]));
    strict_1.default.equal(effectActions.filter((action) => action.effectType === 'damage').length, 4);
    const passiveEffect = allEffects[6];
    const alwaysDefinition = { ...catalog_1.HOUYI_DEFINITION, passiveSkill: { ...catalog_1.HOUYI_DEFINITION.passiveSkill,
            trigger: { kind: 'always' }, structuredEffects: [passiveEffect] } };
    strict_1.default.equal((0, combat_engine_1.planGeneralPassiveTrigger)({ definition: alwaysDefinition, formation: plannerFormation, progress,
        currentTick: 10, tickRateMs: 100, event: 'initialize', enemies: [] }).actions.length, 1);
    const nthDefinition = { ...alwaysDefinition, passiveSkill: { ...alwaysDefinition.passiveSkill,
            trigger: { kind: 'on_nth_basic_attack', every: 2 } } };
    strict_1.default.equal((0, combat_engine_1.planGeneralPassiveTrigger)({ definition: nthDefinition, formation: plannerFormation,
        progress: { ...progress, basicAttackCount: 1 }, currentTick: 10, tickRateMs: 100, event: 'basic_attack', enemies: [] }).actions.length, 1);
    const periodicDefinition = { ...alwaysDefinition, passiveSkill: { ...alwaysDefinition.passiveSkill,
            trigger: { kind: 'periodic', intervalMsByLevel: [1000, 1000, 1000, 1000, 1000] } } };
    const periodic = (0, combat_engine_1.planGeneralPassiveTrigger)({ definition: periodicDefinition, formation: plannerFormation,
        progress: { ...progress, nextPassiveTriggerTick: 10 }, currentTick: 10, tickRateMs: 100, event: 'initialize', enemies: [] });
    strict_1.default.equal(periodic.actions.length, 1);
    strict_1.default.equal(periodic.nextPassiveTriggerTick, 20);
    process.stdout.write('hero-v1 smoke passed\n');
}
if (require.main === module) {
    runHeroV1Smoke();
}
