import { cn } from '@/lib/utils'
import { LucideIcon, TrendingUp, TrendingDown } from 'lucide-react'

interface StatsCardProps {
  title: string
  value: string | number
  subtitle?: string
  icon: LucideIcon
  trend?: {
    value: number
    isPositive: boolean
  }
  variant?: 'default' | 'primary' | 'warning' | 'success' | 'error'
  className?: string
}

const variantStyles = {
  default: {
    card: 'bg-card',
    icon: 'bg-muted text-muted-foreground',
    value: 'text-foreground',
    glow: '',
    accent: 'bg-muted-foreground/30',
  },
  primary: {
    card: 'bg-card border-primary/30',
    icon: 'bg-primary/10 text-primary',
    value: 'text-primary',
    glow: 'shadow-[inset_0_1px_0_0_rgba(101,144,247,0.1)]',
    accent: 'bg-primary/50',
  },
  warning: {
    card: 'bg-card border-warning-orange/30',
    icon: 'bg-warning-orange/10 text-warning-orange',
    value: 'text-warning-orange',
    glow: 'shadow-[inset_0_1px_0_0_rgba(245,158,11,0.1)]',
    accent: 'bg-warning-orange/50',
  },
  success: {
    card: 'bg-card border-acid-green/30',
    icon: 'bg-acid-green/10 text-acid-green',
    value: 'text-acid-green',
    glow: 'shadow-[inset_0_1px_0_0_rgba(16,185,129,0.1)]',
    accent: 'bg-acid-green/50',
  },
  error: {
    card: 'bg-card border-alert-red/30',
    icon: 'bg-alert-red/10 text-alert-red',
    value: 'text-alert-red',
    glow: 'shadow-[inset_0_1px_0_0_rgba(239,68,68,0.1)]',
    accent: 'bg-alert-red/50',
  },
}

export function StatsCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  variant = 'default',
  className,
}: StatsCardProps) {
  const styles = variantStyles[variant]

  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-lg border border-border p-4 transition-all hover:border-border/60',
        styles.card,
        styles.glow,
        className
      )}
    >
      {/* Top accent line */}
      <div className={cn('absolute left-0 right-0 top-0 h-[2px]', styles.accent)} />
      
      {/* Scanlines overlay */}
      <div className="pointer-events-none absolute inset-0 scanlines opacity-20" />
      
      <div className="relative flex items-start justify-between">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <div className={cn(
              'status-light',
              variant === 'success' && 'status-light-active',
              variant === 'warning' && 'status-light-warning',
              variant === 'error' && 'status-light-error',
              variant === 'primary' && 'status-light-active',
              variant === 'default' && 'status-light-idle'
            )} />
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {title}
            </p>
          </div>
          <div className="flex items-baseline gap-2">
            <span className={cn('text-2xl font-bold tabular-nums', styles.value)}>
              {typeof value === 'number' ? value.toLocaleString() : value}
            </span>
            {trend && (
              <div className={cn(
                'flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-semibold',
                trend.isPositive ? 'bg-acid-green/10 text-acid-green' : 'bg-alert-red/10 text-alert-red'
              )}>
                {trend.isPositive ? (
                  <TrendingUp className="h-3 w-3" />
                ) : (
                  <TrendingDown className="h-3 w-3" />
                )}
                {trend.value}%
              </div>
            )}
          </div>
          {subtitle && (
            <p className="text-[11px] text-muted-foreground">{subtitle}</p>
          )}
        </div>
        <div className={cn('rounded-lg p-2.5 transition-transform group-hover:scale-105', styles.icon)}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  )
}

// Large Stats Card with Chart
interface LargeStatsCardProps {
  title: string
  value: string | number
  subtitle?: string
  icon: LucideIcon
  children?: React.ReactNode
  className?: string
}

export function LargeStatsCard({
  title,
  value,
  subtitle,
  icon: Icon,
  children,
  className,
}: LargeStatsCardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-card p-4 transition-all hover:border-border/80',
        className
      )}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {title}
          </p>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums text-foreground">
              {typeof value === 'number' ? value.toLocaleString() : value}
            </span>
          </div>
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        <div className="rounded-lg bg-primary/10 p-2.5 text-primary">
          <Icon className="h-5 w-5" />
        </div>
      </div>
      {children}
    </div>
  )
}
