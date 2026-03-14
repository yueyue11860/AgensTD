'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MainLayout } from '@/components/layout/main-layout'
import { CoreMap } from '@/components/game/core-map'
import { HardcoreResourcesPanel } from '@/components/game/resource-bar'
import { Timeline } from '@/components/game/timeline'
import { DifficultyBadge, StatusBadge } from '@/components/game/status-badge'
import { useAgentsData } from '@/hooks/use-agents-data'
import { useLiveRun } from '@/hooks/use-live-run'
import { TacticalPanel } from '@/components/ui/tactical-panel'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { GameSimulator, createSimulator } from '@/lib/game/simulator'
import { buildReplaySnapshot, buildRunResultSummary } from '@/lib/game/replay'
import { enqueueRun, submitRunAction } from '@/lib/supabase/functions'
import { mockCoreScenario, mockCoreSnapshots, mockDifficultyProgress } from '@/lib/mock-data'
import type { CoreMapCell, CoreQuickActionSlot, CoreReplaySnapshot, CoreRunScenario, Difficulty, DifficultyProgress, GameAction, GridPoint, RouteNodeState, RunActionLogEntry, RunResultSummary, SimulationEvent } from '@/lib/domain'
import { toast } from 'sonner'
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Flame,
  Gauge,
  GitBranch,
  Lock,
  Play,
  RotateCcw,
  Shield,
  ShieldCheck,
  Target,
  TimerReset,
  Trophy,
  Wrench,
} from 'lucide-react'

type PlayerDifficultyProgress = Omit<DifficultyProgress, 'difficulty'> & {
  difficulty: Difficulty
}

type BattleMode = 'local' | 'remote'

const difficultyOrder: Difficulty[] = ['EASY', 'NORMAL', 'HARD', 'HELL']
const progressStorageKey = 'clawgame-main-battle-progress'

const routeNodeStyle = {
  combat: 'border-border bg-card text-foreground',
  elite: 'border-alert-red/35 bg-alert-red/10 text-alert-red',
  shop: 'border-cold-blue/35 bg-cold-blue/10 text-cold-blue',
  event: 'border-warning-orange/35 bg-warning-orange/10 text-warning-orange',
  camp: 'border-acid-green/35 bg-acid-green/10 text-acid-green',
  boss: 'border-alert-red/45 bg-gradient-to-r from-alert-red/12 to-warning-orange/12 text-warning-orange',
} as const

const routeBlueprints: Record<Difficulty, Array<Omit<RouteNodeState, 'cleared' | 'active'>>> = {
  EASY: [
    { id: 'zone1-1', zone: 1, index: 1, type: 'combat', title: '外环警戒线', modifier: '单入口 + 低压敌潮' },
    { id: 'zone1-2', zone: 1, index: 2, type: 'event', title: '废旧补给仓', modifier: '可换首件低阶遗物' },
    { id: 'zone1-3', zone: 1, index: 3, type: 'shop', title: '临时商队', modifier: '冷却剂价格下降' },
    { id: 'zone1-4', zone: 1, index: 4, type: 'camp', title: '前哨营地', modifier: '免费维修 1 次' },
    { id: 'zone1-boss', zone: 1, index: 5, type: 'boss', title: '边境碾压者', modifier: 'Boss 只会单路推进' },
  ],
  NORMAL: [
    { id: 'zone2-1', zone: 2, index: 1, type: 'combat', title: '冷焰回廊', modifier: '双路同步进压' },
    { id: 'zone2-2', zone: 2, index: 2, type: 'elite', title: '裂隙哨戒', modifier: '精英敌群开局加速' },
    { id: 'zone2-3', zone: 2, index: 3, type: 'shop', title: '冷焰补给站', modifier: '法能包收益提升' },
    { id: 'zone2-4', zone: 2, index: 4, type: 'event', title: '回流阀失控', modifier: '可换高热换金币事件' },
    { id: 'zone2-boss', zone: 2, index: 5, type: 'boss', title: '回廊监督者', modifier: 'Boss 会改写目标优先级' },
  ],
  HARD: [
    { id: 'zone3-1', zone: 3, index: 1, type: 'combat', title: '锈河防线', modifier: '双入口 + 污染地块' },
    { id: 'zone3-2', zone: 3, index: 2, type: 'event', title: '无主熔炉', modifier: '可换高热遗物' },
    { id: 'zone3-3', zone: 3, index: 3, type: 'elite', title: '裂隙先遣', modifier: '精英词缀 +1' },
    { id: 'zone3-4', zone: 3, index: 4, type: 'shop', title: '黑箱商店', modifier: '维修成本 -1' },
    { id: 'zone3-5', zone: 3, index: 5, type: 'camp', title: '废墟营地', modifier: '可重构 1 次塔核' },
    { id: 'zone3-boss', zone: 3, index: 6, type: 'boss', title: '余烬主教', modifier: '阶段切换会封路' },
  ],
  HELL: [
    { id: 'zone4-1', zone: 4, index: 1, type: 'combat', title: '熔穿外圈', modifier: '三路同时给压' },
    { id: 'zone4-2', zone: 4, index: 2, type: 'elite', title: '高热朝圣团', modifier: '精英会污染高热塔位' },
    { id: 'zone4-3', zone: 4, index: 3, type: 'shop', title: '末路黑箱', modifier: '商店刷新附带维护债务' },
    { id: 'zone4-4', zone: 4, index: 4, type: 'camp', title: '断层营地', modifier: '允许 1 次重构和 1 次去污' },
    { id: 'zone4-5', zone: 4, index: 5, type: 'event', title: '熔火仪式场', modifier: '可换终局遗物，但热上限 -10' },
    { id: 'zone4-boss', zone: 4, index: 6, type: 'boss', title: '熔穿主脑', modifier: 'Boss 会强制重绘三路并锁模块槽' },
  ],
}

const routeForecastBlueprints: Record<Difficulty, CoreRunScenario['routeForecast']> = {
  EASY: [
    { path: '警戒线 -> 商队 -> 营地', reward: '更平滑的资源曲线', cost: '遗物质量偏低', risk: 'Boss 伤害上限不足' },
    { path: '警戒线 -> 事件 -> 商队', reward: '更早拿到关键遗物', cost: '维修点压力更高', risk: '前两波容易漏怪' },
  ],
  NORMAL: [
    { path: '回廊 -> 精英 -> 商店', reward: '更快成型主轴塔核', cost: '中局压力提高', risk: '双路同时爆线' },
    { path: '回廊 -> 事件 -> Boss', reward: '高额金币与法能', cost: '热量抬升', risk: 'Boss 前容错明显变窄' },
  ],
  HARD: [
    { path: '锈河防线 -> 黑箱商店 -> 废墟营地', reward: '稳定转型窗口', cost: '放弃高稀有遗物', risk: 'Boss 血量更厚' },
    { path: '锈河防线 -> 无主熔炉 -> 余烬主教', reward: '高乘法遗物', cost: '热量上限 -10', risk: '更容易过载暴毙' },
    { path: '锈河防线 -> 裂隙先遣 -> 余烬主教', reward: '额外维修点', cost: '精英词缀 +1', risk: '若未清污染会直接崩盘' },
  ],
  HELL: [
    { path: '熔穿外圈 -> 末路黑箱 -> 断层营地', reward: '高压下仍有重构窗口', cost: '维护债务抬升', risk: '中盘经济极紧' },
    { path: '熔穿外圈 -> 熔火仪式场 -> 熔穿主脑', reward: '终局级遗物收益', cost: '热上限 -10', risk: '任何一次漏怪都可能直接崩盘' },
    { path: '熔穿外圈 -> 高热朝圣团 -> 熔穿主脑', reward: '更多维修点和金币', cost: '精英污染更重', risk: '高热塔核会被持续封锁' },
  ],
}

