"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GENERAL_DEVELOPMENT_SEQUENCE = exports.GENERAL_SYNERGY_IDS_BY_GENERAL = exports.SYNERGY_V1_CATALOG = exports.MOON_PALACE_COMPANIONS = exports.GENERAL_SYNERGY_PROFILES = void 0;
exports.validateGeneralDevelopmentSequence = validateGeneralDevelopmentSequence;
const roster_1 = require("../core/hero-v1/roster");
/** 神将身份、配方与分类只由 hero-v1 roster 定义，羁绊层不复制第二份名单。 */
exports.GENERAL_SYNERGY_PROFILES = roster_1.GENERAL_ROSTER.map((entry) => ({
    generalId: entry.generalId,
    displayName: entry.displayName,
    glyphs: entry.glyphs,
    factions: entry.factions,
    profession: entry.profession,
    playstyles: entry.playstyles,
    namedCollections: entry.namedCollections,
}));
function stat(effectId, target, statName, operation, value, condition) {
    return {
        effectId,
        type: 'stat_modifier',
        target,
        stat: statName,
        operation,
        value,
        stackGroup: `synergy_${statName}`,
        ...(condition ? { condition } : {}),
    };
}
function memberStat(effectId, statName, operation, value, condition) {
    return stat(effectId, { scope: 'synergy_members' }, statName, operation, value, condition);
}
function summonStat(effectId, statName, value) {
    return stat(effectId, { scope: 'owned_summons_of_synergy_members' }, statName, 'add_ratio', value);
}
function patch(effectId, targetEffectId, parameter, operation, value) {
    return {
        effectId,
        type: 'effect_parameter_patch',
        target: { scope: 'synergy_members' },
        targetEffectId,
        parameter,
        operation,
        value,
        stackGroup: `synergy_parameter_${parameter}`,
    };
}
/** “全属性”必须在数据层展开，不存在 allAttributes 运行时属性。 */
function explicitMemberAllAttributes(prefix, valueBps) {
    return [
        memberStat(`${prefix}_attack`, 'attack', 'add_ratio', valueBps),
        memberStat(`${prefix}_attack_speed`, 'attackSpeed', 'add_ratio', valueBps),
        memberStat(`${prefix}_attack_range`, 'attackRange', 'add_ratio', valueBps),
        memberStat(`${prefix}_crit_rate`, 'critRate', 'add_ratio', valueBps),
        memberStat(`${prefix}_crit_damage`, 'critDamage', 'add_ratio', valueBps),
    ];
}
function defineSynergy(input) {
    return {
        schemaVersion: 1,
        synergyId: input.synergyId,
        displayName: input.displayName,
        category: input.category,
        activationScope: 'owner_board_formed_generals',
        levels: [{
                level: 1,
                requirements: [{ kind: 'all_generals', generalIds: input.members }],
                effects: input.effects,
            }],
        status: 'prototype',
    };
}
exports.MOON_PALACE_COMPANIONS = defineSynergy({
    synergyId: 'moon_palace_companions', displayName: '月宫旧侣', category: 'specific_combination',
    members: [roster_1.GENERAL_IDS.HOUYI, roster_1.GENERAL_IDS.CHANG_E],
    effects: [
        memberStat('moon_palace_companions_range', 'attackRange', 'add_flat', 500),
        memberStat('moon_palace_companions_attack_speed', 'attackSpeed', 'add_ratio', 1000),
    ],
});
exports.SYNERGY_V1_CATALOG = [
    defineSynergy({
        synergyId: 'piercing_cloud_duo', displayName: '穿云双将', category: 'profession',
        members: [roster_1.GENERAL_IDS.YANGJIAN, roster_1.GENERAL_IDS.HOUYI],
        effects: [memberStat('piercing_cloud_duo_attack', 'attack', 'add_ratio', 1500), memberStat('piercing_cloud_duo_crit_rate', 'critRate', 'add_flat', 1000)],
    }),
    defineSynergy({
        synergyId: 'thunder_duo', displayName: '雷部双神', category: 'profession',
        members: [roster_1.GENERAL_IDS.LEI_GONG, roster_1.GENERAL_IDS.DIAN_MU],
        effects: [
            memberStat('thunder_duo_magic_damage', 'magicDamageBonus', 'add_ratio', 2000),
            patch('thunder_duo_lightning_chain_extra_target', 'dian_mu_shandianlian', 'targetLimit', 'add_flat', 1),
        ],
    }),
    defineSynergy({
        synergyId: 'heavenly_soldier_moon_rabbit', displayName: '天兵月兔', category: 'profession',
        members: [roster_1.GENERAL_IDS.LIJING, roster_1.GENERAL_IDS.CHANG_E],
        effects: [
            patch('heavenly_soldier_moon_rabbit_lijing_limit', 'lijing_tianbing_summon', 'maxOwnedAlive', 'add_flat', 1),
            patch('heavenly_soldier_moon_rabbit_change_limit', 'chang_e_moon_rabbit_summon', 'maxOwnedAlive', 'add_flat', 1),
            summonStat('heavenly_soldier_moon_rabbit_attack', 'summonAttack', 1500),
        ],
    }),
    defineSynergy({
        synergyId: 'curtain_canopy', displayName: '卷帘天蓬', category: 'profession',
        members: [roster_1.GENERAL_IDS.SHA_WUJING, roster_1.GENERAL_IDS.ZHU_BAJIE],
        effects: [memberStat('curtain_canopy_attack_speed', 'attackSpeed', 'add_ratio', 1500), memberStat('curtain_canopy_range', 'attackRange', 'add_flat', 500)],
    }),
    defineSynergy({
        synergyId: 'buddhist_blessing', displayName: '佛法加持', category: 'profession',
        members: [roster_1.GENERAL_IDS.TANG_SANZANG, roster_1.GENERAL_IDS.PI_LANPO],
        effects: [
            memberStat('buddhist_blessing_control_duration', 'controlDuration', 'add_ratio', 2000),
            patch('buddhist_blessing_tangsanzang_vulnerable', 'tang_sanzang_jinguzhou_vulnerable', 'magnitude', 'add_flat', 500),
            patch('buddhist_blessing_pilanpo_vulnerable', 'pi_lanpo_jinzhen_vulnerable', 'magnitude', 'add_flat', 500),
        ],
    }),
    defineSynergy({
        synergyId: 'lotus_father_and_son', displayName: '莲花父子', category: 'specific_combination',
        members: [roster_1.GENERAL_IDS.LIJING, roster_1.GENERAL_IDS.NAZHA],
        effects: [...explicitMemberAllAttributes('lotus_father_and_son', 1200), memberStat('lotus_father_and_son_cooldown', 'cooldownReduction', 'add_ratio', 1000)],
    }),
    defineSynergy({
        synergyId: 'mentor_and_disciple', displayName: '师徒同行', category: 'specific_combination',
        members: [roster_1.GENERAL_IDS.TANG_SANZANG, roster_1.GENERAL_IDS.SUNWUKONG],
        effects: [memberStat('mentor_and_disciple_attack', 'attack', 'add_ratio', 1500), memberStat('mentor_and_disciple_boss_damage', 'damageDealt', 'add_ratio', 2000, { targetTagsAny: ['boss'] })],
    }),
    defineSynergy({
        synergyId: 'senior_brothers', displayName: '师兄弟', category: 'specific_combination',
        members: [roster_1.GENERAL_IDS.SUNWUKONG, roster_1.GENERAL_IDS.ZHU_BAJIE],
        effects: [memberStat('senior_brothers_attack', 'attack', 'add_ratio', 1500), memberStat('senior_brothers_crit_rate', 'critRate', 'add_flat', 1000)],
    }),
    defineSynergy({
        synergyId: 'curtain_dragon', displayName: '卷帘天龙', category: 'specific_combination',
        members: [roster_1.GENERAL_IDS.SHA_WUJING, roster_1.GENERAL_IDS.BAI_LONGMA],
        effects: [memberStat('curtain_dragon_active_skill_damage', 'damageDealt', 'add_ratio', 1500, { effectTagsAny: ['active_skill'] }), memberStat('curtain_dragon_attack_speed', 'attackSpeed', 'add_ratio', 1000)],
    }),
    exports.MOON_PALACE_COMPANIONS,
    defineSynergy({
        synergyId: 'taoist_two_ancestors', displayName: '道之二祖', category: 'specific_combination',
        members: [roster_1.GENERAL_IDS.PU_TI_LAOZU, roster_1.GENERAL_IDS.TAI_SHANG_LAOJUN],
        effects: [memberStat('taoist_two_ancestors_magic_damage', 'magicDamageBonus', 'add_ratio', 2000), memberStat('taoist_two_ancestors_cooldown', 'cooldownReduction', 'add_ratio', 1500)],
    }),
    defineSynergy({
        synergyId: 'earth_immortal_circle', displayName: '地仙之流', category: 'specific_combination',
        members: [roster_1.GENERAL_IDS.ZHEN_YUANZI, roster_1.GENERAL_IDS.TAI_YI_ZHENREN],
        effects: [
            memberStat('earth_immortal_circle_control_duration', 'controlDuration', 'add_ratio', 2000),
            patch('earth_immortal_circle_zhenyuanzi_pull_range', 'zhen_yuanzi_xiulikun', 'radiusMilliCells', 'add_flat', 1000),
            patch('earth_immortal_circle_zhenyuanzi_dot_range', 'zhen_yuanzi_qiankun_dot', 'radiusMilliCells', 'add_flat', 1000),
            patch('earth_immortal_circle_taiyi_spawn_range', 'tai_yi_zhenren_xiantong_summon', 'spawnRadiusMilliCells', 'add_flat', 1000),
        ],
    }),
    defineSynergy({
        synergyId: 'buddhist_ferry', displayName: '佛门引渡', category: 'specific_combination',
        members: [roster_1.GENERAL_IDS.GUAN_YIN_PUSA, roster_1.GENERAL_IDS.TANG_SANZANG],
        effects: [
            memberStat('buddhist_ferry_control_duration', 'controlDuration', 'add_ratio', 2000),
            patch('buddhist_ferry_guanyin_vulnerable', 'guan_yin_pusa_jingping_vulnerable', 'magnitude', 'add_ratio', 1000),
            patch('buddhist_ferry_tangsanzang_vulnerable', 'tang_sanzang_jinguzhou_vulnerable', 'magnitude', 'add_ratio', 1000),
        ],
    }),
    defineSynergy({
        synergyId: 'heaven_vanguard', displayName: '天庭先锋', category: 'specific_combination',
        members: [roster_1.GENERAL_IDS.YANGJIAN, roster_1.GENERAL_IDS.NAZHA, roster_1.GENERAL_IDS.LIJING],
        effects: [...explicitMemberAllAttributes('heaven_vanguard', 1000), memberStat('heaven_vanguard_normal_damage', 'damageDealt', 'add_ratio', 1500, { targetTagsAny: ['normal'] })],
    }),
    defineSynergy({
        synergyId: 'pilgrimage_three_disciples', displayName: '取经三徒', category: 'specific_combination',
        members: [roster_1.GENERAL_IDS.SUNWUKONG, roster_1.GENERAL_IDS.ZHU_BAJIE, roster_1.GENERAL_IDS.SHA_WUJING],
        effects: [memberStat('pilgrimage_three_disciples_attack', 'attack', 'add_ratio', 1500), memberStat('pilgrimage_three_disciples_attack_speed', 'attackSpeed', 'add_ratio', 1000), memberStat('pilgrimage_three_disciples_boss_damage', 'damageDealt', 'add_ratio', 2000, { targetTagsAny: ['boss'] })],
    }),
    defineSynergy({
        synergyId: 'physical_heavenly_venerates', displayName: '物理天尊', category: 'profession',
        members: [roster_1.GENERAL_IDS.YANGJIAN, roster_1.GENERAL_IDS.NAZHA, roster_1.GENERAL_IDS.HOUYI, roster_1.GENERAL_IDS.YU_HUANG_DADI],
        effects: [
            memberStat('physical_heavenly_venerates_attack', 'attack', 'add_ratio', 2500),
            memberStat('physical_heavenly_venerates_crit_rate', 'critRate', 'add_flat', 2000),
            memberStat('physical_heavenly_venerates_crit_damage', 'critDamage', 'add_flat', 3000),
            patch('physical_heavenly_venerates_armor_break', 'yangjian_sanjian_armor_break', 'magnitude', 'add_ratio', 2500),
        ],
    }),
    defineSynergy({
        synergyId: 'myriad_summons', displayName: '万法召唤', category: 'profession',
        members: [roster_1.GENERAL_IDS.LIJING, roster_1.GENERAL_IDS.CHANG_E, roster_1.GENERAL_IDS.SUNWUKONG, roster_1.GENERAL_IDS.TAI_YI_ZHENREN],
        effects: [
            patch('myriad_summons_lijing_limit', 'lijing_tianbing_summon', 'maxOwnedAlive', 'add_flat', 2),
            patch('myriad_summons_change_limit', 'chang_e_moon_rabbit_summon', 'maxOwnedAlive', 'add_flat', 2),
            patch('myriad_summons_sunwukong_limit', 'sunwukong_haomao_fenshen', 'maxOwnedAlive', 'add_flat', 2),
            patch('myriad_summons_taiyi_limit', 'tai_yi_zhenren_xiantong_summon', 'maxOwnedAlive', 'add_flat', 2),
            summonStat('myriad_summons_attack', 'summonAttack', 2500),
            summonStat('myriad_summons_attack_speed', 'summonAttackSpeed', 2500),
            summonStat('myriad_summons_crit_rate', 'summonCritRate', 2500),
            summonStat('myriad_summons_crit_damage', 'summonCritDamage', 2500),
            summonStat('myriad_summons_duration', 'summonDuration', 3000),
        ],
    }),
    defineSynergy({
        synergyId: 'xuanmen_taoist_lineage', displayName: '玄门道宗', category: 'faction',
        members: [roster_1.GENERAL_IDS.PU_TI_LAOZU, roster_1.GENERAL_IDS.TAI_SHANG_LAOJUN, roster_1.GENERAL_IDS.TAI_YI_ZHENREN, roster_1.GENERAL_IDS.ZHEN_YUANZI],
        effects: [memberStat('xuanmen_taoist_lineage_magic_damage', 'magicDamageBonus', 'add_ratio', 3000), memberStat('xuanmen_taoist_lineage_cooldown', 'cooldownReduction', 'add_ratio', 2500), memberStat('xuanmen_taoist_lineage_control_duration', 'controlDuration', 'add_ratio', 3000)],
    }),
    defineSynergy({
        synergyId: 'saha_buddhism', displayName: '娑婆佛门', category: 'faction',
        members: [roster_1.GENERAL_IDS.RU_LAI_FOZU, roster_1.GENERAL_IDS.GUAN_YIN_PUSA, roster_1.GENERAL_IDS.PI_LANPO, roster_1.GENERAL_IDS.TANG_SANZANG],
        effects: [
            ...explicitMemberAllAttributes('saha_buddhism', 2200),
            memberStat('saha_buddhism_demon_damage', 'damageDealt', 'add_ratio', 3500, { targetTagsAny: ['yao', 'mo'] }),
            memberStat('saha_buddhism_control_duration', 'controlDuration', 'add_ratio', 2000),
            patch('saha_buddhism_guanyin_vulnerable', 'guan_yin_pusa_jingping_vulnerable', 'magnitude', 'add_flat', 800),
            patch('saha_buddhism_pilanpo_vulnerable', 'pi_lanpo_jinzhen_vulnerable', 'magnitude', 'add_flat', 800),
            patch('saha_buddhism_tangsanzang_vulnerable', 'tang_sanzang_jinguzhou_vulnerable', 'magnitude', 'add_flat', 800),
        ],
    }),
    defineSynergy({
        synergyId: 'heavenly_court_saints', displayName: '天庭圣众', category: 'faction',
        members: [roster_1.GENERAL_IDS.YU_HUANG_DADI, roster_1.GENERAL_IDS.YANGJIAN, roster_1.GENERAL_IDS.NAZHA, roster_1.GENERAL_IDS.LIJING, roster_1.GENERAL_IDS.LEI_GONG, roster_1.GENERAL_IDS.DIAN_MU],
        effects: [
            memberStat('heavenly_court_saints_attack', 'attack', 'add_ratio', 2500),
            memberStat('heavenly_court_saints_attack_speed', 'attackSpeed', 'add_ratio', 2000),
            memberStat('heavenly_court_saints_active_skill_damage', 'damageDealt', 'add_ratio', 2500, { effectTagsAny: ['active_skill'] }),
            memberStat('heavenly_court_saints_cooldown', 'cooldownReduction', 'add_ratio', 2000),
        ],
    }),
    defineSynergy({
        synergyId: 'pilgrimage_five', displayName: '取经五众', category: 'specific_combination',
        members: [roster_1.GENERAL_IDS.TANG_SANZANG, roster_1.GENERAL_IDS.SUNWUKONG, roster_1.GENERAL_IDS.ZHU_BAJIE, roster_1.GENERAL_IDS.SHA_WUJING, roster_1.GENERAL_IDS.BAI_LONGMA],
        effects: [
            ...explicitMemberAllAttributes('pilgrimage_five', 2000),
            memberStat('pilgrimage_five_crit_rate_extra', 'critRate', 'add_flat', 1800),
            memberStat('pilgrimage_five_boss_damage', 'damageDealt', 'add_ratio', 3500, { targetTagsAny: ['boss'] }),
            stat('pilgrimage_five_experience_gain', { scope: 'owner_player' }, 'generalExperienceGain', 'add_ratio', 2000),
        ],
    }),
    defineSynergy({
        synergyId: 'longevity_immortals', displayName: '长生二仙', category: 'specific_combination',
        members: [roster_1.GENERAL_IDS.SHOU_XING, roster_1.GENERAL_IDS.TAI_SHANG_LAOJUN],
        effects: [memberStat('longevity_immortals_control_duration', 'controlDuration', 'add_ratio', 1500), memberStat('longevity_immortals_cooldown', 'cooldownReduction', 'add_ratio', 1000)],
    }),
];
exports.GENERAL_SYNERGY_IDS_BY_GENERAL = Object.fromEntries(exports.GENERAL_SYNERGY_PROFILES.map((profile) => [
    profile.generalId,
    exports.SYNERGY_V1_CATALOG.flatMap((definition) => definition.levels.some((level) => level.requirements.some((requirement) => requirement.kind === 'all_generals'
        && requirement.generalIds.includes(profile.generalId))) ? [definition.synergyId] : []),
]));
exports.GENERAL_DEVELOPMENT_SEQUENCE = [
    { order: 1, generalId: roster_1.GENERAL_IDS.HOUYI, closesSynergies: [], purpose: '跑通两字神将模板' },
    { order: 2, generalId: roster_1.GENERAL_IDS.CHANG_E, closesSynergies: ['moon_palace_companions'], purpose: '闭合月宫旧侣和召唤物继承' },
    { order: 3, generalId: roster_1.GENERAL_IDS.YANGJIAN, closesSynergies: ['piercing_cloud_duo'], purpose: '闭合穿云双将' },
    { order: 4, generalId: roster_1.GENERAL_IDS.NAZHA, closesSynergies: [], purpose: '为莲花父子与天庭先锋铺路' },
    { order: 5, generalId: roster_1.GENERAL_IDS.LIJING, closesSynergies: ['lotus_father_and_son', 'heaven_vanguard', 'heavenly_soldier_moon_rabbit'], purpose: '同时闭合三条初期羁绊' },
    { order: 6, generalId: roster_1.GENERAL_IDS.LEI_GONG, closesSynergies: [], purpose: '铺设雷部与天庭法系' },
    { order: 7, generalId: roster_1.GENERAL_IDS.DIAN_MU, closesSynergies: ['thunder_duo'], purpose: '闭合雷部双神' },
    { order: 8, generalId: roster_1.GENERAL_IDS.YU_HUANG_DADI, closesSynergies: ['physical_heavenly_venerates', 'heavenly_court_saints'], purpose: '闭合物理天尊与天庭圣众' },
    { order: 9, generalId: roster_1.GENERAL_IDS.SUNWUKONG, closesSynergies: [], purpose: '开启取经与万法召唤路线' },
    { order: 10, generalId: roster_1.GENERAL_IDS.TANG_SANZANG, closesSynergies: ['mentor_and_disciple'], purpose: '闭合师徒同行' },
    { order: 11, generalId: roster_1.GENERAL_IDS.ZHU_BAJIE, closesSynergies: ['senior_brothers'], purpose: '闭合师兄弟' },
    { order: 12, generalId: roster_1.GENERAL_IDS.SHA_WUJING, closesSynergies: ['curtain_canopy', 'pilgrimage_three_disciples'], purpose: '闭合卷帘天蓬与取经三徒' },
    { order: 13, generalId: roster_1.GENERAL_IDS.BAI_LONGMA, closesSynergies: ['curtain_dragon', 'pilgrimage_five'], purpose: '闭合卷帘天龙与取经五众' },
    { order: 14, generalId: roster_1.GENERAL_IDS.TAI_YI_ZHENREN, closesSynergies: ['myriad_summons'], purpose: '闭合万法召唤' },
    { order: 15, generalId: roster_1.GENERAL_IDS.ZHEN_YUANZI, closesSynergies: ['earth_immortal_circle'], purpose: '闭合地仙之流' },
    { order: 16, generalId: roster_1.GENERAL_IDS.PI_LANPO, closesSynergies: ['buddhist_blessing'], purpose: '闭合佛法加持' },
    { order: 17, generalId: roster_1.GENERAL_IDS.GUAN_YIN_PUSA, closesSynergies: ['buddhist_ferry'], purpose: '闭合佛门引渡' },
    { order: 18, generalId: roster_1.GENERAL_IDS.RU_LAI_FOZU, closesSynergies: ['saha_buddhism'], purpose: '闭合娑婆佛门' },
    { order: 19, generalId: roster_1.GENERAL_IDS.PU_TI_LAOZU, closesSynergies: [], purpose: '为道之二祖与玄门道宗铺路' },
    { order: 20, generalId: roster_1.GENERAL_IDS.SHOU_XING, closesSynergies: [], purpose: '为长生二仙铺路' },
    { order: 21, generalId: roster_1.GENERAL_IDS.TAI_SHANG_LAOJUN, closesSynergies: ['taoist_two_ancestors', 'xuanmen_taoist_lineage', 'longevity_immortals'], purpose: '同时闭合玄门与长生终局羁绊' },
];
function validateGeneralDevelopmentSequence() {
    if (exports.GENERAL_DEVELOPMENT_SEQUENCE.length !== roster_1.GENERAL_ROSTER.length) {
        throw new Error('Development sequence must contain every roster general exactly once');
    }
    const orderByGeneral = new Map();
    for (const [index, step] of exports.GENERAL_DEVELOPMENT_SEQUENCE.entries()) {
        if (step.order !== index + 1 || orderByGeneral.has(step.generalId)) {
            throw new Error(`Invalid or duplicate development sequence step: ${step.generalId}`);
        }
        orderByGeneral.set(step.generalId, step.order);
    }
    if (roster_1.GENERAL_ROSTER.some((entry) => !orderByGeneral.has(entry.generalId))) {
        throw new Error('Development sequence is missing a roster general');
    }
    const expectedClosures = new Map();
    for (const synergy of exports.SYNERGY_V1_CATALOG) {
        const members = synergy.levels.flatMap((level) => level.requirements.flatMap((requirement) => requirement.kind === 'all_generals' ? [...requirement.generalIds] : []));
        const closingGeneralId = members.reduce((latest, generalId) => (orderByGeneral.get(generalId) ?? -1) > (orderByGeneral.get(latest) ?? -1) ? generalId : latest);
        const list = expectedClosures.get(closingGeneralId) ?? [];
        list.push(synergy.synergyId);
        expectedClosures.set(closingGeneralId, list);
    }
    const declaredClosures = new Set();
    for (const step of exports.GENERAL_DEVELOPMENT_SEQUENCE) {
        const actual = [...step.closesSynergies].sort();
        const expected = [...(expectedClosures.get(step.generalId) ?? [])].sort();
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
            throw new Error(`Incorrect first-closure list for ${step.generalId}`);
        }
        for (const synergyId of actual) {
            if (declaredClosures.has(synergyId))
                throw new Error(`Synergy closes more than once: ${synergyId}`);
            declaredClosures.add(synergyId);
        }
    }
    if (declaredClosures.size !== exports.SYNERGY_V1_CATALOG.length) {
        throw new Error('Every synergy must close exactly once in the development sequence');
    }
}
validateGeneralDevelopmentSequence();
