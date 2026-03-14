import {
  type ActionType,
  type ActionValidationCode,
  type CoreDecisionOption,
  type CoreEnemyWave,
  type CoreMapCell,
  type CoreQuickActionSlot,
  type CoreReplaySnapshot,
  type CoreResources,
  type CoreRunScenario,
  type CoreTargetMode,
  type CoreTowerBuild,
  type CoreTowerType,
  type GameAction,
  type GameActionResult,
  type GameObservation,
  type GamePhase,
  type LaneLabel,
  type RouteNodeState,
  type RunResultSummary,
  type SimulationEvent,
  type SimulatorState,
} from '../domain.ts'
import {
  createPhaseState,
  getActionWindowLabel,
  isSupportedTowerCore,
  MVP_CORE_TOWER_TYPES,
  PHASE_ORDER,
  PHASE_RULES,
} from './rules.ts'
import { buildReplaySnapshot, buildRunResultSummary } from './replay.ts'
import { mockCoreScenario } from '../mock-data.ts'

interface SimulatorOptions {
  scenario?: CoreRunScenario
  phase?: GamePhase
  seed?: number
}

interface TowerBlueprint {
  name: string
  role: string
  baseDps: number
  baseHeat: number
  note: string
}

export interface SimulatorStepResult {
  actionResult: GameActionResult
  observation: GameObservation
  snapshot: CoreReplaySnapshot
  summary: RunResultSummary
  events: SimulationEvent[]
}

const TOWER_BLUEPRINTS: Record<CoreTowerType, TowerBlueprint> = {
  BALLISTA: {
    name: '断颈弩机',
    role: '单核斩杀',
    baseDps: 132,
    baseHeat: 16,
    note: '优先切开重甲和精英单位。',
  },
  MORTAR: {
    name: '坍缩迫击',
    role: '区域爆发',
    baseDps: 118,
    baseHeat: 24,
    note: '适合压制汇流点和高密度敌群。',
  },
  FROST: {
    name: '寒蚀棱镜',
    role: '控场延滞',
    baseDps: 64,
    baseHeat: 10,
    note: '冻结链能显著拉长敌群暴露时间。',
  },
  CURSE: {
    name: '熵咒祭台',
    role: '乘法增伤',
    baseDps: 72,
    baseHeat: 14,
    note: '负责把高压目标转成全局收益。',
  },
}

const TARGET_MODE_ROTATION: CoreTargetMode[] = ['前锋', '重甲', '热量最高', '精英优先']
const LANE_ORDER: LaneLabel[] = ['北', '中', '南']
const LANE_TO_POSITION: Record<LaneLabel, { x: number; y: number }> = {
  北: { x: 14, y: 4 },
  中: { x: 15, y: 8 },
  南: { x: 14, y: 12 },
}

const DIFFICULTY_WAVE_SCALE = {
  EASY: 0.85,
  NORMAL: 1,
  HARD: 1.16,
  HELL: 1.32,
} as const

