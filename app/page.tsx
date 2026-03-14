'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { MainLayout } from '@/components/layout/main-layout'
import { CoreMap } from '@/components/game/core-map'
import { HardcoreResourcesPanel } from '@/components/game/resource-bar'
import { Timeline } from '@/components/game/timeline'
import { DifficultyBadge, StatusBadge } from '@/components/game/status-badge'
import { useLiveRun } from '@/hooks/use-live-run'
import { TacticalPanel } from '@/components/ui/tactical-panel'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { GameSimulator, createSimulator } from '@/lib/game/simulator'
import { buildReplaySnapshot, buildRunResultSummary } from '@/lib/game/replay'
import { mockCoreScenario, mockCoreSnapshots, mockDifficultyProgress } from '@/lib/mock-data'
import type { CoreReplaySnapshot, CoreRunScenario, Difficulty, DifficultyProgress, GameAction, RunResultSummary } from '@/lib/domain'
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

const difficultyOrder: Difficulty[] = ['EASY', 'NORMAL', 'HARD', 'HELL']
const progressStorageKey = 'clawgame-main-battle-progress'

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
    waveLabel: 'Wave 11 / 侦察群压境',
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
    waveLabel: 'Wave 15 / 双路交汇',
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
    zoneName: mockCoreScenario.zoneName,
    waveLabel: mockCoreScenario.waveLabel,
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
    waveLabel: 'Wave 30 / 最终崩解',
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

function buildScenario(difficulty: Difficulty) {
  const meta = difficultyMeta[difficulty]
  const fortressIntegrity = Math.max(18, Math.min(100, mockCoreScenario.fortressIntegrity + meta.fortressDelta))
  const heat = Math.max(18, Math.min(mockCoreScenario.resources.heat_limit, mockCoreScenario.resources.heat + meta.heatDelta))
  const threat = Math.max(18, Math.min(100, mockCoreScenario.resources.threat + meta.threatDelta))

  return {
    ...mockCoreScenario,
    title: meta.scenarioName,
    difficulty,
    zoneName: meta.zoneName,
    waveLabel: meta.waveLabel,
    currentTick: Math.max(1200, Math.round(mockCoreScenario.currentTick * meta.tickScale)),
    score: Math.round(mockCoreScenario.score * meta.scoreScale),
    fortressIntegrity,
    maintenanceDebt: meta.maintenanceDebt,
    routePressure: `${meta.description} ${meta.unlockText}`,
    resources: {
      ...mockCoreScenario.resources,
      heat,
      threat,
      fortress: fortressIntegrity,
    },
  }
}

function buildSnapshots(difficulty: Difficulty) {
  const meta = difficultyMeta[difficulty]
  return mockCoreSnapshots.map((snapshot) => ({
    ...snapshot,
    tick: Math.max(0, Math.round(snapshot.tick * meta.tickScale)),
    game_state: {
      ...snapshot.game_state,
      score: Math.round(snapshot.game_state.score * meta.scoreScale),
      wave: Math.max(1, Math.round(snapshot.game_state.wave * meta.tickScale)),
      resources: {
        ...snapshot.game_state.resources,
        fortress: Math.max(1, Math.min(snapshot.game_state.resources.fortress_max, snapshot.game_state.resources.fortress + Math.floor(meta.fortressDelta / 2))),
      },
    },
  }))
}

function createSuggestedAction(scenario: CoreRunScenario, observationVersion: number): GameAction {
  const readySlot = scenario.actionWindow.quickActions.find((item) => item.availability === 'ready')

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
    target_id: readySlot.actionId,
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
}

