import {
  type ActionType,
  type ActionValidationCode,
  type CoreDecisionOption,
  type CoreEnemyWave,
  type CoreQuickActionSlot,
  type CoreReplaySnapshot,
  type CoreResources,
  type CoreRunScenario,
  type CoreTargetMode,
  type CoreTowerBuild,
  type CoreTowerStatus,
  type CoreTowerType,
  type GameAction,
  type GameActionResult,
  type GameObservation,
  type GamePhase,
  type GridPoint,
  type LaneLabel,
  type RouteNodeState,
  type RunResultSummary,
  type SimulationEvent,
  type SimulatorState,
} from '../domain.ts'
import {
  BUILDING_ORDER,
  getBuildingDefinition,
  getBuildingLevel,
} from './buildings.ts'
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

interface CombatResolution {
  damageDealt: number
  enemiesKilled: number
  fortressLoss: number
  goldGain: number
  manaDelta: number
  heatDelta: number
}

const TARGET_MODE_ROTATION: CoreTargetMode[] = ['前锋', '末尾', '高生命', '低生命']
const LANE_ORDER: LaneLabel[] = ['北', '中', '南']
const BOARD_COLUMNS = 25
const DIFFICULTY_WAVE_SCALE = {
  EASY: 0.85,
  NORMAL: 1,
  HARD: 1.15,
  HELL: 1.3,
} as const

const LANE_TO_POSITION: Record<LaneLabel, { x: number; y: number }> = {
  北: { x: 20, y: 4 },
  中: { x: 21, y: 9 },
  南: { x: 20, y: 14 },
}

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

function rotateTargetMode(current: CoreTargetMode) {
  const currentIndex = TARGET_MODE_ROTATION.indexOf(current)
  return TARGET_MODE_ROTATION[(currentIndex + 1) % TARGET_MODE_ROTATION.length] ?? '前锋'
}

function nextTowerId(scenario: CoreRunScenario, core: CoreTowerType) {
  const prefix = core.toLowerCase()
  const matched = scenario.towers.filter((tower) => tower.id.startsWith(prefix)).length + 1
  return `${prefix}_${String(matched).padStart(2, '0')}`
}

function parseTowerTypeFromAction(action: GameAction): CoreTowerType | null {
  const payloadCore = action.payload?.core
  if (isSupportedTowerCore(payloadCore)) {
    return payloadCore
  }

  const actionId = String(action.target_id ?? '').toUpperCase()
  return BUILDING_ORDER.find((type) => actionId.includes(type)) ?? null
}

function getTowerCenter(tower: CoreTowerBuild) {
  return {
    x: tower.cell.x + (tower.footprint.width - 1) / 2,
    y: tower.cell.y + (tower.footprint.height - 1) / 2,
  }
}

function getOccupiedCells(cell: GridPoint, footprint: { width: number; height: number }) {
  const occupied: GridPoint[] = []
  for (let dx = 0; dx < footprint.width; dx += 1) {
    for (let dy = 0; dy < footprint.height; dy += 1) {
      occupied.push({ x: cell.x + dx, y: cell.y + dy })
    }
  }
  return occupied
}

function getTowerOccupiedCells(tower: CoreTowerBuild) {
  return getOccupiedCells(tower.cell, tower.footprint)
}

function isCellBuildable(scenario: CoreRunScenario, point: GridPoint) {
  return scenario.cells.some((cell) => cell.kind === 'build' && cell.x === point.x && cell.y === point.y)
}

function canPlaceTower(scenario: CoreRunScenario, type: CoreTowerType, cell: GridPoint) {
  const level = getBuildingLevel(type, 1)
  const occupied = getOccupiedCells(cell, level.footprint)

  return occupied.every((point) => {
    if (!isCellBuildable(scenario, point)) {
      return false
    }

    return !scenario.towers.some((tower) => {
      return getTowerOccupiedCells(tower).some((occupiedCell) => occupiedCell.x === point.x && occupiedCell.y === point.y)
    })
  })
}

function findAvailableBuildCell(scenario: CoreRunScenario, type: CoreTowerType) {
  return scenario.cells.find((cell) => cell.kind === 'build' && canPlaceTower(scenario, type, cell)) ?? null
}

function createTowerBuild(type: CoreTowerType, cell: GridPoint, tier = 1): CoreTowerBuild {
  const definition = getBuildingDefinition(type)
  const level = getBuildingLevel(type, tier)

  return {
    id: `${type.toLowerCase()}_${cell.x}_${cell.y}`,
    name: definition.name,
    role: level.role,
    cell: { x: cell.x, y: cell.y },
    tier,
    core: type,
    status: 'ready',
    targetMode: definition.defaultTargetMode,
    footprint: { ...level.footprint },
    range: level.range,
    attackRate: level.attackRate,
    damage: level.attack,
    dps: Math.round(level.attack * level.attackRate * 10) / 10,
    effects: [level.effectText],
    note: `${definition.name} Lv.${tier} 已部署。${level.effectText}`,
    quickActions: [],
    focusTargetId: null,
    focusSeconds: 0,
    attackSpeedMultiplier: 1,
    storedGold: 0,
  }
}