const difficultyMeta: Record<
  Difficulty,
  {
    title: string
    description: string
    unlockText: string
    panelClass: string
    icon: typeof Shield
    scenarioName: string
    zoneName: string
    waveLabel: string
    scoreScale: number
    tickScale: number
    fortressDelta: number
    heatDelta: number
    threatDelta: number
    maintenanceDebt: number
  }
> = {
  EASY: {
    title: '新兵试炼',
    description: '适合建立基本塔核循环，敌潮密度与资源压力都较低。',
    unlockText: '默认开放',
    panelClass: 'border-slate/30 bg-gradient-to-br from-slate/16 via-card to-card',
    icon: Shield,
    scenarioName: '边境试炼场',
    zoneName: '区域 1 / 防线外环',
    waveLabel: 'Wave 1 / 边境侦察',
    scoreScale: 0.68,
    tickScale: 0.58,
    fortressDelta: 24,
    heatDelta: -26,
    threatDelta: -22,
    maintenanceDebt: 1,
  },
  NORMAL: {
    title: '战术磨合',
    description: '开始考验建造顺序和资源耦合，容错明显收紧。',
    unlockText: '通关 EASY 后解锁',
    panelClass: 'border-cold-blue/30 bg-gradient-to-br from-cold-blue/16 via-card to-card',
    icon: Target,
    scenarioName: '裂隙前哨',
    zoneName: '区域 2 / 冷焰回廊',
    waveLabel: 'Wave 2 / 双路试压',
    scoreScale: 0.84,
    tickScale: 0.78,
    fortressDelta: 12,
    heatDelta: -10,
    threatDelta: -8,
    maintenanceDebt: 2,
  },
  HARD: {
    title: '主战场危机',
    description: '中局开始出现热量、污染与改路压力，是当前赛季的主线门槛。',
    unlockText: '通关 NORMAL 后解锁',
    panelClass: 'border-warning-orange/30 bg-gradient-to-br from-warning-orange/14 via-card to-card',
    icon: Flame,
    scenarioName: '裂谷赛季主战场',
    zoneName: '区域 3 / 裂谷废墟',
    waveLabel: 'Wave 3 / 汇流前哨',
    scoreScale: 1,
    tickScale: 1,
    fortressDelta: 0,
    heatDelta: 0,
    threatDelta: 0,
    maintenanceDebt: mockCoreScenario.maintenanceDebt,
  },
  HELL: {
    title: '地狱终局',
    description: 'Boss 会强制重绘路线并叠加高热压制，要求完整体系和稳定转型。',
    unlockText: '通关 HARD 后解锁',
    panelClass: 'border-alert-red/30 bg-gradient-to-br from-alert-red/16 via-card to-card',
    icon: Gauge,
    scenarioName: '熔穿核心',
    zoneName: '区域 4 / 熔穿核心',
    waveLabel: 'Wave 4 / 高压试炼',
    scoreScale: 1.32,
    tickScale: 1.2,
    fortressDelta: -28,
    heatDelta: 14,
    threatDelta: 18,
    maintenanceDebt: 8,
  },
}

const initialProgress: PlayerDifficultyProgress[] = deriveUnlocks(
  mockDifficultyProgress.map((item) => ({
    ...item,
    difficulty: item.difficulty as Difficulty,
  })),
)

function deriveUnlocks(progress: PlayerDifficultyProgress[]) {
  return difficultyOrder.map((difficulty, index) => {
    const current =
      progress.find((item) => item.difficulty === difficulty) ??
      ({
        difficulty,
        unlocked: index === 0,
        cleared: false,
        best_score: 0,
        best_wave: 0,
        attempts: 0,
        clear_rate: 0,
        requirements: index === 0 ? [] : [`通关 ${difficultyOrder[index - 1]}`],
      } satisfies PlayerDifficultyProgress)

    return {
      ...current,
      unlocked: index === 0 ? true : Boolean(progress.find((item) => item.difficulty === difficultyOrder[index - 1])?.cleared),
    }
  })
}

function parseStoredProgress(raw: string | null) {
  if (!raw) {
    return initialProgress
  }

  try {
    const parsed = JSON.parse(raw) as PlayerDifficultyProgress[]
    if (!Array.isArray(parsed)) {
      return initialProgress
    }

    const merged = initialProgress.map((item) => {
      const stored = parsed.find((entry) => entry.difficulty === item.difficulty)
      if (!stored) {
        return item
      }

      return {
        ...item,
        cleared: Boolean(stored.cleared),
        best_score: Math.max(item.best_score, Number(stored.best_score) || 0),
        best_wave: Math.max(item.best_wave, Number(stored.best_wave) || 0),
        attempts: Math.max(item.attempts, Number(stored.attempts) || 0),
        clear_rate: Math.max(item.clear_rate, Number(stored.clear_rate) || 0),
      }
    })

    return deriveUnlocks(merged)
  } catch {
    return initialProgress
  }
}

function getHighestUnlockedDifficulty(progress: PlayerDifficultyProgress[]) {
  return [...progress].reverse().find((item) => item.unlocked)?.difficulty ?? 'NORMAL'
}

function parseWaveFromLabel(label: string) {
  const match = label.match(/Wave\s+(\d+)/i)
  return match ? Number(match[1]) : 1
}

function buildRouteNodesForRun(difficulty: Difficulty) {
  return routeBlueprints[difficulty].map((node, index) => ({
    ...node,
    cleared: false,
    active: index === 0,
  }))
}

function buildRouteForecastForRun(difficulty: Difficulty) {
  return routeForecastBlueprints[difficulty].map((item) => ({ ...item }))
}

function findDefaultBuildCell(cells: CoreMapCell[]) {
  const firstBuildCell = cells.find((cell) => cell.kind === 'build')
  return firstBuildCell ? { x: firstBuildCell.x, y: firstBuildCell.y } : null
}

function describeSimulationEvent(event: SimulationEvent) {
  switch (event.type) {
    case 'phase_changed':
      return {
        title: `阶段切换：${String(event.payload.to_phase ?? '未知阶段')}`,
        detail: `Tick ${event.tick}，动作窗口已刷新。`,
        tone: 'info' as const,
      }
    case 'wave_started':
      return {
        title: `第 ${String(event.payload.wave ?? '?')} 波开始`,
        detail: `敌群数量 ${String(event.payload.enemy_count ?? '?')}，热量压力继续抬升。`,
        tone: 'warning' as const,
      }
    case 'wave_resolved':
      return {
        title: '波次结算完成',
        detail: `击杀 ${String(event.payload.enemies_killed ?? 0)}，主堡损失 ${String(event.payload.fortress_loss ?? 0)}。`,
        tone: 'info' as const,
      }
    case 'route_changed':
      return {
        title: '路线推进已更新',
        detail: String(event.payload.reason ?? '节点状态发生变化。'),
        tone: 'info' as const,
      }
    case 'run_completed':
      return {
        title: '本局完成',
        detail: '路线已全部推进完毕，可以返回准备区记录进度。',
        tone: 'success' as const,
      }
    case 'run_failed':
      return {
        title: '防线失守',
        detail: String(event.payload.reason ?? '主堡已被击穿。'),
        tone: 'danger' as const,
      }
    case 'action_rejected':
      return {
        title: '动作被拒绝',
        detail: String(event.payload.reason ?? '当前动作不满足执行条件。'),
        tone: 'danger' as const,
      }
    default:
      return {
        title: event.type,
        detail: `Tick ${event.tick}`,
        tone: 'info' as const,
      }
  }
}

