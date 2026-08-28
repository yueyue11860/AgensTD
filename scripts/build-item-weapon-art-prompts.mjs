import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const outputPath = path.join(root, 'output/imagegen/item-weapon-image2-prompts.jsonl')

const itemArt = [
  ['change_character_brush', '点将笔', 'active', '一支修长的朱漆狼毫点将笔，乌黑笔锋凝着金色墨光，笔管镶嵌小型星宿与将印纹样'],
  ['cultivation_pill', '修为丹', 'active', '一枚悬浮在打开的青玉丹盒上方的青金修为丹，丹药内部有旋转的微型灵气星云'],
  ['general_ascension_talisman', '神将符', 'active', '一张厚实的朱砂金箔神将符，中央是抽象神将剪影与升阶光轮，符纸边缘被神火照亮'],
  ['rerecruit_order', '再征令', 'active', '一枚青铜鎏金再征军令，方形令牌配短红穗，表面有循环召集的云雷纹'],
  ['soul_recall_banner', '招魂幡', 'active', '一面小型玄黑招魂幡，旧金骨架，幡面缭绕克制的青蓝魂火与回旋灵纹'],
  ['heavenly_thunder_order', '天雷令', 'active', '一枚深靛色雷击木天雷令，金属包角，表面裂隙中迸发紫白雷光'],
  ['wind_stilling_talisman', '定风符', 'active', '一张青白色定风符，中央封存一枚静止的螺旋风眼，细小云气被凝固在符纸周围'],
  ['war_drum_order', '战鼓令', 'active', '一枚赤铜战鼓令，令牌外形融合微型战鼓与虎纹鼓钉，鼓面荡开金红色冲击波'],
  ['traveling_kitchen', '行军灶', 'passive', '一座可折叠的黄铜行军灶，炉门透出温暖炭火，旁侧整齐收纳小锅与蒸汽管'],
  ['frugal_recruitment_order', '节用令', 'passive', '一枚朴素青竹与旧铜结合的节用令，绳结简洁，表面刻着收束钱粮的秤纹'],
  ['surplus_rations_bag', '余粮袋', 'passive', '一个结实的靛蓝布余粮袋，金线束口，袋口露出稻谷与发光斋饭晶粒'],
  ['talent_registry', '招贤榜', 'passive', '一卷展开的招贤榜，象牙色卷轴配青铜轴头，纸面只有抽象人形星位与金色名录线条，不出现可读文字'],
  ['talent_pity_order', '求贤令', 'passive', '一枚白玉求贤令，嵌一颗温润金珠，周围浮现三重候选人物剪影与汇聚光线'],
  ['reserve_expansion_talisman', '备战符', 'passive', '一张青绿色备战符，符面展开额外阵位的折叠空间，边缘有整齐兵阵格纹'],
  ['army_expansion_order', '扩军令', 'passive', '一枚厚重鎏金虎符式扩军令，两半虎形符节合拢，背后浮现扩展中的军阵光影'],
  ['purple_breakthrough_manual', '紫府破境', 'passive', '一本紫檀封面的破境秘典，紫晶书脊与层叠境界光环，书页溢出深紫灵气'],
  ['orange_breakthrough_manual', '橙府破境', 'passive', '一本赤金封面的破境秘典，琥珀书脊与层叠境界光环，书页溢出橙金灵气'],
  ['lineage_training_manual', '师门秘卷', 'passive', '一卷由旧丝绢与白玉轴组成的师门秘卷，展开处呈现抽象经脉与传承树图案，不出现可读文字'],
  ['army_breaking_banner', '破军旗', 'passive', '一面小型猩红破军旗，黑铁旗枪与金色破军星纹，旗角在无形战风中扬起'],
  ['mystic_method_seal', '玄法印', 'passive', '一方深紫水晶与玄铁组成的玄法印，印钮如盘旋云龙，底部放射法阵光纹'],
  ['myriad_spirit_banner', '万灵幡', 'passive', '一面青玉骨架的万灵幡，幡面汇聚多种温和灵兽光影，青蓝与金色灵气流动'],
  ['realm_stabilizing_pearl', '定界珠', 'passive', '一颗悬浮在古铜环架中的定界珠，珠内是稳定的蓝绿色方格空间与同心界线'],
  ['treasure_hunting_compass', '寻宝罗盘', 'passive', '一枚精密的古铜寻宝罗盘，青玉指针指向一束金色宝光，盘面为抽象山川星位，不出现可读文字'],
]