function updateTowerFromTier(tower: CoreTowerBuild) {
  const level = getBuildingLevel(tower.core, tower.tier)
  tower.role = level.role
  tower.footprint = { ...level.footprint }
  tower.range = level.range
  tower.attackRate = level.attackRate
  tower.damage = level.attack
  tower.dps = Math.round(level.attack * level.attackRate * (tower.attackSpeedMultiplier ?? 1) * 10) / 10
  tower.effects = [level.effectText]
}

function buildTowerStatus(tower: CoreTowerBuild): CoreTowerStatus {
  if ((tower.attackSpeedMultiplier ?? 1) > 1.05) {
    return 'boosted'
  }
  if (tower.core === 'LASER' && (tower.focusSeconds ?? 0) > 0.5) {
    return 'charging'
  }
  return 'ready'
}

function buildTowerQuickActions(tower: CoreTowerBuild): CoreQuickActionSlot[] {
  const definition = getBuildingDefinition(tower.core)
  const nextTier = tower.tier + 1
  const upgradeLevel = tower.tier < 3 ? getBuildingLevel(tower.core, nextTier) : null
  const castCost = definition.category === 'economy' ? '0' : definition.category === 'support' ? '1 法力' : '2 法力'
  const castLabel = tower.core === 'ARROW'
    ? '连射压制'
    : tower.core === 'ICE'
      ? '冰爆延滞'
      : tower.core === 'CANNON'
        ? '震荡齐射'
        : tower.core === 'LASER'
          ? '聚焦增幅'
          : tower.core === 'TESLA'
            ? '链式放电'
            : tower.core === 'MAGIC'
              ? '火雨压场'
              : tower.core === 'SUPPLY'
                ? '战地提速'
                : '提早收矿'

  return [
    {
      key: 'Q',
      actionId: `${tower.id}-upgrade`,
      targetId: tower.id,
      actionType: 'UPGRADE',
      targetKind: 'tower',
      label: `升级${tower.name}`,
      detail: upgradeLevel ? `升到 ${tower.name} Lv.${nextTier}。` : '已达到最高等级。',
      cost: upgradeLevel ? `${upgradeLevel.cost} 金币` : '已满级',
      availability: tower.tier >= 3 ? 'locked' : 'ready',
      reason: tower.tier >= 3 ? '该建筑最多 3 级。' : undefined,
    },
    {
      key: 'W',
      actionId: `${tower.id}-retarget`,
      targetId: tower.id,
      actionType: 'RETARGET',
      targetKind: 'tower',
      label: `切换到${rotateTargetMode(tower.targetMode)}`,
      detail: definition.category === 'attack' ? '切换锁定优先级。' : '该建筑不依赖目标优先级。',
      cost: '0',
      availability: definition.category === 'attack' ? 'ready' : 'locked',
      reason: definition.category === 'attack' ? undefined : '功能建筑不需要重设目标。',
    },
    {
      key: 'E',
      actionId: `${tower.id}-cast`,
      targetId: tower.id,
      actionType: 'CAST',
      targetKind: 'tower',
      label: castLabel,
      detail: tower.core === 'MINE' ? '立刻结算矿场已存金币。' : `对 ${tower.name} 执行一次主动战术动作。`,
      cost: castCost,
      availability: definition.category === 'economy' ? ((tower.storedGold ?? 0) > 0 ? 'ready' : 'locked') : 'ready',
      reason: definition.category === 'economy' && (tower.storedGold ?? 0) <= 0 ? '当前没有可提取金币。' : undefined,
    },
    {
      key: 'R',
      actionId: `${tower.id}-sell`,
      targetId: tower.id,
      actionType: 'SELL',
      targetKind: 'tower',
      label: '拆除回收',
      detail: '拆除建筑并回收部分金币。',
      cost: '+60% 造价',
      availability: 'ready',
    },
  ]
}

function refreshTowerState(scenario: CoreRunScenario) {
  const supplyTowers = scenario.towers.filter((tower) => tower.core === 'SUPPLY')

  scenario.towers = scenario.towers.map((tower) => {
    const center = getTowerCenter(tower)
    const auraBonus = supplyTowers
      .filter((supply) => supply.id !== tower.id)
      .reduce((best, supply) => {
        const level = getBuildingLevel(supply.core, supply.tier)
        const supplyCenter = getTowerCenter(supply)
        const inAura = Math.abs(center.x - supplyCenter.x) <= level.range / 2 && Math.abs(center.y - supplyCenter.y) <= level.range / 2
        return inAura ? Math.max(best, level.auraAttackSpeed ?? 0) : best
      }, 0)

    tower.attackSpeedMultiplier = tower.core === 'SUPPLY' || tower.core === 'MINE' ? 1 : 1 + auraBonus
    updateTowerFromTier(tower)
    tower.status = buildTowerStatus(tower)
    tower.note = tower.core === 'SUPPLY'
      ? `${tower.name} 正在为 6x6 范围内友军提供 ${(getBuildingLevel(tower.core, tower.tier).auraAttackSpeed ?? 0) * 100}% 攻速加成。`
      : tower.core === 'MINE'
        ? `${tower.name} 已累计 ${(tower.storedGold ?? 0).toFixed(0)} 金币待结算。`
        : `${tower.name} Lv.${tower.tier}，当前攻速倍率 ${(tower.attackSpeedMultiplier ?? 1).toFixed(2)}。`
    tower.quickActions = buildTowerQuickActions(tower)
    return tower
  })
}

