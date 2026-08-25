"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BOSS_DEFINITIONS = exports.BOSS_WAVE_NUMBERS = exports.BOSS_SCHEMA_VERSION = exports.BOSS_CATALOG_VERSION = void 0;
exports.isBossWaveNumber = isBossWaveNumber;
exports.getBossDefinition = getBossDefinition;
exports.resolveBossEncounter = resolveBossEncounter;
exports.validateBossCatalog = validateBossCatalog;
const balance_catalog_1 = require("./balance-catalog");
const economy_1 = require("./economy");
exports.BOSS_CATALOG_VERSION = 'boss-catalog-v1';
exports.BOSS_SCHEMA_VERSION = 1;
exports.BOSS_WAVE_NUMBERS = [5, 10, 15, 20];
const BOSS_NODE_BUDGETS = Object.freeze({
    5: {
        waveNumber: 5,
        hpRatioToOneOrdinaryBps: 50000,
        defenseAdd: 3,
        moveSpeedMilliCellsPerSecond: 800,
        controlResistanceBps: 1000,
        maxSingleControlDurationMs: 3000,
        rice: (0, economy_1.resolvePveBossRiceReward)(5),
        experienceMilli: 5000,
    },
    10: {
        waveNumber: 10,
        hpRatioToOneOrdinaryBps: 60000,
        defenseAdd: 5,
        moveSpeedMilliCellsPerSecond: 775,
        controlResistanceBps: 2000,
        maxSingleControlDurationMs: 2500,
        rice: (0, economy_1.resolvePveBossRiceReward)(10),
        experienceMilli: 10000,
    },
    15: {
        waveNumber: 15,
        hpRatioToOneOrdinaryBps: 70000,
        defenseAdd: 7,
        moveSpeedMilliCellsPerSecond: 750,
        controlResistanceBps: 3000,
        maxSingleControlDurationMs: 2000,
        rice: (0, economy_1.resolvePveBossRiceReward)(15),
        experienceMilli: 15000,
    },
    20: {
        waveNumber: 20,
        hpRatioToOneOrdinaryBps: 80000,
        defenseAdd: 10,
        moveSpeedMilliCellsPerSecond: 725,
        controlResistanceBps: 4000,
        maxSingleControlDurationMs: 1500,
        rice: (0, economy_1.resolvePveBossRiceReward)(20),
        experienceMilli: 20000,
    },
});
const SKILL_DISPLAY_NAMES = Object.freeze({
    mountain_rush: '山魈催阵', water_curtain_guard: '水帘护体', fruit_mountain_call: '花果号令',
    demon_host_march: '群魔进军', demon_king_guard: '混世魔甲', black_wind_gust: '黑风催阵',
    snake_shed: '白蛇蜕鳞', empty_spirit_wind: '凌虚妖风', empty_spirit_guard: '凌虚护身',
    black_bear_hide: '黑熊厚皮', black_wind_command: '黑风号令', tiger_vanguard_charge: '虎先锋突进',
    yellow_wind_column: '黄风卷阵', marten_escape: '貂影遁形', sandstorm_drive: '沙暴催军',
    great_samadi_wind: '三昧神风', wind_body: '风灵护体', drowned_shell: '沉水护壳',
    bone_current: '骷髅暗流', quicksand_surge: '流沙涌动', sand_armor: '流沙护甲',
    curtain_general_body: '卷帘战躯', river_torrent: '河潮催阵', ghostly_whisper: '骨灵低语',
    false_skin: '白骨假身', bone_mist: '枯骨迷雾', second_face: '幻面护身',
    three_transformations: '白骨三变', nether_procession: '幽冥夜行', fine_ghost_order: '精细鬼令',
    clever_swarm: '伶俐群行', clever_escape: '伶俐遁身', silver_horn_guard: '银角护法',
    golden_gourd_call: '金葫号令', golden_horn_guard: '金角护法', silken_pull: '蛛丝牵引',
    silk_cocoon: '盘丝结茧', seven_webs: '七情盘丝', golden_light_body: '金光护体',
    hundred_eyes_command: '百眼号令', poison_bloom: '毒花绽放', pipa_echo: '琵琶回响',
    stinging_advance: '倒马毒锋', scorpion_carapace: '蝎甲护体', poison_host: '毒军夜行',
    lion_roar_march: '狮吼进军', elephant_hide: '白象厚甲', roc_wing_gale: '鹏翼妖风',
    roc_escape: '金鹏振翅', three_saints_command: '三圣号令', three_saints_guard: '三圣护体',
    fire_cloud_drive: '火云催阵', banana_fan_wind: '芭蕉烈风', bull_demon_body: '牛魔战躯',
    flaming_mountain_charge: '火焰山冲阵', great_sage_guard: '平天圣甲',
});
function skillDisplayName(bindingId) {
    const displayName = SKILL_DISPLAY_NAMES[bindingId];
    if (!displayName)
        throw new Error(`Missing boss skill display name: ${bindingId}`);
    return displayName;
}
function haste(bindingId, speedBonusBps, durationMs, cooldownMs, maxCasts) {
    return {
        bindingId,
        displayName: skillDisplayName(bindingId),
        pluginId: 'lane_minion_haste_v1',
        pluginVersion: 1,
        trigger: 'periodic',
        parameters: Object.freeze({ telegraphMs: 1000, speedBonusBps, durationMs, cooldownMs, maxCasts }),
    };
}
function guard(bindingId, hpThresholdBps, damageTakenReductionBps, moveSpeedBonusBps, durationMs) {
    return {
        bindingId,
        displayName: skillDisplayName(bindingId),
        pluginId: 'phase_guard_v1',
        pluginVersion: 1,
        trigger: 'hp_threshold',
        parameters: Object.freeze({
            hpThresholdBps,
            telegraphMs: 800,
            damageTakenReductionBps,
            moveSpeedBonusBps,
            durationMs,
        }),
    };
}
function boss(levelId, waveNumber, bossDefinitionId, glyph, displayName, role, skills) {
    return Object.freeze({
        bossDefinitionId,
        levelId,
        waveNumber,
        glyph,
        displayName,
        role,
        controlProfileId: `boss-control-w${waveNumber}-v1`,
        skills: Object.freeze([...skills]),
    });
}
/**
 * 10 关 × 4 节点的线上 V1 内容目录。技能仅绑定首版已经注册的两个确定性插件；
 * 名称和参数可以形成主题差异，但不能把自由脚本写入配置。
 */
