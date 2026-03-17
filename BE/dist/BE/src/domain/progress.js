"use strict";
/**
 * 难度阶梯与通关记录 — 领域类型定义
 *
 * PlayerType: 'HUMAN' (碳基) | 'AGENT' (硅基)
 *
 * 关卡规则：
 *  - Level 0  : 教学关，仅限 HUMAN
 *  - Level 1-5: 标准关卡，均可游玩
 *  - Level 6  : 隐藏关，Level 5 通关 5 次后解锁
 *  - 必须通关上一级才能解锁下一级
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.HIDDEN_LEVEL_UNLOCK_COUNT = exports.HIDDEN_LEVEL_ID = exports.MAX_STANDARD_LEVEL = exports.TUTORIAL_LEVEL_ID = void 0;
/** 教学关 ID（仅 HUMAN 可用） */
exports.TUTORIAL_LEVEL_ID = 0;
/** 最高标准关卡 ID */
exports.MAX_STANDARD_LEVEL = 5;
/** 隐藏关卡 ID */
exports.HIDDEN_LEVEL_ID = 6;
/** 解锁隐藏关所需的 Level 5 通关次数 */
exports.HIDDEN_LEVEL_UNLOCK_COUNT = 5;
