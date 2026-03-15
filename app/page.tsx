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
import { getBuildingLabel } from '@/lib/game/buildings'
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
  Target,
  TimerReset,
  Trophy,
  Wrench,
} from 'lucide-react'

type PlayerDifficultyProgress = Omit<DifficultyProgress, 'difficulty'> & {
  difficulty: Difficulty
}

type BattleMode = 'local' | 'remote'
type StageId = 'tutorial' | 'level-1' | 'level-2' | 'level-3' | 'level-4' | 'level-5' | 'level-6' | 'endless'
type StageCompletionState = Record<StageId, boolean>

interface StageDefinition {
  id: StageId
  label: string
  title: string
  description: string
  detail: string
  unlockHint: string
  difficulty: Difficulty
  icon: typeof Shield
  panelClass: string
  guaranteedWin?: boolean
  tutorial?: boolean
}

interface StageState {
  unlocked: boolean
  completed: boolean
}

interface TutorialStep {
  title: string
  detail: string
}

const difficultyOrder: Difficulty[] = ['EASY', 'NORMAL', 'HARD', 'HELL']
const progressStorageKey = 'clawgame-main-battle-progress'
const stageProgressStorageKey = 'clawgame-stage-progress'

const stageDefinitions: StageDefinition[] = [
  {
    id: 'tutorial',
    label: '教学关卡',
    title: '零压演练',
    description: '从地图点选到就近操作卡执行，按步骤把新版核心操作亲手做一遍。',
    detail: '完成全部教学步骤后，会自动把你带到关卡 1。',
    unlockHint: '默认开放',
    difficulty: 'EASY',
    icon: Shield,
    panelClass: 'border-primary/30 bg-gradient-to-br from-primary/14 via-card to-card',
    tutorial: true,
  },
  {
    id: 'level-1',
    label: '关卡 1',
    title: '新兵巡检线',
    description: '极简敌潮与超宽资源窗口，用来建立第一局的节奏感。',
    detail: '本关保证 100% 通过率，目标是让玩家稳定体验第一场胜利。',
    unlockHint: '完成教学关卡后开放',
    difficulty: 'EASY',
    icon: Shield,
    panelClass: 'border-slate/30 bg-gradient-to-br from-slate/16 via-card to-card',
    guaranteedWin: true,
  },
  {
    id: 'level-2',
    label: '关卡 2',
    title: '补给线巡航',
    description: '继续留在低压环境，但开始要求你稳定处理两轮资源分配。',
    detail: '通过关卡 1 后开放，仍属于 EASY 强度，用来巩固开局与波中节奏。',
    unlockHint: '通关关卡 1 后开放',
    difficulty: 'EASY',
    icon: Shield,
    panelClass: 'border-slate/30 bg-gradient-to-br from-slate/16 via-card to-card',
  },
  {
    id: 'level-3',
    label: '关卡 3',
    title: '双路磨合',
    description: '开始引入更真实的资源交换，要求玩家熟悉棋盘就近操作卡的取舍。',
    detail: '通过关卡 2 后开放，对应 NORMAL 难度的正式起点。',
    unlockHint: '通关关卡 2 后开放',
    difficulty: 'NORMAL',
    icon: Target,
    panelClass: 'border-cold-blue/30 bg-gradient-to-br from-cold-blue/16 via-card to-card',
  },
  {
    id: 'level-4',
    label: '关卡 4',
    title: '裂隙前哨',
    description: '双路与波中决策一起施压，开始要求更清晰的目标优先级。',
    detail: '通过关卡 3 后开放，仍属于 NORMAL 强度的后段。',
    unlockHint: '通关关卡 3 后开放',
    difficulty: 'NORMAL',
    icon: Target,
    panelClass: 'border-cold-blue/30 bg-gradient-to-br from-cold-blue/16 via-card to-card',
  },
  {
    id: 'level-5',
    label: '关卡 5',
    title: '主战场前夜',
    description: '污染、维修与改路开始叠压，是进入主线强度前的过渡关。',
    detail: '通过关卡 4 后开放，对应 HARD 难度。',
    unlockHint: '通关关卡 4 后开放',
    difficulty: 'HARD',
    icon: Flame,
    panelClass: 'border-warning-orange/30 bg-gradient-to-br from-warning-orange/14 via-card to-card',
  },
  {
    id: 'level-6',
    label: '关卡 6',
    title: '灰烬断层',
    description: '主线高压关卡，要求稳定处理中后期热度、占地和建筑升级节奏。',
    detail: '通过关卡 5 后开放，属于 HARD 后段压力测试。',
    unlockHint: '通关关卡 5 后开放',
    difficulty: 'HARD',
    icon: Flame,
    panelClass: 'border-warning-orange/30 bg-gradient-to-br from-warning-orange/14 via-card to-card',
  },
  {
    id: 'endless',
    label: '无尽终局',
    title: '零域裁决',
    description: '最终关卡，敌潮无尽拉长，要求完整构筑、稳定节奏与更严格的资源控制。',
    detail: '通过关卡 6 后开放，这是最后一张关卡卡，也是当前版本的终局入口。',
    unlockHint: '通关关卡 6 后开放',
    difficulty: 'HELL',
    icon: Gauge,
    panelClass: 'border-alert-red/30 bg-gradient-to-br from-alert-red/16 via-card to-card',
  },
]

