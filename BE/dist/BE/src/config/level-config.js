"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_LEVEL_IDS = exports.ORDERED_STANDARD_LEVEL_IDS = exports.LEVEL_CONFIGS = void 0;
exports.getWavesForLevel = getWavesForLevel;
const PVE_WAVE_COUNT = 20;
function createUnifiedTwentyWavePlan() {
    return Array.from({ length: PVE_WAVE_COUNT }, (_, index) => ({
        waveNumber: index + 1,
        prepTime: 50,
        // 新版运行时从 WAVE_MINION_CATALOG 读取生成配置；这里保留结构用于房间协议和旧客户端展示。
        groups: [],
    }));
}
function createLevel(levelId, label, description) {
    return {
        levelId,
        label,
        description,
        targetClearRate: 0,
        allowedPlayerKinds: ['human', 'agent'],
        minPlayers: 1,
        capacityPerPlayer: 10,
        waves: createUnifiedTwentyWavePlan(),
    };
}
exports.LEVEL_CONFIGS = {
    1: createLevel(1, '花果山', '花果山场景关卡，共 20 波。第 5、10、15、20 波为 Boss 节点。'),
    2: createLevel(2, '流沙河', '流沙河场景关卡，共 20 波。场景字池与 Boss 将由关卡专项接入。'),
    3: createLevel(3, '盘丝洞', '盘丝洞场景关卡，共 20 波。场景小怪可使用“蛛、蛇”等汉字。'),
    4: createLevel(4, '火焰山', '火焰山场景关卡，共 20 波。场景小怪可使用“火、焰”等汉字。'),
};
exports.ORDERED_STANDARD_LEVEL_IDS = [1, 2, 3, 4];
exports.ALL_LEVEL_IDS = exports.ORDERED_STANDARD_LEVEL_IDS;
function getWavesForLevel(levelId) {
    return exports.LEVEL_CONFIGS[levelId]?.waves ?? null;
}
