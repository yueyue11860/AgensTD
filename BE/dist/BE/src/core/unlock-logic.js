"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDefaultPveProgress = createDefaultPveProgress;
exports.clearedPveStageKeys = clearedPveStageKeys;
exports.prerequisiteStageKeys = prerequisiteStageKeys;
exports.checkPveStageUnlock = checkPveStageUnlock;
exports.derivePveProgressionView = derivePveProgressionView;
exports.stageSelectionLabel = stageSelectionLabel;
exports.checkUnlock = checkUnlock;
const pve_stage_config_1 = require("../../../shared/contracts/pve-stage-config");
const level_config_1 = require("../config/level-config");
function createDefaultPveProgress() {
    return { version: 1, clearsByStageKey: {} };
}
function clearedPveStageKeys(progress) {
    const cleared = new Set();
    for (const [storedKey, record] of Object.entries(progress.clearsByStageKey)) {
        if (!record || !(0, pve_stage_config_1.isPveStageSelection)(record.selection))
            continue;
        const canonicalKey = (0, pve_stage_config_1.pveStageKey)(record.selection);
        if (storedKey === canonicalKey && record.stageKey === canonicalKey && record.clearCount > 0) {
            cleared.add(canonicalKey);
        }
    }
    return cleared;
}
function prerequisiteStageKeys(selection) {
    if (!(0, pve_stage_config_1.isPveStageSelection)(selection))
        return [];
    const keys = (difficulty, from, to) => Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => (0, pve_stage_config_1.pveStageKey)({ levelId: from + index, difficulty }));
    if (selection.difficulty === 'easy') {
        return selection.levelId === 1
            ? []
            : [(0, pve_stage_config_1.pveStageKey)({ levelId: selection.levelId - 1, difficulty: 'easy' })];
    }
    if (selection.difficulty === 'normal') {
        return keys('easy', 1, selection.levelId <= 5 ? 5 : selection.levelId);
    }
    return keys('normal', 1, 10);
}
function checkPveStageUnlock(progress, selection) {
    if (!(0, pve_stage_config_1.isPveStageSelection)(selection)) {
        return { allowed: false, reason: '关卡或难度不存在。' };
    }
    const cleared = clearedPveStageKeys(progress);
    const missing = prerequisiteStageKeys(selection).filter(key => !cleared.has(key));
    if (missing.length === 0)
        return { allowed: true };
    if (selection.difficulty === 'easy') {
        return { allowed: false, reason: `请先通关第 ${selection.levelId - 1} 关简单难度。` };
    }
    if (selection.difficulty === 'normal') {
        const requiredEnd = selection.levelId <= 5 ? 5 : selection.levelId;
        return { allowed: false, reason: `请先通关第 1–${requiredEnd} 关简单难度。` };
    }
    return { allowed: false, reason: '请先通关全部 10 个关卡的普通难度。' };
}
function derivePveProgressionView(progress) {
    const cleared = clearedPveStageKeys(progress);
    const stages = pve_stage_config_1.PVE_STAGE_SELECTIONS.map(selection => {
        const stageKey = (0, pve_stage_config_1.pveStageKey)(selection);
        const check = checkPveStageUnlock(progress, selection);
        return {
            ...selection,
            stageKey,
            cleared: cleared.has(stageKey),
            unlocked: check.allowed,
            lockedReason: check.allowed ? null : check.reason,
            prerequisiteStageKeys: prerequisiteStageKeys(selection),
        };
    });
    return {
        schemaVersion: 1,
        clearedStageKeys: [...cleared].sort(),
        stages,
    };
}
function stageSelectionLabel(selection) {
    const stage = (0, pve_stage_config_1.getPveStageDefinition)(selection.levelId);
    return `${stage?.label ?? `PVE-${selection.levelId}`} · ${pve_stage_config_1.PVE_DIFFICULTY_LABELS[selection.difficulty]}`;
}
/**
 * @deprecated 仅为旧 SocketGateway 编译兼容；新选关必须调用 checkPveStageUnlock。
 */
function checkUnlock(_progress, targetLevel) {
    return level_config_1.ALL_LEVEL_IDS.includes(targetLevel)
        ? { allowed: true }
        : { allowed: false, reason: `PVE 关卡 ${targetLevel} 不存在。` };
}