const initialStageCompletion: StageCompletionState = {
  tutorial: false,
  'level-1': false,
  'level-2': false,
  'level-3': false,
  'level-4': false,
  'level-5': false,
  'level-6': false,
  endless: false,
}

const tutorialSteps: TutorialStep[] = [
  {
    title: '步骤 1: 先点选地图格子',
    detail: '点击地图上的任意可建造格，熟悉战场选中与视角焦点。',
  },
  {
    title: '步骤 2: 使用就近操作卡',
    detail: '点开格子旁的小型操作卡，直接执行一个可用动作。',
  },
  {
    title: '步骤 3: 再完成一次场上交互',
    detail: '重新点选地块或建筑，再通过就近操作卡完成一次动作，结束教学。',
  },
]

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
    { id: 'zone3-5', zone: 3, index: 5, type: 'camp', title: '废墟营地', modifier: '可重整 1 处建筑布局' },
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
    { path: '回廊 -> 精英 -> 商店', reward: '更快成型主轴建筑', cost: '中局压力提高', risk: '双路同时爆线' },
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
    { path: '熔穿外圈 -> 高热朝圣团 -> 熔穿主脑', reward: '更多维修点和金币', cost: '精英压力更重', risk: '核心建筑会持续承压' },
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
    description: '适合建立基础建筑循环，敌潮密度与资源压力都较低。',
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

function parseStoredStageCompletion(raw: string | null): StageCompletionState {
  if (!raw) {
    return initialStageCompletion
  }

  try {
    const parsed = JSON.parse(raw) as Partial<Record<StageId, boolean>>
    return {
      tutorial: Boolean(parsed.tutorial),
      'level-1': Boolean(parsed['level-1']),
      'level-2': Boolean(parsed['level-2']),
      'level-3': Boolean(parsed['level-3']),
      'level-4': Boolean(parsed['level-4']),
      'level-5': Boolean(parsed['level-5']),
      'level-6': Boolean(parsed['level-6']),
      endless: Boolean(parsed.endless),
    }
  } catch {
    return initialStageCompletion
  }
}

function buildStageStates(stageCompletion: StageCompletionState): Record<StageId, StageState> {
  return stageDefinitions.reduce((states, stage, index) => {
    const previousStage = stageDefinitions[index - 1]
    states[stage.id] = {
      unlocked: index === 0 ? true : stageCompletion[previousStage.id],
      completed: stageCompletion[stage.id],
    }
    return states
  }, {} as Record<StageId, StageState>)
}

function getStageDefinition(stageId: StageId) {
  return stageDefinitions.find((item) => item.id === stageId) ?? stageDefinitions[0]
}

function parseWaveFromLabel(label: string) {
  const match = label.match(/Wave\s+(\d+)/i)
  return match ? Number(match[1]) : 1
}

function buildRouteNodesForRun(difficulty: Difficulty): RouteNodeState[] {
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
        detail: `Tick ${event.tick}，棋盘交互已刷新。`,
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
      return { gold: 12, heat: 8, mana: 10, repair: 5, threat: 10, fortress: 100 }
    case 'NORMAL':
      return { gold: 10, heat: 12, mana: 9, repair: 4, threat: 14, fortress: 96 }
    case 'HARD':
      return { gold: 9, heat: 16, mana: 8, repair: 4, threat: 18, fortress: 92 }
    case 'HELL':
      return { gold: 8, heat: 20, mana: 7, repair: 3, threat: 24, fortress: 88 }
    default:
      return { gold: 10, heat: 12, mana: 9, repair: 4, threat: 14, fortress: 96 }
  }
}

