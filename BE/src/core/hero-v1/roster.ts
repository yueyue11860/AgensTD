import type { GeneralArchetype, GeneralQuality } from './types'

/**
 * 神将身份 ID 的唯一定义点。
 *
 * 已进入旧代码或权威文档的 ID 保持不变；其余 ID 统一使用小写拼音
 * snake_case。战斗 catalog 可以分批接入，但不得另行创造第二套 ID。
 */
export const GENERAL_IDS = {
  HOUYI: 'houyi',
  CHANG_E: 'chang_e',
  YANGJIAN: 'yangjian',
  NAZHA: 'nazha',
  LIJING: 'lijing',
  SUNWUKONG: 'sunwukong',
  SHA_WUJING: 'sha_wujing',
  ZHU_BAJIE: 'zhu_bajie',
  YU_HUANG_DADI: 'yu_huang_dadi',
  LEI_GONG: 'lei_gong',
  DIAN_MU: 'dian_mu',
  ZHEN_YUANZI: 'zhen_yuanzi',
  RU_LAI_FOZU: 'ru_lai_fozu',
  PU_TI_LAOZU: 'pu_ti_laozu',
  TAI_YI_ZHENREN: 'tai_yi_zhenren',
  SHOU_XING: 'shou_xing',
  TANG_SANZANG: 'tang_sanzang',
  BAI_LONGMA: 'bai_longma',
  PI_LANPO: 'pi_lanpo',
  GUAN_YIN_PUSA: 'guan_yin_pusa',
  TAI_SHANG_LAOJUN: 'tai_shang_laojun',
} as const

export type GeneralRosterId = typeof GENERAL_IDS[keyof typeof GENERAL_IDS]

export interface GeneralRosterEntry {
  generalId: GeneralRosterId
  displayName: string
  glyphs: readonly string[]
  quality: GeneralQuality
  profession: GeneralArchetype
  factions: readonly string[]
  /** 用于羁绊分类、阵容检索的正交玩法标签。 */
  playstyles: readonly string[]
  /** 用于战斗目标、特效和 UI 展示的更细粒度标签。 */
  combatTags: readonly string[]
  namedCollections: readonly string[]
}