function describeRunAction(action: RunActionLogEntry) {
  const label = typeof action.action.payload?.label === 'string'
    ? action.action.payload.label
    : action.action.action_type

  return {
    title: action.accepted ? `已提交 ${label}` : `提交失败 ${label}`,
    detail: action.accepted
      ? `Tick ${action.tick} / ${action.action.target_kind}${action.validation_code ? ` / ${action.validation_code}` : ''}`
      : action.reason ?? action.validation_code ?? '服务端拒绝了这次动作。',
    tone: action.accepted ? 'info' as const : 'danger' as const,
  }
}

function buildBaseResources(difficulty: Difficulty) {
  switch (difficulty) {
    case 'EASY':
      return { gold: 540, heat: 8, mana: 72, repair: 5, threat: 10, fortress: 100 }
    case 'NORMAL':
      return { gold: 500, heat: 12, mana: 68, repair: 4, threat: 14, fortress: 96 }
    case 'HARD':
      return { gold: 460, heat: 16, mana: 64, repair: 4, threat: 18, fortress: 92 }
    case 'HELL':
      return { gold: 430, heat: 20, mana: 60, repair: 3, threat: 24, fortress: 88 }
    default:
      return { gold: 500, heat: 12, mana: 68, repair: 4, threat: 14, fortress: 96 }
  }
}

function buildScenario(difficulty: Difficulty) {
  const meta = difficultyMeta[difficulty]
  const resources = buildBaseResources(difficulty)
  const routeNodes = buildRouteNodesForRun(difficulty)
  const currentNode = routeNodes.find((node) => node.active)?.title ?? routeNodes[0]?.title ?? '区域开局'

  return {
    ...mockCoreScenario,
    title: meta.scenarioName,
    difficulty,
    zoneName: meta.zoneName,
    currentNode,
    waveLabel: meta.waveLabel,
    currentTick: 0,
    score: 0,
    fortressIntegrity: resources.fortress,
    maintenanceDebt: meta.maintenanceDebt,
    routePressure: `${meta.description} ${meta.unlockText}`,
    routeNodes,
    towers: [],
    enemies: [],
    buildQueue: [
      { id: 'queue-start-1', label: '先补第一座塔核', eta: '本窗口', reason: '优先决定这一局的主轴构筑。' },
      { id: 'queue-start-2', label: '保住维修点', eta: '首个战斗节点前', reason: '后续会需要维修去污和波后补堡。' },
    ],
    objectiveStack: [
      { label: '站稳开局', detail: '先建立至少 2 座塔核，避免第一轮漏怪。', severity: 'critical' },
      { label: '留法能', detail: '尽量保留至少 24 法能给首个波中技能。', severity: 'warning' },
      { label: '看路线', detail: '商店和营地是首轮转型窗口，别过早把金币花光。', severity: 'info' },
    ],
    relics: difficulty === 'EASY' ? ['新兵战地手册'] : difficulty === 'NORMAL' ? ['冷焰刻印'] : [],
    routeForecast: buildRouteForecastForRun(difficulty),
    resources: {
      ...mockCoreScenario.resources,
      gold: resources.gold,
      heat: resources.heat,
      mana: resources.mana,
      repair: resources.repair,
      threat: resources.threat,
      fortress: resources.fortress,
    },
  }
}

function buildSnapshots(difficulty: Difficulty) {
  const scenario = buildScenario(difficulty)
  return [
    {
      ...mockCoreSnapshots[0],
      tick: 0,
      game_state: {
        ...mockCoreSnapshots[0].game_state,
        resources: { ...scenario.resources },
        wave: parseWaveFromLabel(scenario.waveLabel),
        score: 0,
      },
    },
  ]
}

function findFirstReadyActionId(scenario: CoreRunScenario) {
  return scenario.actionWindow.quickActions.find((item) => item.availability === 'ready')?.actionId ?? null
}

function createActionFromSlot(
  slot: CoreQuickActionSlot | undefined,
  scenario: CoreRunScenario,
  observationVersion: number,
  selectedCell?: GridPoint | null,
  selectedTowerId?: string | null,
): GameAction {
  const readySlot = slot ?? scenario.actionWindow.quickActions.find((item) => item.availability === 'ready')

  if (!readySlot) {
    return {
      action_type: 'NO_OP',
      target_kind: 'global',
      observation_version: observationVersion,
      issued_at_tick: scenario.currentTick,
    }
  }

  return {
    action_type: readySlot.actionType,
    target_kind: readySlot.targetKind,
    target_id: readySlot.targetKind === 'tower'
      ? (selectedTowerId ?? readySlot.targetId ?? scenario.towers[0]?.id)
      : readySlot.targetId ?? readySlot.actionId,
    ...(readySlot.targetKind === 'cell' && selectedCell ? { target_cell: selectedCell } : {}),
    observation_version: observationVersion,
    issued_at_tick: scenario.currentTick,
    payload: {
      slot: readySlot.key,
      label: readySlot.label,
    },
  }
}

interface LocalBattleState {
  summary: RunResultSummary
  snapshots: CoreReplaySnapshot[]
  lastActionLabel: string | null
  recentEvents: SimulationEvent[]
}

