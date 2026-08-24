"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GENERAL_DEVELOPMENT_SEQUENCE = exports.SYNERGY_V1_CATALOG = exports.MOON_PALACE_COMPANIONS = exports.GENERAL_SYNERGY_PROFILES = void 0;
exports.GENERAL_SYNERGY_PROFILES = [
    {
        generalId: 'houyi',
        displayName: '后羿',
        glyphs: ['后', '羿'],
        factions: ['mythic', 'moon_palace'],
        profession: 'physical',
        playstyles: ['ranged', 'single_target', 'critical'],
        namedCollections: ['moon_palace_legend'],
    },
    {
        generalId: 'chang_e',
        displayName: '嫦娥',
        glyphs: ['嫦', '娥'],
        factions: ['moon_palace'],
        profession: 'summon',
        playstyles: ['ranged', 'summoner', 'slow'],
        namedCollections: ['moon_palace_legend'],
    },
    {
        generalId: 'yangjian',
        displayName: '杨戬',
        glyphs: ['杨', '戬'],
        factions: ['heavenly_court'],
        profession: 'physical',
        playstyles: ['single_target', 'armor_break'],
        namedCollections: ['heaven_vanguard'],
    },
    {
        generalId: 'nazha',
        displayName: '哪吒',
        glyphs: ['哪', '吒'],
        factions: ['heavenly_court'],
        profession: 'physical',
        playstyles: ['area_damage', 'path_displacement'],
        namedCollections: ['lotus_family', 'heaven_vanguard'],
    },
    {
        generalId: 'lijing',
        displayName: '李靖',
        glyphs: ['李', '靖'],
        factions: ['heavenly_court'],
        profession: 'summon',
        playstyles: ['summoner'],
        namedCollections: ['lotus_family', 'heaven_vanguard'],
    },
];
/**
 * 第一条羁绊只验证成员常驻属性修改。减速幅度修改留到嫦娥技能和
 * 统一效果参数补丁接入后再做，不扩大首个纵向切片。
 */
exports.MOON_PALACE_COMPANIONS = {
    schemaVersion: 1,
    synergyId: 'moon_palace_companions',
    displayName: '月宫旧侣',
    category: 'specific_combination',
    activationScope: 'owner_board_formed_generals',
    levels: [
        {
            level: 1,
            requirements: [
                {
                    kind: 'all_generals',
                    generalIds: ['houyi', 'chang_e'],
                },
            ],
            effects: [
                {
                    effectId: 'moon_palace_companions_range',
                    type: 'stat_modifier',
                    target: { scope: 'synergy_members' },
                    stat: 'attackRange',
                    operation: 'add_flat',
                    value: 500,
                    stackGroup: 'synergy_attack_range',
                },
                {
                    effectId: 'moon_palace_companions_attack_speed',
                    type: 'stat_modifier',
                    target: { scope: 'synergy_members' },
                    stat: 'attackSpeed',
                    operation: 'add_ratio',
                    value: 1000,
                    stackGroup: 'synergy_attack_speed',
                },
            ],
        },
    ],
    status: 'prototype',
};
exports.SYNERGY_V1_CATALOG = [
    exports.MOON_PALACE_COMPANIONS,
];
exports.GENERAL_DEVELOPMENT_SEQUENCE = [
    {
        order: 1,
        generalId: 'houyi',
        closesSynergies: [],
        purpose: '跑通两字神将、远程物理普攻与自动技能模板',
    },
    {
        order: 2,
        generalId: 'chang_e',
        closesSynergies: ['moon_palace_companions'],
        purpose: '闭合首条神话羁绊，并接入召唤物继承白名单',
    },
    {
        order: 3,
        generalId: 'yangjian',
        closesSynergies: ['piercing_cloud_duo'],
        purpose: '与后羿闭合第一条物理职业羁绊',
    },
    {
        order: 4,
        generalId: 'nazha',
        closesSynergies: [],
        purpose: '为莲花父子与天庭先锋同时铺路',
    },
    {
        order: 5,
        generalId: 'lijing',
        closesSynergies: ['lotus_father_and_son', 'heaven_vanguard'],
        purpose: '一名神将同时验证两条羁绊叠加与召唤物动态刷新',
    },
];
