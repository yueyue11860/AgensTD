export const PVE_MINION_GLYPHS = [
  '妖', '魔', '鬼', '怪', '蛛', '蛇', '蝎', '魅', '骨', '虎', '豹', '鹰', '熊', '狮',
] as const

export type PveMinionGlyph = (typeof PVE_MINION_GLYPHS)[number]

export interface PveSceneTheme {
  environment: string
  landmark: string
  ambientEffect: string
  palette: readonly [string, string, string]
}

export interface PveStageDefinition {
  levelId: number
  stageId: string
  sceneId: string
  label: string
  subtitle: string
  description: string
  minionGlyphs: readonly [PveMinionGlyph, PveMinionGlyph, PveMinionGlyph, PveMinionGlyph]
  waveGlyphPools: readonly (readonly PveMinionGlyph[])[]
  sceneTheme: PveSceneTheme
  /** 仅作为后续 Boss 专项的西游主题锚点，不表示当前已实现。 */
  bossTheme: string
}

/**
 * 20 波逐步引入关卡的 4 种小怪。每波总数由服务端固定为 10，
 * 此处只决定该波的等概率字池，不改变小怪属性。
 */
function buildTwentyWaveGlyphPools(
  glyphs: readonly [PveMinionGlyph, PveMinionGlyph, PveMinionGlyph, PveMinionGlyph],
): readonly (readonly PveMinionGlyph[])[] {
  const [common, second, third, signature] = glyphs
  return [
    [common], [common], [common, second], [common, second], [second],
    [common, second], [second, third], [second, third], [common, second, third], [third],
    [second, third], [third, signature], [third, signature], [second, third, signature], [signature],
    [third, signature], [common, third, signature], [second, third, signature],
    [common, second, third, signature], [signature],
  ]
}

function stage(
  definition: Omit<PveStageDefinition, 'waveGlyphPools'>,
): PveStageDefinition {
  return {
    ...definition,
    waveGlyphPools: buildTwentyWaveGlyphPools(definition.minionGlyphs),
  }
}