function refreshDerivedLists(scenario: CoreRunScenario) {
  const utilityTowers = scenario.towers.filter((tower) => tower.core === 'SUPPLY' || tower.core === 'MINE')

  scenario.buildQueue = [
    ...utilityTowers.slice(0, 2).map((tower) => ({
      id: `queue-${tower.id}`,
      label: tower.core === 'SUPPLY' ? `扩大 ${tower.name} 覆盖` : `结算 ${tower.name} 产出`,
      eta: tower.core === 'SUPPLY' ? '本轮准备阶段' : '本轮结算阶段',
      reason: tower.note,
    })),
    {
      id: `queue-route-${parseWaveNumber(scenario.waveLabel)}`,
      label: '评估下一节点走向',
      eta: '决策窗口',
      reason: '在资源、战线热度和主堡完整度之间选择最优路线。',
    },
  ].slice(0, 3)

  scenario.objectiveStack = [
    {
      label: '保主堡',
      detail: scenario.resources.fortress <= 40 ? '主堡已经进入危险线，下一波必须优先防漏。' : '把主堡保持在 40 以上，才有余量转功能塔。',
      severity: scenario.resources.fortress <= 40 ? 'critical' : 'warning',
    },
    {
      label: '控热度',
      detail: scenario.resources.heat >= 70 ? '战线热度过高，会压缩你在后续节点的容错。' : '控制战线热度，避免资源链同时断裂。',
      severity: scenario.resources.heat >= 70 ? 'critical' : 'info',
    },
    {
      label: '做经济',
      detail: scenario.towers.some((tower) => tower.core === 'MINE') ? '矿场已经开工，注意别让矿位占满关键火力区。' : '如果局势平稳，尽快放下一座矿场滚经济。',
      severity: scenario.towers.some((tower) => tower.core === 'MINE') ? 'info' : 'warning',
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
      label: '加固主线',
      cost: '2 金币',
      payoff: '下一波漏怪伤害降低。',
      risk: `会推迟进入 ${nextLabel}。`,
    },
    {
      id: 'option-deep-invest',
      label: '追加投资',
      cost: '4 金币',
      payoff: '强化当前最高等级建筑。',
      risk: '若下一波失守，经济会被直接掏空。',
      locked: scenario.resources.gold < 4,
    },
    {
      id: 'option-field-repair',
      label: '补线修堡',
      cost: '2 维修',
      payoff: '主堡恢复并降低战线热度。',
      risk: '后续拆改预算会更紧。',
      locked: scenario.resources.repair < 2,
    },
    {
      id: 'option-push-forward',
      label: `进入 ${nextLabel}`,
      cost: '0',
      payoff: '推进节点并拿到新的布局窗口。',
      risk: nextNode ? nextNode.modifier : '当前 run 将进入结算。',
    },
  ]
}

function buildActionSummary(scenario: CoreRunScenario, phase: GamePhase) {
  switch (phase) {
    case 'PREP':
      return scenario.towers.length === 0
        ? '先定开局架构。箭塔和炮塔稳，补给站和矿场决定中局节奏。'
        : '准备阶段优先补齐关键火力，再考虑补给站覆盖和矿场位置。'
    case 'COMBAT':
      return '战斗阶段用少量高价值动作处理漏怪、抢节奏和临时提速。'
    case 'RESOLUTION':
      return '结算阶段处理主堡、买法力或回收矿场的即时收益。'
    case 'DECISION':
      return '在路线收益、主堡安全和经济滚动之间做选择。'
    default:
      return scenario.routePressure
  }
}