const weaponArt = [
  ['qinggang_blade', '青钢刀', 'green', '一柄简洁利落的青钢直背战刀，青灰钢刃、深色缠柄与少量铜饰，刃口泛青光'],
  ['peachwood_staff', '桃木杖', 'green', '一根天然弯曲的古桃木法杖，木纹温润，顶端嵌小块青玉与新生桃叶'],
  ['spirit_bell', '御灵铃', 'green', '一只手持式青铜御灵铃，铃身有灵兽卷云纹，内部逸出柔和青色灵光'],
  ['binding_rope', '缚妖索', 'green', '一条盘旋悬浮的金棕色缚妖索，绳节镶小型铜符环，末端散出绿色禁锢光纹'],
  ['chasing_wind_bow', '追风弓', 'blue', '一张轻盈修长的青蓝追风弓，层压木与银色金属结构，弓弦凝成风线'],
  ['spirit_gathering_orb', '聚灵珠', 'blue', '一颗由银色悬环托住的蓝色聚灵珠，珠内灵气旋涡向中心汇聚'],
  ['life_extending_incense', '续灵香', 'blue', '一座细长的青瓷续灵香炉，银边莲瓣造型，三缕蓝色香烟形成延展的灵体轮廓'],
  ['calming_pearl', '定风珠', 'blue', '一颗被四道银色风翼环绕的浅蓝定风珠，周围狂风在珠面附近化为绝对平静'],
  ['armor_breaking_halberd', '破军钺', 'purple', '一柄厚重的紫黑破军钺，月牙刃带破甲缺口和紫晶铆钉，气势锋锐'],
  ['thunder_fire_talisman', '雷火符', 'purple', '一张悬浮的紫色雷火符，符纸两侧同时缠绕雷弧与赤焰，不出现可读文字'],
  ['division_banner', '分灵幡', 'purple', '一面双层分灵幡，紫晶旗杆与分叉幡尾，两个互相呼应的召唤灵影从幡面分离'],
  ['truth_mirror', '破妄镜', 'purple', '一面八角紫金破妄镜，深色镜面映出被击碎的幻象碎片与清晰金光'],
  ['sun_piercing_bow', '贯日弓', 'orange', '一张大型赤金贯日弓，弓臂如日轮展开，凝聚一支贯穿多层光环的太阳箭'],
  ['nine_luminary_wheel', '九曜法轮', 'orange', '一枚悬浮的九曜法轮，九颗小型星曜围绕金色主轮旋转，散发橙金法术光'],
  ['command_seal', '统御宝印', 'orange', '一方厚重的鎏金统御宝印，印钮为盘踞神兽，周围展开召唤军阵的橙色光环'],
  ['boundary_stele', '镇界碑', 'orange', '一座可手持的玄石镇界碑，鎏金包边，碑面只有抽象封界纹，底部压住空间裂隙'],
  ['battle_sky_axe', '战天斧', 'red', '一柄巨大霸烈的暗金战天斧，赤红晶刃和星火裂纹，具有对抗巨兽的压迫感'],
  ['river_chart_luoshu', '河图洛书', 'red', '一卷悬空展开的河图洛书，黑金丝帛上是抽象河流、星点与方圆阵列，不出现可读文字'],
  ['myriad_beast_scroll', '万兽图', 'red', '一卷赤金万兽图，卷面涌出多种东方灵兽的半透明剪影，层次丰富但主体清晰'],
  ['chaos_umbrella', '混元伞', 'red', '一柄半开的混元宝伞，玄红伞面、金色伞骨与混沌云旋，伞下空间轻微扭曲'],
  ['yangjian_divine_trident', '三尖两刃神锋', 'red', '杨戬专属三尖两刃神锋，银白长柄，三尖双刃结构精确锐利，青金神纹沿刃脊流动'],
  ['nazha_fire_tip_spear', '火尖枪', 'red', '哪吒专属火尖枪，赤金枪尖呈火焰三棱形，红缨化为真实神火并拖出风火轨迹'],
  ['houyi_sun_shooting_bow', '射日神弓', 'red', '后羿专属射日神弓，远古神木与太阳金组成的巨弓，弦上凝聚炽白日芒箭'],
  ['sha_wujing_demon_staff', '降妖宝杖', 'red', '沙悟净专属降妖宝杖，月牙铲与宝杖融合的厚重结构，深蓝宝石串与水波气浪环绕'],
  ['zhu_bajie_supreme_rake', '上宝沁金钯', 'red', '猪八戒专属上宝沁金钯，九齿金钯宽阔厚重，齿端沾有裂地金光与少量泥沼气息'],
  ['jade_emperor_celestial_seal', '凌霄天帝印', 'red', '玉皇大帝专属凌霄天帝印，白玉金边帝印，云宫与雷霆构成的威严光冕环绕'],
  ['lei_gong_thunder_chisel', '雷公凿', 'red', '雷公专属雷公凿，短柄玄铁雷凿配鼓形护手，凿尖聚集密集紫白雷弧'],
  ['dian_mu_lightning_mirror', '乾元电镜', 'red', '电母专属乾元电镜，圆形银金宝镜带多层导电云纹，镜面分出跳跃闪电链'],
  ['zhen_yuanzi_book_of_earth', '天地宝鉴', 'red', '镇元子专属天地宝鉴，厚重青金古籍悬空翻页，书中展开袖里乾坤般的微型山河空间'],
  ['ru_lai_five_finger_seal', '五指金印', 'red', '如来专属五指金印，一枚掌形金色法印，五道指峰化为镇压山影与同心佛光'],
  ['pu_ti_lingtai_staff', '灵台方寸杖', 'red', '菩提老祖专属灵台方寸杖，白玉与古木相接的禅杖，顶端方寸灵台悬浮并散出清明星光'],
  ['lijing_pagoda', '玲珑宝塔', 'red', '李靖专属玲珑宝塔，七层鎏金宝塔小巧而精密，塔窗射出整齐剑气与天兵光影'],
  ['chang_e_guanghan_moonwheel', '广寒月轮', 'red', '嫦娥专属广寒月轮，新月形银白双刃环，月桂纹与冷白月华围绕轮缘'],
  ['sunwukong_ruyi_jingu_bang', '如意金箍棒', 'red', '孙悟空专属如意金箍棒，乌铁棒身与赤金双箍，伸缩中的棒体带强烈横扫气流'],
  ['taiyi_nine_dragon_fire_hood', '九龙神火罩', 'red', '太乙真人专属九龙神火罩，赤金穹罩由九条火龙盘绕而成，内部燃烧纯净神火'],
  ['shouxing_longevity_staff', '盘龙寿杖', 'red', '寿星专属盘龙寿杖，古桃木杖身盘绕金龙，杖首托长寿仙桃与温润生机光'],
  ['tang_sanzang_khakkhara', '九环锡杖', 'red', '唐三藏专属九环锡杖，金铜杖首挂九枚法环，环间荡开克制的金色梵光'],
  ['bai_longma_sea_dragon_pearl', '沧海龙珠', 'red', '白龙马专属沧海龙珠，巨大冰蓝龙珠由银白龙爪环抱，珠内翻涌深海与龙卷'],
  ['pi_lanpo_sun_needle', '昴日金针', 'red', '毗蓝婆专属昴日金针，一组纤长赤金神针呈扇形悬浮，针尖折射日芒并形成弹射光线'],
  ['guanyin_jade_purifying_vase', '羊脂玉净瓶', 'red', '观音专属羊脂玉净瓶，温润白玉瓶配青柳枝，瓶口流出旋转的净水漩涡'],
  ['laojun_purple_gold_furnace', '紫金八卦炉', 'red', '太上老君专属紫金八卦炉，三足双耳的紫金丹炉，八卦结构抽象化为金属纹与炉火光环'],
]

