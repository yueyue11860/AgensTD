"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const pve_stage_config_1 = require("../../../shared/contracts/pve-stage-config");
const unlock_logic_1 = require("./unlock-logic");
const AT = '2026-08-25T00:00:00.000Z';
function markCleared(progress, levelId, difficulty) {
    const selection = { levelId, difficulty };
    const stageKey = (0, pve_stage_config_1.pveStageKey)(selection);
    progress.clearsByStageKey[stageKey] = {
        stageKey,
        selection,
        clearCount: 1,
        firstClearedAt: AT,
        lastClearedAt: AT,
    };
}
function unlockedKeys(progress) {
    return (0, unlock_logic_1.derivePveProgressionView)(progress).stages
        .filter(stage => stage.unlocked)
        .map(stage => stage.stageKey)
        .sort();
}
function main() {
    const progress = (0, unlock_logic_1.createDefaultPveProgress)();
    strict_1.default.deepEqual(unlockedKeys(progress), ['easy:1']);
    strict_1.default.equal((0, unlock_logic_1.checkPveStageUnlock)(progress, { levelId: 2, difficulty: 'easy' }).allowed, false);
    for (let levelId = 1; levelId <= 4; levelId++)
        markCleared(progress, levelId, 'easy');
    strict_1.default.equal((0, unlock_logic_1.checkPveStageUnlock)(progress, { levelId: 5, difficulty: 'easy' }).allowed, true);
    strict_1.default.equal((0, unlock_logic_1.checkPveStageUnlock)(progress, { levelId: 1, difficulty: 'normal' }).allowed, false);
    markCleared(progress, 5, 'easy');
    for (let levelId = 1; levelId <= 5; levelId++) {
        strict_1.default.equal((0, unlock_logic_1.checkPveStageUnlock)(progress, { levelId, difficulty: 'normal' }).allowed, true);
    }
    strict_1.default.equal((0, unlock_logic_1.checkPveStageUnlock)(progress, { levelId: 6, difficulty: 'normal' }).allowed, false);
    markCleared(progress, 6, 'easy');
    strict_1.default.equal((0, unlock_logic_1.checkPveStageUnlock)(progress, { levelId: 6, difficulty: 'normal' }).allowed, true);
    strict_1.default.equal((0, unlock_logic_1.checkPveStageUnlock)(progress, { levelId: 7, difficulty: 'normal' }).allowed, false);
    for (let levelId = 7; levelId <= 10; levelId++)
        markCleared(progress, levelId, 'easy');
    for (let levelId = 1; levelId <= 10; levelId++) {
        strict_1.default.equal((0, unlock_logic_1.checkPveStageUnlock)(progress, { levelId, difficulty: 'normal' }).allowed, true);
    }
    for (let levelId = 1; levelId <= 9; levelId++)
        markCleared(progress, levelId, 'normal');
    strict_1.default.equal((0, unlock_logic_1.checkPveStageUnlock)(progress, { levelId: 1, difficulty: 'hard' }).allowed, false);
    markCleared(progress, 10, 'normal');
    for (let levelId = 1; levelId <= 10; levelId++) {
        strict_1.default.equal((0, unlock_logic_1.checkPveStageUnlock)(progress, { levelId, difficulty: 'hard' }).allowed, true);
    }
    strict_1.default.equal((0, unlock_logic_1.checkPveStageUnlock)(progress, { levelId: 11, difficulty: 'easy' }).allowed, false);
    strict_1.default.equal((0, unlock_logic_1.derivePveProgressionView)(progress).stages.length, 30);
    console.log('unlock-logic smoke passed');
}
main();
