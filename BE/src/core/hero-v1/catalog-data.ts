import { GENERAL_SYNERGY_IDS_BY_GENERAL } from '../../synergy-v1/catalog'
import { GENERAL_IDS, getGeneralRosterEntry } from './roster'
import { SUMMON_UNIT_IDS } from './summon-catalog'
import type {
  DirectDamageEffectDefinition,
  GeneralAbilityTargeting,
  GeneralArchetype,
  GeneralDefinition,
  GeneralPassiveTrigger,
  GeneralQuality,
  GeneralStatModifier,
  GeneralStructuredEffectDefinition,
  LevelCurve,
  SpawnZoneEffectDefinition,
  StatusApplyEffectDefinition,
} from './types'

const fixed = (value: number): LevelCurve => [value, value, value, value, value]
const curve = (one: number, two: number, three: number, four: number, five: number): LevelCurve =>
  [one, two, three, four, five]

const EXPERIENCE_CURVE: LevelCurve = [10000, 20000, 30000, 60000, 100000]

interface BaseStatsTemplate {
  attackByLevel: LevelCurve
  attackIntervalMsByLevel: LevelCurve
  attackRangeMilliCellsByLevel: LevelCurve
  critChanceBpsByLevel: LevelCurve
  critDamageBpsByLevel: LevelCurve
}

const BASE_STATS: Record<GeneralQuality, Record<GeneralArchetype, BaseStatsTemplate>> = {
  purple: {
    physical: {
      attackByLevel: [34, 43, 55, 71, 92],
      attackIntervalMsByLevel: [1350, 1250, 1150, 1050, 950],
      attackRangeMilliCellsByLevel: fixed(2500),
      critChanceBpsByLevel: [800, 1000, 1200, 1500, 1800],
      critDamageBpsByLevel: [16500, 17000, 17500, 18500, 19500],
    },
    magic: {
      attackByLevel: [30, 38, 49, 63, 82],
      attackIntervalMsByLevel: [1450, 1350, 1250, 1150, 1050],
      attackRangeMilliCellsByLevel: fixed(3000),
      critChanceBpsByLevel: [500, 700, 900, 1100, 1400],
      critDamageBpsByLevel: [15000, 15500, 16000, 16500, 17500],
    },
    summon: {
      attackByLevel: [27, 34, 43, 55, 70],
      attackIntervalMsByLevel: [1500, 1400, 1300, 1200, 1100],
      attackRangeMilliCellsByLevel: fixed(2750),
      critChanceBpsByLevel: [500, 600, 800, 1000, 1200],
      critDamageBpsByLevel: [15000, 15000, 15500, 16000, 16500],
    },
    control: {
      attackByLevel: [24, 30, 38, 48, 61],
      attackIntervalMsByLevel: [1550, 1460, 1370, 1280, 1190],
      attackRangeMilliCellsByLevel: fixed(3000),
      critChanceBpsByLevel: [300, 400, 500, 700, 900],
      critDamageBpsByLevel: [15000, 15000, 15000, 15500, 16000],
    },
  },
  orange: {
    physical: {
      attackByLevel: [46, 59, 75, 96, 123],
      attackIntervalMsByLevel: [1280, 1190, 1100, 1010, 920],
      attackRangeMilliCellsByLevel: fixed(2500),
      critChanceBpsByLevel: [900, 1100, 1400, 1700, 2100],
      critDamageBpsByLevel: [17000, 17500, 18000, 19000, 20500],
    },
    magic: {
      attackByLevel: [42, 53, 68, 87, 112],
      attackIntervalMsByLevel: [1380, 1290, 1200, 1110, 1020],
      attackRangeMilliCellsByLevel: fixed(3000),
      critChanceBpsByLevel: [600, 800, 1000, 1300, 1600],
      critDamageBpsByLevel: [15500, 16000, 16500, 17500, 18500],
    },
    summon: {
      attackByLevel: [38, 48, 61, 78, 100],
      attackIntervalMsByLevel: [1420, 1330, 1240, 1150, 1060],
      attackRangeMilliCellsByLevel: fixed(2750),
      critChanceBpsByLevel: [700, 900, 1200, 1500, 1900],
      critDamageBpsByLevel: [16000, 16500, 17000, 18000, 19500],
    },
    control: {
      attackByLevel: [34, 43, 55, 70, 90],
      attackIntervalMsByLevel: [1500, 1410, 1320, 1230, 1140],
      attackRangeMilliCellsByLevel: fixed(3000),
      critChanceBpsByLevel: [400, 500, 700, 900, 1200],
      critDamageBpsByLevel: [15000, 15000, 15500, 16000, 17000],
    },
  },
  red: {
    physical: {
      attackByLevel: [62, 79, 101, 129, 165],
      attackIntervalMsByLevel: [1220, 1130, 1040, 950, 860],
      attackRangeMilliCellsByLevel: fixed(3500),
      critChanceBpsByLevel: [1100, 1400, 1700, 2100, 2600],
      critDamageBpsByLevel: [17500, 18000, 19000, 20000, 21500],
    },
    magic: {
      attackByLevel: [57, 72, 92, 118, 151],
      attackIntervalMsByLevel: [1320, 1230, 1140, 1050, 960],
      attackRangeMilliCellsByLevel: fixed(3500),
      critChanceBpsByLevel: [800, 1000, 1300, 1600, 2000],
      critDamageBpsByLevel: [16000, 16500, 17500, 18500, 20000],
    },
    summon: {
      attackByLevel: [51, 65, 83, 106, 136],
      attackIntervalMsByLevel: [1380, 1290, 1200, 1110, 1020],
      attackRangeMilliCellsByLevel: fixed(3000),
      critChanceBpsByLevel: [800, 1000, 1300, 1600, 2000],
      critDamageBpsByLevel: [16000, 16500, 17500, 18500, 20000],
    },
    control: {
      attackByLevel: [47, 59, 75, 96, 123],
      attackIntervalMsByLevel: [1450, 1360, 1270, 1180, 1090],
      attackRangeMilliCellsByLevel: fixed(3250),
      critChanceBpsByLevel: [500, 700, 900, 1200, 1500],
      critDamageBpsByLevel: [15000, 15500, 16000, 17000, 18000],
    },
  },
}