export default function HomePage() {
  const { agents, isUsingFallback: isAgentsFallback, error: agentsError } = useAgentsData()
  const [progress, setProgress] = useState<PlayerDifficultyProgress[]>(initialProgress)
  const [selectedDifficulty, setSelectedDifficulty] = useState<Difficulty>(getHighestUnlockedDifficulty(initialProgress))
  const [hasStarted, setHasStarted] = useState(false)
  const [battleMode, setBattleMode] = useState<BattleMode>('local')
  const [localBattle, setLocalBattle] = useState<LocalBattleState | null>(null)
  const [timelineState, setTimelineState] = useState<{ difficulty: Difficulty | null; tick: number | null }>({
    difficulty: null,
    tick: null,
  })
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null)
  const [selectedCell, setSelectedCell] = useState<GridPoint | null>(null)
  const [selectedTowerId, setSelectedTowerId] = useState<string | null>(null)
  const [remoteRunId, setRemoteRunId] = useState<string | null>(null)
  const [remoteSubmitError, setRemoteSubmitError] = useState<string | null>(null)
  const [remoteLastActionLabel, setRemoteLastActionLabel] = useState<string | null>(null)
  const [isStartingOnline, setIsStartingOnline] = useState(false)
  const [isSubmittingRemote, setIsSubmittingRemote] = useState(false)
  const simulatorRef = useRef<GameSimulator | null>(null)

  const difficultyProgress = useMemo(() => deriveUnlocks(progress), [progress])
  const resolvedDifficulty = useMemo(() => {
    const active = difficultyProgress.find((item) => item.difficulty === selectedDifficulty)
    if (active?.unlocked) {
      return selectedDifficulty
    }

    return getHighestUnlockedDifficulty(difficultyProgress)
  }, [difficultyProgress, selectedDifficulty])
  const selectedProgress = difficultyProgress.find((item) => item.difficulty === resolvedDifficulty) ?? null
  const activeAgent = useMemo(
    () => agents.find((agent) => agent.status === 'active') ?? agents[0] ?? null,
    [agents],
  )
  const battleScenario = useMemo(
    () => buildScenario(resolvedDifficulty),
    [resolvedDifficulty],
  )
  const battleSnapshots = useMemo(
    () => buildSnapshots(resolvedDifficulty),
    [resolvedDifficulty],
  )
  const {
    scenario: liveBattleScenario,
    snapshots: liveBattleSnapshots,
    recentActions: liveRecentActions,
    isUsingFallback: isLiveBattleFallback,
    error: liveBattleError,
  } = useLiveRun({
    difficulty: resolvedDifficulty,
    runId: remoteRunId ?? undefined,
    enabled: hasStarted && battleMode === 'remote',
    fallbackScenario: battleScenario,
    fallbackSnapshots: battleSnapshots,
  })
  const localObservation = localBattle?.summary.observation
  const isRemoteBattle = hasStarted && battleMode === 'remote'
  const activeBattleScenario = localObservation?.scenario ?? (isRemoteBattle ? liveBattleScenario : battleScenario)
  const activeBattleSnapshots = localBattle?.snapshots ?? (isRemoteBattle ? liveBattleSnapshots : battleSnapshots)
  const activeQuickActions = activeBattleScenario.actionWindow.quickActions
  const effectiveSelectedActionId = activeQuickActions.some((item) => item.actionId === selectedActionId && item.availability === 'ready')
    ? selectedActionId
    : findFirstReadyActionId(activeBattleScenario)
  const selectedQuickAction = activeQuickActions.find((item) => item.actionId === effectiveSelectedActionId) ?? null
  const selectedDecisionOption = activeBattleScenario.actionWindow.options.find((option) => option.id === effectiveSelectedActionId) ?? null
  const localLastAction = localBattle?.summary.lastAction
  const localPhase = localObservation?.phase ?? null
  const localPhaseState = localObservation?.phase_state ?? null
  const selectedCellKind = selectedCell ? activeBattleScenario.cells.find((cell) => cell.x === selectedCell.x && cell.y === selectedCell.y)?.kind ?? null : null
  const isRunFinished = activeBattleScenario.currentTick >= activeBattleScenario.maxTicks || activeBattleScenario.resources.fortress <= 0
  const isRunVictory = activeBattleScenario.resources.fortress > 0 && activeBattleScenario.currentTick >= activeBattleScenario.maxTicks
  const currentTick =
    timelineState.difficulty === resolvedDifficulty && timelineState.tick !== null
      ? timelineState.tick
      : activeBattleScenario.currentTick

  useEffect(() => {
    const storedProgress = parseStoredProgress(window.localStorage.getItem(progressStorageKey))
    queueMicrotask(() => {
      setProgress(storedProgress)
      setSelectedDifficulty(getHighestUnlockedDifficulty(storedProgress))
    })
  }, [])

  useEffect(() => {
    window.localStorage.setItem(progressStorageKey, JSON.stringify(progress))
  }, [progress])

  const handleStartGame = () => {
    if (!selectedProgress?.unlocked) {
      return
    }

    const simulator = createSimulator({
      scenario: buildScenario(resolvedDifficulty),
    })
    const observation = simulator.getObservation()

    simulatorRef.current = simulator
    const summary = buildRunResultSummary(observation)
    setBattleMode('local')
    setRemoteRunId(null)
    setRemoteSubmitError(null)
    setRemoteLastActionLabel(null)
    setLocalBattle({
      summary,
      snapshots: [buildReplaySnapshot(observation.scenario, observation.phase, observation.observation_version)],
      lastActionLabel: null,
      recentEvents: [],
    })
    setSelectedActionId(findFirstReadyActionId(observation.scenario))
    setSelectedCell(findDefaultBuildCell(observation.scenario.cells))
    setSelectedTowerId(null)
    setTimelineState({ difficulty: resolvedDifficulty, tick: observation.tick })
    setHasStarted(true)
  }

  const handleStartOnlineGame = useCallback(async () => {
    if (!selectedProgress?.unlocked || !activeAgent || isAgentsFallback) {
      return
    }

    setIsStartingOnline(true)
    const result = await enqueueRun({
      agentId: activeAgent.id,
      difficulty: resolvedDifficulty,
    })
    setIsStartingOnline(false)

    if (result.error || !result.data) {
      toast.error('创建在线 Run 失败', {
        description: result.error?.message ?? '请检查 Supabase 环境与 Edge Function 配置。',
      })
      return
    }

    simulatorRef.current = null
    setBattleMode('remote')
    setLocalBattle(null)
    setRemoteRunId(result.data.runId)
    setRemoteSubmitError(null)
    setRemoteLastActionLabel(null)
    setSelectedActionId(null)
    setSelectedCell(findDefaultBuildCell(battleScenario.cells))
    setSelectedTowerId(null)
    setTimelineState({ difficulty: resolvedDifficulty, tick: null })
    setHasStarted(true)

    toast.success('在线 Run 已创建', {
      description: `${activeAgent.name} / ${result.data.runCode}`,
    })
  }, [activeAgent, battleScenario.cells, isAgentsFallback, resolvedDifficulty, selectedProgress?.unlocked])

  const handleAdvanceSimulation = useCallback(async (actionId = effectiveSelectedActionId) => {
    if (battleMode === 'remote') {
      const selectedSlot = activeBattleScenario.actionWindow.quickActions.find((item) => item.actionId === actionId)
      if (!selectedSlot || !remoteRunId || selectedSlot.availability !== 'ready') {
        return
      }

      const resolvedTargetId = selectedSlot.targetKind === 'tower'
        ? (selectedTowerId ?? selectedSlot.targetId ?? activeBattleScenario.towers[0]?.id)
        : (selectedSlot.targetId ?? selectedSlot.actionId)
      const resolvedTargetCell = selectedSlot.targetKind === 'cell'
        ? (selectedCell ?? findDefaultBuildCell(activeBattleScenario.cells))
        : undefined

      setIsSubmittingRemote(true)
      setRemoteSubmitError(null)

      const { data, error } = await submitRunAction({
        runId: remoteRunId,
        action: {
          actionType: selectedSlot.actionType,
          targetKind: selectedSlot.targetKind,
          targetId: resolvedTargetId,
          targetCell: resolvedTargetCell ?? undefined,
          payload: {
            slot: selectedSlot.key,
            label: selectedSlot.label,
          },
        },
      })

      setIsSubmittingRemote(false)

      if (error || !data?.ok) {
        setRemoteSubmitError(error?.message ?? data?.reason ?? '在线动作提交失败')
        return
      }

      setRemoteLastActionLabel(selectedSlot.label)
      setSelectedActionId(selectedSlot.actionId)
      if (resolvedTargetCell) {
        setSelectedCell(resolvedTargetCell)
      }
      if (selectedSlot.targetKind === 'tower' && resolvedTargetId) {
        setSelectedTowerId(resolvedTargetId)
      }
      return
    }

    const simulator = simulatorRef.current
    const currentBattle = localBattle

    if (!simulator || !currentBattle) {
      return
    }

    const observation = currentBattle.summary.observation

    if (!observation) {
      return
    }

    const selectedSlot = observation.scenario.actionWindow.quickActions.find((item) => item.actionId === actionId)
    const action = createActionFromSlot(selectedSlot, observation.scenario, observation.observation_version, selectedCell, selectedTowerId)
    const result = simulator.step(action)
  const actionLabel = selectedSlot?.label ?? action.action_type

    setLocalBattle((previous) => {
      if (!previous) {
        return previous
      }

      return {
        summary: result.summary,
        snapshots: [...previous.snapshots, result.snapshot].slice(-24),
        lastActionLabel: actionLabel,
        recentEvents: [...previous.recentEvents, ...result.events].slice(-8),
      }
    })
    setSelectedActionId(findFirstReadyActionId(result.observation.scenario))
    if (action.target_cell) {
      setSelectedCell(action.target_cell)
    }
    if (action.target_kind === 'tower' && action.target_id) {
      setSelectedTowerId(action.target_id)
    }
    setTimelineState({ difficulty: resolvedDifficulty, tick: result.observation.tick })
  }, [activeBattleScenario, battleMode, effectiveSelectedActionId, localBattle, remoteRunId, resolvedDifficulty, selectedCell, selectedTowerId])

  useEffect(() => {
    if (!localBattle) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toUpperCase()
      if (!['Q', 'W', 'E', 'R'].includes(key)) {
        return
      }

      const slot = activeQuickActions.find((item) => item.key === key)
      if (!slot || slot.availability !== 'ready') {
        return
      }

      event.preventDefault()
      setSelectedActionId(slot.actionId)
      void handleAdvanceSimulation(slot.actionId)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeQuickActions, battleMode, handleAdvanceSimulation, localBattle])

  const handleCompleteRun = () => {
    const currentWave = parseWaveFromLabel(activeBattleScenario.waveLabel)
    setProgress((current) =>
      deriveUnlocks(
        current.map((item) =>
          item.difficulty === resolvedDifficulty
            ? {
                ...item,
                cleared: item.cleared || isRunVictory,
                best_score: Math.max(item.best_score, activeBattleScenario.score),
                best_wave: Math.max(item.best_wave, currentWave),
                attempts: item.attempts + 1,
                clear_rate: Math.max(item.clear_rate, isRunVictory ? 0.6 : 0.2),
              }
            : item,
        ),
      ),
    )
    simulatorRef.current = null
    setLocalBattle(null)
    setBattleMode('local')
    setRemoteRunId(null)
    setRemoteSubmitError(null)
    setRemoteLastActionLabel(null)
    setSelectedActionId(null)
    setSelectedCell(null)
    setSelectedTowerId(null)
    setHasStarted(false)
    setTimelineState({ difficulty: resolvedDifficulty, tick: activeBattleScenario.currentTick })
  }

  const unlockedCount = difficultyProgress.filter((item) => item.unlocked).length
  const clearedCount = difficultyProgress.filter((item) => item.cleared).length
  const nextUnlock = difficultyProgress.find((item) => !item.unlocked)

  if (!hasStarted) {
    return (
      <MainLayout title="主战场" subtitle="先选择难度，再进入主战场开始游戏">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <div className="space-y-6">
            <section className="rounded-2xl border border-border bg-card/95 p-6 shadow-sm">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                <div className="max-w-2xl space-y-3">
                  <StatusBadge variant="info">战前准备</StatusBadge>
                  <div>
                    <h1 className="text-3xl font-semibold tracking-tight">选择作战难度后进入主战场</h1>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      主战场现在以开始游戏界面作为入口。每个难度都依赖前一难度的通关记录逐级解锁，未完成选择前不能开始本局。
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span className="rounded-full border border-border bg-muted/30 px-3 py-1">已解锁 {unlockedCount}/{difficultyOrder.length}</span>
                    <span className="rounded-full border border-border bg-muted/30 px-3 py-1">已通关 {clearedCount}/{difficultyOrder.length}</span>
                    <span className="rounded-full border border-border bg-muted/30 px-3 py-1">解锁规则: 仅当前一难度已通关时开放下一难度</span>
                  </div>
                </div>

                <div className="w-full max-w-sm rounded-2xl border border-primary/20 bg-primary/8 p-4 lg:w-[320px]">
                  <p className="text-[11px] uppercase tracking-[0.28em] text-primary">当前选择</p>
                  {selectedProgress ? (
                    <>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <DifficultyBadge difficulty={selectedProgress.difficulty} showLevel />
                        {selectedProgress.cleared ? (
                          <StatusBadge variant="success">已通关</StatusBadge>
                        ) : selectedProgress.unlocked ? (
                          <StatusBadge variant="warning">待挑战</StatusBadge>
                        ) : (
                          <StatusBadge variant="default">未解锁</StatusBadge>
                        )}
                      </div>
                      <p className="mt-3 text-sm text-muted-foreground">{difficultyMeta[selectedProgress.difficulty].description}</p>
                    </>
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">请先选择一个难度。</p>
                  )}
                  <Button
                    className="mt-4 w-full gap-2"
                    size="lg"
                    disabled={!selectedProgress?.unlocked}
                    onClick={handleStartGame}
                  >
                    <Play className="h-4 w-4" />
                    本地开始游戏
                  </Button>
                  <Button
                    variant="outline"
                    className="mt-3 w-full gap-2"
                    size="lg"
                    disabled={!selectedProgress?.unlocked || !activeAgent || isAgentsFallback || isStartingOnline}
                    onClick={() => void handleStartOnlineGame()}
                  >
                    <Bot className="h-4 w-4" />
                    {isStartingOnline ? '创建在线 Run...' : activeAgent ? `在线接管 ${activeAgent.name}` : '没有可用 Agent'}
                  </Button>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {isAgentsFallback
                      ? (agentsError ?? 'Supabase Agent 列表不可用，当前只能进行本地模式。')
                      : activeAgent
                        ? `在线模式会为 ${activeAgent.name} 创建一个真实 Run，并在本页持续接管它。`
                        : '当前没有可用 Agent，可先在 Agent 页面创建或激活一个。'}
                  </p>
                </div>
              </div>
            </section>

            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {difficultyProgress.map((item) => {
                const meta = difficultyMeta[item.difficulty]
                const Icon = meta.icon
                const isSelected = item.difficulty === selectedDifficulty

                return (
                  <button
                    key={item.difficulty}
                    type="button"
                    onClick={() => {
                      if (!item.unlocked) {
                        return
                      }

                      setSelectedDifficulty(item.difficulty)
                      setTimelineState({ difficulty: item.difficulty, tick: null })
                    }}
                    className={cn(
                      'rounded-2xl border p-5 text-left transition-all',
                      meta.panelClass,
                      item.unlocked ? 'hover:-translate-y-0.5 hover:border-primary/40' : 'cursor-not-allowed opacity-60',
                      isSelected && 'border-primary shadow-[0_0_0_1px_rgba(90,160,255,0.4)]',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-background/40">
                          <Icon className="h-5 w-5 text-foreground" />
                        </div>
                        <div>
                          <DifficultyBadge difficulty={item.difficulty} showLevel />
                          <p className="mt-2 text-sm font-medium">{meta.title}</p>
                        </div>
                      </div>
                      {!item.unlocked ? (
                        <Lock className="mt-1 h-4 w-4 text-muted-foreground" />
                      ) : item.cleared ? (
                        <CheckCircle2 className="mt-1 h-4 w-4 text-acid-green" />
                      ) : (
                        <Play className="mt-1 h-4 w-4 text-primary" />
                      )}
                    </div>

                    <p className="mt-4 text-sm leading-6 text-muted-foreground">{meta.description}</p>

                    <div className="mt-5 grid grid-cols-2 gap-3 text-xs">
                      <div className="rounded-xl border border-border bg-background/35 p-3">
                        <p className="text-muted-foreground">最高波次</p>
                        <p className="mt-1 text-lg font-semibold">{item.best_wave}</p>
                      </div>
                      <div className="rounded-xl border border-border bg-background/35 p-3">
                        <p className="text-muted-foreground">最高分</p>
                        <p className="mt-1 text-lg font-semibold">{item.best_score.toLocaleString()}</p>
                      </div>
                    </div>

                    <div className="mt-5 flex items-center justify-between text-xs text-muted-foreground">
                      <span>尝试 {item.attempts} 次</span>
                      <span>通关率 {(item.clear_rate * 100).toFixed(0)}%</span>
                    </div>

                    <div className="mt-4 rounded-xl border border-dashed border-border bg-background/25 p-3 text-xs text-muted-foreground">
                      {item.unlocked ? meta.unlockText : `未解锁: ${item.requirements.join(' / ') || meta.unlockText}`}
                    </div>
                  </button>
                )
              })}
            </section>
          </div>

          <aside className="space-y-6">
            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
                  <ShieldCheck className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h2 className="font-medium">解锁进度</h2>
                  <p className="text-sm text-muted-foreground">通关当前难度后，下一档会立即开放。</p>
                </div>
              </div>

              <div className="mt-5 space-y-3">
                {difficultyProgress.map((item, index) => (
                  <div key={item.difficulty} className="flex items-center gap-3 rounded-xl border border-border bg-muted/20 px-3 py-3">
                    <div className={cn(
                      'flex h-9 w-9 items-center justify-center rounded-full border text-xs font-semibold',
                      item.cleared
                        ? 'border-acid-green/40 bg-acid-green/10 text-acid-green'
                        : item.unlocked
                          ? 'border-primary/40 bg-primary/10 text-primary'
                          : 'border-border bg-background text-muted-foreground'
                    )}>
                      {index + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <DifficultyBadge difficulty={item.difficulty} />
                        {item.cleared ? (
                          <StatusBadge variant="success">已完成</StatusBadge>
                        ) : item.unlocked ? (
                          <StatusBadge variant="info">可进入</StatusBadge>
                        ) : (
                          <StatusBadge variant="default">锁定</StatusBadge>
                        )}
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{difficultyMeta[item.difficulty].unlockText}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <h2 className="font-medium">开始条件</h2>
              <div className="mt-4 space-y-3 text-sm text-muted-foreground">
                <div className="rounded-xl border border-border bg-muted/20 p-4">
                  <p className="font-medium text-foreground">1. 先选难度</p>
                  <p className="mt-1">未选择难度时，开始游戏按钮不会放行。</p>
                </div>
                <div className="rounded-xl border border-border bg-muted/20 p-4">
                  <p className="font-medium text-foreground">2. 再看解锁</p>
                  <p className="mt-1">只有已解锁难度可进入，锁定难度仅显示条件与历史目标。</p>
                </div>
                <div className="rounded-xl border border-border bg-muted/20 p-4">
                  <p className="font-medium text-foreground">3. 通关后逐级开放</p>
                  <p className="mt-1">本页会记录你的通关结果，并在下次进入时保持已解锁状态。</p>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <h2 className="font-medium">下一目标</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {nextUnlock
                  ? `当前最近的未解锁难度是 ${nextUnlock.difficulty}，需要先完成上一档通关。`
                  : '所有难度均已解锁，可以直接挑战更高压的终局配置。'}
              </p>
            </section>
          </aside>
        </div>
      </MainLayout>
    )
  }

  return (
    <MainLayout title="主战场" subtitle={`${difficultyMeta[activeBattleScenario.difficulty].title} / ${activeBattleScenario.title}`}>
      <div className="space-y-4">
        {localBattle ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/8 p-4">
            <StatusBadge variant="live">本地模拟已接管</StatusBadge>
            <span className="text-sm text-muted-foreground">
              当前阶段 {localPhase}，最近动作 {localBattle.lastActionLabel ?? '尚未执行'}
              {localLastAction ? localLastAction.accepted ? '，已应用' : '，被拒绝' : ''}。
            </span>
            {localLastAction?.validation_code ? (
              <span className="rounded-full border border-border bg-background/60 px-3 py-1 text-xs text-muted-foreground">
                校验码 {localLastAction.validation_code}
              </span>
            ) : null}
            {localLastAction?.reason ? (
              <span className="text-xs text-muted-foreground">{localLastAction.reason}</span>
            ) : null}
          </div>
        ) : isRemoteBattle ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-cold-blue/30 bg-cold-blue/10 p-4">
            <StatusBadge variant="live">在线 Run 已接管</StatusBadge>
            <span className="text-sm text-muted-foreground">
              {activeAgent ? `${activeAgent.name}` : activeBattleScenario.agentName} 正在推进真实对局，当前运行 ID 为 {remoteRunId ?? '未连接'}。
            </span>
            {remoteLastActionLabel ? (
              <span className="rounded-full border border-border bg-background/60 px-3 py-1 text-xs text-muted-foreground">
                最近提交 {remoteLastActionLabel}
              </span>
            ) : null}
            {remoteSubmitError ? (
              <span className="text-xs text-alert-red">{remoteSubmitError}</span>
            ) : null}
          </div>
        ) : (isLiveBattleFallback || liveBattleError) && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4">
            <StatusBadge variant={liveBattleError ? 'warning' : 'info'}>
              {liveBattleError ? '实时战场查询失败，当前展示本地 mock 战场' : '当前没有匹配的在线战局，主战场展示本地 mock 数据'}
            </StatusBadge>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card/90 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge variant="live">LIVE</StatusBadge>
            <DifficultyBadge difficulty={activeBattleScenario.difficulty} showLevel />
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <GitBranch className="h-4 w-4 text-cold-blue" />
              <span>{activeBattleScenario.zoneName}</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <TimerReset className="h-4 w-4 text-warning-orange" />
              <span>{activeBattleScenario.waveLabel}</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Bot className="h-4 w-4 text-primary" />
              <span>{activeBattleScenario.agentName}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="gap-2" onClick={() => {
              simulatorRef.current = null
              setLocalBattle(null)
              setBattleMode('local')
              setRemoteRunId(null)
              setRemoteSubmitError(null)
              setRemoteLastActionLabel(null)
              setSelectedActionId(null)
              setSelectedCell(null)
              setSelectedTowerId(null)
              setHasStarted(false)
            }}>
              <RotateCcw className="h-4 w-4" />
              返回准备区
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => void handleAdvanceSimulation()}
              disabled={isRunFinished || !selectedQuickAction || selectedQuickAction.availability !== 'ready' || (battleMode === 'local' ? !localBattle : isLiveBattleFallback || !remoteRunId || isSubmittingRemote)}
            >
              <TimerReset className="h-4 w-4" />
              {battleMode === 'remote' ? (isSubmittingRemote ? '正在提交在线动作...' : '提交在线动作') : '提交动作并推进'}
            </Button>
            {localBattle ? (
              <Button className="gap-2" onClick={handleCompleteRun} disabled={!isRunFinished}>
                <Trophy className="h-4 w-4" />
                {isRunVictory ? '结算胜利并记录进度' : '结束本局并记录失败'}
              </Button>
            ) : null}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-2xl border border-primary/15 bg-primary/8 px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.28em] text-primary">战场说明</p>
            <p className="mt-2 text-sm text-muted-foreground">{activeBattleScenario.routePressure}</p>
          </div>
          <div className="rounded-2xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            当前规则版本 {activeBattleScenario.rulesVersion}。支持塔核 {activeBattleScenario.supportedTowerCores.join(' / ')}，{battleMode === 'remote' ? '在线模式会持续从 Supabase 回流当前 run 快照。' : '完成本局后会写入通关记录，并在准备界面逐级开放下一档。'}
          </div>
        </div>

        <CoreMap
          cells={activeBattleScenario.cells}
          towers={activeBattleScenario.towers}
          enemies={activeBattleScenario.enemies}
          selectedCell={selectedCell}
          selectedTowerId={selectedTowerId}
          enableLocalHotkeys={false}
          onCellSelect={(cell: CoreMapCell, tower) => {
            setSelectedCell({ x: cell.x, y: cell.y })
            setSelectedTowerId(tower?.id ?? null)
          }}
          showIntel
          fillViewport
          showFrame={false}
          showHeader={false}
          layout="landscape"
          className="lg:-mx-1"
        />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-border bg-card px-4 py-3">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              <Trophy className="h-3.5 w-3.5 text-warning-orange" />
              积分
            </div>
            <p className="mt-2 text-2xl font-semibold text-warning-orange">{activeBattleScenario.score.toLocaleString()}</p>
          </div>
          <div className="rounded-lg border border-border bg-card px-4 py-3">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              <Shield className="h-3.5 w-3.5 text-alert-red" />
              主堡完整度
            </div>
            <p className="mt-2 text-2xl font-semibold text-alert-red">{activeBattleScenario.fortressIntegrity}%</p>
          </div>
          <div className="rounded-lg border border-border bg-card px-4 py-3">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              <Activity className="h-3.5 w-3.5 text-cold-blue" />
              当前 Tick
            </div>
            <p className="mt-2 text-2xl font-semibold text-foreground">{currentTick.toLocaleString()}</p>
          </div>
          <div className="rounded-lg border border-border bg-card px-4 py-3">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              <Flame className="h-3.5 w-3.5 text-warning-orange" />
              维护债务
            </div>
            <p className="mt-2 text-2xl font-semibold text-warning-orange">{activeBattleScenario.maintenanceDebt}</p>
          </div>
        </div>

        {localBattle ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-border bg-card px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">阶段序号</p>
              <p className="mt-2 text-2xl font-semibold text-foreground">#{localPhaseState?.sequence ?? '-'}</p>
            </div>
            <div className="rounded-lg border border-border bg-card px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">动作窗口</p>
              <p className="mt-2 text-lg font-semibold text-cold-blue">{activeBattleScenario.actionWindow.label}</p>
            </div>
            <div className="rounded-lg border border-border bg-card px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">阶段起始 Tick</p>
              <p className="mt-2 text-2xl font-semibold text-foreground">{localPhaseState?.started_at_tick.toLocaleString() ?? '-'}</p>
            </div>
            <div className="rounded-lg border border-border bg-card px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">截止 Tick</p>
              <p className="mt-2 text-2xl font-semibold text-warning-orange">{localPhaseState?.deadline_tick.toLocaleString() ?? '-'}</p>
            </div>
          </div>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <div className="space-y-6">
            <TacticalPanel title="区域推进" statusLight="active">
              <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
                {activeBattleScenario.routeNodes.map((node) => (
                  <div
                    key={node.id}
                    className={cn(
                      'relative rounded-lg border p-3 transition-colors',
                      routeNodeStyle[node.type],
                      node.active && 'ring-2 ring-primary',
                      node.cleared && 'opacity-70'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] uppercase tracking-[0.2em]">{node.type}</span>
                      {node.active ? <StatusBadge variant="info">当前节点</StatusBadge> : null}
                    </div>
                    <p className="mt-3 text-sm font-medium">{node.title}</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{node.modifier}</p>
                    {node.cleared ? (
                      <span className="absolute right-3 top-3 rounded border border-acid-green/30 bg-acid-green/10 px-1.5 py-0.5 text-[10px] text-acid-green">
                        已结算
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            </TacticalPanel>

            <Timeline
              snapshots={activeBattleSnapshots}
              currentTick={currentTick}
              maxTicks={activeBattleScenario.maxTicks}
              onSeek={(tick) => setTimelineState({ difficulty: resolvedDifficulty, tick })}
            />

            <HardcoreResourcesPanel resources={activeBattleScenario.resources} />

            <TacticalPanel title="当前动作窗口" variant="danger" statusLight="warning">
              <div className="space-y-4 p-4">
                {isRunFinished ? (
                  <div className={cn(
                    'rounded-lg border p-3',
                    isRunVictory ? 'border-acid-green/30 bg-acid-green/10 text-acid-green' : 'border-alert-red/30 bg-alert-red/10 text-alert-red',
                  )}>
                    <p className="text-sm font-medium">{isRunVictory ? '本局已完成，可结算并写入进度。' : '本局已失败，可记录本次尝试后返回准备区。'}</p>
                  </div>
                ) : null}

                <div className="rounded-lg border border-warning-orange/25 bg-warning-orange/5 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.2em] text-warning-orange">{activeBattleScenario.actionWindow.label}</p>
                      <p className="mt-2 text-sm leading-relaxed text-foreground">{activeBattleScenario.actionWindow.summary}</p>
                    </div>
                    <div className="rounded border border-border bg-background/60 px-2 py-1 text-right">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">截止 Tick</p>
                      <p className="font-mono text-sm text-warning-orange">{localPhaseState?.deadline_tick ?? activeBattleScenario.currentTick}</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-card p-3 text-[11px] text-muted-foreground">
                  当前地图选择：
                  {selectedTowerId
                    ? ` 已锁定塔核 ${activeBattleScenario.towers.find((tower) => tower.id === selectedTowerId)?.name ?? selectedTowerId}。`
                    : selectedCell
                      ? ` 地块 (${selectedCell.x}, ${selectedCell.y}) / ${selectedCellKind ?? '未知'}。`
                      : ' 尚未选择地块或塔核。'}
                  {selectedCellKind === 'build' ? ' 这会作为当前建造动作的落点。' : ''}
                </div>

                {activeBattleScenario.actionWindow.options.length > 0 ? (
                  <div className="space-y-2">
                    {activeBattleScenario.actionWindow.options.map((option) => {
                      const slot = activeQuickActions.find((item) => item.actionId === option.id)
                      const isSelected = selectedActionId === option.id
                      return (
                        <button
                          key={option.id}
                          type="button"
                          disabled={option.locked}
                          onClick={() => setSelectedActionId(option.id)}
                          className={cn(
                            'w-full rounded-lg border p-3 text-left transition-colors',
                            isSelected ? 'border-primary bg-primary/10' : 'border-border bg-card hover:bg-muted/30',
                            option.locked && 'cursor-not-allowed opacity-45',
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-semibold text-foreground">
                                  {slot?.key ?? '-'}
                                </span>
                                <p className="text-sm font-medium">{option.label}</p>
                              </div>
                              <p className="mt-1 text-[11px] text-muted-foreground">收益：{option.payoff}</p>
                            </div>
                            <span className="rounded border border-border bg-muted/30 px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                              {option.cost}
                            </span>
                          </div>
                          <p className="mt-2 text-[11px] text-alert-red">风险：{option.risk}</p>
                        </button>
                      )
                    })}
                  </div>
                ) : null}

                <div className="grid gap-2 sm:grid-cols-2">
                  {activeQuickActions.map((slot) => (
                    <button
                      key={slot.actionId}
                      type="button"
                      disabled={slot.availability !== 'ready'}
                      onClick={() => setSelectedActionId(slot.actionId)}
                      className={cn(
                        'rounded border p-3 text-left transition-colors',
                        slot.availability === 'ready' && 'border-primary/30 bg-primary/5 hover:bg-primary/10',
                        slot.availability === 'cooldown' && 'border-warning-orange/30 bg-warning-orange/5',
                        slot.availability === 'locked' && 'cursor-not-allowed border-border bg-muted/20 opacity-60',
                        effectiveSelectedActionId === slot.actionId && 'ring-1 ring-primary',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-semibold text-foreground">{slot.key}</span>
                          <p className="text-xs font-medium text-foreground">{slot.label}</p>
                        </div>
                        <span className="text-[10px] text-muted-foreground">{slot.cost}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">{slot.detail}</p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {slot.reason ?? (slot.availability === 'ready' ? '可立即执行' : slot.availability === 'cooldown' ? '当前冷却中' : '当前不可用')}
                      </p>
                    </button>
                  ))}
                </div>

                <Button
                  className="w-full justify-between"
                  disabled={isRunFinished || !selectedQuickAction || selectedQuickAction.availability !== 'ready' || (battleMode === 'remote' && (isSubmittingRemote || !remoteRunId || isLiveBattleFallback))}
                  onClick={() => void handleAdvanceSimulation()}
                >
                  {selectedQuickAction ? `提交：${selectedQuickAction.label}` : '提交当前动作'}
                  <Play className="h-4 w-4" />
                </Button>

                {battleMode === 'remote' && remoteSubmitError ? (
                  <div className="rounded-lg border border-alert-red/30 bg-alert-red/10 p-3 text-[11px] text-alert-red">
                    {remoteSubmitError}
                  </div>
                ) : null}

                {selectedDecisionOption ? (
                  <p className="text-[11px] text-muted-foreground">
                    当前锁定决策：{selectedDecisionOption.label}。收益是“{selectedDecisionOption.payoff}”，代价是“{selectedDecisionOption.cost}”。
                  </p>
                ) : selectedQuickAction ? (
                  <p className="text-[11px] text-muted-foreground">
                    当前锁定动作：{selectedQuickAction.label}。按 Q/W/E/R 可直接提交对应槽位。
                  </p>
                ) : null}
              </div>
            </TacticalPanel>
          </div>

          <div className="space-y-6">
            {localBattle ? (
              <TacticalPanel title="最近战报" statusLight="active">
                <div className="space-y-3 p-4">
                  {localBattle.recentEvents.length > 0 ? localBattle.recentEvents.map((event, index) => {
                    const item = describeSimulationEvent(event)
                    return (
                      <div key={`${event.type}-${event.tick}-${index}`} className={cn(
                        'rounded-lg border p-3',
                        item.tone === 'danger' && 'border-alert-red/30 bg-alert-red/10',
                        item.tone === 'success' && 'border-acid-green/30 bg-acid-green/10',
                        item.tone === 'info' && 'border-border bg-card',
                        item.tone === 'warning' && 'border-warning-orange/30 bg-warning-orange/10',
                      )}>
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium">{item.title}</p>
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Tick {event.tick}</span>
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground">{item.detail}</p>
                      </div>
                    )
                  }) : (
                    <div className="rounded-lg border border-dashed border-border bg-muted/15 p-4 text-sm text-muted-foreground">
                      本地单局刚刚开始。提交几次动作后，这里会出现阶段切换、波次结算和路线推进记录。
                    </div>
                  )}
                </div>
              </TacticalPanel>
            ) : battleMode === 'remote' ? (
              <TacticalPanel title="在线动作日志" statusLight="active">
                <div className="space-y-3 p-4">
                  {liveRecentActions.length > 0 ? liveRecentActions.map((item) => {
                    const action = describeRunAction(item)
                    return (
                      <div key={item.id} className={cn(
                        'rounded-lg border p-3',
                        action.tone === 'danger' ? 'border-alert-red/30 bg-alert-red/10' : 'border-border bg-card',
                      )}>
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium">{action.title}</p>
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Tick {item.tick}</span>
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground">{action.detail}</p>
                      </div>
                    )
                  }) : (
                    <div className="rounded-lg border border-dashed border-border bg-muted/15 p-4 text-sm text-muted-foreground">
                      在线 run 已创建，但还没有回流到最近动作。提交一次动作后，这里会显示 accepted、tick 和失败原因。
                    </div>
                  )}
                </div>
              </TacticalPanel>
            ) : null}

            <TacticalPanel title="即时目标栈" variant="danger" statusLight="warning">
              <div className="space-y-3 p-4">
                {activeBattleScenario.objectiveStack.map((item) => (
                  <div key={item.label} className="rounded-lg border border-border bg-card p-3">
                    <div className="flex items-center gap-2">
                      {item.severity === 'critical' ? (
                        <AlertTriangle className="h-4 w-4 text-alert-red" />
                      ) : item.severity === 'warning' ? (
                        <Flame className="h-4 w-4 text-warning-orange" />
                      ) : (
                        <Activity className="h-4 w-4 text-cold-blue" />
                      )}
                      <p className="text-sm font-medium">{item.label}</p>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">{item.detail}</p>
                  </div>
                ))}
              </div>
            </TacticalPanel>

            <TacticalPanel title="改造队列" statusLight="active">
              <div className="space-y-3 p-4">
                {activeBattleScenario.buildQueue.map((item) => (
                  <div key={item.id} className="rounded-lg border border-border bg-card p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Wrench className="h-4 w-4 text-cold-blue" />
                        <p className="text-sm font-medium">{item.label}</p>
                      </div>
                      <span className="rounded border border-border bg-muted/30 px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {item.eta}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">{item.reason}</p>
                  </div>
                ))}
              </div>
            </TacticalPanel>
          </div>
        </div>
      </div>
    </MainLayout>
  )
}