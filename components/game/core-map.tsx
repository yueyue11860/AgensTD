'use client'

import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import type { CoreDecisionOption, CoreEnemyWave, CoreMapCell, CoreQuickActionSlot, CoreTowerBuild, GridPoint } from '@/lib/domain'
import { AlertTriangle, Clock3, Crosshair, GitFork, RadioTower, Shield, Skull, Sparkles } from 'lucide-react'

interface CoreMapProps {
  cells: CoreMapCell[]
  towers: CoreTowerBuild[]
  enemies: CoreEnemyWave[]
  className?: string
  showIntel?: boolean
  fillViewport?: boolean
  showFrame?: boolean
  showHeader?: boolean
  layout?: 'square' | 'landscape'
  selectedCell?: GridPoint | null
  selectedTowerId?: string | null
  onCellSelect?: (cell: CoreMapCell, tower?: CoreTowerBuild) => void
  interactionWindow?: {
    label: string
    summary: string
    deadlineTick?: number
    quickActions: CoreQuickActionSlot[]
    options: CoreDecisionOption[]
    activeActionId?: string | null
    isBusy?: boolean
    isRunFinished?: boolean
    onActionTrigger: (actionId: string) => void
  }
}

const cellStyles: Record<CoreMapCell['kind'], string> = {
  path: 'bg-gunmetal/55 border-gunmetal/80',
  build: 'bg-slate/30 border-border/70 hover:bg-slate/45',
  blocked: 'bg-graphite border-border/40',
  relay: 'bg-cold-blue/10 border-cold-blue/40',
  gate: 'bg-warning-orange/10 border-warning-orange/40',
  core: 'bg-acid-green/10 border-acid-green/40',
  hazard: 'bg-alert-red/10 border-alert-red/35',
}

const towerStyles: Record<CoreTowerBuild['status'], string> = {
  ready: 'border-acid-green/50 bg-acid-green/10 text-acid-green',
  boosted: 'border-warning-orange/50 bg-warning-orange/10 text-warning-orange',
  charging: 'border-cold-blue/50 bg-cold-blue/10 text-cold-blue',
  disabled: 'border-alert-red/50 bg-alert-red/10 text-alert-red',
}

const threatStyles: Record<CoreEnemyWave['threat'], string> = {
  low: 'border-border bg-muted/60 text-foreground/80',
  medium: 'border-warning-orange/40 bg-warning-orange/10 text-warning-orange',
  high: 'border-alert-red/40 bg-alert-red/10 text-alert-red',
  boss: 'border-cold-blue/50 bg-cold-blue/10 text-cold-blue',
}

