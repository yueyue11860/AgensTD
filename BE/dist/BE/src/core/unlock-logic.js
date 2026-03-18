"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkUnlock = checkUnlock;
const progress_1 = require("../domain/progress");
/**
 * checkUnlock — 判断玩家是否有权进入目标关卡
 *
 * 规则总结：
 *  - Level 0 (教学关)  : 仅 HUMAN 可用，始终解锁
 *  - Level 1-5 (标准关): 必须 highestUnlockedLevel >= targetLevel
 *  - Level 6 (隐藏关)  : level5ClearCount >= 5
 *  - AGENT 不得访问 Level 0
 *  - 范围外的 level ID 一律拒绝
 *
 * @param progress  玩家当前进度
 * @param targetLevel  目标关卡 ID (0-6)
 */
function checkUnlock(progress, targetLevel) {
    // ── 教学关 ──────────────────────────────────────────────────────────────
    if (targetLevel === progress_1.TUTORIAL_LEVEL_ID) {
        if (progress.playerType === 'AGENT') {
            return {
                allowed: false,
                reason: 'Tutorial (Level 0) is exclusive to human players. Agents must start from Level 1.',
            };
        }
        return { allowed: true };
    }
    // ── 隐藏关 ──────────────────────────────────────────────────────────────
    if (targetLevel === progress_1.HIDDEN_LEVEL_ID) {
        if (progress.level5ClearCount < progress_1.HIDDEN_LEVEL_UNLOCK_COUNT) {
            return {
                allowed: false,
                reason: `Hidden level requires clearing Level 5 at least ${progress_1.HIDDEN_LEVEL_UNLOCK_COUNT} times. `
                    + `Current progress: ${progress.level5ClearCount}/${progress_1.HIDDEN_LEVEL_UNLOCK_COUNT}.`,
            };
        }
        return { allowed: true };
    }
    // ── 越界关卡 ID ──────────────────────────────────────────────────────────
    if (targetLevel < 1 || targetLevel > progress_1.MAX_STANDARD_LEVEL) {
        return { allowed: false, reason: `Level ${targetLevel} does not exist.` };
    }
    // ── 标准关卡 1-5 ─────────────────────────────────────────────────────────
    if (targetLevel <= progress.highestUnlockedLevel) {
        return { allowed: true };
    }
    return {
        allowed: false,
        reason: `Level ${targetLevel} is locked. Clear Level ${targetLevel - 1} first.`,
    };
}
