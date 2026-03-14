'use client'

import { MainLayout } from '@/components/layout/main-layout'
import { DifficultyBadge, StatusBadge } from '@/components/game/status-badge'
import { Button } from '@/components/ui/button'
import { useAgentProgress } from '@/hooks/use-agent-progress'
import { useAgentsData } from '@/hooks/use-agents-data'
import { cn } from '@/lib/utils'
import type { Difficulty } from '@/lib/domain'
import {
  Lock,
  Unlock,
  Trophy,
  Target,
  TrendingUp,
  ChevronRight,
  Play,
  Star,
  Flame,
  Shield,
} from 'lucide-react'

const difficultyIcons: Record<Difficulty, typeof Shield> = {
  EASY: Shield,
  NORMAL: Shield,
  HARD: Target,
  HELL: Flame,
}

const difficultyColors: Record<Difficulty, string> = {
  EASY: 'from-slate/20 to-slate/5 border-slate/30',
  NORMAL: 'from-cold-blue/20 to-cold-blue/5 border-cold-blue/30',
  HARD: 'from-warning-orange/20 to-warning-orange/5 border-warning-orange/30',
  HELL: 'from-alert-red/20 to-warning-orange/5 border-alert-red/30',
}

export default function ProgressPage() {
  const { agents, isUsingFallback: isAgentFallback, error: agentError } = useAgentsData()
  const selectedAgent = agents[0]
  const { progress, isUsingFallback: isProgressFallback, error: progressError } = useAgentProgress(selectedAgent?.id)

  const unlockedDifficulties = progress.filter((item) => item.unlocked)
  const clearedDifficulties = progress.filter((item) => item.cleared)
  const highestWave = unlockedDifficulties.length > 0 ? Math.max(...unlockedDifficulties.map((item) => item.best_wave)) : 0
  const totalBestScore = progress.reduce((acc, item) => acc + item.best_score, 0)

  return (
    <MainLayout title="难度进度">
      <div className="space-y-8">
        {(isAgentFallback || isProgressFallback || agentError || progressError) && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4">
            <StatusBadge variant={agentError || progressError ? 'warning' : 'info'}>
              {agentError || progressError ? 'Supabase 查询失败，已回退到 mock 进度' : '当前使用 mock 进度数据'}
            </StatusBadge>
          </div>
        )}

        {/* Agent Selector */}
        <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
              <Trophy className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h2 className="font-medium">{selectedAgent?.name ?? '暂无 Agent'}</h2>
              <p className="text-sm text-muted-foreground">
                v{selectedAgent?.version ?? '-'} | {selectedAgent?.total_runs ?? 0} 次运行
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-2xl font-bold">{(((selectedAgent?.win_rate ?? 0) * 100)).toFixed(1)}%</p>
              <p className="text-xs text-muted-foreground">总胜率</p>
            </div>
            <Button variant="outline" className="gap-2">
              切换 Agent
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Progress Overview */}
        <div className="grid gap-4 sm:grid-cols-4">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-acid-green/10">
              <Unlock className="h-5 w-5 text-acid-green" />
            </div>
            <div>
              <p className="text-2xl font-bold text-acid-green">
                {unlockedDifficulties.length}
              </p>
              <p className="text-xs text-muted-foreground">已解锁难度</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning-orange/10">
              <Star className="h-5 w-5 text-warning-orange" />
            </div>
            <div>
              <p className="text-2xl font-bold text-warning-orange">
                {clearedDifficulties.length}
              </p>
              <p className="text-xs text-muted-foreground">已通关难度</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Target className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {highestWave}
              </p>
              <p className="text-xs text-muted-foreground">最高波次</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cold-blue/10">
              <TrendingUp className="h-5 w-5 text-cold-blue" />
            </div>
            <div>
              <p className="text-2xl font-bold text-cold-blue">
                {totalBestScore.toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground">总最高分</p>
            </div>
          </div>
        </div>

        {/* Difficulty Cards */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {progress.map((progressItem) => {
            const Icon = difficultyIcons[progressItem.difficulty]
            const colorClass = difficultyColors[progressItem.difficulty]
            
            return (
              <div
                key={progressItem.difficulty}
                className={cn(
                  'relative overflow-hidden rounded-xl border bg-gradient-to-br p-6 transition-all',
                  colorClass,
                  !progressItem.unlocked && 'opacity-60'
                )}
              >
                {/* Lock Overlay */}
                {!progressItem.unlocked && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm">
                    <div className="text-center">
                      <Lock className="mx-auto h-8 w-8 text-muted-foreground" />
                      <p className="mt-2 text-sm text-muted-foreground">未解锁</p>
                    </div>
                  </div>
                )}

                {/* Header */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      'flex h-12 w-12 items-center justify-center rounded-xl',
                      progressItem.unlocked ? 'bg-background/50' : 'bg-muted/30'
                    )}>
                      <Icon className={cn(
                        'h-6 w-6',
                        progressItem.cleared ? 'text-acid-green' : 'text-foreground/70'
                      )} />
                    </div>
                    <div>
                      <DifficultyBadge difficulty={progressItem.difficulty} />
                      {progressItem.cleared && (
                        <div className="mt-1 flex items-center gap-1 text-xs text-acid-green">
                          <Star className="h-3 w-3 fill-current" />
                          <span>CLEARED</span>
                        </div>
                      )}
                    </div>
                  </div>
                  {progressItem.unlocked && !progressItem.cleared && (
                    <Button size="sm" className="gap-1">
                      <Play className="h-3 w-3" />
                      挑战
                    </Button>
                  )}
                </div>

                {/* Stats */}
                {progressItem.unlocked && (
                  <div className="mt-6 grid grid-cols-2 gap-4">
                    <div className="rounded-lg bg-background/30 p-3 text-center">
                      <p className="text-xl font-bold">{progressItem.best_wave}</p>
                      <p className="text-xs text-muted-foreground">最高波次</p>
                    </div>
                    <div className="rounded-lg bg-background/30 p-3 text-center">
                      <p className="text-xl font-bold">{progressItem.best_score.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">最高分</p>
                    </div>
                    <div className="rounded-lg bg-background/30 p-3 text-center">
                      <p className="text-xl font-bold">{progressItem.attempts}</p>
                      <p className="text-xs text-muted-foreground">尝试次数</p>
                    </div>
                    <div className="rounded-lg bg-background/30 p-3 text-center">
                      <p className={cn(
                        'text-xl font-bold',
                        progressItem.clear_rate >= 0.5 ? 'text-acid-green' : progressItem.clear_rate >= 0.25 ? 'text-warning-orange' : 'text-alert-red'
                      )}>
                        {(progressItem.clear_rate * 100).toFixed(0)}%
                      </p>
                      <p className="text-xs text-muted-foreground">通关率</p>
                    </div>
                  </div>
                )}

                {/* Requirements */}
                {!progressItem.unlocked && progressItem.requirements.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs text-muted-foreground mb-2">解锁条件:</p>
                    <ul className="space-y-1">
                      {progressItem.requirements.map((req, index) => (
                        <li key={index} className="flex items-center gap-2 text-sm text-muted-foreground">
                          <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
                          {req}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Progress Bar (for unlocked but not cleared) */}
                {progressItem.unlocked && !progressItem.cleared && (
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                      <span>通关进度</span>
                      <span>{progressItem.best_wave}/50 波</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-background/50">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${(progressItem.best_wave / 50) * 100}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Tips */}
        <div className="rounded-lg border border-border bg-card p-6">
          <h3 className="text-lg font-medium mb-4">进阶提示</h3>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-lg bg-muted/30 p-4">
              <Target className="h-6 w-6 text-cold-blue mb-2" />
              <h4 className="font-medium mb-1">优化策略</h4>
              <p className="text-sm text-muted-foreground">
                分析高排名 Agent 的回放，学习最佳建塔顺序和资源分配策略。
              </p>
            </div>
            <div className="rounded-lg bg-muted/30 p-4">
              <TrendingUp className="h-6 w-6 text-acid-green mb-2" />
              <h4 className="font-medium mb-1">持续迭代</h4>
              <p className="text-sm text-muted-foreground">
                使用调试面板观察 Agent 的决策过程，找出可以改进的地方。
              </p>
            </div>
            <div className="rounded-lg bg-muted/30 p-4">
              <Flame className="h-6 w-6 text-warning-orange mb-2" />
              <h4 className="font-medium mb-1">挑战极限</h4>
              <p className="text-sm text-muted-foreground">
                更高难度会带来更多变数，需要 Agent 具备更强的适应能力。
              </p>
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  )
}