export const PVE_STAGE_DEFINITIONS: readonly PveStageDefinition[] = [
  stage({
    levelId: 1,
    stageId: 'flower_fruit_mountain_v1',
    sceneId: 'scene_flower_fruit_mountain',
    label: '花果山',
    subtitle: '水帘洞外·山林群兽',
    description: '桃林、飞瀑与云海石台组成的入门副本，以山野妖兽为主。',
    minionGlyphs: ['妖', '虎', '豹', '鹰'],
    sceneTheme: {
      environment: '桃林山径与水帘飞瀑',
      landmark: '水帘洞石门',
      ambientEffect: '桃花飘落、水雾和云海缓慢流动',
      palette: ['#164e63', '#15803d', '#f9a8d4'],
    },
    bossTheme: '混世魔王',
  }),
  stage({
    levelId: 2,
    stageId: 'black_wind_mountain_v1',
    sceneId: 'scene_black_wind_mountain',
    label: '黑风山',
    subtitle: '黑风洞·幽林妖影',
    description: '黑松密林与残破禅院相连，山雾中出没黑熊与幽鬼。',
    minionGlyphs: ['熊', '怪', '鬼', '妖'],
    sceneTheme: {
      environment: '黑松林、陡峭山径与禅院断垣',
      landmark: '黑风洞巨石洞口',
      ambientEffect: '黑雾穿林、远处禅灯明灭',
      palette: ['#020617', '#334155', '#854d0e'],
    },
    bossTheme: '黑熊精',
  }),
  stage({
    levelId: 3,
    stageId: 'yellow_wind_ridge_v1',
    sceneId: 'scene_yellow_wind_ridge',
    label: '黄风岭',
    subtitle: '黄沙峡谷·虎妖巡山',
    description: '狂风席卷的荒漠峡谷，虎先锋所属妖众借沙尘掩护进军。',
    minionGlyphs: ['虎', '怪', '妖', '魔'],
    sceneTheme: {
      environment: '黄沙峡谷、枯木和风蚀岩柱',
      landmark: '黄风洞石寨',
      ambientEffect: '沙尘带和旋风远景',
      palette: ['#713f12', '#ca8a04', '#fde68a'],
    },
    bossTheme: '虎先锋、黄风怪',
  }),
  stage({
    levelId: 4,
    stageId: 'flowing_sands_river_v1',
    sceneId: 'scene_flowing_sands_river',
    label: '流沙河',
    subtitle: '流沙漩涡·沉骨水鬼',
    description: '浑浊河水与流沙浅滩交错，沉船、残骨和河中魅影构成压迫战场。',
    minionGlyphs: ['鬼', '怪', '魅', '骨'],
    sceneTheme: {
      environment: '浑水浅滩、流沙漩涡与沉船残骸',
      landmark: '河心流沙碑',
      ambientEffect: '水雾、泡沫与缓慢旋转的沙流',
      palette: ['#083344', '#155e75', '#a16207'],
    },
    bossTheme: '卷帘大将',
  }),
  stage({
    levelId: 5,
    stageId: 'white_bone_ridge_v1',
    sceneId: 'scene_white_bone_ridge',
    label: '白骨岭',
    subtitle: '枯林冷月·白骨魅影',
    description: '冷月下的枯林荒岭，白骨堆与幽魂火光营造幻化鬼域。',
    minionGlyphs: ['骨', '鬼', '魅', '妖'],
    sceneTheme: {
      environment: '白骨荒坡、枯林和冷月石径',
      landmark: '白骨王座',
      ambientEffect: '磷火飘浮、薄雾贴地流动',
      palette: ['#111827', '#64748b', '#e2e8f0'],
    },
    bossTheme: '白骨夫人',
  }),
  stage({
    levelId: 6,
    stageId: 'lotus_cave_v1',
    sceneId: 'scene_lotus_cave',
    label: '平顶山莲花洞',
    subtitle: '金银石门·群魔炼宝',
    description: '莲花洞内金银石门与炼丹炉火交替照亮，小妖与魔众层层守卫。',
    minionGlyphs: ['怪', '鬼', '妖', '魔'],
    sceneTheme: {
      environment: '莲花洞窟、金银石阶与炼宝高台',
      landmark: '紫金红葫芦祭坛',
      ambientEffect: '炉火明灭、金银光粒循环飘散',
      palette: ['#451a03', '#a16207', '#eab308'],
    },
    bossTheme: '金角大王、银角大王',
  }),
  stage({
    levelId: 7,
    stageId: 'webbed_hollow_v1',
    sceneId: 'scene_webbed_hollow',
    label: '盘丝洞',
    subtitle: '紫雾丝茧·蛛蛇魅影',
    description: '层叠蛛网、紫色毒雾与悬挂丝茧形成狭窄洞窟副本。',
    minionGlyphs: ['蛛', '蛇', '魅', '妖'],
    sceneTheme: {
      environment: '蛛网洞窟、湿滑石壁和悬挂丝茧',
      landmark: '七色盘丝祭台',
      ambientEffect: '丝缕摇摆、紫雾与微小蛛影爬行',
      palette: ['#2e1065', '#7e22ce', '#d8b4fe'],
    },
    bossTheme: '七蛛女、百眼魔君',
  }),
  stage({
    levelId: 8,
    stageId: 'scorpion_ridge_pipa_cave_v1',
    sceneId: 'scene_scorpion_ridge_pipa_cave',
    label: '毒敌山琵琶洞',
    subtitle: '毒花幽谷·蝎尾蛇影',
    description: '幽紫毒花遍布的山谷洞府，蝎尾石柱与蛇影包围战场。',
    minionGlyphs: ['蝎', '蛇', '魅', '魔'],
    sceneTheme: {
      environment: '毒花山谷、蝎尾石林和琵琶洞府',
      landmark: '倒马毒桩',
      ambientEffect: '紫色毒尘、花粉和地表毒液反光',
      palette: ['#3b0764', '#86198f', '#bef264'],
    },
    bossTheme: '蝎子精',
  }),
  stage({
    levelId: 9,
    stageId: 'lion_camel_ridge_v1',
    sceneId: 'scene_lion_camel_ridge',
    label: '狮驼岭',
    subtitle: '万妖山塞·狮鹰群兽',
    description: '兽骨旌旗遍布的山塞和峭壁鹰巢构成高压群妖副本。',
    minionGlyphs: ['狮', '豹', '鹰', '魔'],
    sceneTheme: {
      environment: '险峻山塞、兽骨旌旗与峭壁鹰巢',
      landmark: '狮驼国妖门',
      ambientEffect: '鹰影掠过、旌旗猎猎与尘土飞扬',
      palette: ['#422006', '#7f1d1d', '#d97706'],
    },
    bossTheme: '青狮、白象、大鹏',
  }),
  stage({
    levelId: 10,
    stageId: 'flaming_mountain_v1',
    sceneId: 'scene_flaming_mountain',
    label: '火焰山',
    subtitle: '熔岩裂谷·群魔火阵',
    description: '熔岩裂谷、火云和铁扇风痕构成十关终章场景，群魔从火海中涌出。',
    minionGlyphs: ['鬼', '怪', '妖', '魔'],
    sceneTheme: {
      environment: '熔岩裂谷、黑曜石道路和火云天幕',
      landmark: '芭蕉扇风眼祭台',
      ambientEffect: '火星飘散、热浪扭曲与间歇风痕',
      palette: ['#450a0a', '#c2410c', '#facc15'],
    },
    bossTheme: '铁扇公主、牛魔王',
  }),
] as const

export const PVE_STAGE_BY_LEVEL_ID: Readonly<Record<number, PveStageDefinition>> = Object.freeze(
  Object.fromEntries(PVE_STAGE_DEFINITIONS.map((definition) => [definition.levelId, definition])),
)

export function getPveStageDefinition(levelId: number): PveStageDefinition | null {
  return PVE_STAGE_BY_LEVEL_ID[levelId] ?? null
}