const qualityAccent = {
  green: '青玉绿与温和金光',
  blue: '清澈天青与银蓝灵光',
  purple: '深紫与品红法术光',
  orange: '琥珀橙与鎏金神光',
  red: '赤金、深绯与炽白神光',
}

const shared = {
  use_case: 'stylized-concept',
  style: '统一的东方神话赛博玄幻游戏道具立绘；写实比例与高端手绘 3D 渲染融合；青铜、鎏金、玉石、漆器、丝绢材质清晰；敦煌配色经过冷色赛博界面统一；精致但轮廓易读',
  composition: '1:1 方形；单一主体完整居中；轻微三分之四视角；主体占画面约 72%；四周留出稳定安全边距；同一相机距离和透视；适合游戏背包与武库卡片裁切',
  lighting: '顶部柔和金色轮廓光，正面青蓝补光，主体下方轻微悬浮阴影，电影级体积光但不遮挡轮廓',
  constraints: '深靛蓝到黑色的统一渐变陈列背景；背后只有克制的圆形天宫法阵与极淡六边形网格；单件物品；无人物、无手、无场景叙事、无边框、无界面、无文字、无汉字、无数字、无徽标、无水印；主体不可裁切；不得生成重复物品；保持真实可制作的结构',
  size: '1024x1024',
  quality: 'high',
  model: 'gpt-image-2',
}