export const GENERAL_ROSTER = [
  {
    generalId: GENERAL_IDS.YANGJIAN,
    displayName: '杨戬',
    glyphs: ['杨', '戬'],
    quality: 'purple',
    profession: 'physical',
    factions: ['heavenly_court'],
    playstyles: ['single_target', 'armor_break'],
    combatTags: ['melee', 'physical_burst', 'line_attack', 'armor_break'],
    namedCollections: ['heaven_vanguard'],
  },
  {
    generalId: GENERAL_IDS.NAZHA,
    displayName: '哪吒',
    glyphs: ['哪', '吒'],
    quality: 'purple',
    profession: 'physical',
    factions: ['heavenly_court'],
    playstyles: ['area_damage', 'path_displacement'],
    combatTags: ['melee', 'area_damage', 'multi_hit', 'path_displacement'],
    namedCollections: ['lotus_family', 'heaven_vanguard'],
  },
  {
    generalId: GENERAL_IDS.HOUYI,
    displayName: '后羿',
    glyphs: ['后', '羿'],
    quality: 'purple',
    profession: 'physical',
    factions: ['mythic', 'moon_palace'],
    playstyles: ['ranged', 'single_target', 'critical'],
    combatTags: ['ranged', 'single_target', 'critical', 'boss_hunter'],
    namedCollections: ['moon_palace_legend'],
  },
  {
    generalId: GENERAL_IDS.SHA_WUJING,
    displayName: '沙悟净',
    glyphs: ['沙', '悟', '净'],
    quality: 'orange',
    profession: 'physical',
    factions: ['pilgrimage'],
    playstyles: ['sustained_damage', 'vulnerable'],
    combatTags: ['line_attack', 'multi_hit', 'vulnerable', 'attack_counter'],
    namedCollections: ['pilgrimage_party'],
  },
  {
    generalId: GENERAL_IDS.ZHU_BAJIE,
    displayName: '猪八戒',
    glyphs: ['猪', '八', '戒'],
    quality: 'orange',
    profession: 'physical',
    factions: ['pilgrimage', 'heavenly_court'],
    playstyles: ['area_damage', 'hard_control'],
    combatTags: ['melee', 'area_damage', 'stun', 'slow_aura'],
    namedCollections: ['pilgrimage_party'],
  },
  {
    generalId: GENERAL_IDS.YU_HUANG_DADI,
    displayName: '玉皇大帝',
    glyphs: ['玉', '皇', '大', '帝'],
    quality: 'red',
    profession: 'physical',
    factions: ['heavenly_court'],
    playstyles: ['global_damage', 'physical_aura'],
    combatTags: ['global', 'multi_hit', 'on_kill_cooldown', 'physical_aura'],
    namedCollections: [],
  },
  {
    generalId: GENERAL_IDS.LEI_GONG,
    displayName: '雷公',
    glyphs: ['雷', '公'],
    quality: 'purple',
    profession: 'magic',
    factions: ['heavenly_court', 'thunder_department'],
    playstyles: ['area_damage', 'damage_over_time'],
    combatTags: ['ranged', 'area_damage', 'spawn_zone', 'damage_over_time'],
    namedCollections: ['thunder_deities'],
  },
  {
    generalId: GENERAL_IDS.DIAN_MU,
    displayName: '电母',
    glyphs: ['电', '母'],
    quality: 'purple',
    profession: 'magic',
    factions: ['heavenly_court', 'thunder_department'],
    playstyles: ['chain_damage', 'multi_target'],
    combatTags: ['ranged', 'chain', 'bounce', 'damage_falloff'],
    namedCollections: ['thunder_deities'],
  },
  {
    generalId: GENERAL_IDS.ZHEN_YUANZI,
    displayName: '镇元子',
    glyphs: ['镇', '元', '子'],
    quality: 'orange',
    profession: 'magic',
    factions: ['daoist', 'earth_immortal'],
    playstyles: ['gather', 'damage_over_time'],
    combatTags: ['area_damage', 'pull', 'slow', 'damage_over_time'],
    namedCollections: ['daoist_lineage'],
  },
  {
    generalId: GENERAL_IDS.RU_LAI_FOZU,
    displayName: '如来佛祖',
    glyphs: ['如', '来', '佛', '祖'],
    quality: 'red',
    profession: 'magic',
    factions: ['buddhist'],
    playstyles: ['global_damage', 'hard_control'],
    combatTags: ['global', 'area_damage', 'stun', 'magic_aura', 'boss_hunter'],
    namedCollections: ['buddhist_guides'],
  },
  {
    generalId: GENERAL_IDS.PU_TI_LAOZU,
    displayName: '菩提老祖',
    glyphs: ['菩', '提', '老', '祖'],
    quality: 'red',
    profession: 'magic',
    factions: ['daoist'],
    playstyles: ['global_damage', 'cooldown_aura'],
    combatTags: ['global', 'multi_hit', 'cooldown_aura'],
    namedCollections: ['daoist_lineage'],
  },
  {
    generalId: GENERAL_IDS.LIJING,
    displayName: '李靖',
    glyphs: ['李', '靖'],
    quality: 'purple',
    profession: 'summon',
    factions: ['heavenly_court'],
    playstyles: ['summoner'],
    combatTags: ['melee', 'summoner', 'summon_aura'],
    namedCollections: ['lotus_family', 'heaven_vanguard'],
  },
  {
    generalId: GENERAL_IDS.CHANG_E,
    displayName: '嫦娥',
    glyphs: ['嫦', '娥'],
    quality: 'purple',
    profession: 'summon',
    factions: ['moon_palace'],
    playstyles: ['ranged', 'summoner', 'slow'],
    combatTags: ['ranged', 'summoner', 'slow', 'damage_over_time'],
    namedCollections: ['moon_palace_legend'],
  },
  {
    generalId: GENERAL_IDS.SUNWUKONG,
    displayName: '孙悟空',
    glyphs: ['孙', '悟', '空'],
    quality: 'orange',
    profession: 'summon',
    factions: ['pilgrimage', 'huaguoshan'],
    playstyles: ['summoner', 'critical'],
    combatTags: ['melee', 'summoner', 'critical', 'boss_hunter'],
    namedCollections: ['pilgrimage_party'],
  },
  {
    generalId: GENERAL_IDS.TAI_YI_ZHENREN,
    displayName: '太乙真人',
    glyphs: ['太', '乙', '真', '人'],
    quality: 'red',
    profession: 'summon',
    factions: ['daoist', 'heavenly_court'],
    playstyles: ['summoner', 'summon_aura'],
    combatTags: ['ranged', 'summoner', 'burn', 'attack_speed_aura', 'summon_aura'],
    namedCollections: ['daoist_lineage'],
  },
  {
    generalId: GENERAL_IDS.SHOU_XING,
    displayName: '寿星',
    glyphs: ['寿', '星'],
    quality: 'purple',
    profession: 'control',
    factions: ['heavenly_court'],
    playstyles: ['slow', 'vulnerable'],
    combatTags: ['area_control', 'slow', 'vulnerable', 'stacking_status'],
    namedCollections: [],
  },
  {
    generalId: GENERAL_IDS.TANG_SANZANG,
    displayName: '唐三藏',
    glyphs: ['唐', '三', '藏'],
    quality: 'orange',
    profession: 'control',
    factions: ['pilgrimage', 'buddhist'],
    playstyles: ['hard_control', 'vulnerable'],
    combatTags: ['area_control', 'stun', 'vulnerable', 'control_resistance_reduction'],
    namedCollections: ['pilgrimage_party', 'buddhist_guides'],
  },
  {
    generalId: GENERAL_IDS.BAI_LONGMA,
    displayName: '白龙马',
    glyphs: ['白', '龙', '马'],
    quality: 'orange',
    profession: 'control',
    factions: ['pilgrimage', 'dragon_clan'],
    playstyles: ['path_displacement', 'slow'],
    combatTags: ['line_attack', 'path_displacement', 'slow', 'spawn_zone', 'attack_counter'],
    namedCollections: ['pilgrimage_party'],
  },
  {
    generalId: GENERAL_IDS.PI_LANPO,
    displayName: '毗蓝婆',
    glyphs: ['毗', '蓝', '婆'],
    quality: 'orange',
    profession: 'control',
    factions: ['buddhist'],
    playstyles: ['root', 'vulnerable'],
    combatTags: ['area_control', 'root', 'skill_vulnerable', 'controlled_target_bonus'],
    namedCollections: ['buddhist_guides'],
  },
  {
    generalId: GENERAL_IDS.GUAN_YIN_PUSA,
    displayName: '观音菩萨',
    glyphs: ['观', '音', '菩', '萨'],
    quality: 'red',
    profession: 'control',
    factions: ['buddhist'],
    playstyles: ['gather', 'vulnerable'],
    combatTags: ['area_control', 'pull', 'vulnerable', 'control_resistance_reduction'],
    namedCollections: ['buddhist_guides'],
  },
  {
    generalId: GENERAL_IDS.TAI_SHANG_LAOJUN,
    displayName: '太上老君',
    glyphs: ['太', '上', '老', '君'],
    quality: 'red',
    profession: 'control',
    factions: ['daoist', 'heavenly_court'],
    playstyles: ['hard_control', 'damage_over_time'],
    combatTags: ['area_control', 'suppress', 'burn', 'magic_vulnerable', 'on_kill_cooldown'],
    namedCollections: ['daoist_lineage'],
  },
] as const satisfies readonly GeneralRosterEntry[]