const single = (
  priority: 'furthest_progress' | 'highest_current_hp' = 'highest_current_hp',
): GeneralAbilityTargeting => ({
  kind: 'single', scope: 'enemies_in_attack_range', priority, targetLimit: 1,
})
const radius = (radiusMilliCells: number, targetLimit = 100): GeneralAbilityTargeting => ({
  kind: 'radius_aoe',
  scope: 'enemies_around_primary',
  priority: 'furthest_progress',
  primarySearch: 'attack_range',
  radiusMilliCellsByLevel: fixed(radiusMilliCells),
  targetLimit,
})
const line = (lengthMilliCells: number, halfWidthMilliCells = 500): GeneralAbilityTargeting => ({
  kind: 'line',
  scope: 'enemies_in_line_from_caster',
  priority: 'furthest_progress',
  primarySearch: 'line_length',
  lengthMilliCellsByLevel: fixed(lengthMilliCells),
  halfWidthMilliCellsByLevel: fixed(halfWidthMilliCells),
  targetLimit: 100,
})
const globalTargets = (): GeneralAbilityTargeting => ({
  kind: 'global', scope: 'all_targetable_enemies', priority: 'furthest_progress', targetLimit: 200,
})
const chainTargets = (count: number): GeneralAbilityTargeting => ({
  kind: 'chain',
  scope: 'chain_from_primary',
  priority: 'furthest_progress',
  primarySearch: 'attack_range',
  bounceRangeMilliCellsByLevel: fixed(3000),
  targetLimit: count,
})
const selfTarget = (): GeneralAbilityTargeting => ({ kind: 'self', scope: 'self', targetLimit: 0 })

function damage(
  effectId: string,
  damageType: 'physical' | 'magic',
  coefficientBpsByLevel: LevelCurve,
  options: {
    criticalPolicy?: 'can_crit' | 'cannot_crit'
    hitCountByLevel?: LevelCurve
    hitIntervalMs?: number
    tags?: readonly string[]
    targeting?: GeneralAbilityTargeting
  } = {},
): DirectDamageEffectDefinition {
  return {
    effectId,
    type: 'damage',
    damageType,
    coefficientBpsByLevel,
    flatDamageByLevel: fixed(0),
    criticalPolicy: options.criticalPolicy ?? 'cannot_crit',
    ...(options.hitCountByLevel ? { hitCountByLevel: options.hitCountByLevel } : {}),
    ...(options.hitIntervalMs ? { hitIntervalMs: options.hitIntervalMs } : {}),
    ...(options.targeting ? { targeting: options.targeting } : {}),
    tags: options.tags ?? ['active_skill', 'direct'],
  }
}

function status(
  effectId: string,
  statusId: string,
  magnitudeByLevel: LevelCurve,
  durationMsByLevel: LevelCurve,
  options: {
    chanceBpsByLevel?: LevelCurve
    policy?: 'refresh' | 'extend' | 'stack' | 'strongest_refresh' | 'replace' | 'independent'
    maxStacks?: number
    tags?: readonly string[]
    targeting?: GeneralAbilityTargeting
  } = {},
): StatusApplyEffectDefinition {
  return {
    effectId,
    type: 'status_apply',
    statusId,
    magnitudeByLevel,
    durationMsByLevel,
    chanceBpsByLevel: options.chanceBpsByLevel ?? fixed(10000),
    stacking: {
      stackGroup: effectId,
      policy: options.policy ?? 'strongest_refresh',
      maxStacks: options.maxStacks ?? 1,
    },
    ...(options.targeting ? { targeting: options.targeting } : {}),
    tags: options.tags ?? ['active_skill', 'control'],
  }
}

function passiveModifier(
  passiveId: string,
  stat: GeneralStatModifier['stat'],
  operation: GeneralStatModifier['operation'],
  value: number,
  target: GeneralStatModifier['target'] = { scope: 'self' },
  condition?: GeneralStatModifier['condition'],
): GeneralStatModifier {
  return {
    source: { kind: 'passive', sourceId: passiveId },
    target,
    stat,
    operation,
    value,
    stackGroup: `${passiveId}_${stat}`,
    ...(condition ? { condition } : {}),
  }
}

interface GeneralInput {
  generalId: string
  attackRangeMilliCells?: number
  basicDamageType?: 'physical' | 'magic'
  activeSkill: GeneralDefinition['activeSkill']
  passiveSkill: {
    skillId: string
    skillName: string
    trigger?: GeneralPassiveTrigger
    effects?: readonly GeneralStatModifier[]
    structuredEffects?: readonly GeneralStructuredEffectDefinition[]
  }
}