const BUILD_PRIORITY_KEYS = [
  '6,7',
  '8,6',
  '10,5',
  '9,10',
  '6,9',
  '7,6',
  '7,10',
  '10,10',
  '11,6',
  '11,10',
]

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function mulberry32(seed: number) {
  let current = seed >>> 0
  return () => {
    current += 0x6d2b79f5
    let t = current
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function nextPhase(phase: GamePhase): GamePhase {
  const currentIndex = PHASE_ORDER.indexOf(phase)
  return PHASE_ORDER[(currentIndex + 1) % PHASE_ORDER.length] ?? 'PREP'
}

function parseWaveNumber(label: string) {
  const match = label.match(/Wave\s+(\d+)/i)
  return match ? Number(match[1]) : 1
}

function updateWaveLabel(label: string, nextWave: number) {
  if (/Wave\s+\d+/i.test(label)) {
    return label.replace(/Wave\s+\d+/i, `Wave ${nextWave}`)
  }

  return `Wave ${nextWave}`
}

function canAfford(resources: CoreResources, delta: Partial<CoreResources>) {
  return !(
    (delta.gold ?? 0) < 0 && resources.gold + (delta.gold ?? 0) < 0
    || (delta.heat ?? 0) < 0 && resources.heat + (delta.heat ?? 0) < 0
    || (delta.mana ?? 0) < 0 && resources.mana + (delta.mana ?? 0) < 0
    || (delta.repair ?? 0) < 0 && resources.repair + (delta.repair ?? 0) < 0
    || (delta.fortress ?? 0) < 0 && resources.fortress + (delta.fortress ?? 0) < 0
  )
}

function buildResourceDelta(action: GameAction): Partial<CoreResources> {
  switch (action.action_type) {
    case 'BUILD':
      return { gold: -90, repair: -1, threat: -4 }
    case 'UPGRADE':
      return { gold: -120, heat: 6, threat: -5 }
    case 'SELL':
      return { gold: 60, repair: -1, threat: 2 }
    case 'MODULATE':
      return { gold: -55, mana: -12, heat: 4 }
    case 'RETARGET':
      return { threat: -3 }
    case 'CAST':
      return { mana: -24, heat: -8, threat: -7 }
    case 'CONSUME':
      return { mana: -10, threat: -4 }
    case 'REPAIR':
      return { repair: -2, fortress: 8, threat: -5 }
    case 'REROUTE':
      return { gold: -35, repair: -2, threat: -8 }
    case 'BUY':
      return { gold: -80 }
    case 'REFRESH_SHOP':
      return { gold: -25 }
    case 'CHOOSE_OPTION':
      return { mana: -6, repair: -1, threat: -2 }
    case 'PAUSE_OR_RESUME':
      return { threat: -1 }
    case 'NO_OP':
      return { heat: 2, threat: 3 }
    default:
      return {}
  }
}

function applyResourceDelta(resources: CoreResources, delta: Partial<CoreResources>) {
  return {
    gold: clamp(resources.gold + (delta.gold ?? 0), 0, 9999),
    heat: clamp(resources.heat + (delta.heat ?? 0), 0, resources.heat_limit),
    heat_limit: resources.heat_limit,
    mana: clamp(resources.mana + (delta.mana ?? 0), 0, resources.mana_limit),
    mana_limit: resources.mana_limit,
    repair: clamp(resources.repair + (delta.repair ?? 0), 0, 99),
    threat: clamp(resources.threat + (delta.threat ?? 0), 0, 100),
    fortress: clamp(resources.fortress + (delta.fortress ?? 0), 0, resources.fortress_max),
    fortress_max: resources.fortress_max,
  }
}

function getActiveRouteNode(scenario: CoreRunScenario) {
  return scenario.routeNodes.find((node) => node.active) ?? scenario.routeNodes[0] ?? null
}

function getNextRouteNode(scenario: CoreRunScenario, currentId?: string) {
  if (scenario.routeNodes.length === 0) {
    return null
  }

  const currentIndex = scenario.routeNodes.findIndex((node) => node.id === currentId)
  if (currentIndex === -1) {
    return scenario.routeNodes.find((node) => !node.cleared) ?? scenario.routeNodes[0]
  }

  return scenario.routeNodes[currentIndex + 1] ?? null
}

function buildCandidates(cells: CoreMapCell[]) {
  const preferred = BUILD_PRIORITY_KEYS
    .map((key) => {
      const [x, y] = key.split(',').map(Number)
      return cells.find((cell) => cell.kind === 'build' && cell.x === x && cell.y === y) ?? null
    })
    .filter((cell): cell is CoreMapCell => Boolean(cell))

  const remaining = cells.filter(
    (cell) => cell.kind === 'build' && !preferred.some((preferredCell) => preferredCell.x === cell.x && preferredCell.y === cell.y),
  )

  return [...preferred, ...remaining]
}

function isOccupied(scenario: CoreRunScenario, cell: { x: number; y: number }) {
  return scenario.towers.some((tower) => tower.cell.x === cell.x && tower.cell.y === cell.y)
}

function findAvailableBuildCell(scenario: CoreRunScenario) {
  return buildCandidates(scenario.cells).find((cell) => !isOccupied(scenario, cell)) ?? null
}

function nextTowerId(scenario: CoreRunScenario, core: CoreTowerType) {
  return `tower-${core.toLowerCase()}-${scenario.towers.length + 1}`
}

function rotateTargetMode(current: CoreTargetMode) {
  const index = TARGET_MODE_ROTATION.indexOf(current)
  return TARGET_MODE_ROTATION[(index + 1) % TARGET_MODE_ROTATION.length] ?? TARGET_MODE_ROTATION[0]
}

function parseCoreFromAction(action: GameAction): CoreTowerType | null {
  const payloadCore = action.payload?.core
  if (isSupportedTowerCore(payloadCore)) {
    return payloadCore
  }

  const actionId = action.target_id?.toLowerCase() ?? ''
  if (actionId.includes('ballista')) {
    return 'BALLISTA'
  }
  if (actionId.includes('mortar')) {
    return 'MORTAR'
  }
  if (actionId.includes('frost')) {
    return 'FROST'
  }
  if (actionId.includes('curse')) {
    return 'CURSE'
  }

  return null
}

function towerStatusFromHeat(heat: number, fallback: CoreTowerBuild['status']) {
  if (heat >= 95) {
    return 'jammed'
  }
  if (heat >= 70) {
    return 'overdrive'
  }
  if (fallback === 'corrupted') {
    return 'corrupted'
  }
  return 'stable'
}

function buildTowerQuickActions(tower: CoreTowerBuild): CoreQuickActionSlot[] {
  const upgradeCost = 80 + tower.tier * 26
  const repairAvailability = tower.status === 'stable' && tower.heat < 24 ? 'locked' : 'ready'
  const castAvailability = tower.status === 'jammed' ? 'locked' : tower.heat >= 88 ? 'cooldown' : 'ready'

  return [
    {
      key: 'Q',
      actionId: `${tower.id}-upgrade`,
      targetId: tower.id,
      actionType: 'UPGRADE',
      targetKind: 'tower',
      label: `升级${tower.name}`,
      detail: '提高等级、输出和模块容量。',
      cost: `${upgradeCost} 金币`,
      availability: tower.tier >= 4 ? 'locked' : 'ready',
      reason: tower.tier >= 4 ? '已达到当前首版等级上限' : undefined,
    },
    {
      key: 'W',
      actionId: `${tower.id}-retarget`,
      targetId: tower.id,
      actionType: 'RETARGET',
      targetKind: 'tower',
      label: `切换到${rotateTargetMode(tower.targetMode)}`,
      detail: '重新设定当前塔核的优先目标模式。',
      cost: '0',
      availability: 'ready',
    },
    {
      key: 'E',
      actionId: `${tower.id}-${tower.status === 'jammed' || tower.status === 'corrupted' ? 'repair' : 'cast'}`,
      targetId: tower.id,
      actionType: tower.status === 'jammed' || tower.status === 'corrupted' ? 'REPAIR' : 'CAST',
      targetKind: 'tower',
      label: tower.status === 'jammed' || tower.status === 'corrupted' ? '应急维修' : '释放塔核技能',
      detail: tower.status === 'jammed' || tower.status === 'corrupted' ? '去污、解卡并快速降温。' : '对当前锁定目标造成额外爆发。',
      cost: tower.status === 'jammed' || tower.status === 'corrupted' ? '2 维修点' : '18 法能',
      availability: repairAvailability === 'locked' && tower.status === 'stable' ? castAvailability : repairAvailability,
      reason: repairAvailability === 'locked' && tower.status === 'stable' ? '当前无维修必要' : undefined,
    },
    {
      key: 'R',
      actionId: `${tower.id}-sell`,
      targetId: tower.id,
      actionType: 'SELL',
      targetKind: 'tower',
      label: '拆除回收',
      detail: '回收部分资源并腾出塔位。',
      cost: '-1 维修点',
      availability: tower.tier >= 3 ? 'locked' : 'ready',
      reason: tower.tier >= 3 ? '高等级核心建议保留到节点决策后' : undefined,
    },
  ]
}

function refreshTowerState(scenario: CoreRunScenario) {
  scenario.towers = scenario.towers.map((tower) => {
    const status = towerStatusFromHeat(tower.heat, tower.status)
    const modules = tower.modules.length > 0 ? tower.modules : [`T${tower.tier} 校准核心`]

    return {
      ...tower,
      status,
      modules,
      quickActions: buildTowerQuickActions({ ...tower, status, modules }),
      note:
        status === 'jammed'
          ? `${tower.name} 已接近热崩溃，需要维修或主动降温。`
          : status === 'overdrive'
            ? `${tower.name} 处于过载输出区，收益高但容错极低。`
            : tower.note,
    }
  })
}

function refreshDerivedLists(scenario: CoreRunScenario) {
  const stressedTowers = scenario.towers.filter((tower) => tower.status !== 'stable' || tower.heat >= 72)

  scenario.buildQueue = [
    ...stressedTowers.slice(0, 2).map((tower) => ({
      id: `queue-fix-${tower.id}`,
      label: `稳定 ${tower.name}`,
      eta: tower.status === 'corrupted' ? '2 维修点' : '1 窗口',
      reason: tower.status === 'corrupted' ? '污染状态会显著压低该塔收益。' : '热量过高会在下一轮进入卡壳区。',
    })),
    {
      id: `queue-route-${parseWaveNumber(scenario.waveLabel)}`,
      label: '评估下一节点走向',
      eta: '决策窗口',
      reason: '商店、营地和 Boss 路线会决定中局资源节奏。',
    },
  ].slice(0, 3)

  scenario.objectiveStack = [
    {
      label: '压热',
      detail: scenario.resources.heat >= 80 ? '热量已进入危险区，下一次过载会导致塔核卡壳。' : '保持热量低于 80，避免失去波中主动权。',
      severity: scenario.resources.heat >= 80 ? 'critical' : 'warning',
    },
    {
      label: '保主堡',
      detail: scenario.resources.fortress <= 45 ? '主堡已经进入红区，至少要保住下一波漏怪。' : '尽量在 Boss 前把主堡稳定在半血以上。',
      severity: scenario.resources.fortress <= 45 ? 'critical' : 'info',
    },
    {
      label: '管维修',
      detail: scenario.resources.repair <= 1 ? '维修点见底，改路和去污都会被迫放弃。' : '保留至少 1 点维修给突发污染或主堡修补。',
      severity: scenario.resources.repair <= 1 ? 'warning' : 'info',
    },
  ]
}

function buildDecisionOptions(scenario: CoreRunScenario): CoreDecisionOption[] {
  const activeNode = getActiveRouteNode(scenario)
  const nextNode = getNextRouteNode(scenario, activeNode?.id)
  const nextLabel = nextNode ? `${nextNode.title} / ${nextNode.type}` : '终局结算'

  return [
    {
      id: 'option-fortify-route',
      label: '稳住主路',
      cost: '40 金币',
      payoff: '下波敌群推进速度下降。',
      risk: `放弃对 ${nextLabel} 的贪收益线路。`,
    },
    {
      id: 'option-deep-invest',
      label: '提前投资构筑',
      cost: '65 金币 / 8 法能',
      payoff: '立即强化当前最强塔核。',
      risk: '若下一波漏怪，主堡恢复空间会被压缩。',
    },
    {
      id: 'option-field-repair',
      label: '压热并补线',
      cost: '2 维修点',
      payoff: '主堡与高热塔核一同稳定。',
      risk: '后续改路和拆改预算不足。',
      locked: scenario.resources.repair < 2,
    },
    {
      id: 'option-push-forward',
      label: `进入 ${nextLabel}`,
      cost: '0',
      payoff: '推进节点并拿到下一个转型窗口。',
      risk: nextNode ? `${nextNode.modifier}` : '立即结束当前演示 run。',
    },
  ]
}

function buildActionSummary(scenario: CoreRunScenario, phase: GamePhase) {
  const activeNode = getActiveRouteNode(scenario)

  switch (phase) {
    case 'PREP':
      return scenario.towers.length === 0
        ? '先落第一批塔核，再决定这局是走单核斩杀、冻结链还是乘法增伤。'
        : '波前优先补齐空位和升级关键塔核，避免把压力全留到波中处理。'
    case 'COMBAT':
      return scenario.resources.heat >= 80
        ? '当前更大的问题是过热，而不是纯输出不足。先稳住热量，再决定是否强开技能。'
        : '波中只做少量高价值动作：补伤害、改目标、维修关键塔核。'
    case 'RESOLUTION':
      return '利用波后结算窗口修补主堡、补买法能或维修包，为下一个决策窗口留资源。'
    case 'DECISION':
      return activeNode ? `当前节点 ${activeNode.title}。决策会直接影响下一节点的资源和压力。` : '选择下一条路线，决定收益与风险。'
    default:
      return scenario.routePressure
  }
}

function applyRouteNodeEffects(scenario: CoreRunScenario, node: RouteNodeState, wave: number) {
  switch (node.type) {
    case 'shop':
      scenario.resources = applyResourceDelta(scenario.resources, { gold: 70, repair: 1, heat: -6 })
      scenario.maintenanceDebt = clamp(scenario.maintenanceDebt - 1, 0, 99)
      scenario.routePressure = `${node.title} 提供了补给窗口。你拿到更多金币、维修点，并暂时缓解了热量。`
      scenario.buildQueue = [
        { id: `queue-shop-${wave}`, label: '考虑购买冷却剂或法能包', eta: '当前节点', reason: `${node.title} 会让波后资源更宽松。` },
        ...scenario.buildQueue,
      ].slice(0, 3)
      break
    case 'camp':
      scenario.resources = applyResourceDelta(scenario.resources, { repair: 2, heat: -10, fortress: 6 })
      scenario.fortressIntegrity = scenario.resources.fortress
      scenario.towers = scenario.towers.map((tower) => ({
        ...tower,
        heat: clamp(tower.heat - 12, 0, scenario.resources.heat_limit),
      }))
      scenario.routePressure = `${node.title} 让你重整防线。主堡和塔核状态都得到短暂修复。`
      break
    case 'event':
      scenario.resources = applyResourceDelta(scenario.resources, { mana: 18, gold: 35 })
      scenario.relics = [...scenario.relics, `${node.title} 契约`].slice(-6)
      scenario.routePressure = `${node.title} 带来了额外法能与一件事件遗物，但后续路线会更不可控。`
      break
    case 'elite':
      scenario.resources = applyResourceDelta(scenario.resources, { gold: 55, threat: 8 })
      scenario.score = clamp(scenario.score + 180 + wave * 12, 0, 999999)
      scenario.routePressure = `${node.title} 已进入精英压制区。收益更高，但下一波威胁也会继续上升。`
      break
    case 'boss':
      scenario.resources = applyResourceDelta(scenario.resources, { mana: 24, heat: 6, threat: 14 })
      scenario.routePressure = `${node.title} 即将开启终局机制。Boss 会强制重绘路线并持续抬高热压。`
      scenario.objectiveStack = [
        { label: '保主堡', detail: '进入 Boss 阶段后，任何一次漏怪都会迅速放大。', severity: 'critical' },
        { label: '压热', detail: '尽量将热量压到 70 以下，否则核心塔会频繁卡壳。', severity: 'critical' },
        { label: '留法能', detail: '至少保留 24 法能用于 Boss 转阶段时的爆发或抢修。', severity: 'warning' },
      ]
      break
    case 'combat':
    default:
      scenario.resources = applyResourceDelta(scenario.resources, { gold: 24 })
      scenario.routePressure = `${node.title} 已部署到位。当前节点会继续考验你的基础构筑稳定性。`
      break
  }

  scenario.fortressIntegrity = scenario.resources.fortress
}

function buildWindowQuickActions(scenario: CoreRunScenario, phase: GamePhase): CoreQuickActionSlot[] {
  const hottestTower = [...scenario.towers].sort((left, right) => right.heat - left.heat)[0]
  const highestTierTower = [...scenario.towers].sort((left, right) => right.tier - left.tier || right.dps - left.dps)[0]

  if (phase === 'PREP') {
    return [
      { key: 'Q', actionId: 'build-ballista', actionType: 'BUILD', targetKind: 'cell', label: '建造弩机', detail: '补单体斩杀位。', cost: '90 金币', availability: 'ready' },
      { key: 'W', actionId: 'build-mortar', actionType: 'BUILD', targetKind: 'cell', label: '建造迫击', detail: '补范围压线位。', cost: '90 金币', availability: 'ready' },
      { key: 'E', actionId: 'build-frost', actionType: 'BUILD', targetKind: 'cell', label: '建造寒霜', detail: '补控场延滞位。', cost: '90 金币', availability: 'ready' },
      { key: 'R', actionId: 'build-curse', actionType: 'BUILD', targetKind: 'cell', label: '建造诅咒', detail: '补乘法增伤位。', cost: '90 金币', availability: 'ready' },
    ]
  }

  if (phase === 'COMBAT') {
    return [
      {
        key: 'Q',
        actionId: highestTierTower ? `combat-cast-${highestTierTower.id}` : 'combat-cast',
        targetId: highestTierTower?.id,
        actionType: 'CAST',
        targetKind: highestTierTower ? 'tower' : 'enemy',
        label: '核心爆发',
        detail: '用最高收益塔核打出一轮短时爆发。',
        cost: '24 法能',
        availability: scenario.resources.mana >= 24 && scenario.enemies.length > 0 ? 'ready' : 'locked',
        reason: scenario.enemies.length === 0 ? '当前没有需要处理的敌群' : scenario.resources.mana < 24 ? '法能不足' : undefined,
      },
      {
        key: 'W',
        actionId: highestTierTower ? `combat-retarget-${highestTierTower.id}` : 'combat-retarget',
        targetId: highestTierTower?.id,
        actionType: 'RETARGET',
        targetKind: highestTierTower ? 'tower' : 'global',
        label: '切换锁定',
        detail: '把主要火力改为更合适的目标模式。',
        cost: '0',
        availability: highestTierTower ? 'ready' : 'locked',
        reason: highestTierTower ? undefined : '场上尚无可重定向塔核',
      },
      {
        key: 'E',
        actionId: hottestTower ? `combat-repair-${hottestTower.id}` : 'fortress-core',
        targetId: hottestTower?.id,
        actionType: 'REPAIR',
        targetKind: hottestTower ? 'tower' : 'global',
        label: '应急维修',
        detail: '优先处理最危险的高热或损坏单位。',
        cost: hottestTower ? '2 维修点' : '1 维修点',
        availability: scenario.resources.repair >= (hottestTower ? 2 : 1) ? 'ready' : 'locked',
        reason: scenario.resources.repair < (hottestTower ? 2 : 1) ? '维修点不足' : undefined,
      },
      {
        key: 'R',
        actionId: 'combat-hold',
        actionType: 'NO_OP',
        targetKind: 'global',
        label: '保留资源',
        detail: '跳过本窗口，保住后续转型预算。',
        cost: '0',
        availability: 'ready',
      },
    ]
  }

  if (phase === 'RESOLUTION') {
    return [
      {
        key: 'Q',
        actionId: 'fortress-core',
        actionType: 'REPAIR',
        targetKind: 'global',
        label: '修复主堡',
        detail: '优先补回漏怪造成的结构损伤。',
        cost: '2 维修点',
        availability: scenario.resources.repair >= 2 ? 'ready' : 'locked',
        reason: scenario.resources.repair < 2 ? '维修点不足' : undefined,
      },
      { key: 'W', actionId: 'shop-coolant', actionType: 'BUY', targetKind: 'shop', label: '购买冷却剂', detail: '直接回收热量，换更高容错。', cost: '80 金币', availability: scenario.resources.gold >= 80 ? 'ready' : 'locked', reason: scenario.resources.gold < 80 ? '金币不足' : undefined },
      { key: 'E', actionId: 'shop-mana-cell', actionType: 'BUY', targetKind: 'shop', label: '购买法能包', detail: '补足波中技能资源。', cost: '80 金币', availability: scenario.resources.gold >= 80 ? 'ready' : 'locked', reason: scenario.resources.gold < 80 ? '金币不足' : undefined },
      { key: 'R', actionId: 'resolution-hold', actionType: 'NO_OP', targetKind: 'global', label: '跳过结算动作', detail: '保留金币和维修点。', cost: '0', availability: 'ready' },
    ]
  }

  const options = buildDecisionOptions(scenario)
  return options.map((option, index) => ({
    key: (['Q', 'W', 'E', 'R'][index] ?? 'Q') as CoreQuickActionSlot['key'],
    actionId: option.id,
    actionType: 'CHOOSE_OPTION',
    targetKind: 'option',
    label: option.label,
    detail: option.payoff,
    cost: option.cost,
    availability: option.locked ? 'locked' : 'ready',
    reason: option.locked ? option.risk : undefined,
  }))
}

function syncActionWindow(scenario: CoreRunScenario, phase: GamePhase) {
  const config = PHASE_RULES[phase]

  refreshTowerState(scenario)
  refreshDerivedLists(scenario)

  const options = phase === 'DECISION' ? buildDecisionOptions(scenario) : []
  const activeNode = getActiveRouteNode(scenario)

  scenario.actionWindow = {
    ...scenario.actionWindow,
    type: config.window_type,
    label: getActionWindowLabel(phase),
    deadlineMs: config.deadline_ms,
    summary: buildActionSummary(scenario, phase),
    options,
    quickActions: buildWindowQuickActions(scenario, phase),
  }

  if (activeNode) {
    scenario.currentNode = activeNode.title
  }
}

function chooseEnemyIndex(tower: CoreTowerBuild, enemies: CoreEnemyWave[]) {
  const available = enemies.filter((enemy) => enemy.hp > 0)

  if (available.length === 0) {
    return -1
  }

  const scored = available.map((enemy) => {
    const laneMatch = tower.cell.y < 8 ? enemy.lane === '北' : tower.cell.y > 9 ? enemy.lane === '南' : enemy.lane === '中'
    const modeBonus =
      tower.targetMode === '精英优先'
        ? (enemy.threat === 'boss' ? 4 : enemy.threat === 'high' ? 2.5 : 1)
        : tower.targetMode === '重甲'
          ? enemy.maxHp / Math.max(enemy.count, 1)
          : tower.targetMode === '热量最高'
            ? enemy.hp / Math.max(enemy.count, 1)
            : 18 - enemy.position.x

    return {
      index: enemies.indexOf(enemy),
      score: modeBonus + (laneMatch ? 1.5 : 0),
    }
  })

  return scored.sort((left, right) => right.score - left.score)[0]?.index ?? -1
}

function damageMultiplier(tower: CoreTowerBuild, enemy: CoreEnemyWave) {
  let multiplier = 1 + (tower.tier - 1) * 0.22

  if (tower.core === 'BALLISTA' && (enemy.threat === 'high' || enemy.threat === 'boss')) {
    multiplier += 0.42
  }
  if (tower.core === 'MORTAR' && enemy.count >= 5) {
    multiplier += 0.35
  }
  if (tower.core === 'FROST') {
    multiplier += 0.08
  }
  if (tower.core === 'CURSE' && enemy.hp / Math.max(enemy.maxHp, 1) <= 0.55) {
    multiplier += 0.3
  }
  if (tower.status === 'overdrive') {
    multiplier += 0.18
  }
  if (tower.status === 'jammed') {
    multiplier *= 0.42
  }
  if (tower.status === 'corrupted') {
    multiplier *= 0.75
  }

  return multiplier
}

function createEnemyWave(seed: number, wave: number, difficulty: CoreRunScenario['difficulty'], routeNode: RouteNodeState | null) {
  const scale = DIFFICULTY_WAVE_SCALE[difficulty]
  const baseThreat = 280 + wave * 42
  const enemyCount = routeNode?.type === 'elite' ? 2 : routeNode?.type === 'boss' ? 1 : 3

  return Array.from({ length: enemyCount }, (_, index) => {
    const lane = LANE_ORDER[(wave + index + seed) % LANE_ORDER.length] ?? '中'
    const lanePosition = LANE_TO_POSITION[lane]
    const isBoss = routeNode?.type === 'boss' && index === enemyCount - 1
    const isElite = routeNode?.type === 'elite' || wave % 5 === 0
    const count = isBoss ? 1 : isElite ? 3 + (wave % 2) : 4 + ((wave + index) % 4)
    const maxHp = Math.round((baseThreat + index * 55) * scale * (isBoss ? 7 : isElite ? 2.6 : 1.35))

    return {
      id: `enemy-wave-${wave}-${index + 1}`,
      name: isBoss ? '余烬巨像' : isElite ? '裂隙织法者' : ['碎盾重步群', '沸腾斥候', '腐蚀驮兽'][(wave + index) % 3] ?? '裂隙敌群',
      threat: isBoss ? 'boss' : isElite ? 'high' : count >= 6 ? 'medium' : 'low',
      lane,
      count,
      hp: maxHp,
      maxHp,
      position: { ...lanePosition },
      intent: isBoss
        ? 'Boss 会在半血后强压主路，并对高热塔核施加污染。'
        : isElite
          ? '精英会优先拖垮高热和低维修资源的防线。'
          : '普通敌群会试图快速穿过汇流点，逼迫你补范围伤害。',
    }
  })
}

export class GameSimulator {
  private readonly random: () => number

  private state: SimulatorState

  constructor(options: SimulatorOptions = {}) {
    const scenario = cloneValue(options.scenario ?? mockCoreScenario)
    const phase = options.phase ?? 'PREP'

    syncActionWindow(scenario, phase)

    this.random = mulberry32(options.seed ?? scenario.seed)
    this.state = {
      phase,
      phaseState: createPhaseState(phase, scenario.currentTick),
      observationVersion: 1,
      scenario: {
        ...scenario,
        supportedTowerCores: [...MVP_CORE_TOWER_TYPES],
      },
      eventLog: [],
    }
  }

  getState() {
    return cloneValue(this.state)
  }

  getObservation(): GameObservation {
    const config = PHASE_RULES[this.state.phase]

    return {
      run_id: this.state.scenario.runId,
      tick: this.state.scenario.currentTick,
      difficulty: this.state.scenario.difficulty,
      seed: this.state.scenario.seed,
      phase: this.state.phase,
      phase_state: cloneValue(this.state.phaseState),
      observation_version: this.state.observationVersion,
      scenario: cloneValue(this.state.scenario),
      executable_actions: [...config.allowed_actions],
      deadline_ms: config.deadline_ms,
    }
  }

  step(action?: GameAction): SimulatorStepResult {
    const isTimeoutFallback = !action
    const pendingAction = action ?? this.createNoOpAction()
    const beforeEventCount = this.state.eventLog.length
    const actionResult = this.submitAction(pendingAction, isTimeoutFallback ? 'timeout_fallback' : undefined)

    this.advancePhase()

    return {
      actionResult,
      observation: this.getObservation(),
      snapshot: this.createSnapshot(),
      summary: this.getResultSummary(actionResult),
      events: cloneValue(this.state.eventLog.slice(beforeEventCount)),
    }
  }

  getResultSummary(lastAction?: GameActionResult) {
    return buildRunResultSummary(this.getObservation(), lastAction)
  }

  submitAction(action: GameAction, fallbackCode?: Extract<ActionValidationCode, 'timeout_fallback'>): GameActionResult {
    const config = PHASE_RULES[this.state.phase]

    if (action.observation_version !== this.state.observationVersion) {
      const result = this.rejectAction(action, 'observation_version mismatch', 'observation_version_mismatch')
      return result
    }

    if (!config.allowed_actions.includes(action.action_type)) {
      return this.rejectAction(action, `${action.action_type} is not allowed during ${this.state.phase}`, 'action_not_allowed')
    }

    if (action.issued_at_tick < this.state.phaseState.started_at_tick) {
      return this.rejectAction(action, 'issued_at_tick is older than current phase start', 'issued_tick_stale')
    }

    if (action.issued_at_tick > this.state.phaseState.deadline_tick) {
      return this.rejectAction(action, 'issued_at_tick exceeds phase deadline', 'issued_tick_outside_window')
    }

    if (action.action_type === 'BUILD' && action.payload?.core && !isSupportedTowerCore(action.payload.core)) {
      return this.rejectAction(action, 'tower core is outside MVP boundary', 'unsupported_tower_core')
    }

    const delta = buildResourceDelta(action)

    if (!canAfford(this.state.scenario.resources, delta)) {
      return this.rejectAction(action, 'insufficient resources for action', 'resource_insufficient')
    }

    const applyError = this.applyAction(action)
    if (applyError) {
      return this.rejectAction(action, applyError, 'invalid_target')
    }

    const nextResources = applyResourceDelta(this.state.scenario.resources, delta)
    const previousResources = this.state.scenario.resources

    if (previousResources.gold > 0 && nextResources.gold === 0 && (delta.gold ?? 0) < 0) {
      this.pushEvent('resources_changed', {
        from: cloneValue(previousResources),
        to: cloneValue(nextResources),
        reason: 'gold_floor_reached',
      })
    }

    this.state.scenario.resources = nextResources
    this.state.scenario.fortressIntegrity = nextResources.fortress
    this.state.scenario.score = clamp(
      this.state.scenario.score + Math.round(this.random() * 120) + this.scoreDeltaForAction(action.action_type),
      0,
      999999,
    )
    this.state.scenario.maintenanceDebt = clamp(
      this.state.scenario.maintenanceDebt + ((delta.repair ?? 0) < 0 ? 1 : 0) - ((delta.fortress ?? 0) > 0 ? 1 : 0),
      0,
      99,
    )
    this.state.observationVersion += 1
    syncActionWindow(this.state.scenario, this.state.phase)

    const result: GameActionResult = {
      accepted: true,
      action,
      phase: this.state.phase,
      applied_tick: this.state.scenario.currentTick,
      validation_code: fallbackCode,
      reason: fallbackCode === 'timeout_fallback' ? 'deadline reached, simulator applied NO_OP fallback' : undefined,
      resource_delta: delta,
    }

    if (Object.keys(delta).length > 0) {
      this.pushEvent('resources_changed', {
        from: cloneValue(previousResources),
        to: cloneValue(nextResources),
        delta,
      })
    }

    if (fallbackCode === 'timeout_fallback') {
      this.pushEvent('timeout_fallback', {
        phase: this.state.phase,
        action,
        timeout_policy: this.state.phaseState.timeout_policy,
      })
    }

    this.pushEvent('action_applied', {
      action,
      resource_delta: delta,
      phase: this.state.phase,
      observation_version: this.state.observationVersion,
      validation_code: fallbackCode,
    })

    return result
  }

  createSnapshot(): CoreReplaySnapshot {
    return buildReplaySnapshot(this.state.scenario, this.state.phase, this.state.observationVersion)
  }

  private advancePhase() {
    const previousPhase = this.state.phase
    const next = nextPhase(previousPhase)
    const previousPhaseRule = PHASE_RULES[previousPhase]

    this.state.scenario.currentTick = Math.min(
      this.state.scenario.maxTicks,
      this.state.scenario.currentTick + previousPhaseRule.tick_delta,
    )

    if (next === 'COMBAT') {
      const currentWave = parseWaveNumber(this.state.scenario.waveLabel)
      const routeNode = getActiveRouteNode(this.state.scenario)
      const threatBump = Math.round(this.random() * 6) + 3 + Math.floor(currentWave / 4)
      const heatBump = Math.round(this.random() * 4) + 1
      this.state.scenario.resources = applyResourceDelta(this.state.scenario.resources, {
        heat: heatBump,
        threat: threatBump,
      })
      this.state.scenario.enemies = createEnemyWave(this.state.scenario.seed, currentWave, this.state.scenario.difficulty, routeNode)
      this.pushEvent('wave_started', {
        wave: currentWave,
        threat_bump: threatBump,
        heat_bump: heatBump,
        enemy_count: this.state.scenario.enemies.length,
      })
    }

    if (next === 'RESOLUTION') {
      const combatResult = this.resolveCombat()
      this.state.scenario.resources = applyResourceDelta(this.state.scenario.resources, {
        gold: combatResult.goldGain,
        fortress: -combatResult.fortressLoss,
        heat: combatResult.heatDelta,
        mana: combatResult.manaDelta,
        threat: -Math.max(2, combatResult.enemiesKilled),
      })
      this.state.scenario.fortressIntegrity = this.state.scenario.resources.fortress
      this.state.scenario.score = clamp(this.state.scenario.score + combatResult.damageDealt + combatResult.enemiesKilled * 90, 0, 999999)
      this.pushEvent('wave_resolved', {
        fortress_loss: combatResult.fortressLoss,
        gold_gain: combatResult.goldGain,
        enemies_killed: combatResult.enemiesKilled,
        damage_dealt: combatResult.damageDealt,
      })
    }

    if (next === 'DECISION') {
      const currentWave = parseWaveNumber(this.state.scenario.waveLabel)
      this.state.scenario.waveLabel = updateWaveLabel(this.state.scenario.waveLabel, currentWave + 1)
      this.state.scenario.resources = applyResourceDelta(this.state.scenario.resources, {
        heat: -10,
        mana: 12,
        gold: 30 + Math.round(this.random() * 25),
      })
    }

    if (this.state.scenario.resources.fortress <= 0) {
      this.state.scenario.currentTick = this.state.scenario.maxTicks
      this.pushEvent('run_failed', {
        reason: 'fortress_breached',
        wave: parseWaveNumber(this.state.scenario.waveLabel),
      })
    }

    this.state.phase = next
    this.state.phaseState = createPhaseState(next, this.state.scenario.currentTick, this.state.phaseState.sequence + 1)
    syncActionWindow(this.state.scenario, next)
    this.state.observationVersion += 1

    this.pushEvent('phase_changed', {
      from: previousPhase,
      to: next,
      tick: this.state.scenario.currentTick,
      phase_sequence: this.state.phaseState.sequence,
    })
  }

  private createNoOpAction(): GameAction {
    return {
      action_type: 'NO_OP',
      target_kind: 'global',
      observation_version: this.state.observationVersion,
      issued_at_tick: this.state.scenario.currentTick,
    }
  }

  private pushEvent(type: SimulationEvent['type'], payload: Record<string, unknown>) {
    this.state.eventLog.push({
      type,
      tick: this.state.scenario.currentTick,
      payload,
    })
  }

  private rejectAction(action: GameAction, reason: string, validationCode: ActionValidationCode): GameActionResult {
    const result: GameActionResult = {
      accepted: false,
      action,
      phase: this.state.phase,
      applied_tick: this.state.scenario.currentTick,
      validation_code: validationCode,
      reason,
    }

    this.pushEvent('action_rejected', {
      action,
      reason,
      phase: this.state.phase,
      validation_code: validationCode,
    })

    return result
  }

  private scoreDeltaForAction(actionType: ActionType) {
    switch (actionType) {
      case 'BUILD':
      case 'UPGRADE':
      case 'CAST':
      case 'REROUTE':
        return 180
      case 'CHOOSE_OPTION':
      case 'BUY':
      case 'REPAIR':
        return 90
      case 'NO_OP':
        return 0
      default:
        return 40
    }
  }

  private applyAction(action: GameAction) {
    switch (action.action_type) {
      case 'BUILD': {
        const core = parseCoreFromAction(action)
        if (!core) {
          return 'missing build core'
        }

        const cell = action.target_cell ?? findAvailableBuildCell(this.state.scenario)
        if (!cell || isOccupied(this.state.scenario, cell)) {
          return 'no available build cell'
        }

        const blueprint = TOWER_BLUEPRINTS[core]
        const tower: CoreTowerBuild = {
          id: nextTowerId(this.state.scenario, core),
          name: blueprint.name,
          role: blueprint.role,
          cell: { x: cell.x, y: cell.y },
          tier: 1,
          core,
          status: 'stable',
          targetMode: core === 'CURSE' ? '热量最高' : core === 'BALLISTA' ? '精英优先' : '前锋',
          modules: [`${core} T1`],
          heat: blueprint.baseHeat,
          dps: blueprint.baseDps,
          note: blueprint.note,
          quickActions: [],
        }

        this.state.scenario.towers.push(tower)
        return null
      }
      case 'UPGRADE': {
        const tower = this.state.scenario.towers.find((item) => item.id === action.target_id) ?? this.state.scenario.towers[0]
        if (!tower || tower.tier >= 4) {
          return 'tower upgrade target unavailable'
        }

        tower.tier += 1
        tower.dps = Math.round(tower.dps * 1.34)
        tower.heat = clamp(tower.heat + 6, 0, this.state.scenario.resources.heat_limit)
        tower.modules = [...tower.modules, action.payload?.module ? String(action.payload.module) : `T${tower.tier} 增幅`] 
        return null
      }
      case 'SELL': {
        const index = this.state.scenario.towers.findIndex((item) => item.id === action.target_id)
        if (index === -1) {
          return 'tower sell target unavailable'
        }

        this.state.scenario.towers.splice(index, 1)
        return null
      }
      case 'MODULATE': {
        const tower = this.state.scenario.towers.find((item) => item.id === action.target_id) ?? this.state.scenario.towers[0]
        if (!tower) {
          return 'tower modulation target unavailable'
        }

        tower.modules = [...tower.modules, String(action.payload?.module ?? `校准-${tower.modules.length + 1}`)]
        tower.dps = Math.round(tower.dps * 1.08)
        return null
      }
      case 'RETARGET': {
        const tower = this.state.scenario.towers.find((item) => item.id === action.target_id) ?? this.state.scenario.towers[0]
        if (!tower) {
          return 'tower retarget target unavailable'
        }

        tower.targetMode = rotateTargetMode(tower.targetMode)
        return null
      }
      case 'CAST': {
        const enemy = this.state.scenario.enemies.find((item) => item.id === action.target_id) ?? this.state.scenario.enemies[0]
        const tower = this.state.scenario.towers.find((item) => item.id === action.target_id)
        if (!enemy && !tower) {
          return 'cast target unavailable'
        }

        if (tower) {
          tower.heat = clamp(tower.heat + 10, 0, this.state.scenario.resources.heat_limit)
          tower.dps = Math.round(tower.dps * 1.06)
          const index = chooseEnemyIndex(tower, this.state.scenario.enemies)
          if (index >= 0) {
            const target = this.state.scenario.enemies[index]
            target.hp = clamp(target.hp - Math.round(tower.dps * 1.25), 0, target.maxHp)
          }
        } else if (enemy) {
          enemy.hp = clamp(enemy.hp - Math.round(enemy.maxHp * 0.22), 0, enemy.maxHp)
        }

        return null
      }
      case 'CONSUME': {
        this.state.scenario.resources = applyResourceDelta(this.state.scenario.resources, { mana: 6, fortress: 4 })
        this.state.scenario.fortressIntegrity = this.state.scenario.resources.fortress
        return null
      }
      case 'REPAIR': {
        const tower = this.state.scenario.towers.find((item) => item.id === action.target_id)
        if (tower) {
          tower.heat = clamp(tower.heat - 20, 0, this.state.scenario.resources.heat_limit)
          tower.status = towerStatusFromHeat(tower.heat, 'stable')
          return null
        }

        this.state.scenario.resources = applyResourceDelta(this.state.scenario.resources, { fortress: 6, heat: -4 })
        this.state.scenario.fortressIntegrity = this.state.scenario.resources.fortress
        this.state.scenario.maintenanceDebt = clamp(this.state.scenario.maintenanceDebt - 1, 0, 99)
        return null
      }
      case 'REROUTE': {
        this.state.scenario.enemies = this.state.scenario.enemies.map((enemy) => ({
          ...enemy,
          position: {
            ...enemy.position,
            x: clamp(enemy.position.x + 2, 0, 17),
          },
        }))
        this.state.scenario.routePressure = '你重绘了关键路径，敌群被迫延后进入主路。'
        this.pushEvent('route_changed', {
          reason: 'player_reroute',
          wave: parseWaveNumber(this.state.scenario.waveLabel),
        })
        return null
      }
      case 'BUY': {
        const itemId = action.target_id ?? 'shop-coolant'
        if (itemId.includes('coolant')) {
          this.state.scenario.resources = applyResourceDelta(this.state.scenario.resources, { heat: -18 })
        } else if (itemId.includes('mana')) {
          this.state.scenario.resources = applyResourceDelta(this.state.scenario.resources, { mana: 28 })
        } else {
          this.state.scenario.relics = [...this.state.scenario.relics, '战地补给包'].slice(-6)
          this.state.scenario.resources = applyResourceDelta(this.state.scenario.resources, { repair: 1 })
        }
        this.state.scenario.fortressIntegrity = this.state.scenario.resources.fortress
        return null
      }
      case 'REFRESH_SHOP': {
        this.state.scenario.routeForecast = [...this.state.scenario.routeForecast].reverse()
        return null
      }
      case 'CHOOSE_OPTION': {
        const optionId = action.target_id ?? 'option-push-forward'
        if (optionId === 'option-fortify-route') {
          this.state.scenario.resources = applyResourceDelta(this.state.scenario.resources, { gold: -20, threat: -8 })
          this.state.scenario.routePressure = '主路被加固，下一波推进速度会被压慢。'
        } else if (optionId === 'option-deep-invest') {
          const tower = [...this.state.scenario.towers].sort((left, right) => right.tier - left.tier || right.dps - left.dps)[0]
          if (tower) {
            tower.dps = Math.round(tower.dps * 1.18)
            tower.heat = clamp(tower.heat + 8, 0, this.state.scenario.resources.heat_limit)
          }
        } else if (optionId === 'option-field-repair') {
          this.state.scenario.resources = applyResourceDelta(this.state.scenario.resources, { heat: -14, fortress: 10 })
          this.state.scenario.fortressIntegrity = this.state.scenario.resources.fortress
          this.state.scenario.maintenanceDebt = clamp(this.state.scenario.maintenanceDebt - 2, 0, 99)
        }

        const currentNode = getActiveRouteNode(this.state.scenario)
        if (currentNode) {
          currentNode.active = false
          currentNode.cleared = true
          const nextNode = getNextRouteNode(this.state.scenario, currentNode.id)
          if (nextNode) {
            nextNode.active = true
            this.state.scenario.currentNode = nextNode.title
            applyRouteNodeEffects(this.state.scenario, nextNode, parseWaveNumber(this.state.scenario.waveLabel))
            this.pushEvent('route_changed', {
              reason: `entered_${nextNode.type}`,
              node: nextNode.title,
              modifier: nextNode.modifier,
            })
          } else {
            this.state.scenario.currentNode = '终局结算'
            this.state.scenario.currentTick = this.state.scenario.maxTicks
            this.pushEvent('run_completed', {
              reason: 'route_finished',
              wave: parseWaveNumber(this.state.scenario.waveLabel),
            })
          }
        }

        return null
      }
      case 'PAUSE_OR_RESUME':
      case 'NO_OP':
        return null
      default:
        return null
    }
  }

  private resolveCombat() {
    let damageDealt = 0
    let enemiesKilled = 0

    for (const tower of this.state.scenario.towers) {
      const enemyIndex = chooseEnemyIndex(tower, this.state.scenario.enemies)
      if (enemyIndex === -1) {
        tower.heat = clamp(tower.heat - 2, 0, this.state.scenario.resources.heat_limit)
        continue
      }

      const enemy = this.state.scenario.enemies[enemyIndex]
      const dealt = Math.round(tower.dps * damageMultiplier(tower, enemy))
      enemy.hp = clamp(enemy.hp - dealt, 0, enemy.maxHp)
      tower.heat = clamp(tower.heat + Math.max(2, Math.round(tower.tier * 1.5)), 0, this.state.scenario.resources.heat_limit)
      tower.status = towerStatusFromHeat(tower.heat, tower.status)
      damageDealt += dealt

      if (enemy.hp === 0) {
        enemiesKilled += enemy.count
      }
    }

    const survivors = this.state.scenario.enemies
      .map((enemy) => {
        if (enemy.hp <= 0) {
          return null
        }

        const step = enemy.threat === 'boss' ? 3 : enemy.threat === 'high' ? 2 : 1
        const nextX = clamp(enemy.position.x - step, 0, 17)
        return {
          ...enemy,
          position: {
            ...enemy.position,
            x: nextX,
          },
        }
      })
      .filter((enemy): enemy is CoreEnemyWave => Boolean(enemy))

    let fortressLoss = 0
    let pressureLoss = 0

    for (const enemy of survivors) {
      if (enemy.position.x <= 1) {
        const leak = enemy.threat === 'boss' ? 14 : enemy.threat === 'high' ? 8 : 4
        fortressLoss += leak
        pressureLoss += enemy.count
      }
    }

    const unresolved = survivors.filter((enemy) => enemy.position.x > 1)
    this.state.scenario.enemies = unresolved

    if (unresolved.some((enemy) => enemy.threat === 'high' || enemy.threat === 'boss') && this.state.scenario.towers.length > 0) {
      const stressedTower = [...this.state.scenario.towers].sort((left, right) => right.heat - left.heat)[0]
      if (stressedTower && this.random() > 0.5) {
        stressedTower.status = stressedTower.status === 'jammed' ? 'jammed' : 'corrupted'
      }
    }

    return {
      damageDealt,
      enemiesKilled,
      fortressLoss,
      goldGain: 42 + enemiesKilled * 6 + Math.round(this.random() * 18),
      heatDelta: -8,
      manaDelta: 6,
      pressureLoss,
    }
  }
}

export function createSimulator(options: SimulatorOptions = {}) {
  return new GameSimulator(options)
}