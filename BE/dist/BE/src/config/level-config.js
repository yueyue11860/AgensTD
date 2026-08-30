"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_LEVEL_IDS = exports.ORDERED_STANDARD_LEVEL_IDS = exports.LEVEL_CONFIGS = exports.PVE_WAVE_COUNT = void 0;
const pve_stage_config_1 = require("../../../shared/contracts/pve-stage-config");
exports.PVE_WAVE_COUNT = 20;
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
    };
}
exports.LEVEL_CONFIGS = Object.freeze(Object.fromEntries(pve_stage_config_1.PVE_STAGE_DEFINITIONS.map((definition) => [
    definition.levelId,
    createLevel(definition.levelId, definition.stageId, definition.label, `${definition.description}共 20 波，每波每路固定 10 只小怪；关卡字池：${definition.minionGlyphs.join('、')}。`),
])));
exports.ORDERED_STANDARD_LEVEL_IDS = pve_stage_config_1.PVE_STAGE_DEFINITIONS.map(({ levelId }) => levelId);
exports.ALL_LEVEL_IDS = exports.ORDERED_STANDARD_LEVEL_IDS;