function defineGeneral(input: GeneralInput): GeneralDefinition {
  const roster = getGeneralRosterEntry(input.generalId)
  if (!roster) throw new Error(`Unknown roster general ${input.generalId}`)
  const baseTemplate = BASE_STATS[roster.quality][roster.profession]
  const defaultMaxLevel = roster.quality === 'purple' ? 3 : roster.quality === 'orange' ? 4 : 5
  const basicDamageType = input.basicDamageType
    ?? (roster.profession === 'physical' || roster.profession === 'summon' ? 'physical' : 'magic')
  return {
    schemaVersion: 1,
    generalId: roster.generalId,
    name: roster.displayName,
    quality: roster.quality,
    recipe: { glyphs: roster.glyphs, orientation: 'horizontal_left_to_right', priority: 100 },
    formation: { cellCount: roster.glyphs.length, anchor: 'footprint_center', visual: 'character_tiles' },
    uniqueness: { scope: 'player', maxPerMatch: 1 },
    archetype: roster.profession,
    factions: roster.factions,
    combatTags: roster.combatTags,
    levelRules: {
      initialLevel: 1,
      defaultMaxLevel,
      breakthroughMaxLevel: 5,
      experienceRequiredPoints: EXPERIENCE_CURVE,
    },
    baseStats: {
      ...baseTemplate,
      attackRangeMilliCellsByLevel: fixed(
        input.attackRangeMilliCells ?? baseTemplate.attackRangeMilliCellsByLevel[0],
      ),
    },
    basicAttack: {
      attackId: `${roster.generalId}_basic_attack`,
      targeting: { scope: 'enemies_in_radius', priority: 'furthest_progress', targetLimit: 1 },
      effect: damage(
        `${roster.generalId}_basic_attack_damage`,
        basicDamageType,
        fixed(10000),
        { criticalPolicy: 'can_crit', tags: ['direct', 'basic_attack'] },
      ),
    },
    activeSkill: input.activeSkill,
    passiveSkill: {
      skillId: input.passiveSkill.skillId,
      skillName: input.passiveSkill.skillName,
      ...(input.passiveSkill.trigger ? { trigger: input.passiveSkill.trigger } : {}),
      effects: input.passiveSkill.effects ?? [],
      ...(input.passiveSkill.structuredEffects
        ? { structuredEffects: input.passiveSkill.structuredEffects }
        : {}),
    },
    relatedSynergyIds: GENERAL_SYNERGY_IDS_BY_GENERAL[roster.generalId] ?? [],
  }
}

/** 后羿是已验收的纵向切片，下列数值必须保持原样。 */
export const HOUYI_DEFINITION: GeneralDefinition = {
  schemaVersion: 1,
  generalId: GENERAL_IDS.HOUYI,
  name: '后羿',
  quality: 'purple',
  recipe: { glyphs: ['后', '羿'], orientation: 'horizontal_left_to_right', priority: 100 },
  formation: { cellCount: 2, anchor: 'footprint_center', visual: 'character_tiles' },
  uniqueness: { scope: 'player', maxPerMatch: 1 },
  archetype: 'physical',
  factions: ['mythic', 'moon_palace'],
  combatTags: ['ranged', 'single_target', 'critical', 'boss_hunter'],
  levelRules: {
    initialLevel: 1, defaultMaxLevel: 3, breakthroughMaxLevel: 5,
    experienceRequiredPoints: EXPERIENCE_CURVE,
  },
  baseStats: {
    attackByLevel: [34, 43, 55, 71, 92],
    attackIntervalMsByLevel: [1350, 1250, 1150, 1050, 950],
    attackRangeMilliCellsByLevel: [3000, 3000, 3000, 3000, 3000],
    critChanceBpsByLevel: [1000, 1200, 1400, 1600, 2000],
    critDamageBpsByLevel: [17500, 18000, 18500, 19000, 20000],
  },
  basicAttack: {
    attackId: 'houyi_basic_arrow',
    targeting: { scope: 'enemies_in_radius', priority: 'furthest_progress', targetLimit: 1 },
    effect: damage('houyi_basic_arrow_damage', 'physical', fixed(10000), {
      criticalPolicy: 'can_crit', tags: ['direct', 'basic_attack', 'projectile'],
    }),
  },
  activeSkill: {
    skillId: 'chuanyun_zhurijian', skillName: '穿云逐日箭', trigger: 'auto',
    cooldownMsByLevel: [12000, 11600, 11200, 10600, 10000],
    targeting: single('highest_current_hp'),
    effects: [damage('houyi_chuanyun_zhurijian_damage', 'physical', [22000, 24000, 26000, 28500, 32000], {
      criticalPolicy: 'can_crit', tags: ['direct', 'active_skill', 'single_target', 'projectile'],
    })],
  },
  passiveSkill: {
    skillId: 'shenshe_zhunxin', skillName: '神射准心',
    effects: [passiveModifier('shenshe_zhunxin', 'damageDealt', 'add_ratio', 2000, { scope: 'self' }, { targetTagsAny: ['boss'] })],
  },
  relatedSynergyIds: ['moon_palace_companions', 'piercing_cloud_duo', 'physical_heavenly_venerates'],
}

const YANGJIAN = defineGeneral({
  generalId: GENERAL_IDS.YANGJIAN,
  attackRangeMilliCells: 1800,
  activeSkill: {
    skillId: 'yangjian_sanjian_liangrenzhan', skillName: '三尖两刃斩', trigger: 'auto',
    cooldownMsByLevel: curve(8000, 7800, 7600, 7300, 7000), targeting: line(3000),
    effects: [
      damage('yangjian_sanjian_damage', 'physical', curve(16000, 17500, 19000, 21000, 23500), { criticalPolicy: 'can_crit' }),
      status('yangjian_sanjian_armor_break', 'armor_break', fixed(2500), fixed(4000)),
    ],
  },
  passiveSkill: {
    skillId: 'yangjian_pojia_shenwei', skillName: '破甲神威', trigger: { kind: 'on_basic_attack' }, effects: [],
    structuredEffects: [status('yangjian_current_hp_strike', 'current_hp_physical_damage', fixed(500), fixed(1), {
      chanceBpsByLevel: fixed(3000), targeting: single('furthest_progress'), tags: ['passive', 'current_hp_damage'],
    })],
  },
})