function buildScenario(difficulty: Difficulty, stageId?: StageId): CoreRunScenario {
  const meta = difficultyMeta[difficulty]
  const resources = buildBaseResources(difficulty)
  const routeNodes = buildRouteNodesForRun(difficulty)
  const currentNode = routeNodes.find((node) => node.active)?.title ?? routeNodes[0]?.title ?? '区域开局'

  const scenario: CoreRunScenario = {
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
      { id: 'queue-start-1', label: '先补第一座建筑', eta: '本窗口', reason: '优先决定这一局的主轴构筑。' },
      { id: 'queue-start-2', label: '保住维修点', eta: '首个战斗节点前', reason: '后续会需要维修去污和波后补堡。' },
    ],
    objectiveStack: [
      { label: '站稳开局', detail: '先建立至少 2 座建筑，避免第一轮漏怪。', severity: 'critical' },
      { label: '留法能', detail: '尽量保留至少 2 点法能给首个波中主动动作。', severity: 'warning' },
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

  if (stageId === 'tutorial') {
    return {
      ...scenario,
      title: '教学关卡 / 零压演练',
      zoneName: '教学扇区 / 零压训练场',
      waveLabel: 'Wave 0 / 基础训练',
      currentNode: '基础操作训练',
      maxTicks: 1200,
      fortressIntegrity: 100,
      maintenanceDebt: 0,
      routePressure: '本关会按顺序教学地图点选与就近操作卡交互。每一步都需要你亲手完成一次。',
      routeNodes: [
        { id: 'tutorial-1', zone: 0, index: 1, type: 'camp', title: '基础操作训练', modifier: '无失败压力，专注完成操作。', cleared: false, active: true },
      ],
      buildQueue: [
        { id: 'tutorial-queue-1', label: '先选中一个格子', eta: '立即', reason: '熟悉地图交互和目标锁定。' },
        { id: 'tutorial-queue-2', label: '再执行一次动作', eta: '立即', reason: '确认你会使用棋盘上的就近操作卡。' },
      ],
      objectiveStack: [
        { label: '完成教学步骤', detail: '依次完成地图点选和两次就近操作卡交互。', severity: 'critical' },
        { label: '观察反馈', detail: '留意右侧战报和顶部提示对你的即时反馈。', severity: 'info' },
      ],
      resources: {
        ...scenario.resources,
        gold: 14,
        heat: 0,
        mana: 12,
        repair: 8,
        threat: 0,
        fortress: 100,
      },
    }
  }

  if (stageId === 'level-1') {
    return {
      ...scenario,
      title: '关卡 1 / 新兵巡检线',
      zoneName: '区域 1 / 新手防线',
      waveLabel: 'Wave 1 / 演示入侵',
      currentNode: '新兵巡检线',
      maxTicks: 1600,
      fortressIntegrity: 100,
      maintenanceDebt: 0,
      routePressure: '这是首个正式关卡。资源和容错被大幅放宽，目标是确保玩家稳定完成第一次通关。',
      buildQueue: [
        { id: 'level-1-queue-1', label: '先补两座基础建筑', eta: '开局', reason: '本关敌潮很轻，优先熟悉建造节奏。' },
        { id: 'level-1-queue-2', label: '保留法能和维修点', eta: '波中', reason: '为第一次动作提交预留充分容错。' },
      ],
      objectiveStack: [
        { label: '稳稳通关', detail: '本关通过率设定为 100%，专注体验完整流程即可。', severity: 'critical' },
        { label: '熟悉节奏', detail: '观察波次、资源和战报如何互相影响。', severity: 'info' },
      ],
      resources: {
        ...scenario.resources,
        gold: 760,
        heat: 0,
        mana: 110,
        repair: 10,
        threat: 4,
        fortress: 100,
      },
    }
  }

  return scenario
}

function buildSnapshots(difficulty: Difficulty, stageId?: StageId) {
  const scenario = buildScenario(difficulty, stageId)
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
      ...(readySlot.actionType === 'BUILD' && readySlot.targetId ? { core: readySlot.targetId } : {}),
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
  const { agents, isUsingFallback: isAgentsFallback } = useAgentsData()
  const [progress, setProgress] = useState<PlayerDifficultyProgress[]>(initialProgress)
  const [stageCompletion, setStageCompletion] = useState<StageCompletionState>(initialStageCompletion)
  const [selectedDifficulty, setSelectedDifficulty] = useState<Difficulty>('EASY')
  const [selectedStageId, setSelectedStageId] = useState<StageId>('tutorial')
  const [tutorialStepIndex, setTutorialStepIndex] = useState(0)
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

  const stageStates = useMemo(() => buildStageStates(stageCompletion), [stageCompletion])
  const selectedStage = useMemo(() => getStageDefinition(selectedStageId), [selectedStageId])
  const resolvedDifficulty = selectedDifficulty
  const activeAgent = useMemo(
    () => agents.find((agent) => agent.status === 'active') ?? agents[0] ?? null,
    [agents],
  )
  const battleScenario = useMemo(
    () => buildScenario(resolvedDifficulty, selectedStageId),
    [resolvedDifficulty, selectedStageId],
  )
  const battleSnapshots = useMemo(
    () => buildSnapshots(resolvedDifficulty, selectedStageId),
    [resolvedDifficulty, selectedStageId],
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
  const selectedTowerQuickActions = selectedTowerId
    ? activeBattleScenario.towers.find((tower) => tower.id === selectedTowerId)?.quickActions ?? []
    : []
  const activeQuickActions = selectedTowerQuickActions.length > 0
    ? selectedTowerQuickActions
    : activeBattleScenario.actionWindow.quickActions
  const effectiveSelectedActionId = activeQuickActions.some((item) => item.actionId === selectedActionId && item.availability === 'ready')
    ? selectedActionId
    : findFirstReadyActionId(activeBattleScenario)
  const localLastAction = localBattle?.summary.lastAction
  const localPhase = localObservation?.phase ?? null
  const localPhaseState = localObservation?.phase_state ?? null
  const isRunFinished = activeBattleScenario.currentTick >= activeBattleScenario.maxTicks || activeBattleScenario.resources.fortress <= 0
  const isTutorialRun = hasStarted && selectedStageId === 'tutorial' && battleMode === 'local'
  const activeTutorialStep = isTutorialRun ? tutorialSteps[tutorialStepIndex] ?? null : null
  const isRunVictory = selectedStage.guaranteedWin
    ? isRunFinished
    : activeBattleScenario.resources.fortress > 0 && activeBattleScenario.currentTick >= activeBattleScenario.maxTicks
  const currentTick =
    timelineState.difficulty === resolvedDifficulty && timelineState.tick !== null
      ? timelineState.tick
      : activeBattleScenario.currentTick

  useEffect(() => {
    const storedProgress = parseStoredProgress(window.localStorage.getItem(progressStorageKey))
    const storedStageCompletion = parseStoredStageCompletion(window.localStorage.getItem(stageProgressStorageKey))
    queueMicrotask(() => {
      setProgress(storedProgress)
      setStageCompletion(storedStageCompletion)
    })
  }, [])

  useEffect(() => {
    window.localStorage.setItem(progressStorageKey, JSON.stringify(progress))
  }, [progress])

  useEffect(() => {
    window.localStorage.setItem(stageProgressStorageKey, JSON.stringify(stageCompletion))
  }, [stageCompletion])

  const completeTutorial = useCallback(() => {
    setStageCompletion((current) => ({
      ...current,
      tutorial: true,
    }))
    setTutorialStepIndex(0)
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
    setSelectedStageId('level-1')
    setSelectedDifficulty('EASY')
    setTimelineState({ difficulty: 'EASY', tick: null })
    toast.success('教学完成，已解锁关卡 1', {
      description: '现在可以直接选择 Agent play 或 Human play 进入第一关。',
    })
  }, [])

  const handleStartGame = (stageId: StageId) => {
    const stage = getStageDefinition(stageId)
    const stageState = stageStates[stageId]

    if (!stageState?.unlocked) {
      return
    }

    setSelectedStageId(stageId)
    setSelectedDifficulty(stage.difficulty)

    const simulator = createSimulator({
      scenario: buildScenario(stage.difficulty, stageId),
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
    setSelectedActionId(stageId === 'tutorial' ? null : findFirstReadyActionId(observation.scenario))
    setSelectedCell(stageId === 'tutorial' ? null : findDefaultBuildCell(observation.scenario.cells))
    setSelectedTowerId(null)
    setTutorialStepIndex(0)
    setTimelineState({ difficulty: stage.difficulty, tick: observation.tick })
    setHasStarted(true)
  }

  const handleStartOnlineGame = useCallback(async (stageId: StageId) => {
    const stage = getStageDefinition(stageId)
    const stageState = stageStates[stageId]

    if (!stageState?.unlocked || !activeAgent || isAgentsFallback) {
      return
    }

    setSelectedStageId(stageId)
    setSelectedDifficulty(stage.difficulty)

    setIsStartingOnline(true)
    const result = await enqueueRun({
      agentId: activeAgent.id,
      difficulty: stage.difficulty,
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
    setSelectedCell(findDefaultBuildCell(buildScenario(stage.difficulty, stageId).cells))
    setSelectedTowerId(null)
    setTutorialStepIndex(0)
    setTimelineState({ difficulty: stage.difficulty, tick: null })
    setHasStarted(true)

    toast.success('在线 Run 已创建', {
      description: `${activeAgent.name} / ${result.data.runCode}`,
    })
  }, [activeAgent, isAgentsFallback, stageStates])

  const handleAdvanceSimulation = useCallback(async (actionId = effectiveSelectedActionId) => {
    if (isTutorialRun) {
      if (tutorialStepIndex === 0) {
        toast.info('先完成地图点选', {
          description: '请先点击地图上的任意可建造格。',
        })
        return
      }
    }

    if (battleMode === 'remote') {
      const selectedSlot = activeQuickActions.find((item) => item.actionId === actionId)
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
            ...(selectedSlot.actionType === 'BUILD' && selectedSlot.targetId ? { core: selectedSlot.targetId } : {}),
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

    const selectedSlot = activeQuickActions.find((item) => item.actionId === actionId)
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

    if (isTutorialRun && tutorialStepIndex === 1) {
      setTutorialStepIndex(2)
      toast.success('首次交互完成', {
        description: '再选一次地块或建筑，并用就近操作卡完成最后一步。',
      })
    } else if (isTutorialRun && tutorialStepIndex === 2) {
      queueMicrotask(() => completeTutorial())
    }
  }, [activeBattleScenario, activeQuickActions, battleMode, completeTutorial, effectiveSelectedActionId, isTutorialRun, localBattle, remoteRunId, resolvedDifficulty, selectedCell, selectedTowerId, tutorialStepIndex])

  const handleTriggerAction = useCallback((actionId: string) => {
    setSelectedActionId(actionId)
    void handleAdvanceSimulation(actionId)
  }, [handleAdvanceSimulation])

  const handleCompleteRun = () => {
    const currentWave = parseWaveFromLabel(activeBattleScenario.waveLabel)
    if (isRunVictory) {
      setStageCompletion((current) => ({
        ...current,
        [selectedStageId]: true,
      }))
    }

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
                clear_rate: Math.max(item.clear_rate, selectedStage.guaranteedWin ? 1 : isRunVictory ? 0.6 : 0.2),
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
    setTutorialStepIndex(0)
    setHasStarted(false)
    setTimelineState({ difficulty: resolvedDifficulty, tick: activeBattleScenario.currentTick })
  }

  if (!hasStarted) {
    return (
      <MainLayout title="开始游戏" subtitle="从教学关卡开始，选择 Agent play 或 Human play 直接进入战斗">
        <div>
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:auto-rows-fr xl:grid-cols-4">
              {stageDefinitions.map((stage) => {
                const status = stageStates[stage.id]
                const Icon = stage.icon
                const isSelected = stage.id === selectedStageId

                return (
                  <div
                    key={stage.id}
                    onClick={() => {
                      if (!status.unlocked) {
                        return
                      }

                      setSelectedStageId(stage.id)
                      setSelectedDifficulty(stage.difficulty)
                      setTimelineState({ difficulty: stage.difficulty, tick: null })
                    }}
                    role="button"
                    tabIndex={status.unlocked ? 0 : -1}
                    onKeyDown={(event) => {
                      if (!status.unlocked) {
                        return
                      }

                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setSelectedStageId(stage.id)
                        setSelectedDifficulty(stage.difficulty)
                        setTimelineState({ difficulty: stage.difficulty, tick: null })
                      }
                    }}
                    className={cn(
                      'flex min-h-[214px] flex-col rounded-2xl border p-5 text-left transition-all xl:min-h-[calc((100vh-14rem)/2)]',
                      stage.panelClass,
                      status.unlocked ? 'hover:-translate-y-0.5 hover:border-primary/40' : 'cursor-not-allowed opacity-60',
                      isSelected && 'border-primary shadow-[0_0_0_1px_rgba(90,160,255,0.4)]',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-background/40">
                          <Icon className="h-5 w-5 text-foreground" />
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge variant={stage.tutorial ? 'info' : 'default'}>{stage.label}</StatusBadge>
                            {!stage.tutorial ? <DifficultyBadge difficulty={stage.difficulty} showLevel /> : null}
                          </div>
                          <p className="mt-2 text-sm font-medium">{stage.title}</p>
                        </div>
                      </div>
                      {!status.unlocked ? (
                        <Lock className="mt-1 h-4 w-4 text-muted-foreground" />
                      ) : status.completed ? (
                        <CheckCircle2 className="mt-1 h-4 w-4 text-acid-green" />
                      ) : (
                        <Play className="mt-1 h-4 w-4 text-primary" />
                      )}
                    </div>

                    <div className="mt-auto space-y-3 pt-4">
                      <Button
                        className="w-full gap-2"
                        size="lg"
                        disabled={!status.unlocked}
                        onClick={(event) => {
                          event.stopPropagation()
                          handleStartGame(stage.id)
                        }}
                      >
                        <Play className="h-4 w-4" />
                        Human play
                      </Button>
                      <Button
                        variant="outline"
                        className="w-full gap-2"
                        size="lg"
                        disabled={!status.unlocked || !activeAgent || isAgentsFallback || isStartingOnline}
                        onClick={(event) => {
                          event.stopPropagation()
                          void handleStartOnlineGame(stage.id)
                        }}
                      >
                        <Bot className="h-4 w-4" />
                        {isStartingOnline && selectedStageId === stage.id ? '创建在线 Run...' : 'Agent play'}
                      </Button>
                    </div>
                  </div>
                )
              })}
          </section>
        </div>
      </MainLayout>
    )
  }

  return (
    <MainLayout title="开始游戏" subtitle={`${selectedStage.label} / ${activeBattleScenario.title}`}>
      <div className="space-y-4">
        {activeTutorialStep ? (
          <div className="rounded-2xl border border-primary/30 bg-primary/10 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge variant="info">教学进行中</StatusBadge>
                  <span className="text-xs text-muted-foreground">{tutorialStepIndex + 1}/{tutorialSteps.length}</span>
                </div>
                <h2 className="mt-3 text-lg font-semibold">{activeTutorialStep.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{activeTutorialStep.detail}</p>
              </div>
              <div className="rounded-xl border border-primary/20 bg-background/40 px-4 py-3 text-sm text-muted-foreground">
                完成全部教学步骤后，系统会自动解锁并选中关卡 1。
              </div>
            </div>
          </div>
        ) : null}

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
              setTutorialStepIndex(0)
              setHasStarted(false)
            }}>
              <RotateCcw className="h-4 w-4" />
              返回关卡选择
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              disabled
            >
              <TimerReset className="h-4 w-4" />
              点击棋盘格子打开交互
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
            当前规则版本 {activeBattleScenario.rulesVersion}。支持建筑 {activeBattleScenario.supportedTowerCores.map((type) => getBuildingLabel(type)).join(' / ')}，{battleMode === 'remote' ? '在线模式会持续从 Supabase 回流当前 run 快照。' : '完成本局后会写入通关记录，并在准备界面逐级开放下一档。'}
          </div>
        </div>

        <CoreMap
          cells={activeBattleScenario.cells}
          towers={activeBattleScenario.towers}
          enemies={activeBattleScenario.enemies}
          selectedCell={selectedCell}
          selectedTowerId={selectedTowerId}
          onCellSelect={(cell: CoreMapCell, tower) => {
            setSelectedCell({ x: cell.x, y: cell.y })
            setSelectedTowerId(tower?.id ?? null)

            if (isTutorialRun && tutorialStepIndex === 0 && cell.kind === 'build') {
              setTutorialStepIndex(1)
              toast.success('已完成地图点选', {
                description: '下一步请在格子旁出现的操作卡里直接执行一个动作。',
              })
            }
          }}
          interactionWindow={{
            label: activeBattleScenario.actionWindow.label,
            summary: activeBattleScenario.actionWindow.summary,
            deadlineTick: localPhaseState?.deadline_tick ?? activeBattleScenario.currentTick,
            quickActions: activeQuickActions,
            options: activeBattleScenario.actionWindow.options,
            activeActionId: effectiveSelectedActionId,
            isBusy: battleMode === 'remote' ? isSubmittingRemote || isLiveBattleFallback || !remoteRunId : !localBattle,
            isRunFinished,
            onActionTrigger: handleTriggerAction,
          }}
          showIntel={false}
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
              <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">当前阶段</p>
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