function promptForItem([id, name, kind, subject]) {
  const energy = kind === 'active'
    ? '主动道具：金红能量更明亮、像即将释放，但光效必须收束'
    : '被动道具：青玉与金色能量稳定内敛、像持续生效的收藏品'
  return {
    ...shared,
    prompt: `游戏道具「${name}」的正式收藏立绘。主体：${subject}。${energy}。必须准确表现这件道具的类别与功能联想，不要展示名称文字。`,
    out: `item_${id}.png`,
  }
}

function promptForWeapon([id, name, quality, subject]) {
  return {
    ...shared,
    prompt: `游戏武器「${name}」的正式收藏立绘。主体：${subject}。品质色：${qualityAccent[quality]}，品质色只用于轮廓光、宝石与少量能量，不能覆盖材质。必须准确表现武器结构与东方神话来源，不要展示名称文字。`,
    out: `weapon_${id}.png`,
  }
}

function extractCatalog(source, regex) {
  return [...source.matchAll(regex)].map((match) => ({ id: match.groups.id, name: match.groups.name }))
}

function assertManifestMatchesCatalog() {
  const itemSource = fs.readFileSync(path.join(root, 'BE/src/item-v1/catalog.ts'), 'utf8')
  const weaponSource = fs.readFileSync(path.join(root, 'BE/src/weapon-v1/catalog.ts'), 'utf8')
  const catalogItems = [
    ...extractCatalog(itemSource, /itemId:\s*'(?<id>[^']+)'[\s\S]{0,100}?name:\s*'(?<name>[^']+)'/g),
    ...extractCatalog(itemSource, /passiveBase\('(?<id>[^']+)',\s*'(?<name>[^']+)'/g),
    ...extractCatalog(itemSource, /combatPassive\('(?<id>[^']+)',\s*'(?<name>[^']+)'/g),
  ]
  const catalogWeapons = [
    ...extractCatalog(weaponSource, /common\(\{\s*id:\s*'(?<id>[^']+)',\s*name:\s*'(?<name>[^']+)'/g),
    ...extractCatalog(weaponSource, /exclusive\(\{[\s\S]*?\bid:\s*'(?<id>[^']+)',\s*name:\s*'(?<name>[^']+)'/g),
  ]

  const verify = (label, catalog, manifest, expected) => {
    if (catalog.length !== expected || manifest.length !== expected) {
      throw new Error(`${label} count mismatch: catalog=${catalog.length}, manifest=${manifest.length}, expected=${expected}`)
    }
    const catalogById = new Map(catalog.map((entry) => [entry.id, entry.name]))
    for (const [id, name] of manifest) {
      if (catalogById.get(id) !== name) throw new Error(`${label} mismatch for ${id}: manifest=${name}, catalog=${catalogById.get(id) ?? 'missing'}`)
      catalogById.delete(id)
    }
    if (catalogById.size) throw new Error(`${label} missing art briefs: ${[...catalogById.keys()].join(', ')}`)
  }

  verify('item', catalogItems, itemArt, 23)
  verify('weapon', catalogWeapons, weaponArt, 41)
}

assertManifestMatchesCatalog()
const jobs = [...itemArt.map(promptForItem), ...weaponArt.map(promptForWeapon)]
fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, `${jobs.map((job) => JSON.stringify(job)).join('\n')}\n`)
console.log(`Wrote ${jobs.length} gpt-image-2 jobs to ${path.relative(root, outputPath)}`)