const NAZHA = defineGeneral({
  generalId: GENERAL_IDS.NAZHA,
  attackRangeMilliCells: 2000,
  activeSkill: {
    skillId: 'nazha_fenghuolun_xuanji', skillName: '风火轮旋击', trigger: 'auto',
    cooldownMsByLevel: curve(10000, 9700, 9400, 9000, 8500), targeting: radius(2000),
    effects: [
      damage('nazha_fenghuolun_damage', 'physical', curve(13000, 14200, 15500, 17000, 19000), {
        criticalPolicy: 'can_crit', hitCountByLevel: fixed(3), hitIntervalMs: 150,
      }),
      { effectId: 'nazha_fenghuolun_knockback', type: 'path_displacement', direction: 'backward', distanceMilliCellsByLevel: fixed(500), bossDistanceRatioBps: 3333, tags: ['active_skill', 'path_displacement'] },
    ],
  },
  passiveSkill: {
    skillId: 'nazha_fenghuo_zhanyi', skillName: '风火战意', trigger: { kind: 'on_displacement_success' }, effects: [],
    structuredEffects: [status('nazha_fenghuo_attack_speed', 'attack_speed_up', fixed(400), fixed(5000), {
      policy: 'stack', maxStacks: 5, targeting: selfTarget(), tags: ['passive', 'self_buff'],
    })],
  },
})

const SHA_WUJING = defineGeneral({
  generalId: GENERAL_IDS.SHA_WUJING,
  activeSkill: {
    skillId: 'sha_wujing_xiangyao_baozhang', skillName: '降妖宝杖连劈', trigger: 'auto',
    cooldownMsByLevel: curve(11000, 10600, 10200, 9700, 9200), targeting: line(4000, 600),
    effects: [
      damage('sha_wujing_baozhang_damage', 'physical', curve(6500, 7200, 8000, 9000, 10200), {
        criticalPolicy: 'can_crit', hitCountByLevel: fixed(3), hitIntervalMs: 180,
      }),
      status('sha_wujing_baozhang_vulnerable', 'vulnerable_all', fixed(600), fixed(5000), { policy: 'stack', maxStacks: 5 }),
    ],
  },
  passiveSkill: {
    skillId: 'sha_wujing_juanlian_zhanyi', skillName: '卷帘战意', trigger: { kind: 'on_nth_basic_attack', every: 5 }, effects: [],
    structuredEffects: [status('sha_wujing_next_attack_empower', 'next_basic_attack_damage_up', fixed(12000), fixed(5000), {
      targeting: selfTarget(), tags: ['passive', 'self_buff'],
    })],
  },
})

const ZHU_BAJIE = defineGeneral({
  generalId: GENERAL_IDS.ZHU_BAJIE,
  attackRangeMilliCells: 2000,
  activeSkill: {
    skillId: 'zhu_bajie_jiuchi_dingpa', skillName: '九齿钉耙震地', trigger: 'auto',
    cooldownMsByLevel: curve(14000, 13500, 13000, 12400, 11800), targeting: radius(2000),
    effects: [
      damage('zhu_bajie_dingpa_damage', 'physical', curve(13000, 14300, 15700, 17400, 19400), { criticalPolicy: 'can_crit' }),
      status('zhu_bajie_dingpa_stun', 'stun', fixed(0), curve(1800, 1900, 2000, 2150, 2300)),
    ],
  },
  passiveSkill: {
    skillId: 'zhu_bajie_tianpeng_shenwei', skillName: '天蓬神威', trigger: { kind: 'periodic', intervalMsByLevel: fixed(1000) }, effects: [],
    structuredEffects: [status('zhu_bajie_slow_aura', 'slow', fixed(2000), fixed(1200), { targeting: radius(2000), tags: ['passive', 'aura', 'slow'] })],
  },
})

const YU_HUANG_DADI = defineGeneral({
  generalId: GENERAL_IDS.YU_HUANG_DADI,
  activeSkill: {
    skillId: 'yu_huang_dadi_tianwei_zhennu', skillName: '天威震怒', trigger: 'auto',
    cooldownMsByLevel: curve(32000, 31000, 30000, 28500, 27000), targeting: globalTargets(),
    effects: [damage('yu_huang_dadi_tianlei_damage', 'physical', curve(9000, 9800, 10700, 11700, 13000), {
      criticalPolicy: 'can_crit', hitCountByLevel: fixed(12), hitIntervalMs: 100,
    })],
  },
  passiveSkill: {
    skillId: 'yu_huang_dadi_sanjie_zhizhu', skillName: '三界之主', trigger: { kind: 'on_enemy_killed' },
    effects: [
      passiveModifier('yu_huang_dadi_sanjie_zhizhu', 'attack', 'add_ratio', 1500, { scope: 'owner_generals' }),
      passiveModifier('yu_huang_dadi_sanjie_zhizhu', 'critRate', 'add_flat', 1000, { scope: 'owner_generals' }),
    ],
    structuredEffects: [{ effectId: 'yu_huang_dadi_kill_cooldown', type: 'cooldown_modify', targetSkill: 'active_skill', operation: 'add_ms', valueByLevel: fixed(-1000), maxTriggersPerCast: 12, tags: ['passive', 'on_kill'] }],
  },
})

const LEI_GONG = defineGeneral({
  generalId: GENERAL_IDS.LEI_GONG,
  activeSkill: {
    skillId: 'lei_gong_jinglei_luo', skillName: '惊雷落', trigger: 'auto',
    cooldownMsByLevel: curve(6000, 5800, 5600, 5300, 5000), targeting: radius(1800),
    effects: [
      damage('lei_gong_jinglei_damage', 'magic', curve(12000, 13200, 14500, 16000, 17800)),
      {
        effectId: 'lei_gong_leiming_yuzhen_zone', type: 'spawn_zone', zoneId: 'lei_gong_thunder_zone',
        shape: { kind: 'circle', radiusMilliCellsByLevel: fixed(1800) }, durationMsByLevel: fixed(2000), tickIntervalMs: 1000,
        tickEffects: [damage('lei_gong_leiming_yuzhen_tick', 'magic', fixed(2000), { tags: ['active_skill', 'damage_over_time', 'zone'] })],
        sourceInactivePolicy: 'finish_duration', tags: ['active_skill', 'zone', 'damage_over_time'],
      },
    ],
  },
  passiveSkill: {
    skillId: 'lei_gong_leiming_yuzhen', skillName: '雷鸣余震', trigger: { kind: 'on_skill_hit' }, effects: [],
    structuredEffects: [status('lei_gong_leiming_yuzhen_vulnerability', 'vulnerable', fixed(1000), fixed(2000), {
      targeting: radius(1800), tags: ['passive', 'vulnerability'],
    })],
  },
})

