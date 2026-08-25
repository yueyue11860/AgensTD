"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PASSIVE_ITEM_IDS = exports.ACTIVE_ITEM_IDS = exports.ITEM_DEFINITIONS = exports.PASSIVE_ITEM_DEFINITIONS = exports.ACTIVE_ITEM_DEFINITIONS = void 0;
exports.getItemDefinition = getItemDefinition;
exports.getActiveItemDefinition = getActiveItemDefinition;
exports.getPassiveItemDefinition = getPassiveItemDefinition;
exports.validateItemCatalog = validateItemCatalog;
exports.assertValidItemCatalog = assertValidItemCatalog;
const ui = (shortDescription, detailDescription, iconKey) => ({
    shortDescription,
    detailDescription,
    iconKey,
});
exports.ACTIVE_ITEM_DEFINITIONS = [
    {
        schemaVersion: 1,
        itemId: 'change_character_brush',
        name: '点将笔',
        itemKind: 'active',
        tags: ['character', 'recruit'],
        ui: ui('替换一个自己的字符', '等权替换为大本营剩余的其他神将字符。', 'item_change_character_brush'),
        status: 'released',
        availabilityPhases: ['prep', 'spawning', 'clearing'],
        targeting: {
            kind: 'character_token',
            ownerPolicy: 'self_only',
            allowedZones: ['summon_tray', 'reserve', 'board'],
        },
        maxChargesPerMatch: 2,
        cooldownMs: 15_000,
        effects: [],
        actions: [{
                actionId: 'change_character_brush.replace_character',
                type: 'replace_character_token',
                candidatePolicy: 'remaining_other_general_character_equal_weight',
                originalTokenDestination: 'discard',
                rescanPolicy: 'affected_board_line',
            }],
        failurePolicy: 'no_consume',
    },
    {
        schemaVersion: 1,
        itemId: 'cultivation_pill',
        name: '修为丹',
        itemKind: 'active',
        tags: ['general', 'experience'],
        ui: ui('神将增加 10 经验', '为当前激活神将增加内部 10000 点经验。', 'item_cultivation_pill'),
        status: 'released',
        availabilityPhases: ['prep', 'spawning', 'clearing'],
        targeting: { kind: 'active_general', ownerPolicy: 'self_only' },
        maxChargesPerMatch: 2,
        cooldownMs: 20_000,
        effects: [],
        actions: [{
                actionId: 'cultivation_pill.grant_experience',
                type: 'grant_general_experience',
                experiencePoints: 10_000,
                obeyCurrentLevelCap: true,
            }],
        failurePolicy: 'no_consume',
    },
    {
        schemaVersion: 1,
        itemId: 'general_ascension_talisman',
        name: '神将符',
        itemKind: 'active',
        tags: ['general', 'level'],
        ui: ui('神将恰好提升一级', '补足当前激活神将到下一级所缺经验。', 'item_general_ascension_talisman'),
        status: 'released',
        availabilityPhases: ['prep', 'spawning', 'clearing'],
        targeting: { kind: 'active_general', ownerPolicy: 'self_only' },
        maxChargesPerMatch: 1,
        cooldownMs: 30_000,
        effects: [],
        actions: [{
                actionId: 'general_ascension_talisman.grant_level',
                type: 'grant_general_level',
                levels: 1,
                grantOnlyMissingExperience: true,
                obeyCurrentLevelCap: true,
            }],
        failurePolicy: 'no_consume',
    },
    {
        schemaVersion: 1,
        itemId: 'rerecruit_order',
        name: '再征令',
        itemKind: 'active',
        tags: ['recruit', 'refresh'],
        ui: ui('免费刷新召唤托盘', '0.5 秒后免费强制刷新全部五格。', 'item_rerecruit_order'),
        status: 'released',
        availabilityPhases: ['prep', 'spawning', 'clearing'],
        targeting: { kind: 'none', ownerPolicy: 'self_only' },
        maxChargesPerMatch: 1,
        cooldownMs: 30_000,
        effects: [],
        actions: [{
                actionId: 'rerecruit_order.refresh_tray',
                type: 'refresh_summon_tray',
                slotCount: 5,
                animationMs: 500,
                costRations: 0,
                incrementsPaidRecruitCount: false,
                contributesToPity: false,
                appliesFirstBatchSoldierRule: false,
            }],
        failurePolicy: 'no_consume',
    },
    {
        schemaVersion: 1,
        itemId: 'soul_recall_banner',
        name: '招魂幡',
        itemKind: 'active',
        tags: ['character', 'discard'],
        ui: ui('找回一个弃置字符', '把自己的弃置字符原 Token 移至空托盘位或备战位。', 'item_soul_recall_banner'),
        status: 'released',
        availabilityPhases: ['prep', 'spawning', 'clearing'],
        targeting: {
            kind: 'discarded_character_to_empty_slot',
            ownerPolicy: 'self_only',
            allowedZones: ['discard', 'summon_tray', 'reserve'],
        },
        maxChargesPerMatch: 1,
        cooldownMs: 20_000,
        effects: [],
        actions: [{
                actionId: 'soul_recall_banner.recover_character',
                type: 'recover_discarded_character',
                forbidsSoldier: true,
                preserveTokenIdentity: true,
            }],
        failurePolicy: 'no_consume',
    },
    {
        schemaVersion: 1,
        itemId: 'heavenly_thunder_order',
        name: '天雷令',
        itemKind: 'active',
        tags: ['combat', 'damage'],
        ui: ui('范围压低敌人当前生命', '普通怪损失 12%、Boss 损失 3% 当前生命，最低保留 1 点。', 'item_heavenly_thunder_order'),
        status: 'released',
        availabilityPhases: ['spawning', 'clearing'],
        targeting: { kind: 'battlefield_point', ownerPolicy: 'any_targetable_enemy', radiusMilliCells: 2_000 },
        maxChargesPerMatch: 2,
        cooldownMs: 25_000,
        effects: [{
                effectId: 'heavenly_thunder_order.current_hp_damage',
                type: 'current_health_true_damage',
                target: 'enemies_in_radius',
                radiusMilliCells: 2_000,
                normalCurrentHpRatioBps: 1_200,
                bossCurrentHpRatioBps: 300,
                minimumRemainingHp: 1,
                canCrit: false,
                excludesSpawnProtected: true,
                grantsGeneralContribution: false,
            }],
        actions: [],
        failurePolicy: 'no_consume',
    },
    {
        schemaVersion: 1,
        itemId: 'wind_stilling_talisman',
        name: '定风符',
        itemKind: 'active',
        tags: ['combat', 'control'],
        ui: ui('范围减速并定身', '半径三格内普通怪减速 50% 五秒并定身一秒。', 'item_wind_stilling_talisman'),
        status: 'released',
        availabilityPhases: ['spawning', 'clearing'],
        targeting: { kind: 'battlefield_point', ownerPolicy: 'any_targetable_enemy', radiusMilliCells: 3_000 },
        maxChargesPerMatch: 2,
        cooldownMs: 25_000,
        effects: [
            {
                effectId: 'wind_stilling_talisman.slow',
                type: 'status_apply',
                target: 'enemies_in_radius',
                radiusMilliCells: 3_000,
                statusId: 'slow',
                magnitudeBps: 5_000,
                normalDurationMs: 5_000,
                bossBaseDurationMs: 5_000,
                obeysControlDiminishingReturns: true,
                obeysBossControlResistance: true,
                grantsGeneralContribution: false,
            },
            {
                effectId: 'wind_stilling_talisman.root',
                type: 'status_apply',
                target: 'enemies_in_radius',
                radiusMilliCells: 3_000,
                statusId: 'root',
                magnitudeBps: 10_000,
                normalDurationMs: 1_000,
                bossBaseDurationMs: 300,
                obeysControlDiminishingReturns: true,
                obeysBossControlResistance: true,
                grantsGeneralContribution: false,
            },
        ],
        actions: [],
        failurePolicy: 'no_consume',
    },
    {
        schemaVersion: 1,
        itemId: 'war_drum_order',
        name: '战鼓令',
        itemKind: 'active',
        tags: ['combat', 'general', 'buff'],
        ui: ui('强化神将八秒', '攻击 +25%、攻速 +20%、主动技能伤害 +25%。', 'item_war_drum_order'),
        status: 'released',
        availabilityPhases: ['spawning', 'clearing'],
        targeting: { kind: 'active_general', ownerPolicy: 'self_only' },
        maxChargesPerMatch: 2,
        cooldownMs: 20_000,
        effects: [
            timedGeneralEffect('war_drum_order.attack', 'attack', 2_500),
            timedGeneralEffect('war_drum_order.attack_speed', 'attackSpeed', 2_000),
            timedGeneralEffect('war_drum_order.active_skill_damage', 'activeSkillDamage', 2_500),
        ],
        actions: [],
        failurePolicy: 'no_consume',
    },
];
function timedGeneralEffect(effectId, stat, valueBps) {
    return {
        effectId,
        type: 'timed_stat_modifier',
        target: 'target_general',
        stat,
        operation: 'add_ratio',
        valueBps,
        durationMs: 8_000,
        stackGroup: `active_item:${effectId}`,
        inactivePolicy: 'continue_timer_restore_if_reformed',
    };
}
const passiveBase = (itemId, name, shortDescription, tags) => ({
    schemaVersion: 1,
    itemId,
    name,
    itemKind: 'passive',
    tags,
    ui: ui(shortDescription, shortDescription, `item_${itemId}`),
    status: 'released',
    scope: 'owner_global',
    attachAt: 'player_match_state_initialized',
    effects: [],
    ruleModifiers: [],
    eventListeners: [],
    stacking: { group: `passive_item:${itemId}`, policy: 'unique' },
});
exports.PASSIVE_ITEM_DEFINITIONS = [
    {
        ...passiveBase('traveling_kitchen', '行军灶', '初始斋饭 +5', ['economy']),
        ruleModifiers: [{ modifierId: 'traveling_kitchen.starting_rations', type: 'starting_rations', addFlat: 5 }],
    },
    {
        ...passiveBase('frugal_recruitment_order', '节用令', '付费召唤费用 -1，最低 5', ['economy', 'recruit']),
        ruleModifiers: [{ modifierId: 'frugal_recruitment_order.cost', type: 'paid_recruit_cost', addFlat: -1, minimumCost: 5 }],
    },
    {
        ...passiveBase('surplus_rations_bag', '余粮袋', '自己路线清波额外 +2 斋饭', ['economy', 'wave']),
        ruleModifiers: [{ modifierId: 'surplus_rations_bag.reward', type: 'own_lane_wave_clear_rations', addFlat: 2 }],
        eventListeners: [{ listenerId: 'surplus_rations_bag.on_wave', event: 'own_lane_wave_cleared', action: 'grant_rations' }],
    },
    {
        ...passiveBase('talent_registry', '招贤榜', '普通召唤位字符概率 12%', ['recruit', 'character']),
        exclusiveGroup: 'character_probability',
        ruleModifiers: [{ modifierId: 'talent_registry.probability', type: 'character_probability', probabilityBps: 1_200 }],
    },
    {
        ...passiveBase('talent_pity_order', '求贤令', '连续两批无字符后第三批保底字符', ['recruit', 'character', 'pity']),
        ruleModifiers: [{
                modifierId: 'talent_pity_order.pity',
                type: 'paid_recruit_character_pity',
                triggerAfterNoCharacterBatches: 2,
                guaranteedCharacters: 1,
                excludesFreeRefresh: true,
                resetsOnAnyCharacter: true,
                respectsFirstBatchSoldierRule: true,
            }],
        eventListeners: [{ listenerId: 'talent_pity_order.on_recruit', event: 'paid_recruit_batch_resolved', action: 'update_character_pity' }],
    },
    {
        ...passiveBase('reserve_expansion_talisman', '备战符', '备战席容量 +1', ['reserve']),
        ruleModifiers: [{ modifierId: 'reserve_expansion_talisman.capacity', type: 'reserve_capacity', addFlat: 1 }],
    },
    {
        ...passiveBase('army_expansion_order', '扩军令', '人口上限 +1', ['population']),
        ruleModifiers: [{ modifierId: 'army_expansion_order.population', type: 'population_cap', addFlat: 1, changesBoardArea: false }],
    },
    {
        ...passiveBase('purple_breakthrough_manual', '紫府破境', '紫色神将等级上限提升至 5', ['general', 'growth']),
        ruleModifiers: [{ modifierId: 'purple_breakthrough_manual.cap', type: 'general_level_cap', quality: 'purple', maxLevel: 5, grantsExperience: false }],
    },
    {
        ...passiveBase('orange_breakthrough_manual', '橙府破境', '橙色神将等级上限提升至 5', ['general', 'growth']),
        ruleModifiers: [{ modifierId: 'orange_breakthrough_manual.cap', type: 'general_level_cap', quality: 'orange', maxLevel: 5, grantsExperience: false }],
    },
    {
        ...passiveBase('lineage_training_manual', '师门秘卷', '神将结算经验 +15%', ['general', 'experience']),
        ruleModifiers: [{ modifierId: 'lineage_training_manual.experience', type: 'general_experience_gain', addRatioBps: 1_500, rounding: 'floor_after_weighted_distribution' }],
    },
    combatPassive('army_breaking_banner', '破军旗', '物理神将攻击力 +8%', 'owner_physical_generals', 'attack', 800),
    combatPassive('mystic_method_seal', '玄法印', '魔法神将法术伤害 +8%', 'owner_magic_generals', 'magicDamage', 800),
    {
        ...passiveBase('myriad_spirit_banner', '万灵幡', '所属召唤物伤害与持续时间提高', ['summon', 'combat']),
        effects: [
            persistentEffect('myriad_spirit_banner.damage', 'summons_owned_by_player', 'summonDamage', 1_000),
            persistentEffect('myriad_spirit_banner.duration', 'summons_owned_by_player', 'summonDuration', 1_000),
        ],
    },
    combatPassive('realm_stabilizing_pearl', '定界珠', '控制神将控制持续时间 +8%', 'owner_control_generals', 'controlDuration', 800),
    {
        ...passiveBase('treasure_hunting_compass', '寻宝罗盘', 'Boss 碎片 20% 概率额外掉落一个', ['boss', 'fragment']),
        exclusiveGroup: 'boss_fragment_bonus',
        ruleModifiers: [{
                modifierId: 'treasure_hunting_compass.drop',
                type: 'boss_fragment_bonus',
                chanceBps: 2_000,
                extraCount: 1,
                qualityPolicy: 'same_quality_random_fragment',
                maxExtraPerBoss: 1,
            }],
        eventListeners: [{ listenerId: 'treasure_hunting_compass.on_drop', event: 'personal_boss_fragment_dropped', action: 'roll_extra_fragment' }],
    },
];
function persistentEffect(effectId, target, stat, valueBps) {
    return {
        effectId,
        type: 'persistent_stat_modifier',
        target,
        stat,
        operation: 'add_ratio',
        valueBps,
        stackGroup: `passive_item:${effectId}`,
    };
}
function combatPassive(itemId, name, description, target, stat, valueBps) {
    return {
        ...passiveBase(itemId, name, description, ['combat']),
        effects: [persistentEffect(`${itemId}.combat`, target, stat, valueBps)],
    };
}
exports.ITEM_DEFINITIONS = [
    ...exports.ACTIVE_ITEM_DEFINITIONS,
    ...exports.PASSIVE_ITEM_DEFINITIONS,
];
exports.ACTIVE_ITEM_IDS = exports.ACTIVE_ITEM_DEFINITIONS.map((definition) => definition.itemId);
exports.PASSIVE_ITEM_IDS = exports.PASSIVE_ITEM_DEFINITIONS.map((definition) => definition.itemId);
const ITEM_BY_ID = new Map(exports.ITEM_DEFINITIONS.map((definition) => [definition.itemId, definition]));
function getItemDefinition(itemId) {
    return ITEM_BY_ID.get(itemId);
}
function getActiveItemDefinition(itemId) {
    const definition = getItemDefinition(itemId);
    return definition?.itemKind === 'active' ? definition : undefined;
}
function getPassiveItemDefinition(itemId) {
    const definition = getItemDefinition(itemId);
    return definition?.itemKind === 'passive' ? definition : undefined;
}
function validateItemCatalog(definitions = exports.ITEM_DEFINITIONS) {
    const errors = [];
    const itemIds = new Set();
    const nestedIds = new Set();
    if (definitions.filter((definition) => definition.itemKind === 'active').length !== 8) {
        errors.push('catalog must contain exactly 8 active items');
    }
    if (definitions.filter((definition) => definition.itemKind === 'passive').length !== 15) {
        errors.push('catalog must contain exactly 15 passive items');
    }
    for (const definition of definitions) {
        if (definition.schemaVersion !== 1)
            errors.push(`${definition.itemId}: invalid schemaVersion`);
        if (!/^[a-z][a-z0-9_]*$/.test(definition.itemId))
            errors.push(`${definition.itemId}: invalid itemId`);
        if (itemIds.has(definition.itemId))
            errors.push(`${definition.itemId}: duplicate itemId`);
        itemIds.add(definition.itemId);
        if (!definition.name || definition.tags.length === 0 || !definition.ui.iconKey) {
            errors.push(`${definition.itemId}: incomplete presentation metadata`);
        }
        if (definition.itemKind === 'active') {
            if (definition.maxChargesPerMatch < 1 || definition.cooldownMs < 0) {
                errors.push(`${definition.itemId}: invalid charges/cooldown`);
            }
            if (definition.availabilityPhases.length === 0)
                errors.push(`${definition.itemId}: no phases`);
            if (definition.effects.length + definition.actions.length === 0)
                errors.push(`${definition.itemId}: no executable payload`);
            if (definition.failurePolicy !== 'no_consume')
                errors.push(`${definition.itemId}: invalid failure policy`);
        }
        else {
            if (definition.scope !== 'owner_global')
                errors.push(`${definition.itemId}: V1 items must be owner_global`);
            if (definition.attachAt !== 'player_match_state_initialized')
                errors.push(`${definition.itemId}: invalid attach point`);
            if (definition.effects.length + definition.ruleModifiers.length === 0)
                errors.push(`${definition.itemId}: no passive payload`);
        }
        const ids = definition.itemKind === 'active'
            ? [...definition.effects.map((effect) => effect.effectId), ...definition.actions.map((action) => action.actionId)]
            : [
                ...definition.effects.map((effect) => effect.effectId),
                ...definition.ruleModifiers.map((modifier) => modifier.modifierId),
                ...definition.eventListeners.map((listener) => listener.listenerId),
            ];
        for (const id of ids) {
            if (!id.startsWith(`${definition.itemId}.`))
                errors.push(`${definition.itemId}: nested id ${id} lacks item prefix`);
            if (nestedIds.has(id))
                errors.push(`${definition.itemId}: duplicate nested id ${id}`);
            nestedIds.add(id);
        }
    }
    const expectedActive = new Set([
        'change_character_brush', 'cultivation_pill', 'general_ascension_talisman', 'rerecruit_order',
        'soul_recall_banner', 'heavenly_thunder_order', 'wind_stilling_talisman', 'war_drum_order',
    ]);
    const expectedPassive = new Set([
        'traveling_kitchen', 'frugal_recruitment_order', 'surplus_rations_bag', 'talent_registry',
        'talent_pity_order', 'reserve_expansion_talisman', 'army_expansion_order',
        'purple_breakthrough_manual', 'orange_breakthrough_manual', 'lineage_training_manual',
        'army_breaking_banner', 'mystic_method_seal', 'myriad_spirit_banner',
        'realm_stabilizing_pearl', 'treasure_hunting_compass',
    ]);
    for (const id of exports.ACTIVE_ITEM_IDS)
        if (!expectedActive.delete(id))
            errors.push(`unexpected/duplicate active item ${id}`);
    for (const id of exports.PASSIVE_ITEM_IDS)
        if (!expectedPassive.delete(id))
            errors.push(`unexpected/duplicate passive item ${id}`);
    for (const id of expectedActive)
        errors.push(`missing active item ${id}`);
    for (const id of expectedPassive)
        errors.push(`missing passive item ${id}`);
    return errors;
}
function assertValidItemCatalog() {
    const errors = validateItemCatalog();
    if (errors.length > 0)
        throw new Error(`Invalid item catalog:\n${errors.join('\n')}`);
}
assertValidItemCatalog();
