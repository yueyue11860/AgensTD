'use client'

import { useEffect, useMemo, useState } from 'react'
import { MainLayout } from '@/components/layout/main-layout'
import { CoreMap } from '@/components/game/core-map'
import { HardcoreResourcesPanel } from '@/components/game/resource-bar'
import { Timeline } from '@/components/game/timeline'
import { DifficultyBadge, StatusBadge } from '@/components/game/status-badge'
import { TacticalPanel } from '@/components/ui/tactical-panel'
import { useLiveRun } from '@/hooks/use-live-run'
import {
  mockCoreScenario,
  mockCoreSnapshots,
} from '@/lib/mock-data'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Clock3,
  Flame,
  GitBranch,
  Hammer,
  ShieldAlert,
  Skull,
  Sparkles,
  TimerReset,
  Wrench,
} from 'lucide-react'

export default function SpectatePage() {
  const { scenario, snapshots, isUsingFallback, error } = useLiveRun({
    fallbackScenario: mockCoreScenario,
    fallbackSnapshots: mockCoreSnapshots,
  })
  const [currentTickOverride, setCurrentTickOverride] = useState<{ scenarioKey: string; tick: number } | null>(null)
  const [selectedOption, setSelectedOption] = useState<string | null>(mockCoreScenario.actionWindow.options[0]?.id ?? null)
  const [lastCommittedActionId, setLastCommittedActionId] = useState<string | null>(null)

  const scenarioKey = `${scenario.runId ?? 'fallback'}:${scenario.currentTick}`
  const currentTick = currentTickOverride?.scenarioKey === scenarioKey
    ? currentTickOverride.tick
    : scenario.currentTick
  const actionSlots = useMemo(() => scenario.actionWindow.quickActions, [scenario.actionWindow.quickActions])
  const activeSelectedOption = scenario.actionWindow.options.some((option) => option.id === selectedOption)
    ? selectedOption
    : scenario.actionWindow.options[0]?.id ?? null

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toUpperCase()

      if (!['Q', 'W', 'E', 'R'].includes(key)) {
        return
      }

      const slot = actionSlots.find((item) => item.key === key)

      if (!slot || slot.availability !== 'ready') {
        return
      }

      event.preventDefault()
      setSelectedOption(slot.actionId)
      setLastCommittedActionId(slot.actionId)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [actionSlots])

  const nodeTypeStyle = {
    combat: 'border-border bg-card text-foreground',
    elite: 'border-alert-red/35 bg-alert-red/10 text-alert-red',
    shop: 'border-cold-blue/35 bg-cold-blue/10 text-cold-blue',
    event: 'border-warning-orange/35 bg-warning-orange/10 text-warning-orange',
    camp: 'border-acid-green/35 bg-acid-green/10 text-acid-green',
    boss: 'border-alert-red/45 bg-gradient-to-r from-alert-red/12 to-warning-orange/12 text-warning-orange',
  } as const

  return (
    <MainLayout title="硬核战场">
      <div className="space-y-6">
        {(isUsingFallback || error) && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4">
            <StatusBadge variant={error ? 'warning' : 'info'}>
              {error ? 'Supabase 查询失败，观战页已回退到 mock 数据' : '当前没有在线对局，观战页展示 mock 数据'}
            </StatusBadge>
          </div>
        )}

        <div className="rounded-xl border border-border bg-card/95 p-5 shadow-[0_0_40px_rgba(0,0,0,0.2)]">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge variant="live">危机窗口进行中</StatusBadge>
                <DifficultyBadge difficulty={scenario.difficulty} showLevel />
                <StatusBadge variant="warning">维护债务 {scenario.maintenanceDebt}</StatusBadge>
              </div>
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">{scenario.title}</h2>
                <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                  {scenario.zoneName} · {scenario.currentNode} · {scenario.routePressure}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4 text-primary" />
                  <span>{scenario.agentName}</span>
                </div>
                <div className="flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-cold-blue" />
                  <span className="font-mono">SEED {scenario.seed}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock3 className="h-4 w-4 text-warning-orange" />
                  <span>{scenario.waveLabel}</span>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[430px] xl:grid-cols-4">
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">积分</p>
                <p className="mt-1 text-2xl font-semibold text-warning-orange">{scenario.score.toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">主堡完整度</p>
                <p className="mt-1 text-2xl font-semibold text-alert-red">{scenario.fortressIntegrity}%</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">当前 Tick</p>
                <p className="mt-1 text-2xl font-semibold text-foreground">{currentTick.toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">路径压强</p>
                <p className="mt-1 text-sm font-semibold text-cold-blue">三路汇流</p>
              </div>
            </div>
          </div>
        </div>

        <TacticalPanel title="区域推进" statusLight="active">
          <div className="grid gap-3 p-4 md:grid-cols-3 xl:grid-cols-6">
            {scenario.routeNodes.map((node) => (
              <div
                key={node.id}
                className={cn(
                  'relative rounded-lg border p-3 transition-colors',
                  nodeTypeStyle[node.type],
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

        <div className="grid gap-6 2xl:grid-cols-[minmax(0,1.65fr)_minmax(360px,0.95fr)]">
          <div className="space-y-6">
            <CoreMap cells={scenario.cells} towers={scenario.towers} enemies={scenario.enemies} />

            <Timeline
              snapshots={snapshots}
              currentTick={currentTick}
              maxTicks={scenario.maxTicks}
              onSeek={(tick) => setCurrentTickOverride({ scenarioKey, tick })}
            />

            <TacticalPanel title="快照节点" statusLight="active">
              <div className="grid gap-3 p-4 md:grid-cols-2">
                {snapshots.map((snapshot) => (
                  <div key={snapshot.tick} className="rounded-lg border border-border bg-card p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-foreground">Tick {snapshot.tick.toLocaleString()}</span>
                      <span className="rounded border border-border bg-muted/30 px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                        Wave {snapshot.game_state.wave}
                      </span>
                    </div>
                    <div className="mt-2 grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-2">
                      <p>积分：{snapshot.game_state.score.toLocaleString()}</p>
                      <p>资源：{snapshot.game_state.resources.gold} 金</p>
                    </div>
                  </div>
                ))}
              </div>
            </TacticalPanel>
          </div>

          <div className="space-y-6">
            <HardcoreResourcesPanel resources={scenario.resources} />

            <TacticalPanel title="危机决策窗口" variant="danger" statusLight="warning">
              <div className="space-y-4 p-4">
                <div className="rounded-lg border border-warning-orange/25 bg-warning-orange/5 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <TimerReset className="h-4 w-4 text-warning-orange" />
                    <span className="text-xs uppercase tracking-[0.2em] text-warning-orange">决策摘要</span>
                  </div>
                  <p className="text-sm leading-relaxed text-foreground">{scenario.actionWindow.summary}</p>
                  <p className="mt-2 text-[11px] text-muted-foreground">剩余决策时间 {scenario.actionWindow.deadlineMs} ms</p>
                </div>

                <div className="space-y-2">
                  {scenario.actionWindow.options.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setSelectedOption(option.id)}
                      className={cn(
                        'w-full rounded-lg border p-3 text-left transition-colors',
                        activeSelectedOption === option.id
                          ? 'border-primary bg-primary/10'
                          : 'border-border bg-card hover:bg-muted/30',
                        option.locked && 'cursor-not-allowed opacity-45'
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-semibold text-foreground">
                              {actionSlots.find((slot) => slot.actionId === option.id)?.key ?? '-'}
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
                  ))}
                </div>

                <div className="rounded-lg border border-border bg-card p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">全局动作槽</span>
                    <span className="text-[10px] text-muted-foreground">Q/W/E/R 直接锁定危机选项</span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {actionSlots.map((slot) => (
                      <div
                        key={slot.actionId}
                        className={cn(
                          'rounded border p-2',
                          slot.availability === 'ready' && 'border-primary/30 bg-primary/5',
                          slot.availability === 'cooldown' && 'border-warning-orange/30 bg-warning-orange/5',
                          slot.availability === 'locked' && 'border-border bg-muted/20 opacity-70',
                          activeSelectedOption === slot.actionId && 'ring-1 ring-primary'
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
                      </div>
                    ))}
                  </div>
                  {lastCommittedActionId ? (
                    <p className="mt-2 text-[11px] text-primary">最近通过快捷键锁定：{actionSlots.find((slot) => slot.actionId === lastCommittedActionId)?.label}</p>
                  ) : null}
                </div>

                <Button className="w-full justify-between">
                  提交当前动作
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </TacticalPanel>

            <TacticalPanel title="构筑状态" statusLight="active">
              <div className="space-y-4 p-4">
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-cold-blue" />
                    <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">当前遗物</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {scenario.relics.map((relic) => (
                      <span key={relic} className="rounded border border-cold-blue/30 bg-cold-blue/10 px-2 py-1 text-[11px] text-cold-blue">
                        {relic}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <Hammer className="h-4 w-4 text-warning-orange" />
                    <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">改造队列</span>
                  </div>
                  <div className="space-y-2">
                    {scenario.buildQueue.map((item) => (
                      <div key={item.id} className="rounded-lg border border-border bg-card p-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium">{item.label}</p>
                          <span className="rounded border border-border bg-muted/30 px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                            {item.eta}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground">{item.reason}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </TacticalPanel>

            <TacticalPanel title="路线预演" statusLight="warning">
              <div className="space-y-3 p-4">
                {scenario.routeForecast.map((route) => (
                  <div key={route.path} className="rounded-lg border border-border bg-card p-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <GitBranch className="h-4 w-4 text-primary" />
                      {route.path}
                    </div>
                    <div className="mt-2 grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-3">
                      <p>收益：{route.reward}</p>
                      <p>代价：{route.cost}</p>
                      <p className="text-alert-red">风险：{route.risk}</p>
                    </div>
                  </div>
                ))}
              </div>
            </TacticalPanel>

            <TacticalPanel title="即时目标栈" variant="bordered" statusLight="error">
              <div className="space-y-3 p-4">
                {scenario.objectiveStack.map((item) => (
                  <div key={item.label} className="rounded-lg border border-border bg-card p-3">
                    <div className="flex items-center gap-2">
                      {item.severity === 'critical' ? (
                        <AlertTriangle className="h-4 w-4 text-alert-red" />
                      ) : item.severity === 'warning' ? (
                        <Flame className="h-4 w-4 text-warning-orange" />
                      ) : (
                        <Wrench className="h-4 w-4 text-cold-blue" />
                      )}
                      <p className="text-sm font-medium">{item.label}</p>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">{item.detail}</p>
                  </div>
                ))}
                <div className="rounded-lg border border-alert-red/25 bg-alert-red/5 p-3 text-[11px] text-muted-foreground">
                  <div className="mb-1 flex items-center gap-2 text-alert-red">
                    <ShieldAlert className="h-4 w-4" />
                    <span className="text-xs uppercase tracking-[0.2em]">失败条件提示</span>
                  </div>
                  当前局不是缺输出，而是转型成本正在失控。继续贪输出会导致 Boss 节点无路可改。
                </div>
                <div className="rounded-lg border border-warning-orange/25 bg-warning-orange/5 p-3 text-[11px] text-muted-foreground">
                  <div className="mb-1 flex items-center gap-2 text-warning-orange">
                    <Skull className="h-4 w-4" />
                    <span className="text-xs uppercase tracking-[0.2em]">反构筑警报</span>
                  </div>
                  余烬巨像会封锁模块槽，当前高热构筑若不降温，二阶段会直接丢失主输出闭环。
                </div>
              </div>
            </TacticalPanel>
          </div>
        </div>
      </div>
    </MainLayout>
  )
}