const DIAN_MU = defineGeneral({
  generalId: GENERAL_IDS.DIAN_MU,
  attackRangeMilliCells: 3500,
  activeSkill: {
    skillId: 'dian_mu_shandianlian_skill', skillName: '闪电链', trigger: 'auto',
    cooldownMsByLevel: curve(9000, 8700, 8400, 8000, 7600), targeting: chainTargets(5),
    effects: [damage('dian_mu_shandianlian', 'magic', curve(8500, 9300, 10200, 11200, 12400), { targeting: chainTargets(5), tags: ['active_skill', 'chain', 'bounce', 'damage_falloff_10_percent'] })],
  },
  passiveSkill: {
    skillId: 'dian_mu_dianguang_chuandao', skillName: '电光传导', trigger: { kind: 'always' }, effects: [],
    structuredEffects: [{ effectId: 'dian_mu_falloff_reduction', type: 'effect_parameter_patch', targetEffectId: 'dian_mu_shandianlian', parameter: 'bounceDamageFalloffBps', operation: 'add_flat', valueByLevel: fixed(-500), tags: ['passive', 'effect_parameter_patch'] }],
  },
})

const ZHEN_YUANZI = defineGeneral({
  generalId: GENERAL_IDS.ZHEN_YUANZI,
  activeSkill: {
    skillId: 'zhen_yuanzi_xiuli_qiankun', skillName: '袖里乾坤', trigger: 'auto',
    cooldownMsByLevel: curve(16000, 15400, 14800, 14100, 13400), targeting: radius(3000),
    effects: [
      { effectId: 'zhen_yuanzi_xiulikun', type: 'path_displacement', targeting: radius(3000), direction: 'toward_primary', distanceMilliCellsByLevel: fixed(2000), bossDistanceRatioBps: 2500, tags: ['active_skill', 'gather', 'path_displacement'] },
      { effectId: 'zhen_yuanzi_qiankun_dot', type: 'damage_over_time', targeting: radius(3000), damageType: 'magic', coefficientBpsPerTickByLevel: curve(7300, 8000, 8800, 9800, 11000), flatDamagePerTickByLevel: fixed(0), tickIntervalMs: 1000, durationMsByLevel: fixed(3000), criticalPolicy: 'cannot_crit', stacking: { stackGroup: 'zhen_yuanzi_qiankun_dot', policy: 'refresh', maxStacks: 1 }, tags: ['active_skill', 'damage_over_time'] },
    ],
  },
  passiveSkill: {
    skillId: 'zhen_yuanzi_dixian_zhiwei', skillName: '地仙之威', trigger: { kind: 'on_skill_hit' }, effects: [],
    structuredEffects: [status('zhen_yuanzi_dixian_slow', 'slow', fixed(3500), fixed(4000), {
      targeting: radius(3000), tags: ['passive', 'control', 'slow'],
    })],
  },
})

const RU_LAI_FOZU = defineGeneral({
  generalId: GENERAL_IDS.RU_LAI_FOZU,
  activeSkill: {
    skillId: 'ru_lai_fozu_wuzhishan', skillName: '五指山镇压', trigger: 'auto',
    cooldownMsByLevel: curve(30000, 29000, 28000, 26500, 25000), targeting: globalTargets(),
    effects: [
      damage('ru_lai_fozu_wuzhishan_damage', 'magic', curve(32000, 35000, 38500, 42500, 47000)),
      status('ru_lai_fozu_wuzhishan_stun', 'stun', fixed(0), curve(3000, 3100, 3200, 3350, 3500)),
    ],
  },
  passiveSkill: {
    skillId: 'ru_lai_fozu_fofa_wubian', skillName: '佛法无边', effects: [
      passiveModifier('ru_lai_fozu_fofa_wubian', 'damageDealt', 'add_ratio', 1800, { scope: 'owner_generals' }),
      passiveModifier('ru_lai_fozu_fofa_wubian', 'damageDealt', 'add_ratio', 2000, { scope: 'owner_generals' }, { targetTagsAny: ['boss'] }),
    ],
  },
})

const PU_TI_LAOZU = defineGeneral({
  generalId: GENERAL_IDS.PU_TI_LAOZU,
  activeSkill: {
    skillId: 'pu_ti_laozu_wanfa_guizong', skillName: '万法归宗', trigger: 'auto',
    cooldownMsByLevel: curve(28000, 27000, 26000, 24500, 23000), targeting: globalTargets(),
    effects: [damage('pu_ti_laozu_wanfa_damage', 'magic', curve(35000, 38500, 42500, 47000, 52500), { hitCountByLevel: fixed(4), hitIntervalMs: 180 })],
  },
  passiveSkill: {
    skillId: 'pu_ti_laozu_daofa_ziran', skillName: '道法自然', trigger: { kind: 'always' }, effects: [],
    structuredEffects: [{ effectId: 'pu_ti_laozu_owner_cooldown_aura', type: 'cooldown_modify', targetSkill: 'active_skill', operation: 'add_ratio', valueByLevel: fixed(-2000), maxTriggersPerCast: 1, tags: ['passive', 'owner_aura', 'cooldown'] }],
  },
})

