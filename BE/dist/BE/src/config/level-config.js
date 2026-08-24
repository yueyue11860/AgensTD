"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_LEVEL_IDS = exports.ORDERED_STANDARD_LEVEL_IDS = exports.LEVEL_CONFIGS = void 0;
exports.getWavesForLevel = getWavesForLevel;
const pve_stage_config_1 = require("../../../shared/contracts/pve-stage-config");
const PVE_WAVE_COUNT = 20;
function createUnifiedTwentyWavePlan() {
    return Array.from({ length: PVE_WAVE_COUNT }, (_, index) => ({
        waveNumber: index + 1,
        prepTime: 50,
        // 新版运行时从 WAVE_MINION_CATALOG 读取生成配置；这里保留结构用于房间协议和旧客户端展示。
        groups: [],
    }));
}
function createLevel(levelId, stageId, label, description) {
    return {
        levelId,
        stageId,
        label,
        description,
        targetClearRate: 0,
        allowedPlayerKinds: ['human', 'agent'],
        minPlayers: 1,
        capacityPerPlayer: 10,
        waves: createUnifiedTwentyWavePlan(),
    };
}
exports.LEVEL_CONFIGS = Object.freeze(Object.fromEntries(pve_stage_config_1.PVE_STAGE_DEFINITIONS.map((definition) => [
    definition.levelId,
    createLevel(definition.levelId, definition.stageId, definition.label, `${definition.description}共 20 波，每波每路固定 10 只小怪；关卡字池：${definition.minionGlyphs.join('、')}。`),
])));
exports.ORDERED_STANDARD_LEVEL_IDS = pve_stage_config_1.PVE_STAGE_DEFINITIONS.map(({ levelId }) => levelId);
exports.ALL_LEVEL_IDS = exports.ORDERED_STANDARD_LEVEL_IDS;
function getWavesForLevel(levelId) {
    return exports.LEVEL_CONFIGS[levelId]?.waves ?? null;
}