function buildWindowQuickActions(scenario: CoreRunScenario, phase: GamePhase): CoreQuickActionSlot[] {
  const bestTower = [...scenario.towers]
    .filter((tower) => getBuildingDefinition(tower.core).category === 'attack')
    .sort((left, right) => right.tier - left.tier || right.dps - left.dps)[0]
  const economyTower = scenario.towers.find((tower) => tower.core === 'MINE' && (tower.storedGold ?? 0) > 0)

  if (phase === 'PREP') {
    return BUILDING_ORDER.map((type, index) => {
      const definition = getBuildingDefinition(type)
      const level = definition.levels[0]
      return {
        key: String(index + 1),
        actionId: `build-${type}`,
        targetId: type,
        actionType: 'BUILD',
        targetKind: 'cell',
        label: `建造${definition.name}`,
        detail: level.effectText,
        cost: `${level.cost} 金币`,
        availability: scenario.resources.gold >= level.cost ? 'ready' : 'locked',
        reason: scenario.resources.gold >= level.cost ? undefined : '金币不足。',
      }
    })
  }

  if (phase === 'COMBAT') {
    return [
      {
        key: 'Q',
        actionId: bestTower ? `combat-cast-${bestTower.id}` : 'combat-cast',
        targetId: bestTower?.id,
        actionType: 'CAST',
        targetKind: bestTower ? 'tower' : 'global',
        label: '主动战术',
        detail: '让当前最关键的建筑立刻介入本轮战斗。',
        cost: '2 法力',
        availability: bestTower && scenario.resources.mana >= 2 ? 'ready' : 'locked',
        reason: bestTower ? (scenario.resources.mana >= 2 ? undefined : '法力不足。') : '场上还没有可主动操作的进攻建筑。',
      },
      {
        key: 'W',
        actionId: bestTower ? `combat-retarget-${bestTower.id}` : 'combat-retarget',
        targetId: bestTower?.id,
        actionType: 'RETARGET',
        targetKind: bestTower ? 'tower' : 'global',
        label: '切换优先级',
        detail: '把核心火力切到更合适的敌群。',
        cost: '0',
        availability: bestTower ? 'ready' : 'locked',
        reason: bestTower ? undefined : '当前没有目标可切换。',
      },
      {
        key: 'E',
        actionId: 'combat-reroute',
        actionType: 'REROUTE',
        targetKind: 'route',
        label: '拖慢进军',
        detail: '让当前敌群整体后退一小段距离。',
        cost: '1 维修',
        availability: scenario.resources.repair >= 1 ? 'ready' : 'locked',
        reason: scenario.resources.repair >= 1 ? undefined : '维修点不足。',
      },
      {
        key: 'R',
        actionId: economyTower ? `collect-${economyTower.id}` : 'combat-hold',
        targetId: economyTower?.id,
        actionType: economyTower ? 'CAST' : 'NO_OP',
        targetKind: economyTower ? 'tower' : 'global',
        label: economyTower ? '提取矿场' : '保留资源',
        detail: economyTower ? '提前拿走矿场已累计的金币。' : '跳过本窗口，保住下一轮预算。',
        cost: '0',
        availability: 'ready',
      },
    ]
  }

  if (phase === 'RESOLUTION') {
    return [
      {
        key: 'Q',
        actionId: 'fortress-repair',
        actionType: 'REPAIR',
        targetKind: 'global',
        label: '修复主堡',
        detail: '立刻恢复主堡结构完整度。',
        cost: '2 维修',
        availability: scenario.resources.repair >= 2 ? 'ready' : 'locked',
        reason: scenario.resources.repair >= 2 ? undefined : '维修点不足。',
      },
      {
        key: 'W',
        actionId: 'shop-mana',
        actionType: 'BUY',
        targetKind: 'shop',
        label: '买法力包',
        detail: '结算阶段追加法力，准备下一次主动战术。',
        cost: '3 金币',
        availability: scenario.resources.gold >= 3 ? 'ready' : 'locked',
        reason: scenario.resources.gold >= 3 ? undefined : '金币不足。',
      },
      {
        key: 'E',
        actionId: 'shop-repair-kit',
        actionType: 'BUY',
        targetKind: 'shop',
        label: '买维修包',
        detail: '补回 1 点维修资源。',
        cost: '2 金币',
        availability: scenario.resources.gold >= 2 ? 'ready' : 'locked',
        reason: scenario.resources.gold >= 2 ? undefined : '金币不足。',
      },
      {
        key: 'R',
        actionId: 'resolution-hold',
        actionType: 'NO_OP',
        targetKind: 'global',
        label: '跳过结算动作',
        detail: '保住金币和维修资源。',
        cost: '0',
        availability: 'ready',
      },
    ]
  }

  const options = buildDecisionOptions(scenario)
  return options.map((option, index) => ({
    key: ['Q', 'W', 'E', 'R'][index] ?? String(index + 1),
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

  scenario.actionWindow = {
    ...scenario.actionWindow,
    type: config.window_type,
    label: getActionWindowLabel(phase),
    deadlineMs: config.deadline_ms,
    summary: buildActionSummary(scenario, phase),
    options: phase === 'DECISION' ? buildDecisionOptions(scenario) : [],
    quickActions: buildWindowQuickActions(scenario, phase),
  }

  const activeNode = getActiveRouteNode(scenario)
  if (activeNode) {
    scenario.currentNode = activeNode.title
  }
}

function chooseEnemyIndex(tower: CoreTowerBuild, enemies: CoreEnemyWave[]) {
  const available = enemies.filter((enemy) => enemy.hp > 0)

  if (available.length === 0) {
    return -1
  }

  const center = getTowerCenter(tower)
  const inRange = available.filter((enemy) => {
    if (tower.core === 'MAGIC') {
      return true
    }
    const dx = center.x - enemy.position.x
    const dy = center.y - enemy.position.y
    return Math.sqrt(dx * dx + dy * dy) <= Math.max(1, tower.range)
  })
  const pool = inRange.length > 0 ? inRange : available

  const scored = pool.map((enemy) => {
    const modeScore = tower.targetMode === '高生命'
      ? enemy.hp
      : tower.targetMode === '低生命'
        ? 10000 - enemy.hp
        : tower.targetMode === '末尾'
          ? enemy.position.x
          : BOARD_COLUMNS - enemy.position.x
    return {
      index: enemies.indexOf(enemy),
      score: modeScore + enemy.count * 4 - enemy.armor * 100,
    }
  })

  return scored.sort((left, right) => right.score - left.score)[0]?.index ?? -1
}

function affectEnemy(enemy: CoreEnemyWave, damage: number) {
  const mitigatedDamage = Math.max(0, Math.round(damage * (1 - enemy.armor)))
  enemy.hp = clamp(enemy.hp - mitigatedDamage, 0, enemy.maxHp)
  return mitigatedDamage
}

function resolveTowerAttack(tower: CoreTowerBuild, enemies: CoreEnemyWave[], phaseSeconds: number) {
  const definition = getBuildingDefinition(tower.core)
  const level = getBuildingLevel(tower.core, tower.tier)
  let dealtTotal = 0

  if (definition.category === 'support' || definition.category === 'economy') {
    return dealtTotal
  }

  if (tower.core === 'MAGIC') {
    const directDamage = level.attack * level.attackRate * phaseSeconds
    for (const enemy of enemies) {
      enemy.burnRatio = Math.max(enemy.burnRatio, level.burnRatio ?? 0)
      enemy.statusText = `灼烧 ${(enemy.burnRatio * 100).toFixed(0)}%/s`
      dealtTotal += affectEnemy(enemy, directDamage)
    }
    return dealtTotal
  }

  const index = chooseEnemyIndex(tower, enemies)
  if (index === -1) {
    tower.focusTargetId = null
    tower.focusSeconds = 0
    return dealtTotal
  }

  const primary = enemies[index]
  const attackMultiplier = tower.attackSpeedMultiplier ?? 1

  if (tower.core === 'LASER') {
    const sameTarget = tower.focusTargetId === primary.id
    const currentFocus = sameTarget ? tower.focusSeconds ?? 0 : 0
    const nextFocus = Math.min(5, currentFocus + phaseSeconds)
    const ramp = 1 + (level.laserRampBonus ?? 0) * (nextFocus / 5)
    tower.focusTargetId = primary.id
    tower.focusSeconds = nextFocus
    dealtTotal += affectEnemy(primary, level.attack * phaseSeconds * attackMultiplier * ramp)
    return dealtTotal
  }

  const baseDamage = level.attack * level.attackRate * phaseSeconds * attackMultiplier

  if (tower.core === 'CANNON' || tower.core === 'TESLA') {
    for (const enemy of enemies) {
      const inBlast = Math.abs(enemy.position.x - primary.position.x) <= 1 && Math.abs(enemy.position.y - primary.position.y) <= 1
      if (!inBlast) {
        continue
      }
      dealtTotal += affectEnemy(enemy, baseDamage)
      if (tower.core === 'TESLA') {
        enemy.armor = clamp(enemy.armor - (level.armorShred ?? 0), 0, enemy.maxArmor)
        enemy.statusText = `减防 ${(level.armorShred ?? 0) * 100}%`
      }
    }
    return dealtTotal
  }

  dealtTotal += affectEnemy(primary, baseDamage)
  if (tower.core === 'ICE') {
    primary.slowFactor = Math.max(primary.slowFactor, level.slowFactor ?? 0)
    primary.statusText = `减速 ${(primary.slowFactor * 100).toFixed(0)}%`
  }
  return dealtTotal
}

function createEnemyWave(seed: number, wave: number, difficulty: CoreRunScenario['difficulty'], routeNode: RouteNodeState | null) {
  const scale = DIFFICULTY_WAVE_SCALE[difficulty]
  const isBossNode = routeNode?.type === 'boss'
  const isEliteNode = routeNode?.type === 'elite' || wave % 5 === 0
  const groupCount = isBossNode ? 1 : 3

  return Array.from({ length: groupCount }, (_, index) => {
    const lane = LANE_ORDER[(wave + index + seed) % LANE_ORDER.length] ?? '中'
    const lanePosition = LANE_TO_POSITION[lane]
    const boss = isBossNode && index === 0
    const elite = !boss && isEliteNode && index === 0
    const count = boss ? 1 : elite ? 3 : 4 + ((wave + index) % 3)
    const maxHp = Math.round((60 + wave * 14 + index * 12) * scale * (boss ? 6.5 : elite ? 2.4 : 1.4))
    const armor = boss ? 0.28 : elite ? 0.18 : 0.08 + ((wave + index) % 3) * 0.02
    const speed = boss ? 1.1 : elite ? 1.6 : 1.8

    return {
      id: `enemy-wave-${wave}-${index + 1}`,
      name: boss ? '攻城巨像' : elite ? '重甲先遣队' : ['散兵群', '破墙兽', '携盾群'][index % 3] ?? '敌军簇',
      threat: (boss ? 'boss' : elite ? 'high' : count >= 5 ? 'medium' : 'low') as CoreEnemyWave['threat'],
      lane,
      count,
      hp: maxHp,
      maxHp,
      position: { ...lanePosition },
      speed,
      baseSpeed: speed,
      armor,
      maxArmor: armor,
      slowFactor: 0,
      burnRatio: 0,
      statusText: '无异常状态',
      intent: boss
        ? '会强拆主线并测试你的多格火力布局。'
        : elite
          ? '高护甲精英会逼你尽快补减防与范围伤害。'
          : '普通敌群会试探火力空隙并寻找漏怪路线。',
    }
  })
}

function applyRouteNodeEffects(scenario: CoreRunScenario, node: RouteNodeState) {
  switch (node.type) {
    case 'shop':
      scenario.resources = applyResourceDelta(scenario.resources, { gold: 4, repair: 1, mana: 2, heat: -6 })
      scenario.routePressure = `${node.title} 给了你短暂补给窗口，可以更放心地准备下一轮布局。`
      break
    case 'camp':
      scenario.resources = applyResourceDelta(scenario.resources, { repair: 2, fortress: 8, heat: -10 })
      scenario.fortressIntegrity = scenario.resources.fortress
      scenario.routePressure = `${node.title} 让你完成抢修和重整。`
      break
    case 'event':
      scenario.resources = applyResourceDelta(scenario.resources, { gold: 2, mana: 3 })
      scenario.relics = [...scenario.relics, `${node.title} 契约`].slice(-6)
      scenario.routePressure = `${node.title} 提供额外资源，但后续波次会更不稳定。`
      break
    case 'elite':
      scenario.resources = applyResourceDelta(scenario.resources, { gold: 3, threat: 6 })
      scenario.routePressure = `${node.title} 的收益更高，但会更快暴露你在范围伤害上的短板。`
      break
    case 'boss':
      scenario.resources = applyResourceDelta(scenario.resources, { mana: 3, heat: 10, threat: 12 })
      scenario.routePressure = `${node.title} 将检验你是否真的搭出了完整建筑体系。`
      break
    case 'combat':
    default:
      scenario.resources = applyResourceDelta(scenario.resources, { gold: 1 })
      scenario.routePressure = `${node.title} 会继续测试你的基础建筑构成。`
      break
  }
}

function processPassiveEconomy(scenario: CoreRunScenario, seconds: number) {
  let passiveGold = 0
  for (const tower of scenario.towers) {
    if (tower.core !== 'MINE') {
      continue
    }
    const incomeInterval = getBuildingLevel(tower.core, tower.tier).incomeInterval ?? 999
    const produced = Math.floor(seconds / incomeInterval)
    tower.storedGold = (tower.storedGold ?? 0) + produced
    passiveGold += produced
  }
  if (passiveGold > 0) {
    scenario.resources = applyResourceDelta(scenario.resources, { gold: passiveGold })
  }
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

  step(action?: GameAction) {
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

  getResultSummary(lastAction?: GameActionResult): RunResultSummary {
    return buildRunResultSummary(this.getObservation(), lastAction)
  }

  submitAction(action: GameAction, fallbackCode?: Extract<ActionValidationCode, 'timeout_fallback'>): GameActionResult {
    const config = PHASE_RULES[this.state.phase]

    if (action.observation_version !== this.state.observationVersion) {
      return this.rejectAction(action, 'observation_version mismatch', 'observation_version_mismatch')
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
      return this.rejectAction(action, 'building type is outside supported boundary', 'unsupported_tower_core')
    }

    const delta = this.buildResourceDelta(action)
    if (!canAfford(this.state.scenario.resources, delta)) {
      return this.rejectAction(action, 'insufficient resources for action', 'resource_insufficient')
    }

    const applyError = this.applyAction(action)
    if (applyError) {
      return this.rejectAction(action, applyError, 'invalid_target')
    }

    const previousResources = this.state.scenario.resources
    const nextResources = applyResourceDelta(previousResources, delta)
    this.state.scenario.resources = nextResources
    this.state.scenario.fortressIntegrity = nextResources.fortress
    this.state.scenario.score = clamp(this.state.scenario.score + this.scoreDeltaForAction(action.action_type), 0, 999999)
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

  private buildResourceDelta(action: GameAction): Partial<CoreResources> {
    switch (action.action_type) {
      case 'BUILD': {
        const type = parseTowerTypeFromAction(action)
        return type ? { gold: -getBuildingLevel(type, 1).cost, threat: -2 } : {}
      }
      case 'UPGRADE': {
        const tower = this.state.scenario.towers.find((item) => item.id === action.target_id)
        return tower && tower.tier < 3 ? { gold: -getBuildingLevel(tower.core, tower.tier + 1).cost, threat: -1 } : {}
      }
      case 'SELL': {
        const tower = this.state.scenario.towers.find((item) => item.id === action.target_id)
        return tower ? { gold: Math.round(getBuildingLevel(tower.core, tower.tier).cost * 0.6), threat: 1 } : {}
      }
      case 'CAST': {
        const tower = this.state.scenario.towers.find((item) => item.id === action.target_id)
        if (!tower) {
          return { mana: -2 }
        }
        if (tower.core === 'SUPPLY') {
          return { mana: -1 }
        }
        return tower.core === 'MINE' ? {} : { mana: -2 }
      }
      case 'REPAIR':
        return action.target_kind === 'tower' ? { repair: -1 } : { repair: -2 }
      case 'REROUTE':
        return { repair: -1, threat: -4 }
      case 'BUY':
        return String(action.target_id ?? '').includes('repair') ? { gold: -2 } : { gold: -3 }
      case 'CHOOSE_OPTION': {
        const optionId = String(action.target_id ?? '')
        if (optionId === 'option-fortify-route') {
          return { gold: -2, threat: -6 }
        }
        if (optionId === 'option-deep-invest') {
          return { gold: -4 }
        }
        if (optionId === 'option-field-repair') {
          return { repair: -2, heat: -8, fortress: 8 }
        }
        return {}
      }
      case 'NO_OP':
        return { heat: 2, threat: 1 }
      default:
        return {}
    }
  }

  private advancePhase() {
    const previousPhase = this.state.phase
    const next = nextPhase(previousPhase)
    const previousPhaseRule = PHASE_RULES[previousPhase]
    const elapsedSeconds = previousPhaseRule.tick_delta / 10

    processPassiveEconomy(this.state.scenario, elapsedSeconds)

    this.state.scenario.currentTick = Math.min(
      this.state.scenario.maxTicks,
      this.state.scenario.currentTick + previousPhaseRule.tick_delta,
    )

    if (next === 'COMBAT') {
      const currentWave = parseWaveNumber(this.state.scenario.waveLabel)
      const routeNode = getActiveRouteNode(this.state.scenario)
      this.state.scenario.resources = applyResourceDelta(this.state.scenario.resources, {
        heat: 4 + Math.floor(currentWave / 5),
        threat: 5 + Math.floor(currentWave / 4),
      })
      this.state.scenario.enemies = createEnemyWave(this.state.scenario.seed, currentWave, this.state.scenario.difficulty, routeNode)
      this.pushEvent('wave_started', {
        wave: currentWave,
        enemy_count: this.state.scenario.enemies.length,
      })
    }

    if (next === 'RESOLUTION') {
      const combatResult = this.resolveCombat()
      this.state.scenario.resources = applyResourceDelta(this.state.scenario.resources, {
        gold: combatResult.goldGain,
        mana: combatResult.manaDelta,
        heat: combatResult.heatDelta,
        fortress: -combatResult.fortressLoss,
        threat: -Math.max(2, combatResult.enemiesKilled),
      })
      this.state.scenario.fortressIntegrity = this.state.scenario.resources.fortress
      this.state.scenario.score = clamp(this.state.scenario.score + combatResult.damageDealt + combatResult.enemiesKilled * 12, 0, 999999)
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
        mana: 2,
        heat: -6,
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
      case 'CHOOSE_OPTION':
        return 24
      case 'SELL':
      case 'REPAIR':
      case 'BUY':
      case 'REROUTE':
        return 12
      default:
        return 4
    }
  }

  private applyAction(action: GameAction) {
    switch (action.action_type) {
      case 'BUILD': {
        const type = parseTowerTypeFromAction(action)
        if (!type) {
          return 'missing building type'
        }
        const cell = action.target_cell ?? findAvailableBuildCell(this.state.scenario, type)
        if (!cell || !canPlaceTower(this.state.scenario, type, cell)) {
          return 'selected position cannot fit this building'
        }
        const tower = createTowerBuild(type, cell, 1)
        tower.id = nextTowerId(this.state.scenario, type)
        this.state.scenario.towers.push(tower)
        return null
      }
      case 'UPGRADE': {
        const tower = this.state.scenario.towers.find((item) => item.id === action.target_id) ?? this.state.scenario.towers[0]
        if (!tower || tower.tier >= 3) {
          return 'building upgrade target unavailable'
        }
        tower.tier += 1
        updateTowerFromTier(tower)
        return null
      }
      case 'SELL': {
        const index = this.state.scenario.towers.findIndex((item) => item.id === action.target_id)
        if (index === -1) {
          return 'building sell target unavailable'
        }
        this.state.scenario.towers.splice(index, 1)
        return null
      }
      case 'RETARGET': {
        const tower = this.state.scenario.towers.find((item) => item.id === action.target_id)
        if (!tower) {
          return 'building retarget target unavailable'
        }
        if (getBuildingDefinition(tower.core).category !== 'attack') {
          return 'this building has no retarget mode'
        }
        tower.targetMode = rotateTargetMode(tower.targetMode)
        return null
      }
      case 'CAST': {
        const tower = this.state.scenario.towers.find((item) => item.id === action.target_id)
        if (!tower) {
          const enemy = this.state.scenario.enemies[0]
          if (!enemy) {
            return 'cast target unavailable'
          }
          enemy.hp = clamp(enemy.hp - 12, 0, enemy.maxHp)
          return null
        }

        const level = getBuildingLevel(tower.core, tower.tier)
        if (tower.core === 'MINE') {
          const collected = tower.storedGold ?? 0
          tower.storedGold = 0
          this.state.scenario.resources = applyResourceDelta(this.state.scenario.resources, { gold: collected })
          return null
        }
        if (tower.core === 'SUPPLY') {
          for (const target of this.state.scenario.towers) {
            if (target.id === tower.id || getBuildingDefinition(target.core).category !== 'attack') {
              continue
            }
            const center = getTowerCenter(target)
            const supplyCenter = getTowerCenter(tower)
            if (Math.abs(center.x - supplyCenter.x) <= level.range / 2 && Math.abs(center.y - supplyCenter.y) <= level.range / 2) {
              target.attackSpeedMultiplier = (target.attackSpeedMultiplier ?? 1) + 0.15
            }
          }
          return null
        }
        if (tower.core === 'MAGIC') {
          this.state.scenario.enemies = this.state.scenario.enemies.map((enemy) => ({
            ...enemy,
            burnRatio: Math.max(enemy.burnRatio, (level.burnRatio ?? 0) + 0.01),
            statusText: '主动火雨压场',
          }))
          return null
        }

        const enemyIndex = chooseEnemyIndex(tower, this.state.scenario.enemies)
        if (enemyIndex === -1) {
          return 'cast target unavailable'
        }
        const enemy = this.state.scenario.enemies[enemyIndex]
        const burst = tower.core === 'LASER' ? level.attack * 12 : level.attack * 4
        affectEnemy(enemy, burst)
        if (tower.core === 'ICE') {
          enemy.slowFactor = Math.max(enemy.slowFactor, (level.slowFactor ?? 0) + 0.1)
          enemy.statusText = '主动减速'
        }
        if (tower.core === 'TESLA') {
          enemy.armor = clamp(enemy.armor - ((level.armorShred ?? 0) + 0.05), 0, enemy.maxArmor)
          enemy.statusText = '主动减防'
        }
        if (tower.core === 'LASER') {
          tower.focusTargetId = enemy.id
          tower.focusSeconds = Math.min(5, (tower.focusSeconds ?? 0) + 2.5)
        }
        return null
      }
      case 'CONSUME': {
        this.state.scenario.resources = applyResourceDelta(this.state.scenario.resources, { mana: -1, fortress: 4 })
        this.state.scenario.fortressIntegrity = this.state.scenario.resources.fortress
        return null
      }
      case 'REPAIR': {
        if (action.target_kind === 'tower') {
          const tower = this.state.scenario.towers.find((item) => item.id === action.target_id)
          if (!tower) {
            return 'repair target unavailable'
          }
          tower.focusTargetId = null
          tower.focusSeconds = 0
          tower.attackSpeedMultiplier = 1
          tower.status = 'ready'
          return null
        }
        this.state.scenario.resources = applyResourceDelta(this.state.scenario.resources, { fortress: 8, heat: -6 })
        this.state.scenario.fortressIntegrity = this.state.scenario.resources.fortress
        return null
      }
      case 'REROUTE': {
        this.state.scenario.enemies = this.state.scenario.enemies.map((enemy) => ({
          ...enemy,
          position: {
            ...enemy.position,
            x: clamp(enemy.position.x + 2, 0, BOARD_COLUMNS - 1),
          },
        }))
        this.state.scenario.routePressure = '你暂时拖慢了敌军推进，为多格火力争取了一轮输出时间。'
        this.pushEvent('route_changed', {
          reason: 'player_reroute',
          wave: parseWaveNumber(this.state.scenario.waveLabel),
        })
        return null
      }
      case 'BUY': {
        if (String(action.target_id ?? '').includes('repair')) {
          this.state.scenario.resources = applyResourceDelta(this.state.scenario.resources, { repair: 1 })
        } else {
          this.state.scenario.resources = applyResourceDelta(this.state.scenario.resources, { mana: 4 })
        }
        return null
      }
      case 'REFRESH_SHOP': {
        this.state.scenario.routeForecast = [...this.state.scenario.routeForecast].reverse()
        return null
      }
      case 'CHOOSE_OPTION': {
        if (String(action.target_id ?? '') === 'option-deep-invest') {
          const tower = [...this.state.scenario.towers].sort((left, right) => right.tier - left.tier || right.dps - left.dps)[0]
          if (tower) {
            tower.attackSpeedMultiplier = (tower.attackSpeedMultiplier ?? 1) + 0.2
            updateTowerFromTier(tower)
          }
        }
        const currentNode = getActiveRouteNode(this.state.scenario)
        if (currentNode) {
          currentNode.active = false
          currentNode.cleared = true
          const nextNode = getNextRouteNode(this.state.scenario, currentNode.id)
          if (nextNode) {
            nextNode.active = true
            this.state.scenario.currentNode = nextNode.title
            applyRouteNodeEffects(this.state.scenario, nextNode)
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

  private resolveCombat(): CombatResolution {
    const phaseSeconds = PHASE_RULES.COMBAT.tick_delta / 10
    let damageDealt = 0

    refreshTowerState(this.state.scenario)
    for (const tower of this.state.scenario.towers) {
      damageDealt += resolveTowerAttack(tower, this.state.scenario.enemies, phaseSeconds)
    }
    for (const enemy of this.state.scenario.enemies) {
      if (enemy.hp <= 0 || enemy.burnRatio <= 0) {
        continue
      }
      damageDealt += affectEnemy(enemy, enemy.maxHp * enemy.burnRatio * phaseSeconds)
    }

    const killed = this.state.scenario.enemies.filter((enemy) => enemy.hp <= 0)
    const survivors = this.state.scenario.enemies
      .filter((enemy) => enemy.hp > 0)
      .map((enemy) => ({
        ...enemy,
        position: {
          ...enemy.position,
          x: clamp(enemy.position.x - Math.max(1, Math.round(enemy.baseSpeed * (1 - enemy.slowFactor) * phaseSeconds / 18)), 0, BOARD_COLUMNS - 1),
        },
        speed: enemy.baseSpeed,
        slowFactor: 0,
      }))

    let fortressLoss = 0
    const unresolved = survivors.filter((enemy) => {
      if (enemy.position.x > 1) {
        return true
      }
      fortressLoss += enemy.threat === 'boss' ? 18 : enemy.threat === 'high' ? 10 : enemy.threat === 'medium' ? 6 : 4
      return false
    })

    this.state.scenario.enemies = unresolved

    return {
      damageDealt: Math.round(damageDealt),
      enemiesKilled: killed.reduce((total, enemy) => total + enemy.count, 0),
      fortressLoss,
      goldGain: killed.reduce((total, enemy) => total + Math.max(1, Math.ceil(enemy.count / 2)), 0),
      manaDelta: unresolved.length === 0 ? 2 : 1,
      heatDelta: unresolved.length > 0 ? 6 : -4,
    }
  }
}

export function createSimulator(options: SimulatorOptions = {}) {
  return new GameSimulator(options)
}