const LIJING = defineGeneral({
  generalId: GENERAL_IDS.LIJING,
  attackRangeMilliCells: 2000,
  activeSkill: {
    skillId: 'lijing_tianbing_zhaohuan', skillName: '天兵召唤', trigger: 'auto',
    cooldownMsByLevel: curve(12000, 11600, 11200, 10700, 10200), targeting: selfTarget(),
    effects: [{ effectId: 'lijing_tianbing_summon', type: 'summon_unit', summonUnitId: SUMMON_UNIT_IDS.CELESTIAL_SOLDIER, countByLevel: fixed(2), durationMsByLevel: fixed(15000), maxOwnedAliveByLevel: fixed(3), spawnRadiusMilliCellsByLevel: fixed(1000), spawnPattern: 'self_surrounding_empty_cells', inheritStatRatiosBps: { attack: 6000, attackSpeed: 10000, critRate: 10000, critDamage: 10000 }, sourceInactivePolicy: 'despawn', tags: ['active_skill', 'summon'] }],
  },
  passiveSkill: {
    skillId: 'lijing_tianbing_tongshuai', skillName: '天兵统帅', trigger: { kind: 'always' }, effects: [],
    structuredEffects: [
      { effectId: 'lijing_tianbing_attack_patch', type: 'effect_parameter_patch', targetEffectId: 'lijing_tianbing_summon', parameter: 'summonAttackBps', operation: 'add_ratio', valueByLevel: fixed(2000), tags: ['passive', 'summon'] },
      { effectId: 'lijing_tianbing_duration_patch', type: 'effect_parameter_patch', targetEffectId: 'lijing_tianbing_summon', parameter: 'durationMs', operation: 'add_ratio', valueByLevel: fixed(2500), tags: ['passive', 'summon'] },
    ],
  },
})

const CHANG_E = defineGeneral({
  generalId: GENERAL_IDS.CHANG_E,
  basicDamageType: 'magic',
  attackRangeMilliCells: 3000,
  activeSkill: {
    skillId: 'chang_e_yuetu_zhaohuan', skillName: '月兔召唤', trigger: 'auto',
    cooldownMsByLevel: curve(10000, 9700, 9400, 9000, 8500), targeting: selfTarget(),
    effects: [{ effectId: 'chang_e_moon_rabbit_summon', type: 'summon_unit', summonUnitId: SUMMON_UNIT_IDS.MOON_RABBIT, countByLevel: fixed(2), durationMsByLevel: fixed(12000), maxOwnedAliveByLevel: fixed(4), spawnRadiusMilliCellsByLevel: fixed(1000), spawnPattern: 'self_surrounding_empty_cells', inheritStatRatiosBps: { attack: 5000, attackSpeed: 10000, critRate: 10000, critDamage: 10000 }, sourceInactivePolicy: 'despawn', tags: ['active_skill', 'summon', 'slow'] }],
  },
  passiveSkill: {
    skillId: 'chang_e_yuehua_jiachi', skillName: '月华加持', trigger: { kind: 'always' }, effects: [],
    structuredEffects: [{ effectId: 'chang_e_yuetu_dot_patch', type: 'effect_parameter_patch', targetEffectId: 'moon_rabbit_moonlight_dot', parameter: 'ownerAttackCoefficientBpsPerTick', operation: 'add_flat', valueByLevel: fixed(1000), tags: ['passive', 'summon', 'damage_over_time'] }],
  },
})

const SUNWUKONG = defineGeneral({
  generalId: GENERAL_IDS.SUNWUKONG,
  attackRangeMilliCells: 2000,
  activeSkill: {
    skillId: 'sunwukong_haomao_fenshen_skill', skillName: '毫毛分身', trigger: 'auto',
    cooldownMsByLevel: curve(14000, 13500, 13000, 12400, 11800), targeting: selfTarget(),
    effects: [{ effectId: 'sunwukong_haomao_fenshen', type: 'summon_unit', summonUnitId: SUMMON_UNIT_IDS.MONKEY_SOLDIER, countByLevel: fixed(4), durationMsByLevel: fixed(12000), maxOwnedAliveByLevel: fixed(6), spawnRadiusMilliCellsByLevel: fixed(1000), spawnPattern: 'path_side_nearest_empty', inheritStatRatiosBps: { attack: 5500, attackSpeed: 10000, critRate: 10000, critDamage: 10000 }, sourceInactivePolicy: 'despawn', tags: ['active_skill', 'summon', 'burst'] }],
  },
  passiveSkill: {
    skillId: 'sunwukong_huoyan_jinjing', skillName: '火眼金睛', trigger: { kind: 'always' }, effects: [],
    structuredEffects: [
      { effectId: 'sunwukong_summon_crit_patch', type: 'effect_parameter_patch', targetEffectId: 'sunwukong_haomao_fenshen', parameter: 'summonCritRateBps', operation: 'add_flat', valueByLevel: fixed(2500), tags: ['passive', 'summon', 'critical'] },
      { effectId: 'sunwukong_summon_boss_crit_patch', type: 'effect_parameter_patch', targetEffectId: 'sunwukong_haomao_fenshen', parameter: 'bossCritDamageBps', operation: 'add_flat', valueByLevel: fixed(1500), tags: ['passive', 'summon', 'boss_hunter'] },
    ],
  },
})

