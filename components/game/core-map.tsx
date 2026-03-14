'use client'

import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import type { CoreEnemyWave, CoreMapCell, CoreTowerBuild } from '@/lib/mock-data'
import { AlertTriangle, Crosshair, GitFork, RadioTower, Shield, Skull } from 'lucide-react'

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
}

const gridSize = 18

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
  stable: 'border-acid-green/50 bg-acid-green/10 text-acid-green',
  overdrive: 'border-warning-orange/50 bg-warning-orange/10 text-warning-orange',
  jammed: 'border-cold-blue/50 bg-cold-blue/10 text-cold-blue',
  corrupted: 'border-alert-red/50 bg-alert-red/10 text-alert-red',
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
}: CoreMapProps) {
  const [selectedTowerId, setSelectedTowerId] = useState<string | null>(towers[0]?.id ?? null)
  const [lastTriggeredActionId, setLastTriggeredActionId] = useState<string | null>(null)

  const cellMap = useMemo(() => {
    return new Map(cells.map((cell) => [`${cell.x},${cell.y}`, cell]))
  }, [cells])

  const selectedTower = towers.find((tower) => tower.id === selectedTowerId) ?? towers[0]
  const isLandscape = layout === 'landscape'

  useEffect(() => {
    if (!selectedTower) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toUpperCase()

      if (!['Q', 'W', 'E', 'R'].includes(key)) {
        return
      }

      const action = selectedTower.quickActions.find((item) => item.key === key)

      if (!action) {
        return
      }

      event.preventDefault()
      setLastTriggeredActionId(action.actionId)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedTower])

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
            fillViewport && isLandscape && 'min-h-[22rem] lg:min-h-[34rem]'
          )}
        >
          <div className={cn('mx-auto', fillViewport && 'flex h-full items-center justify-center')}>
            <div
              className={cn(
                'grid gap-1',
                fillViewport && !isLandscape && 'aspect-square w-full max-h-full max-w-[min(100%,calc(100vh-12rem))]',
                fillViewport && isLandscape && 'h-[clamp(24rem,58vh,42rem)] w-full'
              )}
              style={{
                gridTemplateColumns: `repeat(${gridSize}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${gridSize}, minmax(0, 1fr))`,
              }}
            >
            {Array.from({ length: gridSize * gridSize }, (_, index) => {
              const x = index % gridSize
              const y = Math.floor(index / gridSize)
              const key = `${x},${y}`
              const cell = cellMap.get(key)
              const tower = towers.find((item) => item.cell.x === x && item.cell.y === y)
              const enemy = enemies.find((item) => item.position.x === x && item.position.y === y)

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => tower && setSelectedTowerId(tower.id)}
                  className={cn(
                    'relative min-h-0 rounded border text-left transition-colors',
                    !isLandscape && 'aspect-square',
                    cell ? cellStyles[cell.kind] : cellStyles.blocked,
                    tower && 'ring-1 ring-inset ring-primary/50',
                    selectedTower?.id === tower?.id && 'ring-2 ring-primary'
                  )}
                  title={tower ? `${tower.name} T${tower.tier}` : cell?.kind ?? 'void'}
                >
                  {cell?.kind === 'gate' && <GitFork className="absolute left-1 top-1 h-3 w-3 text-warning-orange" />}
                  {cell?.kind === 'core' && <Shield className="absolute left-1 top-1 h-3 w-3 text-acid-green" />}
                  {cell?.kind === 'hazard' && <AlertTriangle className="absolute left-1 top-1 h-3 w-3 text-alert-red" />}
                  {tower && (
                    <div
                      className={cn(
                        'absolute inset-1 flex flex-col items-center justify-center rounded border text-center',
                        towerStyles[tower.status]
                      )}
                    >
                      <RadioTower className="h-3.5 w-3.5" />
                      <span className="text-[9px] font-bold leading-none">T{tower.tier}</span>
                    </div>
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
        </div>

        {showIntel && selectedTower && <div className="space-y-3">
          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <div className="mb-3 flex items-center gap-2">
              <Crosshair className="h-4 w-4 text-primary" />
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">焦点塔核</p>
                <p className="text-sm font-medium">{selectedTower.name}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded border border-border bg-card px-2 py-1.5">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">角色</p>
                <p>{selectedTower.role}</p>
              </div>
              <div className="rounded border border-border bg-card px-2 py-1.5">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">锁定模式</p>
                <p>{selectedTower.targetMode}</p>
              </div>
              <div className="rounded border border-border bg-card px-2 py-1.5">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">输出</p>
                <p>{selectedTower.dps} DPS</p>
              </div>
              <div className="rounded border border-border bg-card px-2 py-1.5">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">热负荷</p>
                <p>{selectedTower.heat}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {selectedTower.modules.map((module) => (
                <span key={module} className="rounded border border-cold-blue/30 bg-cold-blue/10 px-2 py-1 text-[10px] text-cold-blue">
                  {module}
                </span>
              ))}
            </div>
            <div className="mt-3 rounded-lg border border-border bg-card p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">QWER 动作槽</p>
                <span className="text-[10px] text-muted-foreground">鼠标选塔后可直接按键</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {selectedTower.quickActions.map((action) => (
                  <div
                    key={action.actionId}
                    className={cn(
                      'rounded border p-2',
                      action.availability === 'ready' && 'border-primary/30 bg-primary/5',
                      action.availability === 'cooldown' && 'border-warning-orange/30 bg-warning-orange/5',
                      action.availability === 'locked' && 'border-border bg-muted/20 opacity-70',
                      lastTriggeredActionId === action.actionId && 'ring-1 ring-primary'
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
            {lastTriggeredActionId ? (
              <p className="mt-3 text-[11px] text-primary">最近触发动作：{selectedTower.quickActions.find((action) => action.actionId === lastTriggeredActionId)?.label}</p>
            ) : null}
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
        </div>}
      </div>
    </div>
  )
}