// 编译期确保 roster 的元组长度没有被无意改动。
const _GENERAL_ROSTER_EXACT_COUNT: 21 = GENERAL_ROSTER.length
void _GENERAL_ROSTER_EXACT_COUNT

const qualityForGlyphCount = (glyphCount: number): GeneralQuality | null => {
  if (glyphCount === 2) return 'purple'
  if (glyphCount === 3) return 'orange'
  if (glyphCount === 4) return 'red'
  return null
}

export function validateGeneralRoster(
  roster: readonly GeneralRosterEntry[] = GENERAL_ROSTER,
): void {
  if (roster.length !== 21) {
    throw new Error(`General roster must contain exactly 21 entries, received ${roster.length}`)
  }

  const ids = new Set<string>()
  const names = new Set<string>()
  const recipes = new Set<string>()
  const professionCounts: Record<GeneralArchetype, number> = {
    physical: 0,
    magic: 0,
    summon: 0,
    control: 0,
  }

  for (const entry of roster) {
    if (!/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(entry.generalId)) {
      throw new Error(`Invalid snake_case generalId: ${entry.generalId}`)
    }
    if (ids.has(entry.generalId)) {
      throw new Error(`Duplicate generalId: ${entry.generalId}`)
    }
    ids.add(entry.generalId)

    if (entry.glyphs.some((glyph) => [...glyph].length !== 1)) {
      throw new Error(`General ${entry.generalId} recipe must contain single glyphs`)
    }
    const recipeKey = entry.glyphs.join('\u0000')
    if (recipes.has(recipeKey)) {
      throw new Error(`Duplicate general recipe: ${entry.glyphs.join('+')}`)
    }
    recipes.add(recipeKey)

    if (entry.glyphs.join('') !== entry.displayName) {
      throw new Error(`General ${entry.generalId} recipe must spell its displayName`)
    }

    if (names.has(entry.displayName)) {
      throw new Error(`Duplicate general displayName: ${entry.displayName}`)
    }
    names.add(entry.displayName)

    const expectedQuality = qualityForGlyphCount(entry.glyphs.length)
    if (!expectedQuality || entry.quality !== expectedQuality) {
      throw new Error(
        `General ${entry.generalId} has invalid ${entry.glyphs.length}-glyph quality ${entry.quality}`,
      )
    }
    professionCounts[entry.profession] += 1
  }

  const expectedProfessionCounts: Record<GeneralArchetype, number> = {
    physical: 6,
    magic: 5,
    summon: 4,
    control: 6,
  }
  for (const profession of Object.keys(expectedProfessionCounts) as GeneralArchetype[]) {
    if (professionCounts[profession] !== expectedProfessionCounts[profession]) {
      throw new Error(
        `General profession ${profession} must contain ${expectedProfessionCounts[profession]} entries, received ${professionCounts[profession]}`,
      )
    }
  }

  const declaredIds = Object.values(GENERAL_IDS)
  if (declaredIds.length !== 21
    || declaredIds.some((generalId) => !ids.has(generalId))
    || ids.size !== new Set(declaredIds).size) {
    throw new Error('GENERAL_IDS and GENERAL_ROSTER must describe the same 21 unique generals')
  }

  const lockedIdentityIds: Readonly<Record<string, GeneralRosterId>> = {
    '后羿': GENERAL_IDS.HOUYI,
    '嫦娥': GENERAL_IDS.CHANG_E,
    '杨戬': GENERAL_IDS.YANGJIAN,
    '哪吒': GENERAL_IDS.NAZHA,
    '李靖': GENERAL_IDS.LIJING,
    '孙悟空': GENERAL_IDS.SUNWUKONG,
  }
  for (const [displayName, generalId] of Object.entries(lockedIdentityIds)) {
    const entry = roster.find((candidate) => candidate.displayName === displayName)
    if (entry?.generalId !== generalId) {
      throw new Error(`Locked general ID mismatch for ${displayName}: expected ${generalId}`)
    }
  }
}

export const GENERAL_ROSTER_BY_ID: ReadonlyMap<GeneralRosterId, GeneralRosterEntry> = new Map(
  GENERAL_ROSTER.map((entry) => [entry.generalId, entry]),
)

export function getGeneralRosterEntry(generalId: string): GeneralRosterEntry | null {
  return GENERAL_ROSTER_BY_ID.get(generalId as GeneralRosterId) ?? null
}

validateGeneralRoster()