export default function HomePage() {
  const [progress, setProgress] = useState<PlayerDifficultyProgress[]>(initialProgress)
  const [selectedDifficulty, setSelectedDifficulty] = useState<Difficulty>(getHighestUnlockedDifficulty(initialProgress))
  const [hasStarted, setHasStarted] = useState(false)
  const [localBattle, setLocalBattle] = useState<LocalBattleState | null>(null)
  const [timelineState, setTimelineState] = useState<{ difficulty: Difficulty | null; tick: number | null }>({
    difficulty: null,
    tick: null,
  })
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
    isUsingFallback: isLiveBattleFallback,
    error: liveBattleError,
  } = useLiveRun({
    difficulty: resolvedDifficulty,
    enabled: hasStarted,
    fallbackScenario: battleScenario,
    fallbackSnapshots: battleSnapshots,
  })
  const localObservation = localBattle?.summary.observation
  const activeBattleScenario = localObservation?.scenario ?? (hasStarted ? liveBattleScenario : battleScenario)
  const activeBattleSnapshots = localBattle?.snapshots ?? (hasStarted ? liveBattleSnapshots : battleSnapshots)
  const localLastAction = localBattle?.summary.lastAction
  const localPhase = localObservation?.phase ?? null
  const localPhaseState = localObservation?.phase_state ?? null
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
    setLocalBattle({
      summary,
      snapshots: [buildReplaySnapshot(observation.scenario, observation.phase, observation.observation_version)],
      lastActionLabel: null,
    })
    setTimelineState({ difficulty: resolvedDifficulty, tick: observation.tick })
    setHasStarted(true)
  }

  const handleAdvanceSimulation = () => {
    const simulator = simulatorRef.current
    const currentBattle = localBattle

    if (!simulator || !currentBattle) {
      return
    }

    const observation = currentBattle.summary.observation

    if (!observation) {
      return
    }

    const action = createSuggestedAction(observation.scenario, observation.observation_version)
    const result = simulator.step(action)
    const actionLabel = observation.scenario.actionWindow.quickActions.find((item) => item.actionId === action.target_id)?.label ?? action.action_type

    setLocalBattle((previous) => {
      if (!previous) {
        return previous
      }

      return {
        summary: result.summary,
        snapshots: [...previous.snapshots, result.snapshot].slice(-24),
        lastActionLabel: actionLabel,
      }
    })
    setTimelineState({ difficulty: resolvedDifficulty, tick: result.observation.tick })
  }

  const handleCompleteRun = () => {
    setProgress((current) =>
      deriveUnlocks(
        current.map((item) =>
          item.difficulty === resolvedDifficulty
            ? {
                ...item,
                cleared: true,
                best_score: Math.max(item.best_score, activeBattleScenario.score),
                best_wave: Math.max(item.best_wave, 50),
                attempts: item.attempts + 1,
                clear_rate: Math.max(item.clear_rate, 0.6),
              }
            : item,
        ),
      ),
    )
    simulatorRef.current = null
    setLocalBattle(null)
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
                    开始游戏
                  </Button>
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
              setHasStarted(false)
            }}>
              <RotateCcw className="h-4 w-4" />
              返回准备区
            </Button>
            <Button variant="outline" className="gap-2" onClick={handleAdvanceSimulation} disabled={!localBattle}>
              <TimerReset className="h-4 w-4" />
              推进一阶段
            </Button>
            <Button className="gap-2" onClick={handleCompleteRun}>
              <Trophy className="h-4 w-4" />
              完成本局并解锁下一难度
            </Button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-2xl border border-primary/15 bg-primary/8 px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.28em] text-primary">战场说明</p>
            <p className="mt-2 text-sm text-muted-foreground">{activeBattleScenario.routePressure}</p>
          </div>
          <div className="rounded-2xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            当前规则版本 {activeBattleScenario.rulesVersion}。支持塔核 {activeBattleScenario.supportedTowerCores.join(' / ')}，完成本局后会写入通关记录，并在准备界面逐级开放下一档。
          </div>
        </div>

        <CoreMap
          cells={activeBattleScenario.cells}
          towers={activeBattleScenario.towers}
          enemies={activeBattleScenario.enemies}
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
            <Timeline
              snapshots={activeBattleSnapshots}
              currentTick={currentTick}
              maxTicks={activeBattleScenario.maxTicks}
              onSeek={(tick) => setTimelineState({ difficulty: resolvedDifficulty, tick })}
            />

            <HardcoreResourcesPanel resources={activeBattleScenario.resources} />
          </div>

          <div className="space-y-6">
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