const TAI_YI_ZHENREN = defineGeneral({
  generalId: GENERAL_IDS.TAI_YI_ZHENREN,
  basicDamageType: 'magic',
  activeSkill: {
    skillId: 'tai_yi_zhenren_xiantong_zhaohuan', skillName: '仙童召唤', trigger: 'auto',
    cooldownMsByLevel: curve(25000, 24000, 23000, 21700, 20400), targeting: selfTarget(),
    effects: [{ effectId: 'tai_yi_zhenren_xiantong_summon', type: 'summon_unit', summonUnitId: SUMMON_UNIT_IDS.LOTUS_IMMORTAL_CHILD, countByLevel: fixed(2), durationMsByLevel: fixed(20000), maxOwnedAliveByLevel: fixed(4), spawnRadiusMilliCellsByLevel: fixed(1000), spawnPattern: 'self_surrounding_empty_cells', inheritStatRatiosBps: { attack: 7000, attackSpeed: 10000, critRate: 10000, critDamage: 10000 }, sourceInactivePolicy: 'despawn', tags: ['active_skill', 'summon', 'burn', 'attack_speed_aura'] }],
  },
  passiveSkill: {
    skillId: 'tai_yi_zhenren_jiuzhuan_xianfa', skillName: '九转仙法', trigger: { kind: 'always' }, effects: [],
    structuredEffects: [
      { effectId: 'tai_yi_zhenren_summon_attribute_patch', type: 'effect_parameter_patch', targetEffectId: 'tai_yi_zhenren_xiantong_summon', parameter: 'summonAllStatsBps', operation: 'add_ratio', valueByLevel: fixed(2000), tags: ['passive', 'summon'] },
      { effectId: 'tai_yi_zhenren_summon_duration_patch', type: 'effect_parameter_patch', targetEffectId: 'tai_yi_zhenren_xiantong_summon', parameter: 'durationMs', operation: 'add_ratio', valueByLevel: fixed(3000), tags: ['passive', 'summon'] },
    ],
  },
})

const SHOU_XING = defineGeneral({
  generalId: GENERAL_IDS.SHOU_XING,
  activeSkill: {
    skillId: 'shou_xing_suiyue_chizhi', skillName: '岁月迟滞', trigger: 'auto',
    cooldownMsByLevel: curve(12000, 11600, 11200, 10700, 10200), targeting: radius(3000),
    effects: [status('shou_xing_suiyue_slow', 'slow', fixed(4500), fixed(6000))],
  },
  passiveSkill: {
    skillId: 'shou_xing_chimu_yinji', skillName: '迟暮印记', trigger: { kind: 'on_basic_attack' }, effects: [],
    structuredEffects: [
      status('shou_xing_chimu_slow', 'slow', fixed(600), fixed(5000), { chanceBpsByLevel: fixed(2500), policy: 'stack', maxStacks: 3, tags: ['passive', 'slow'] }),
      status('shou_xing_chimu_vulnerable', 'vulnerable_all', fixed(300), fixed(5000), { chanceBpsByLevel: fixed(2500), policy: 'stack', maxStacks: 3, tags: ['passive', 'vulnerable'] }),
    ],
  },
})

const TANG_SANZANG = defineGeneral({
  generalId: GENERAL_IDS.TANG_SANZANG,
  activeSkill: {
    skillId: 'tang_sanzang_jinguzhou_zhenyan', skillName: '紧箍真言', trigger: 'auto',
    cooldownMsByLevel: curve(16000, 15400, 14800, 14100, 13400), targeting: radius(2000),
    effects: [
      status('tang_sanzang_jinguzhou_stun', 'stun', fixed(0), curve(2000, 2100, 2200, 2350, 2500)),
      status('tang_sanzang_jinguzhou_vulnerable', 'vulnerable_all', fixed(2000), fixed(6000)),
    ],
  },
  passiveSkill: {
    skillId: 'tang_sanzang_fanyin_zhenxin', skillName: '梵音镇心', trigger: { kind: 'periodic', intervalMsByLevel: fixed(1000) }, effects: [],
    structuredEffects: [status('tang_sanzang_control_resistance_down', 'control_resistance_down', fixed(1500), fixed(1200), { targeting: radius(3000), tags: ['passive', 'aura', 'control_resistance_reduction'] })],
  },
})

const BAI_LONGMA = defineGeneral({
  generalId: GENERAL_IDS.BAI_LONGMA,
  activeSkill: {
    skillId: 'bai_longma_longjuan_huilan', skillName: '龙卷回澜', trigger: 'auto',
    cooldownMsByLevel: curve(13000, 12500, 12000, 11400, 10800), targeting: line(5000, 600),
    effects: [
      damage('bai_longma_longjuan_damage', 'magic', curve(9000, 9900, 10900, 12100, 13500)),
      { effectId: 'bai_longma_longjuan_knockback', type: 'path_displacement', direction: 'backward', distanceMilliCellsByLevel: fixed(1500), bossDistanceRatioBps: 3333, tags: ['active_skill', 'path_displacement'] },
      status('bai_longma_longjuan_slow', 'slow', fixed(3000), fixed(4000)),
    ],
  },
  passiveSkill: {
    skillId: 'bai_longma_hantan_liuhen', skillName: '寒潭留痕', trigger: { kind: 'on_nth_basic_attack', every: 5 }, effects: [],
    structuredEffects: [{
      effectId: 'bai_longma_hantan_zone', type: 'spawn_zone', zoneId: 'bai_longma_water_zone',
      shape: { kind: 'circle', radiusMilliCellsByLevel: fixed(1500) }, durationMsByLevel: fixed(3000), tickIntervalMs: 500,
      tickEffects: [status('bai_longma_hantan_slow', 'slow', fixed(2500), fixed(700), { tags: ['passive', 'zone', 'slow'] })],
      sourceInactivePolicy: 'finish_duration', tags: ['passive', 'zone', 'slow'],
    }],
  },
})