export function CoreMap({
  cells,
  towers,
  enemies,
  className,
  showIntel = true,
  fillViewport = false,
  showFrame = true,
  showHeader = true,
  layout = 'square',
  selectedCell,
  selectedTowerId,
  onCellSelect,
  interactionWindow,
}: CoreMapProps) {
  const [internalSelectedTowerId, setInternalSelectedTowerId] = useState<string | null>(towers[0]?.id ?? null)
  const [internalSelectedCell, setInternalSelectedCell] = useState<GridPoint | null>(null)

  const cellMap = useMemo(() => {
    return new Map(cells.map((cell) => [`${cell.x},${cell.y}`, cell]))
  }, [cells])
  const towerOccupancyMap = useMemo(() => {
    const map = new Map<string, { tower: CoreTowerBuild; isAnchor: boolean }>()

    towers.forEach((tower) => {
      for (let dx = 0; dx < tower.footprint.width; dx += 1) {
        for (let dy = 0; dy < tower.footprint.height; dy += 1) {
          map.set(`${tower.cell.x + dx},${tower.cell.y + dy}`, {
            tower,
            isAnchor: dx === 0 && dy === 0,
          })
        }
      }
    })

    return map
  }, [towers])
  const columnCount = useMemo(() => cells.reduce((max, cell) => Math.max(max, cell.x), 0) + 1, [cells])
  const rowCount = useMemo(() => cells.reduce((max, cell) => Math.max(max, cell.y), 0) + 1, [cells])

  const resolvedSelectedTowerId = selectedTowerId ?? internalSelectedTowerId
  const resolvedSelectedCell = selectedCell ?? internalSelectedCell
  const selectedTower = resolvedSelectedTowerId
    ? towers.find((tower) => tower.id === resolvedSelectedTowerId) ?? null
    : resolvedSelectedCell
      ? null
      : towers[0] ?? null
  const isLandscape = layout === 'landscape'
  const selectedCellKind = resolvedSelectedCell ? cellMap.get(`${resolvedSelectedCell.x},${resolvedSelectedCell.y}`)?.kind ?? 'blocked' : null
  const interactionItems = interactionWindow?.options.length
    ? interactionWindow.options.map((option) => {
        return {
          id: option.id,
          label: option.label,
          detail: option.payoff,
          meta: option.cost,
          status: option.locked ? 'locked' : 'ready',
          reason: option.locked ? option.risk : option.risk,
          accent: 'option' as const,
        }
      })
    : interactionWindow?.quickActions.map((action) => ({
        id: action.actionId,
        label: action.label,
        detail: action.detail,
        meta: action.cost,
        status: action.availability,
        reason: action.reason,
        accent: 'action' as const,
      })) ?? []
  const interactionAnchorStyle = resolvedSelectedCell
    ? {
        left:
          resolvedSelectedCell.x >= columnCount - 6
            ? undefined
            : `min(calc(${((resolvedSelectedCell.x + 0.5) / columnCount) * 100}% + 0.75rem), calc(100% - 18.5rem))`,
        right:
          resolvedSelectedCell.x >= columnCount - 6
            ? `min(calc(${100 - ((resolvedSelectedCell.x + 0.5) / columnCount) * 100}% + 0.75rem), calc(100% - 18.5rem))`
            : undefined,
        top:
          resolvedSelectedCell.y >= rowCount - 6
            ? undefined
            : `min(calc(${((resolvedSelectedCell.y + 0.5) / rowCount) * 100}% - 0.5rem), calc(100% - 22rem))`,
        bottom:
          resolvedSelectedCell.y >= rowCount - 6
            ? `min(calc(${100 - ((resolvedSelectedCell.y + 0.5) / rowCount) * 100}% + 0.75rem), calc(100% - 22rem))`
            : undefined,
      }
    : undefined

  return (
    <div className={cn(showFrame ? 'rounded-lg border border-border bg-card' : 'bg-transparent', className)}>
      {showHeader && (
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-medium">战场拓扑</h3>
        </div>
      </div>
      )}

      <div className={cn(showFrame ? 'p-4' : 'p-0', showIntel && 'grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]')}>
        <div
          className={cn(
            'relative overflow-auto rounded-lg bg-grid-dense',
            showFrame ? 'border border-border p-3' : 'border border-border/60 bg-card/40 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] backdrop-blur-[2px] md:p-4',
            fillViewport && !isLandscape && 'min-h-[calc(100vh-10rem)] lg:min-h-[calc(100vh-9rem)]',
            fillViewport && isLandscape && 'min-h-[clamp(34rem,72vh,58rem)]'
          )}
        >
          <div className={cn('mx-auto', fillViewport && 'h-full')}>
            <div
              className={cn(
                'grid gap-1',
                fillViewport && !isLandscape && 'aspect-square w-full max-h-full max-w-[min(100%,calc(100vh-12rem))]',
                fillViewport && isLandscape && 'w-full'
              )}
              style={{
                gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${rowCount}, minmax(0, 1fr))`,
                aspectRatio: `${columnCount} / ${rowCount}`,
              }}
            >
            {Array.from({ length: columnCount * rowCount }, (_, index) => {
              const x = index % columnCount
              const y = Math.floor(index / columnCount)
              const key = `${x},${y}`
              const cell = cellMap.get(key)
              const towerEntry = towerOccupancyMap.get(key)
              const tower = towerEntry?.tower
              const enemy = enemies.find((item) => item.position.x === x && item.position.y === y)

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setInternalSelectedCell({ x, y })
                    if (tower) {
                      setInternalSelectedTowerId(tower.id)
                    }
                    onCellSelect?.(cell ?? { x, y, kind: 'blocked' }, tower)
                  }}
                  className={cn(
                    'relative min-h-0 rounded border text-left transition-colors',
                    !isLandscape && 'aspect-square',
                    cell ? cellStyles[cell.kind] : cellStyles.blocked,
                    tower && 'ring-1 ring-inset ring-primary/50',
                    selectedTower?.id === tower?.id && 'ring-2 ring-primary',
                    resolvedSelectedCell?.x === x && resolvedSelectedCell?.y === y && !tower && 'ring-2 ring-cold-blue',
                    tower && !towerEntry?.isAnchor && 'opacity-85'
                  )}
                  title={tower ? `${tower.name} Lv.${tower.tier}` : cell?.kind ?? 'void'}
                >
                  {cell?.kind === 'gate' && <GitFork className="absolute left-1 top-1 h-3 w-3 text-warning-orange" />}
                  {cell?.kind === 'core' && <Shield className="absolute left-1 top-1 h-3 w-3 text-acid-green" />}
                  {cell?.kind === 'hazard' && <AlertTriangle className="absolute left-1 top-1 h-3 w-3 text-alert-red" />}
                  {tower && towerEntry?.isAnchor && (
                    <div
                      className={cn(
                        'absolute inset-1 flex flex-col items-center justify-center rounded border text-center',
                        towerStyles[tower.status]
                      )}
                    >
                      <RadioTower className="h-3.5 w-3.5" />
                      <span className="text-[9px] font-bold leading-none">Lv.{tower.tier}</span>
                      <span className="text-[8px] leading-none opacity-80">{tower.footprint.width}x{tower.footprint.height}</span>
                    </div>
                  )}
                  {tower && !towerEntry?.isAnchor && (
                    <div className={cn('absolute inset-1 rounded border border-dashed', towerStyles[tower.status])} />
                  )}
                  {enemy && (
                    <div className={cn('absolute bottom-0.5 right-0.5 rounded border px-1 py-0.5 text-[8px] font-bold', threatStyles[enemy.threat])}>
                      {enemy.threat === 'boss' ? 'B' : enemy.count}
                    </div>
                  )}
                </button>
              )
            })}
            </div>
          </div>

          {interactionWindow && resolvedSelectedCell ? (
            <div
              className="pointer-events-none absolute inset-0 z-20"
              aria-hidden={false}
            >
              <div
                className="pointer-events-auto absolute w-[min(17.5rem,calc(100%-1rem))] overflow-hidden rounded-2xl border border-cold-blue/40 bg-background/94 shadow-[0_14px_40px_rgba(0,0,0,0.45)] backdrop-blur-md"
                style={interactionAnchorStyle}
              >
                <div className="border-b border-border/60 bg-cold-blue/10 px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.22em] text-cold-blue">就近操作</p>
                      <p className="mt-1 text-sm font-medium text-foreground">
                        {selectedTower ? selectedTower.name : `地块 (${resolvedSelectedCell.x}, ${resolvedSelectedCell.y})`}
                      </p>
                    </div>
                    {interactionWindow.deadlineTick !== undefined ? (
                      <div className="rounded-lg border border-border bg-background/80 px-2 py-1 text-right">
                        <p className="text-[9px] uppercase tracking-wide text-muted-foreground">截止</p>
                        <p className="text-xs font-semibold text-warning-orange">{interactionWindow.deadlineTick}</p>
                      </div>
                    ) : null}
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{interactionWindow.summary}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                    <span className="rounded-full border border-border px-2 py-0.5">{interactionWindow.label}</span>
                    <span className="rounded-full border border-border px-2 py-0.5">
                      {selectedTower ? '建筑焦点' : `${selectedCellKind === 'build' ? '可建造地块' : selectedCellKind ?? '未知地块'}`}
                    </span>
                  </div>
                </div>

                <div className="max-h-[22rem] space-y-2 overflow-y-auto p-3">
                  {interactionWindow.isRunFinished ? (
                    <div className="rounded-xl border border-acid-green/30 bg-acid-green/10 px-3 py-2 text-[11px] text-acid-green">
                      当前战斗已结束，这里不再接受新的战场动作。
                    </div>
                  ) : null}

                  {interactionItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      disabled={item.status !== 'ready' || interactionWindow.isBusy || interactionWindow.isRunFinished}
                      onClick={() => interactionWindow.onActionTrigger(item.id)}
                      className={cn(
                        'w-full rounded-xl border px-3 py-2.5 text-left transition-colors',
                        item.status === 'ready' && item.accent === 'option' && 'border-warning-orange/30 bg-warning-orange/8 hover:bg-warning-orange/12',
                        item.status === 'ready' && item.accent === 'action' && 'border-primary/30 bg-primary/8 hover:bg-primary/12',
                        item.status === 'cooldown' && 'border-warning-orange/30 bg-warning-orange/8 opacity-85',
                        item.status === 'locked' && 'cursor-not-allowed border-border bg-muted/20 opacity-55',
                        interactionWindow.activeActionId === item.id && 'ring-1 ring-cold-blue',
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded border border-border bg-background/80 text-[10px] font-semibold text-foreground">
                              <Sparkles className="h-3 w-3" />
                            </span>
                            <p className="truncate text-sm font-medium text-foreground">{item.label}</p>
                          </div>
                          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{item.detail}</p>
                        </div>
                        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">{item.meta}</span>
                      </div>
                      <p className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Clock3 className="h-3 w-3" />
                        {item.reason ?? (item.status === 'ready' ? '点击后立即提交并推进。' : item.status === 'cooldown' ? '当前仍在冷却。' : '当前不可执行。')}
                      </p>
                    </button>
                  ))}

                  {!interactionItems.length ? (
                    <div className="rounded-xl border border-dashed border-border px-3 py-4 text-[11px] text-muted-foreground">
                      当前格子附近没有可执行交互，请切换其他地块或等待下一阶段。
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {showIntel && <div className="space-y-3">
          {resolvedSelectedCell && !selectedTower ? (
            <div className="rounded-lg border border-border bg-muted/20 p-3">
              <div className="mb-3 flex items-center gap-2">
                <Crosshair className="h-4 w-4 text-cold-blue" />
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">已选地块</p>
                  <p className="text-sm font-medium">({resolvedSelectedCell.x}, {resolvedSelectedCell.y})</p>
                </div>
              </div>
              <div className="rounded border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
                {cellMap.get(`${resolvedSelectedCell.x},${resolvedSelectedCell.y}`)?.kind === 'build'
                  ? '这是一个可建造地块。波前阶段可以在这里放置新的建筑。'
                  : '当前格子不可建造，可重新选择其他 build 地块。'}
              </div>
            </div>
          ) : null}

          {selectedTower ? (
          <>
          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <div className="mb-3 flex items-center gap-2">
              <Crosshair className="h-4 w-4 text-primary" />
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">焦点建筑</p>
                <p className="text-sm font-medium">{selectedTower.name}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded border border-border bg-card px-2 py-1.5">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">角色</p>
                <p>{selectedTower.role}</p>
              </div>
              <div className="rounded border border-border bg-card px-2 py-1.5">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">目标模式</p>
                <p>{selectedTower.targetMode}</p>
              </div>
              <div className="rounded border border-border bg-card px-2 py-1.5">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">攻击</p>
                <p>{selectedTower.damage} / {selectedTower.attackRate.toFixed(1)}s</p>
              </div>
              <div className="rounded border border-border bg-card px-2 py-1.5">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">占地 / 范围</p>
                <p>{selectedTower.footprint.width}x{selectedTower.footprint.height} / {selectedTower.range}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {selectedTower.effects.map((effect) => (
                <span key={effect} className="rounded border border-cold-blue/30 bg-cold-blue/10 px-2 py-1 text-[10px] text-cold-blue">
                  {effect}
                </span>
              ))}
            </div>
            <div className="mt-3 rounded-lg border border-border bg-card p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">建筑动作概览</p>
                <span className="text-[10px] text-muted-foreground">实际提交请使用棋盘上的就近操作卡</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {selectedTower.quickActions.map((action) => (
                  <div
                    key={action.actionId}
                    className={cn(
                      'rounded border p-2',
                      action.availability === 'ready' && 'border-primary/30 bg-primary/5',
                      action.availability === 'cooldown' && 'border-warning-orange/30 bg-warning-orange/5',
                      action.availability === 'locked' && 'border-border bg-muted/20 opacity-70'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-semibold text-foreground">
                          {action.key}
                        </span>
                        <p className="text-xs font-medium text-foreground">{action.label}</p>
                      </div>
                      <span className="text-[10px] text-muted-foreground">{action.cost}</span>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{action.detail}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {action.reason ?? (action.availability === 'ready' ? '可立即执行' : action.availability === 'cooldown' ? '处于冷却中' : '当前不可用')}
                    </p>
                  </div>
                ))}
              </div>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{selectedTower.note}</p>
          </div>

          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <div className="mb-2 flex items-center gap-2">
              <Skull className="h-4 w-4 text-alert-red" />
              <p className="text-xs uppercase tracking-wide text-muted-foreground">当前威胁簇</p>
            </div>
            <div className="space-y-2">
              {enemies.map((enemy) => (
                <div key={enemy.id} className="rounded border border-border bg-card p-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{enemy.name}</p>
                      <p className="text-[10px] text-muted-foreground">{enemy.intent}</p>
                    </div>
                    <span className={cn('rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide', threatStyles[enemy.threat])}>
                      {enemy.threat}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-alert-red" style={{ width: `${(enemy.hp / enemy.maxHp) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          </>
          ) : null}
        </div>}
      </div>
    </div>
  )
}