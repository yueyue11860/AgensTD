"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WEAPON_CATALOG_BY_ID = exports.WEAPON_CATALOG = exports.EXCLUSIVE_WEAPONS = exports.COMMON_WEAPONS = void 0;
exports.validateWeaponCatalog = validateWeaponCatalog;
exports.getWeaponDefinition = getWeaponDefinition;
exports.isWeaponCompatible = isWeaponCompatible;
const roster_1 = require("../core/hero-v1/roster");
const types_1 = require("./types");
const ZERO_BUDGET = {
    maxExtraDamageEventsPerSecond: 0,
    maxExtraTargetsPerCast: 0,
    maxOwnedZones: 0,
    maxExtraSummons: 0,
};
const modifier = (effectId, target, stat, operation, value, conditionTagsAny) => ({ effectId, target, stat, operation, value, conditionTagsAny });
const patch = (patchId, targetEffectId, parameter, operation, value, target = 'owner_general_effect') => ({ patchId, target, targetEffectId, parameter, operation, value });
const common = (input) => ({
    schemaVersion: 1,
    weaponId: input.id,
    name: input.name,
    quality: input.quality,
    fragmentRequirement: types_1.WEAPON_FRAGMENT_REQUIREMENT[input.quality],
    compatibility: { allowedArchetypes: [input.archetype] },
    uniqueGroup: input.uniqueGroup,
    statModifiers: input.stats ?? [],
    triggers: input.triggers ?? [],
    parameterPatches: input.patches ?? [],
    eventBudget: input.budget ?? ZERO_BUDGET,
    ui: {
        shortDescription: input.description,
        detailDescription: input.description,
        iconKey: `weapon_${input.id}`,
    },
    status: 'testing',
});
exports.COMMON_WEAPONS = [
    common({ id: 'qinggang_blade', name: '青钢刀', quality: 'green', archetype: 'physical', description: '攻击力 +8%', stats: [modifier('qinggang_attack', 'owner_general', 'attack', 'add_ratio', 800)] }),
    common({ id: 'peachwood_staff', name: '桃木杖', quality: 'green', archetype: 'magic', description: '法术伤害 +8%', stats: [modifier('peachwood_magic', 'owner_general', 'magic_damage', 'add_ratio', 800)] }),
    common({ id: 'spirit_bell', name: '御灵铃', quality: 'green', archetype: 'summon', description: '召唤物攻击力 +10%', stats: [modifier('spirit_bell_attack', 'owned_summons', 'summon_attack', 'add_ratio', 1000)] }),
    common({ id: 'binding_rope', name: '缚妖索', quality: 'green', archetype: 'control', description: '控制持续时间 +8%', stats: [modifier('binding_control', 'owner_general', 'control_duration', 'add_ratio', 800)] }),
    common({ id: 'chasing_wind_bow', name: '追风弓', quality: 'blue', archetype: 'physical', description: '攻速 +10%，攻击范围 +0.25 格', stats: [modifier('chasing_speed', 'owner_general', 'attack_speed', 'add_ratio', 1000), modifier('chasing_range', 'owner_general', 'attack_range', 'add_flat', 250)] }),
    common({ id: 'spirit_gathering_orb', name: '聚灵珠', quality: 'blue', archetype: 'magic', description: '法术伤害 +6%，冷却缩减 +6%', stats: [modifier('orb_magic', 'owner_general', 'magic_damage', 'add_ratio', 600), modifier('orb_cdr', 'owner_general', 'cooldown_reduction', 'add_ratio', 600)] }),
    common({ id: 'life_extending_incense', name: '续灵香', quality: 'blue', archetype: 'summon', description: '召唤物持续时间 +15%，攻击范围 +0.25 格', stats: [modifier('incense_duration', 'owned_summons', 'summon_duration', 'add_ratio', 1500), modifier('incense_range', 'owned_summons', 'summon_attack_range', 'add_flat', 250)] }),
    common({ id: 'calming_pearl', name: '定风珠', quality: 'blue', archetype: 'control', description: '控制持续时间 +10%，攻击范围 +0.25 格', stats: [modifier('pearl_control', 'owner_general', 'control_duration', 'add_ratio', 1000), modifier('pearl_range', 'owner_general', 'attack_range', 'add_flat', 250)] }),
    common({ id: 'armor_breaking_halberd', name: '破军钺', quality: 'purple', archetype: 'physical', description: '普攻 20% 概率施加 10% 破甲 3 秒', triggers: [{ triggerId: 'halberd_armor_break', kind: 'on_basic_attack_hit', chanceBps: 2000, perTargetIcdMs: 0, maxTriggersPerSecond: 5, actions: [{ type: 'apply_status', statusId: 'armor_break', magnitudeBps: 1000, durationMs: 3000 }] }] }),
    common({ id: 'thunder_fire_talisman', name: '雷火符', quality: 'purple', archetype: 'magic', description: '主动技能首次命中附加 3 秒灼烧', triggers: [{ triggerId: 'talisman_burn', kind: 'on_active_skill_hit', perTargetIcdMs: 0, maxTargetsPerCast: 1, actions: [{ type: 'apply_status', statusId: 'weapon_burn_attack_20', magnitudeBps: 2000, durationMs: 3000 }] }] }),
    common({ id: 'division_banner', name: '分灵幡', quality: 'purple', archetype: 'summon', description: '召唤物攻速 +15%，暴击率 +5 个百分点', stats: [modifier('banner_speed', 'owned_summons', 'summon_attack_speed', 'add_ratio', 1500), modifier('banner_crit', 'owned_summons', 'summon_crit_rate', 'add_flat', 500)] }),
    common({ id: 'truth_mirror', name: '破妄镜', quality: 'purple', archetype: 'control', description: '对受控敌人伤害 +12%', stats: [modifier('mirror_damage', 'owner_general', 'controlled_target_damage', 'add_ratio', 1200, ['controlled'])] }),
    common({ id: 'sun_piercing_bow', name: '贯日弓', quality: 'orange', archetype: 'physical', description: '普攻穿透 1 个目标，次级 70% 伤害；攻击力 -8%', stats: [modifier('sun_bow_penalty', 'owner_general', 'attack', 'add_ratio', -800)], patches: [patch('sun_bow_target', 'basic_attack', 'additionalTargetLimit', 'add_flat', 1), patch('sun_bow_falloff', 'basic_attack', 'secondaryDamageRatioBps', 'add_flat', 7000)], budget: { ...ZERO_BUDGET, maxExtraTargetsPerCast: 1, maxExtraDamageEventsPerSecond: 5 } }),
    common({ id: 'nine_luminary_wheel', name: '九曜法轮', quality: 'orange', archetype: 'magic', description: '主动技能首次命中生成 3 秒法术区域', triggers: [{ triggerId: 'luminary_zone', kind: 'on_active_skill_hit', perTargetIcdMs: 0, maxTargetsPerCast: 1, actions: [{ type: 'spawn_zone', zoneId: 'nine_luminary_zone', radiusMilliCells: 1500, durationMs: 3000, tickIntervalMs: 1000, coefficientBpsPerTick: 2500, maxOwned: 1 }] }], budget: { ...ZERO_BUDGET, maxExtraDamageEventsPerSecond: 3, maxOwnedZones: 1 } }),
    common({ id: 'command_seal', name: '统御宝印', quality: 'orange', archetype: 'summon', description: '召唤上限 +1、持续 +20%，召唤物最终伤害 -10%', stats: [modifier('seal_limit', 'owned_summons', 'summon_alive_limit', 'add_flat', 1), modifier('seal_duration', 'owned_summons', 'summon_duration', 'add_ratio', 2000), modifier('seal_damage_penalty', 'owned_summons', 'summon_damage', 'add_ratio', -1000)], budget: { ...ZERO_BUDGET, maxExtraSummons: 1 } }),
    common({ id: 'boundary_stele', name: '镇界碑', quality: 'orange', archetype: 'control', description: '主动技能硬控附加 10% 易损 4 秒', triggers: [{ triggerId: 'stele_vulnerable', kind: 'on_status_applied', statusTags: ['hard_control'], perTargetIcdMs: 8000, actions: [{ type: 'apply_status', statusId: 'all_damage_vulnerable', magnitudeBps: 1000, durationMs: 4000 }] }] }),
    common({ id: 'battle_sky_axe', name: '战天斧', quality: 'red', archetype: 'physical', description: '对 Boss 伤害 +20%，暴伤 +20%；攻速 -10%', stats: [modifier('axe_boss', 'owner_general', 'boss_damage', 'add_ratio', 2000, ['boss']), modifier('axe_crit', 'owner_general', 'crit_damage', 'add_flat', 2000), modifier('axe_speed_penalty', 'owner_general', 'attack_speed', 'add_ratio', -1000)] }),
    common({ id: 'river_chart_luoshu', name: '河图洛书', quality: 'red', archetype: 'magic', description: '主动冷却 -15%，持续效果 +20%；直接技能伤害 -8%', stats: [modifier('chart_cdr', 'owner_general', 'cooldown_reduction', 'add_ratio', 1500), modifier('chart_dot', 'owner_general', 'dot_duration', 'add_ratio', 2000), modifier('chart_zone', 'owner_general', 'zone_duration', 'add_ratio', 2000), modifier('chart_direct_penalty', 'owner_general', 'direct_skill_damage', 'add_ratio', -800)] }),
    common({ id: 'myriad_beast_scroll', name: '万兽图', quality: 'red', archetype: 'summon', description: '召唤物攻击、攻速、暴伤 +30%，持续 +25%；上限 -1', stats: [modifier('scroll_attack', 'owned_summons', 'summon_attack', 'add_ratio', 3000), modifier('scroll_speed', 'owned_summons', 'summon_attack_speed', 'add_ratio', 3000), modifier('scroll_crit', 'owned_summons', 'summon_crit_damage', 'add_flat', 3000), modifier('scroll_duration', 'owned_summons', 'summon_duration', 'add_ratio', 2500), modifier('scroll_limit_penalty', 'owned_summons', 'summon_alive_limit', 'add_flat', -1)] }),
    common({ id: 'chaos_umbrella', name: '混元伞', quality: 'red', archetype: 'control', description: '硬控 -30%；附加 15% 易损', stats: [modifier('umbrella_control_penalty', 'owner_general', 'control_duration', 'add_ratio', -3000)], triggers: [{ triggerId: 'umbrella_vulnerable', kind: 'on_status_applied', statusTags: ['hard_control'], perTargetIcdMs: 0, actions: [{ type: 'apply_status', statusId: 'all_damage_vulnerable_control_scaled', magnitudeBps: 1500, durationMs: 0 }] }] }),
];
const exclusive = (input) => ({
    schemaVersion: 1,
    weaponId: input.id,
    name: input.name,
    quality: 'red',
    fragmentRequirement: 5,
    compatibility: { exclusiveGeneralId: input.generalId },
    statModifiers: input.stats ?? [],
    triggers: input.triggers ?? [],
    parameterPatches: input.patches ?? [],
    eventBudget: input.budget ?? ZERO_BUDGET,
    ui: { shortDescription: input.description, detailDescription: input.description, iconKey: `weapon_${input.id}` },
    status: 'testing',
});
exports.EXCLUSIVE_WEAPONS = [
    exclusive({ generalId: 'yangjian', id: 'yangjian_divine_trident', name: '三尖两刃神锋', description: '三尖两刃斩追加 60% 回斩，破甲 +10%', triggers: [{ triggerId: 'yangjian_return_slash', kind: 'on_active_skill_cast', maxTriggersPerCast: 1, actions: [{ type: 'extra_hit', coefficientBps: 6000, delayMs: 400, targetMode: 'return_path' }] }], patches: [patch('yangjian_armor_break', 'yangjian_armor_break', 'magnitudeBps', 'add_flat', 1000)], budget: { ...ZERO_BUDGET, maxExtraDamageEventsPerSecond: 4 } }),
    exclusive({ generalId: 'nazha', id: 'nazha_fire_tip_spear', name: '火尖枪', description: '风火轮增加 70% 回程命中并聚拢 0.5 格', triggers: [{ triggerId: 'nazha_return', kind: 'on_active_skill_cast', maxTriggersPerCast: 1, actions: [{ type: 'extra_hit', coefficientBps: 7000, delayMs: 300, targetMode: 'return_path' }, { type: 'path_displacement', distanceMilliCells: 500, bossRatioBps: 10000, toward: 'primary' }] }], budget: { ...ZERO_BUDGET, maxExtraDamageEventsPerSecond: 4, maxExtraTargetsPerCast: 8 } }),
    exclusive({ generalId: 'houyi', id: 'houyi_sun_shooting_bow', name: '射日神弓', description: '穿云逐日箭额外贯穿 2 个目标，伤害 100%/80%/60%', patches: [patch('houyi_targets', 'houyi_chuanyun_damage', 'additionalTargetLimit', 'add_flat', 2), patch('houyi_falloff', 'houyi_chuanyun_damage', 'pathDamageRatiosBps', 'add_flat', 8060)], budget: { ...ZERO_BUDGET, maxExtraTargetsPerCast: 2, maxExtraDamageEventsPerSecond: 3 } }),
    exclusive({ generalId: 'sha_wujing', id: 'sha_wujing_demon_staff', name: '降妖宝杖', description: '第 3 道气浪定身 0.5 秒，易损上限 +2', triggers: [{ triggerId: 'wujing_third_wave', kind: 'on_active_skill_hit', perTargetIcdMs: 0, maxTargetsPerCast: 8, actions: [{ type: 'apply_status', statusId: 'root', magnitudeBps: 0, durationMs: 500 }] }], patches: [patch('wujing_stacks', 'sha_wujing_vulnerable', 'maxStacks', 'add_flat', 2)] }),
    exclusive({ generalId: 'zhu_bajie', id: 'zhu_bajie_supreme_rake', name: '上宝沁金钯', description: '震地留下 4 秒泥沼，减速 35%', triggers: [{ triggerId: 'bajie_mud', kind: 'on_active_skill_cast', maxTriggersPerCast: 1, actions: [{ type: 'spawn_zone', zoneId: 'bajie_mud', radiusMilliCells: 2000, durationMs: 4000, tickIntervalMs: 500, coefficientBpsPerTick: 0, maxOwned: 1 }] }], budget: { ...ZERO_BUDGET, maxOwnedZones: 1 } }),
    exclusive({ generalId: 'yu_huang_dadi', id: 'jade_emperor_celestial_seal', name: '凌霄天帝印', description: '天雷优先未命中目标，第 3 道追加 80% 爆发', patches: [patch('jade_unique', 'yu_huang_dadi_thunder', 'preferUnhitTarget', 'add_flat', 1)], triggers: [{ triggerId: 'jade_third', kind: 'on_active_skill_hit', perTargetIcdMs: 0, maxTargetsPerCast: 8, actions: [{ type: 'extra_damage', damageType: 'physical', coefficientBps: 8000 }] }], budget: { ...ZERO_BUDGET, maxExtraDamageEventsPerSecond: 8 } }),
    exclusive({ generalId: 'lei_gong', id: 'lei_gong_thunder_chisel', name: '雷公凿', description: '雷区 +3 秒，每第 2 Tick 弹射 40%', patches: [patch('leigong_duration', 'lei_gong_thunder_zone', 'durationMs', 'add_flat', 3000)], triggers: [{ triggerId: 'leigong_bounce', kind: 'on_nth_basic_attack', n: 2, counterScope: 'owner_general', actions: [{ type: 'extra_damage', damageType: 'magic', coefficientBps: 4000 }] }], budget: { ...ZERO_BUDGET, maxExtraDamageEventsPerSecond: 6, maxExtraTargetsPerCast: 1 } }),
    exclusive({ generalId: 'dian_mu', id: 'dian_mu_lightning_mirror', name: '乾元电镜', description: '闪电链目标 +2，逐跳衰减少 5%', patches: [patch('dianmu_targets', 'dian_mu_shandianlian', 'targetLimit', 'add_flat', 2), patch('dianmu_falloff', 'dian_mu_shandianlian', 'bounceDamageFalloffBps', 'add_flat', -500)], budget: { ...ZERO_BUDGET, maxExtraTargetsPerCast: 2, maxExtraDamageEventsPerSecond: 4 } }),
    exclusive({ generalId: 'zhen_yuanzi', id: 'zhen_yuanzi_book_of_earth', name: '天地宝鉴', description: '袖里乾坤改为 4 秒目标区域，首次聚拢 0.5 格', patches: [patch('zhen_zone', 'zhen_yuanzi_xiulikun', 'convertToZoneDurationMs', 'add_flat', 4000), patch('zhen_pull', 'zhen_yuanzi_xiulikun', 'firstTickPullMilliCells', 'add_flat', 500)], budget: { ...ZERO_BUDGET, maxOwnedZones: 1 } }),
    exclusive({ generalId: 'ru_lai_fozu', id: 'ru_lai_five_finger_seal', name: '五指金印', description: '五指山留下镇压区，减速 50% 并首次封禁 1 秒', triggers: [{ triggerId: 'rulai_zone', kind: 'on_active_skill_cast', maxTriggersPerCast: 1, actions: [{ type: 'spawn_zone', zoneId: 'five_finger_suppress', radiusMilliCells: 2000, durationMs: 4000, tickIntervalMs: 500, coefficientBpsPerTick: 0, maxOwned: 1 }] }], budget: { ...ZERO_BUDGET, maxOwnedZones: 1 } }),
    exclusive({ generalId: 'pu_ti_laozu', id: 'pu_ti_lingtai_staff', name: '灵台方寸杖', description: '技能命中至少 5 敌人时，全体主动 CD -1 秒', triggers: [{ triggerId: 'puti_team_cdr', kind: 'on_active_skill_cast', maxTriggersPerCast: 1, actions: [{ type: 'cooldown_modify', scope: 'owner_all_generals_active', valueMs: -1000, minimumRemainingMs: 1000 }] }] }),
    exclusive({ generalId: 'lijing', id: 'lijing_pagoda', name: '玲珑宝塔', description: '天兵上限 +1；第 3 次普攻释放 50% 剑气', stats: [modifier('pagoda_limit', 'owned_summons', 'summon_alive_limit', 'add_flat', 1)], triggers: [{ triggerId: 'pagoda_sword_wave', kind: 'on_nth_basic_attack', n: 3, counterScope: 'each_summon', actions: [{ type: 'extra_damage', damageType: 'physical', coefficientBps: 5000 }] }], budget: { ...ZERO_BUDGET, maxExtraSummons: 1, maxExtraDamageEventsPerSecond: 6 } }),
    exclusive({ generalId: 'chang_e', id: 'chang_e_guanghan_moonwheel', name: '广寒月轮', description: '不同月兔命中同目标生成 3 秒月华区', triggers: [{ triggerId: 'change_moon_zone', kind: 'on_summon_basic_attack', summonUnitFilter: ['moon_rabbit'], maxTriggersPerSecond: 4, actions: [{ type: 'spawn_zone', zoneId: 'moonlight_zone', radiusMilliCells: 1500, durationMs: 3000, tickIntervalMs: 500, coefficientBpsPerTick: 0, maxOwned: 2 }] }], budget: { ...ZERO_BUDGET, maxOwnedZones: 2 } }),
    exclusive({ generalId: 'sunwukong', id: 'sunwukong_ruyi_jingu_bang', name: '如意金箍棒', description: '猴兵第 4 次普攻改为 120% 直线横扫', triggers: [{ triggerId: 'wukong_sweep', kind: 'on_nth_basic_attack', n: 4, counterScope: 'each_summon', actions: [{ type: 'extra_hit', coefficientBps: 12000, delayMs: 0, targetMode: 'line' }] }], budget: { ...ZERO_BUDGET, maxExtraTargetsPerCast: 4, maxExtraDamageEventsPerSecond: 8 } }),
    exclusive({ generalId: 'tai_yi_zhenren', id: 'taiyi_nine_dragon_fire_hood', name: '九龙神火罩', description: '灼烧死亡传播 2 敌人，仙童光环半径 +1', triggers: [{ triggerId: 'taiyi_burn_spread', kind: 'on_summoned_enemy_killed', maxTriggersPerPeriod: 1, periodMs: 1, actions: [{ type: 'propagate_status', statusId: 'burn', targetLimit: 2, durationRatioBps: 10000 }] }], patches: [patch('taiyi_aura', 'tai_yi_attack_speed_aura', 'radiusMilliCells', 'add_flat', 1000, 'owned_summon_effect')], budget: { ...ZERO_BUDGET, maxExtraTargetsPerCast: 2 } }),
    exclusive({ generalId: 'shou_xing', id: 'shouxing_longevity_staff', name: '盘龙寿杖', description: '3 层迟暮消耗后定身 1 秒并保留 1 层', triggers: [{ triggerId: 'shouxing_root', kind: 'on_status_applied', statusTags: ['aging_3_stacks'], perTargetIcdMs: 5000, actions: [{ type: 'apply_status', statusId: 'root_consume_aging_keep_one', magnitudeBps: 0, durationMs: 1000 }] }] }),
    exclusive({ generalId: 'tang_sanzang', id: 'tang_sanzang_khakkhara', name: '九环锡杖', description: '易损 +3 秒，硬控结束后减速 20% 3 秒', patches: [patch('tang_vuln', 'tang_sanzang_vulnerable', 'durationMs', 'add_flat', 3000)], triggers: [{ triggerId: 'tang_slow', kind: 'on_status_applied', statusTags: ['hard_control_ended'], perTargetIcdMs: 0, actions: [{ type: 'apply_status', statusId: 'slow', magnitudeBps: 2000, durationMs: 3000 }] }] }),
    exclusive({ generalId: 'bai_longma', id: 'bai_longma_sea_dragon_pearl', name: '沧海龙珠', description: '龙卷长度 +2 格并留下 4 秒减速水域', patches: [patch('dragon_length', 'bai_longma_tornado', 'lengthMilliCells', 'add_flat', 2000)], triggers: [{ triggerId: 'dragon_water', kind: 'on_active_skill_cast', maxTriggersPerCast: 1, actions: [{ type: 'spawn_zone', zoneId: 'dragon_water_path', radiusMilliCells: 1000, durationMs: 4000, tickIntervalMs: 500, coefficientBpsPerTick: 0, maxOwned: 2 }] }], budget: { ...ZERO_BUDGET, maxOwnedZones: 2 } }),
    exclusive({ generalId: 'pi_lanpo', id: 'pi_lanpo_sun_needle', name: '昴日金针', description: '金针弹射最近 2 个目标，持续时间为 60%', patches: [patch('needle_targets', 'pi_lanpo_sun_needle', 'additionalTargetLimit', 'add_flat', 2), patch('needle_duration', 'pi_lanpo_sun_needle', 'secondaryDurationRatioBps', 'add_flat', 6000)], budget: { ...ZERO_BUDGET, maxExtraTargetsPerCast: 2 } }),
    exclusive({ generalId: 'guan_yin_pusa', id: 'guanyin_jade_purifying_vase', name: '羊脂玉净瓶', description: '漩涡改为 3 次聚拢脉冲，易损 +2 秒', patches: [patch('guanyin_pulses', 'guan_yin_whirlpool', 'pullPulseCount', 'add_flat', 2), patch('guanyin_vuln', 'guan_yin_vulnerable', 'durationMs', 'add_flat', 2000)] }),
    exclusive({ generalId: 'tai_shang_laojun', id: 'laojun_purple_gold_furnace', name: '紫金八卦炉', description: '受技能影响敌人死亡留下 3 秒炉火区', triggers: [{ triggerId: 'laojun_fire_zone', kind: 'on_enemy_killed', maxTriggersPerSkillCycle: 3, actions: [{ type: 'spawn_zone', zoneId: 'laojun_furnace_fire', radiusMilliCells: 1000, durationMs: 3000, tickIntervalMs: 1000, coefficientBpsPerTick: 3000, maxOwned: 3 }] }], budget: { ...ZERO_BUDGET, maxOwnedZones: 3, maxExtraDamageEventsPerSecond: 9 } }),
];
exports.WEAPON_CATALOG = [...exports.COMMON_WEAPONS, ...exports.EXCLUSIVE_WEAPONS];
exports.WEAPON_CATALOG_BY_ID = new Map(exports.WEAPON_CATALOG.map((weapon) => [weapon.weaponId, weapon]));
const REGISTERED_TRIGGERS = new Set([
    'on_basic_attack_hit', 'on_nth_basic_attack', 'on_active_skill_cast', 'on_active_skill_hit',
    'on_displacement_success', 'on_status_applied', 'on_summon_basic_attack',
    'on_summoned_enemy_killed', 'on_enemy_killed',
]);
function validateWeaponCatalog(catalog = exports.WEAPON_CATALOG) {
    if (catalog.length !== 41)
        throw new Error(`Weapon catalog must contain 41 definitions, received ${catalog.length}`);
    const ids = new Set();
    const names = new Set();
    const exclusiveGenerals = new Set();
    const qualityCounts = { green: 0, blue: 0, purple: 0, orange: 0, red: 0 };
    for (const weapon of catalog) {
        if (!/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(weapon.weaponId) || ids.has(weapon.weaponId))
            throw new Error(`Invalid or duplicate weaponId: ${weapon.weaponId}`);
        if (!weapon.name || names.has(weapon.name))
            throw new Error(`Missing or duplicate weapon name: ${weapon.name}`);
        ids.add(weapon.weaponId);
        names.add(weapon.name);
        qualityCounts[weapon.quality] += 1;
        if (weapon.fragmentRequirement !== types_1.WEAPON_FRAGMENT_REQUIREMENT[weapon.quality])
            throw new Error(`Fragment requirement mismatch: ${weapon.weaponId}`);
        if (!weapon.ui.shortDescription || !weapon.ui.detailDescription || !weapon.ui.iconKey)
            throw new Error(`Incomplete UI metadata: ${weapon.weaponId}`);
        for (const amount of Object.values(weapon.eventBudget))
            if (!Number.isInteger(amount) || amount < 0)
                throw new Error(`Invalid event budget: ${weapon.weaponId}`);
        const exclusiveId = weapon.compatibility.exclusiveGeneralId;
        if (exclusiveId) {
            if (weapon.quality !== 'red' || Object.keys(weapon.compatibility).length !== 1)
                throw new Error(`Exclusive weapon compatibility must contain only exclusiveGeneralId: ${weapon.weaponId}`);
            if (!(0, roster_1.getGeneralRosterEntry)(exclusiveId) || exclusiveGenerals.has(exclusiveId))
                throw new Error(`Invalid or duplicate exclusive general: ${exclusiveId}`);
            exclusiveGenerals.add(exclusiveId);
        }
        else if (!weapon.compatibility.allowedArchetypes?.length && !weapon.compatibility.allowedGeneralIds?.length) {
            throw new Error(`Common weapon has no compatibility: ${weapon.weaponId}`);
        }
        const effectIds = new Set();
        for (const effect of weapon.statModifiers) {
            if (effectIds.has(effect.effectId))
                throw new Error(`Duplicate effectId in ${weapon.weaponId}: ${effect.effectId}`);
            effectIds.add(effect.effectId);
        }
        for (const trigger of weapon.triggers) {
            if (effectIds.has(trigger.triggerId))
                throw new Error(`Duplicate projected effect ID in ${weapon.weaponId}: ${trigger.triggerId}`);
            effectIds.add(trigger.triggerId);
            if (!REGISTERED_TRIGGERS.has(trigger.kind) || !trigger.actions.length)
                throw new Error(`Invalid trigger in ${weapon.weaponId}: ${trigger.triggerId}`);
            if (trigger.kind === 'on_basic_attack_hit' && (trigger.chanceBps === undefined || trigger.perTargetIcdMs === undefined || trigger.maxTriggersPerSecond === undefined))
                throw new Error(`Missing basic attack trigger guard: ${weapon.weaponId}`);
            if (trigger.kind === 'on_nth_basic_attack' && (!trigger.n || !trigger.counterScope))
                throw new Error(`Missing nth attack guard: ${weapon.weaponId}`);
            if (trigger.kind === 'on_active_skill_cast' && trigger.maxTriggersPerCast === undefined)
                throw new Error(`Missing cast guard: ${weapon.weaponId}`);
            if (trigger.kind === 'on_active_skill_hit' && (trigger.perTargetIcdMs === undefined || trigger.maxTargetsPerCast === undefined))
                throw new Error(`Missing skill hit guard: ${weapon.weaponId}`);
            if (trigger.kind === 'on_status_applied' && (!trigger.statusTags?.length || trigger.perTargetIcdMs === undefined))
                throw new Error(`Missing status trigger guard: ${weapon.weaponId}`);
            if (trigger.kind === 'on_summon_basic_attack' && (!trigger.summonUnitFilter?.length || trigger.maxTriggersPerSecond === undefined))
                throw new Error(`Missing summon attack guard: ${weapon.weaponId}`);
            if (trigger.kind === 'on_summoned_enemy_killed' && (!trigger.maxTriggersPerPeriod || !trigger.periodMs))
                throw new Error(`Missing summon kill guard: ${weapon.weaponId}`);
            if (trigger.kind === 'on_enemy_killed' && !trigger.maxTriggersPerSkillCycle)
                throw new Error(`Missing enemy kill guard: ${weapon.weaponId}`);
        }
        for (const parameterPatch of weapon.parameterPatches) {
            if (effectIds.has(parameterPatch.patchId))
                throw new Error(`Duplicate projected effect ID in ${weapon.weaponId}: ${parameterPatch.patchId}`);
            effectIds.add(parameterPatch.patchId);
            if (!parameterPatch.targetEffectId || !parameterPatch.parameter || !Number.isFinite(parameterPatch.value))
                throw new Error(`Invalid parameter patch: ${weapon.weaponId}:${parameterPatch.patchId}`);
        }
        if (!effectIds.size)
            throw new Error(`Weapon has no executable projection: ${weapon.weaponId}`);
    }
    if (qualityCounts.green !== 4 || qualityCounts.blue !== 4 || qualityCounts.purple !== 4 || qualityCounts.orange !== 4 || qualityCounts.red !== 25)
        throw new Error(`Unexpected quality distribution: ${JSON.stringify(qualityCounts)}`);
    if (exclusiveGenerals.size !== 21 || roster_1.GENERAL_ROSTER.some((general) => !exclusiveGenerals.has(general.generalId)))
        throw new Error('Every roster general must have exactly one exclusive weapon');
    for (const quality of ['green', 'blue', 'purple', 'orange', 'red']) {
        const commonAtQuality = catalog.filter((weapon) => weapon.quality === quality && !weapon.compatibility.exclusiveGeneralId);
        const archetypes = commonAtQuality.flatMap((weapon) => weapon.compatibility.allowedArchetypes ?? []);
        if (commonAtQuality.length !== 4 || new Set(archetypes).size !== 4)
            throw new Error(`${quality} must contain one common weapon for each archetype`);
    }
}
function getWeaponDefinition(weaponId) {
    return exports.WEAPON_CATALOG_BY_ID.get(weaponId) ?? null;
}
function isWeaponCompatible(weapon, generalId) {
    const general = (0, roster_1.getGeneralRosterEntry)(generalId);
    if (!general)
        return false;
    const compatibility = weapon.compatibility;
    if (compatibility.exclusiveGeneralId)
        return compatibility.exclusiveGeneralId === generalId;
    if (compatibility.excludedGeneralIds?.includes(generalId))
        return false;
    if (compatibility.allowedGeneralIds?.includes(generalId))
        return true;
    return compatibility.allowedArchetypes?.includes(general.profession) ?? false;
}
validateWeaponCatalog();