const PI_LANPO = defineGeneral({
  generalId: GENERAL_IDS.PI_LANPO,
  activeSkill: {
    skillId: 'pi_lanpo_jinzhen_dingxing', skillName: '金针定形', trigger: 'auto',
    cooldownMsByLevel: curve(18000, 17300, 16600, 15800, 15000), targeting: radius(3000),
    effects: [
      status('pi_lanpo_jinzhen_root', 'root', fixed(0), curve(3000, 3150, 3300, 3500, 3700)),
      status('pi_lanpo_jinzhen_vulnerable', 'skill_vulnerable', fixed(2500), curve(3000, 3150, 3300, 3500, 3700)),
    ],
  },
  passiveSkill: {
    skillId: 'pi_lanpo_powang_jinguang', skillName: '破妄金光',
    effects: [passiveModifier('pi_lanpo_powang_jinguang', 'damageDealt', 'add_ratio', 2000, { scope: 'self' }, { targetTagsAny: ['controlled'] })],
  },
})

const GUAN_YIN_PUSA = defineGeneral({
  generalId: GENERAL_IDS.GUAN_YIN_PUSA,
  activeSkill: {
    skillId: 'guan_yin_pusa_jingping_xuanwo', skillName: '净瓶漩涡', trigger: 'auto',
    cooldownMsByLevel: curve(28000, 27000, 26000, 24500, 23000), targeting: radius(4000),
    effects: [
      { effectId: 'guan_yin_pusa_jingping_pull', type: 'path_displacement', direction: 'toward_primary', distanceMilliCellsByLevel: fixed(2500), bossDistanceRatioBps: 2000, tags: ['active_skill', 'gather', 'path_displacement'] },
      status('guan_yin_pusa_jingping_vulnerable', 'vulnerable_all', fixed(2500), fixed(8000)),
    ],
  },
  passiveSkill: {
    skillId: 'guan_yin_pusa_cihang_yinji', skillName: '慈航印记', trigger: { kind: 'periodic', intervalMsByLevel: fixed(10000) }, effects: [],
    structuredEffects: [
      status('guan_yin_pusa_mark_resistance_down', 'control_resistance_down', fixed(2000), fixed(5000), { targeting: single('highest_current_hp'), tags: ['passive', 'periodic_mark'] }),
      status('guan_yin_pusa_mark_vulnerable', 'vulnerable_all', fixed(1500), fixed(5000), { targeting: single('highest_current_hp'), tags: ['passive', 'periodic_mark'] }),
    ],
  },
})

const TAI_SHANG_LAOJUN = defineGeneral({
  generalId: GENERAL_IDS.TAI_SHANG_LAOJUN,
  activeSkill: {
    skillId: 'tai_shang_laojun_bagualue', skillName: '八卦炉封禁', trigger: 'auto',
    cooldownMsByLevel: curve(25000, 24000, 23000, 21700, 20400), targeting: radius(3000),
    effects: [
      status('tai_shang_laojun_bagualue_suppress', 'suppress_active_trait', fixed(0), curve(4000, 4150, 4300, 4500, 4700)),
      status('tai_shang_laojun_bagualue_magic_vulnerable', 'magic_vulnerable', fixed(1800), curve(4000, 4150, 4300, 4500, 4700)),
      { effectId: 'tai_shang_laojun_bagualue_burn', type: 'damage_over_time', damageType: 'magic', coefficientBpsPerTickByLevel: curve(4500, 5000, 5600, 6300, 7100), flatDamagePerTickByLevel: fixed(0), tickIntervalMs: 1000, durationMsByLevel: curve(4000, 4150, 4300, 4500, 4700), criticalPolicy: 'cannot_crit', stacking: { stackGroup: 'tai_shang_laojun_bagualue_burn', policy: 'refresh', maxStacks: 1 }, tags: ['active_skill', 'burn', 'damage_over_time'] },
    ],
  },
  passiveSkill: {
    skillId: 'tai_shang_laojun_luhuo_lianmo', skillName: '炉火炼魔', trigger: { kind: 'on_enemy_killed' }, effects: [],
    structuredEffects: [{ effectId: 'tai_shang_laojun_kill_cooldown', type: 'cooldown_modify', targetSkill: 'active_skill', operation: 'add_ms', valueByLevel: fixed(-300), maxTriggersPerCast: 10, tags: ['passive', 'on_kill'] }],
  },
})

export const ALL_GENERAL_DEFINITIONS: readonly GeneralDefinition[] = [
  YANGJIAN,
  NAZHA,
  HOUYI_DEFINITION,
  SHA_WUJING,
  ZHU_BAJIE,
  YU_HUANG_DADI,
  LEI_GONG,
  DIAN_MU,
  ZHEN_YUANZI,
  RU_LAI_FOZU,
  PU_TI_LAOZU,
  LIJING,
  CHANG_E,
  SUNWUKONG,
  TAI_YI_ZHENREN,
  SHOU_XING,
  TANG_SANZANG,
  BAI_LONGMA,
  PI_LANPO,
  GUAN_YIN_PUSA,
  TAI_SHANG_LAOJUN,
] as const

export const STRUCTURED_ACTIVE_EFFECT_TYPES = new Set(
  ALL_GENERAL_DEFINITIONS.flatMap((definition) => definition.activeSkill.effects.map((effect) => effect.type)),
)

export function collectNestedEffects(
  effects: readonly GeneralStructuredEffectDefinition[],
): GeneralStructuredEffectDefinition[] {
  const output: GeneralStructuredEffectDefinition[] = []
  for (const effect of effects) {
    output.push(effect)
    if (effect.type === 'spawn_zone') output.push(...collectNestedEffects(effect.tickEffects))
  }
  return output
}

export function collectSummonReferences(definition: GeneralDefinition): string[] {
  const active = collectNestedEffects(definition.activeSkill.effects)
  const passive = collectNestedEffects(definition.passiveSkill.structuredEffects ?? [])
  return [...active, ...passive]
    .filter((effect): effect is Extract<GeneralStructuredEffectDefinition, { type: 'summon_unit' }> =>
      effect.type === 'summon_unit')
    .map((effect) => effect.summonUnitId)
}

export type { SpawnZoneEffectDefinition }
