"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkUnlock = checkUnlock;
const level_config_1 = require("../config/level-config");
/**
 * 新版 PVE 当前按场景选关，已废弃旧版教学/难度/隐藏关解锁规则。
 * 场景解锁与局外进度将在关卡专项确定后重新接入。
 */
function checkUnlock(_progress, targetLevel) {
    return level_config_1.ALL_LEVEL_IDS.includes(targetLevel)
        ? { allowed: true }
        : { allowed: false, reason: `PVE 关卡 ${targetLevel} 不存在。` };
}
