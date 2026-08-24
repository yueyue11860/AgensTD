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
    process.stdout.write('hero-v1 smoke passed\n');
}
if (require.main === module) {
    runHeroV1Smoke();
}
