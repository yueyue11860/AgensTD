import { cn } from '@/lib/utils'
import type { Resources } from '@/lib/domain'
import { Coins, Sparkles, Flame, Wrench, ShieldAlert } from 'lucide-react'

interface ResourceBarProps {
  type: 'gold' | 'mana' | 'heat' | 'repair' | 'fortress'
  current: number
  max?: number
  showLabel?: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const resourceConfig = {
  gold: {
    icon: Coins,
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-500/20',
    barColor: 'bg-yellow-500',
    label: '金币',
  },
  mana: {
    icon: Sparkles,
    color: 'text-cold-blue',
    bgColor: 'bg-cold-blue/20',
    barColor: 'bg-cold-blue',
    label: '法力',
  },
  heat: {
    icon: Flame,
    color: 'text-warning-orange',
    bgColor: 'bg-warning-orange/15',
    barColor: 'bg-warning-orange',
    label: '热量',
  },
  repair: {
    icon: Wrench,
    color: 'text-cyber-cyan',
    bgColor: 'bg-cyber-cyan/15',
    barColor: 'bg-cyber-cyan',
    label: '维修',
  },
  fortress: {
    icon: ShieldAlert,
    color: 'text-alert-red',
    bgColor: 'bg-alert-red/15',
    barColor: 'bg-alert-red',
    label: '主堡',
  },
}

const sizeConfig = {
  sm: { height: 'h-1', iconSize: 'h-3 w-3', textSize: 'text-xs' },
  md: { height: 'h-1.5', iconSize: 'h-4 w-4', textSize: 'text-sm' },
  lg: { height: 'h-2', iconSize: 'h-5 w-5', textSize: 'text-base' },
}

export function ResourceBar({
  type,
  current,
  max,
  showLabel = true,
  size = 'md',
  className,
}: ResourceBarProps) {
  const config = resourceConfig[type]
  const sizeStyles = sizeConfig[size]
  const Icon = config.icon
  const percentage = max ? Math.min((current / max) * 100, 100) : 100

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Icon className={cn(sizeStyles.iconSize, config.color)} />
      {showLabel && (
        <span className={cn('w-10 text-muted-foreground', sizeStyles.textSize)}>
          {config.label}
        </span>
      )}
      {max ? (
        <div className="flex flex-1 items-center gap-2">
          <div className={cn('flex-1 overflow-hidden rounded-full', config.bgColor, sizeStyles.height)}>
            <div
              className={cn('h-full rounded-full transition-all', config.barColor)}
              style={{ width: `${percentage}%` }}
            />
          </div>
          <span className={cn('w-16 text-right font-mono', sizeStyles.textSize, config.color)}>
            {current}/{max}
          </span>
        </div>
      ) : (
        <span className={cn('font-mono font-medium', sizeStyles.textSize, config.color)}>
          {current.toLocaleString()}
        </span>
      )}
    </div>
  )
}

// Combined Resources Panel
interface ResourcesPanelProps {
  resources: Resources
  className?: string
}

export function ResourcesPanel({ resources, className }: ResourcesPanelProps) {
  return (
    <div className={cn('space-y-3 rounded-lg border border-border bg-card p-4', className)}>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">资源状态</h3>
      </div>
      <div className="space-y-2.5">
        <ResourceBar type="gold" current={resources.gold} size="sm" />
        <ResourceBar type="heat" current={resources.heat} max={resources.heat_limit} size="sm" />
        <ResourceBar type="mana" current={resources.mana} max={resources.mana_limit} size="sm" />
        <ResourceBar type="repair" current={resources.repair} size="sm" />
        <ResourceBar type="fortress" current={resources.fortress} max={resources.fortress_max} size="sm" />
      </div>
    </div>
  )
}

interface HardcoreResourcesPanelProps {
  resources: Resources
  className?: string
}

function ThresholdBadge({ current, max }: { current: number; max: number }) {
  const ratio = current / max
  const style =
    ratio >= 0.85
      ? 'border-alert-red/40 bg-alert-red/10 text-alert-red'
      : ratio >= 0.65
        ? 'border-warning-orange/40 bg-warning-orange/10 text-warning-orange'
        : 'border-acid-green/30 bg-acid-green/10 text-acid-green'

  return (
    <span className={cn('rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide', style)}>
      {Math.round(ratio * 100)}%
    </span>
  )
}

export function HardcoreResourcesPanel({ resources, className }: HardcoreResourcesPanelProps) {
  return (
    <div className={cn('rounded-lg border border-border bg-card p-4', className)}>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">资源耦合</h3>
          <p className="mt-1 text-[11px] text-muted-foreground">战线热度与维修预算决定你能否在中局安全转型</p>
        </div>
        <div className="rounded border border-border bg-muted/30 px-2 py-1 text-right">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">威胁压强</p>
          <p className="font-mono text-sm text-warning-orange">{resources.threat}/100</p>
        </div>
      </div>

      <div className="space-y-3">
        <ResourceBar type="gold" current={resources.gold} size="sm" />
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <ResourceBar type="heat" current={resources.heat} max={resources.heat_limit} size="sm" />
            <ThresholdBadge current={resources.heat} max={resources.heat_limit} />
          </div>
          <p className="text-[10px] text-muted-foreground">超过 85% 会显著压缩你的战场容错和后续布局空间。</p>
        </div>
        <ResourceBar type="mana" current={resources.mana} max={resources.mana_limit} size="sm" />
        <div className="space-y-1.5">
          <ResourceBar type="repair" current={resources.repair} size="sm" />
          <p className="text-[10px] text-muted-foreground">拆改、改路、去污染与主堡修复共享维修点。</p>
        </div>
        <div className="rounded-md border border-border bg-muted/20 p-3">
          <div className="mb-2 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-alert-red" />
            <span className="text-xs uppercase tracking-wide text-muted-foreground">主堡完整度</span>
          </div>
          <div className="flex items-end justify-between gap-3">
            <div className="flex-1">
              <div className="h-2 overflow-hidden rounded-full bg-alert-red/10">
                <div
                  className="h-full rounded-full bg-alert-red transition-all"
                  style={{ width: `${(resources.fortress / resources.fortress_max) * 100}%` }}
                />
              </div>
            </div>
            <span className="font-mono text-sm text-alert-red">
              {resources.fortress}/{resources.fortress_max}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