exports.BOSS_DEFINITIONS = Object.freeze([
    boss(1, 5, 'boss_l1_w5_mountain_scout_v1', '魈', '山魈先锋', 'pressure', [haste('mountain_rush', 1200, 3500, 12000, 2)]),
    boss(1, 10, 'boss_l1_w10_water_curtain_guard_v1', '猿', '水帘魔猿', 'survival', [guard('water_curtain_guard', 5000, 1200, 800, 4000)]),
    boss(1, 15, 'boss_l1_w15_flower_fruit_marshal_v1', '魔', '花果魔帅', 'support', [haste('fruit_mountain_call', 1600, 4500, 11000, 3)]),
    boss(1, 20, 'boss_l1_w20_demon_king_v1', '王', '混世魔王', 'hybrid', [haste('demon_host_march', 1800, 5000, 10000, 3), guard('demon_king_guard', 4000, 1600, 1000, 4500)]),
    boss(2, 5, 'boss_l2_w5_black_bear_scout_v1', '熊', '黑风熊先锋', 'pressure', [haste('black_wind_gust', 1300, 3500, 12000, 2)]),
    boss(2, 10, 'boss_l2_w10_white_snake_v1', '蛇', '白花蛇怪', 'survival', [guard('snake_shed', 5500, 1300, 900, 3800)]),
    boss(2, 15, 'boss_l2_w15_lingxuzi_v1', '狼', '凌虚子', 'hybrid', [haste('empty_spirit_wind', 1600, 4200, 10500, 3), guard('empty_spirit_guard', 3500, 1200, 1200, 3500)]),
    boss(2, 20, 'boss_l2_w20_black_bear_spirit_v1', '熊', '黑熊精', 'survival', [guard('black_bear_hide', 5000, 1900, 900, 5000), haste('black_wind_command', 1700, 4800, 10500, 3)]),
    boss(3, 5, 'boss_l3_w5_tiger_vanguard_v1', '虎', '虎先锋', 'pressure', [haste('tiger_vanguard_charge', 1500, 3200, 11500, 2)]),
    boss(3, 10, 'boss_l3_w10_yellow_wind_marshal_v1', '风', '黄风妖将', 'support', [haste('yellow_wind_column', 1700, 4000, 10500, 3)]),
    boss(3, 15, 'boss_l3_w15_yellow_marten_v1', '貂', '黄毛貂鼠', 'hybrid', [guard('marten_escape', 5000, 1200, 1800, 4000), haste('sandstorm_drive', 1500, 4500, 11000, 3)]),
    boss(3, 20, 'boss_l3_w20_yellow_wind_sage_v1', '风', '黄风大圣', 'pressure', [haste('great_samadi_wind', 2200, 5200, 9500, 4), guard('wind_body', 3000, 1400, 1600, 4000)]),
    boss(4, 5, 'boss_l4_w5_drowned_soul_v1', '魂', '河底怨魂', 'survival', [guard('drowned_shell', 5500, 1100, 600, 3800)]),
    boss(4, 10, 'boss_l4_w10_nine_skulls_v1', '骷', '九骷髅妖', 'support', [haste('bone_current', 1400, 4600, 11000, 3)]),
    boss(4, 15, 'boss_l4_w15_quicksand_marshal_v1', '沙', '流沙妖将', 'hybrid', [haste('quicksand_surge', 1700, 4300, 10500, 3), guard('sand_armor', 4500, 1500, 900, 4300)]),
    boss(4, 20, 'boss_l4_w20_curtain_general_v1', '帘', '卷帘大将', 'survival', [guard('curtain_general_body', 5000, 2000, 800, 5200), haste('river_torrent', 1700, 5000, 10000, 3)]),
    boss(5, 5, 'boss_l5_w5_bone_handmaid_v1', '灵', '骨灵侍女', 'support', [haste('ghostly_whisper', 1300, 4000, 12000, 2)]),
    boss(5, 10, 'boss_l5_w10_bone_avatar_v1', '骨', '白骨化身', 'survival', [guard('false_skin', 6000, 1400, 700, 4200)]),
    boss(5, 15, 'boss_l5_w15_bone_madam_v1', '姬', '白骨夫人', 'hybrid', [haste('bone_mist', 1700, 4400, 10500, 3), guard('second_face', 4000, 1600, 1000, 4300)]),
    boss(5, 20, 'boss_l5_w20_white_bone_spirit_v1', '骨', '白骨精', 'survival', [guard('three_transformations', 6500, 2100, 900, 4800), haste('nether_procession', 1700, 5000, 10000, 3)]),
    boss(6, 5, 'boss_l6_w5_jingxigui_v1', '精', '精细鬼', 'pressure', [haste('fine_ghost_order', 1400, 3600, 11500, 2)]),
    boss(6, 10, 'boss_l6_w10_linglichong_v1', '伶', '伶俐虫', 'hybrid', [haste('clever_swarm', 1500, 4200, 11000, 3), guard('clever_escape', 4000, 1000, 1400, 3200)]),
    boss(6, 15, 'boss_l6_w15_silver_horn_v1', '银', '银角大王', 'survival', [guard('silver_horn_guard', 5500, 1800, 900, 4500)]),
    boss(6, 20, 'boss_l6_w20_golden_horn_v1', '金', '金角大王', 'hybrid', [haste('golden_gourd_call', 1900, 5000, 9800, 4), guard('golden_horn_guard', 3500, 1800, 1100, 4600)]),
    boss(7, 5, 'boss_l7_w5_web_handmaid_v1', '丝', '蛛丝侍女', 'support', [haste('silken_pull', 1200, 4500, 12000, 2)]),
    boss(7, 10, 'boss_l7_w10_spider_elder_v1', '蛛', '蛛女长姐', 'survival', [guard('silk_cocoon', 5500, 1500, 700, 4500)]),
    boss(7, 15, 'boss_l7_w15_seven_spiders_v1', '七', '七蛛女', 'support', [haste('seven_webs', 1900, 4800, 10000, 4)]),
    boss(7, 20, 'boss_l7_w20_hundred_eyes_v1', '眼', '百眼魔君', 'hybrid', [guard('golden_light_body', 5000, 2000, 800, 5000), haste('hundred_eyes_command', 1800, 5000, 9800, 4)]),
    boss(8, 5, 'boss_l8_w5_poison_flower_v1', '花', '毒花娘子', 'support', [haste('poison_bloom', 1400, 4000, 11500, 2)]),
    boss(8, 10, 'boss_l8_w10_pipa_cave_lord_v1', '琵', '琵琶洞主', 'survival', [guard('pipa_echo', 5000, 1500, 1000, 4200)]),
    boss(8, 15, 'boss_l8_w15_stinging_queen_v1', '刺', '倒马毒后', 'pressure', [haste('stinging_advance', 1900, 4300, 10000, 4)]),
    boss(8, 20, 'boss_l8_w20_scorpion_spirit_v1', '蝎', '蝎子精', 'hybrid', [guard('scorpion_carapace', 4500, 1900, 1300, 4600), haste('poison_host', 1900, 5000, 9800, 4)]),
    boss(9, 5, 'boss_l9_w5_green_lion_vanguard_v1', '狮', '青狮先锋', 'pressure', [haste('lion_roar_march', 1600, 3800, 11000, 3)]),
    boss(9, 10, 'boss_l9_w10_white_elephant_v1', '象', '白象大王', 'survival', [guard('elephant_hide', 6000, 1700, 600, 4800)]),
    boss(9, 15, 'boss_l9_w15_golden_roc_v1', '鹏', '金翅大鹏', 'pressure', [haste('roc_wing_gale', 2200, 4500, 9500, 4), guard('roc_escape', 3000, 1000, 2000, 3200)]),
    boss(9, 20, 'boss_l9_w20_lion_camel_saints_v1', '圣', '狮驼三圣', 'hybrid', [haste('three_saints_command', 2100, 5200, 9500, 4), guard('three_saints_guard', 5000, 2100, 900, 5000)]),
    boss(10, 5, 'boss_l10_w5_fire_cloud_vanguard_v1', '火', '火云先锋', 'pressure', [haste('fire_cloud_drive', 1700, 4000, 10500, 3)]),
    boss(10, 10, 'boss_l10_w10_iron_fan_princess_v1', '扇', '铁扇公主', 'support', [haste('banana_fan_wind', 2100, 4700, 9800, 4)]),
    boss(10, 15, 'boss_l10_w15_bull_demon_king_v1', '牛', '牛魔王', 'survival', [guard('bull_demon_body', 6000, 2200, 700, 5200)]),
    boss(10, 20, 'boss_l10_w20_great_sage_equaling_heaven_v1', '天', '平天大圣', 'hybrid', [haste('flaming_mountain_charge', 2300, 5400, 9200, 4), guard('great_sage_guard', 4500, 2200, 1200, 5200)]),
]);
const BOSS_BY_STAGE_NODE = new Map(exports.BOSS_DEFINITIONS.map((definition) => [`${definition.levelId}:${definition.waveNumber}`, definition]));
function isBossWaveNumber(waveNumber) {
    return exports.BOSS_WAVE_NUMBERS.includes(waveNumber);
}
function getBossDefinition(levelId, waveNumber) {
    if (!isBossWaveNumber(waveNumber))
        return null;
    return BOSS_BY_STAGE_NODE.get(`${levelId}:${waveNumber}`) ?? null;
}
function resolveSkillIntensityBps(levelId, difficulty) {
    if (difficulty === 'easy')
        return 8500 + (levelId - 1) * 250;
    if (difficulty === 'normal')
        return 11000 + (levelId - 1) * 300;
    return 15500;
}
function resolveBossEncounter(levelId, difficulty, waveNumber) {
    if (!isBossWaveNumber(waveNumber))
        return null;
    // Boss 波即使目录缺失，也要先用统一入口拒绝非法关卡/难度，避免静默降级。
    (0, balance_catalog_1.resolvePveBalanceProfile)(levelId, difficulty);
    const definition = getBossDefinition(levelId, waveNumber);
    if (!definition)
        return null;
    // 复用普通怪已冻结的关卡/难度曲线，Boss 只叠加节点预算，避免形成另一套断崖。
    const ordinary = (0, balance_catalog_1.getResolvedPveWave)(levelId, difficulty, waveNumber);
    if (!ordinary)
        return null;
    const budget = BOSS_NODE_BUDGETS[waveNumber];
    return {
        schemaVersion: exports.BOSS_SCHEMA_VERSION,
        catalogVersion: exports.BOSS_CATALOG_VERSION,
        levelId,
        difficulty,
        waveNumber,
        definition,
        stats: {
            maxHp: Math.max(1, Math.floor(ordinary.maxHp * budget.hpRatioToOneOrdinaryBps / 10000)),
            armor: ordinary.armor + budget.defenseAdd,
            magicResistance: ordinary.magicResistance + budget.defenseAdd,
            moveSpeedMilliCellsPerSecond: budget.moveSpeedMilliCellsPerSecond,
            controlResistanceBps: budget.controlResistanceBps,
            maxSingleControlDurationMs: budget.maxSingleControlDurationMs,
            skillIntensityBps: resolveSkillIntensityBps(levelId, difficulty),
        },
        rewardProfile: {
            rewardProfileId: `boss-reward-w${waveNumber}-v1`,
            rice: budget.rice,
            experienceMilli: budget.experienceMilli,
            weaponMilestoneWave: waveNumber,
            directWeaponFragments: 0,
        },
    };
}
function validateBossCatalog() {
    if (exports.BOSS_DEFINITIONS.length !== 40)
        throw new Error('Boss catalog must define exactly 10 × 4 nodes');
    const ids = new Set();
    const nodes = new Set();
    for (const definition of exports.BOSS_DEFINITIONS) {
        if (!Number.isInteger(definition.levelId)
            || definition.levelId < balance_catalog_1.PVE_BALANCE_LEVEL_MIN
            || definition.levelId > balance_catalog_1.PVE_BALANCE_LEVEL_MAX) {
            throw new Error(`Invalid boss levelId: ${definition.levelId}`);
        }
        if (!isBossWaveNumber(definition.waveNumber))
            throw new Error(`Invalid boss wave: ${definition.waveNumber}`);
        if (Array.from(definition.glyph).length !== 1)
            throw new Error(`Boss glyph must be one Unicode glyph: ${definition.bossDefinitionId}`);
        if (ids.has(definition.bossDefinitionId))
            throw new Error(`Duplicate bossDefinitionId: ${definition.bossDefinitionId}`);
        const nodeKey = `${definition.levelId}:${definition.waveNumber}`;
        if (nodes.has(nodeKey))
            throw new Error(`Duplicate boss node: ${nodeKey}`);
        if (definition.skills.length < 1)
            throw new Error(`Boss needs at least one registered skill: ${definition.bossDefinitionId}`);
        for (const skill of definition.skills) {
            if (skill.pluginVersion !== 1)
                throw new Error(`Unsupported boss plugin version: ${skill.pluginVersion}`);
            for (const value of Object.values(skill.parameters)) {
                if (!Number.isInteger(value) || value < 0)
                    throw new Error(`Invalid boss skill parameter: ${skill.bindingId}`);
            }
        }
        ids.add(definition.bossDefinitionId);
        nodes.add(nodeKey);
    }
    for (let levelId = balance_catalog_1.PVE_BALANCE_LEVEL_MIN; levelId <= balance_catalog_1.PVE_BALANCE_LEVEL_MAX; levelId += 1) {
        for (const waveNumber of exports.BOSS_WAVE_NUMBERS) {
            if (!nodes.has(`${levelId}:${waveNumber}`))
                throw new Error(`Missing boss node: ${levelId}:${waveNumber}`);
        }
    }
}
