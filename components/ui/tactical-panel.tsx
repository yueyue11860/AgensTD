'use client'

import { cn } from '@/lib/utils'
import { ReactNode } from 'react'

interface TacticalPanelProps {
  children: ReactNode
  title?: string
  subtitle?: string
  className?: string
  variant?: 'default' | 'bordered' | 'glass' | 'danger'
  headerActions?: ReactNode
  statusLight?: 'active' | 'warning' | 'error' | 'idle'
  cornerBrackets?: boolean
}

export function TacticalPanel({
  children,
  title,
  className,
  variant = 'default',
  headerActions,
  statusLight,
  cornerBrackets = false,
}: TacticalPanelProps) {
  const variantStyles = {
    default: 'bg-card border border-border',
    bordered: 'tactical-panel',
    glass: 'glass-panel',
    danger: 'danger-zone bg-card border border-border',
  }

  return (
    <div
      className={cn(
        'relative rounded-lg overflow-hidden',
        variantStyles[variant],
        cornerBrackets && 'corner-bracket',
        className
      )}
    >
      {/* Scanline overlay */}
      <div className="pointer-events-none absolute inset-0 scanlines opacity-30" />
      
      {title && (
        <div className="flex items-center justify-between border-b border-border/50 bg-muted/20 px-4 py-2.5">
          <div className="flex items-center gap-3">
            {statusLight && (
              <div
                className={cn(
                  'status-light',
                  statusLight === 'active' && 'status-light-active',
                  statusLight === 'warning' && 'status-light-warning',
                  statusLight === 'error' && 'status-light-error',
                  statusLight === 'idle' && 'status-light-idle'
                )}
              />
            )}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
                {title}
              </h3>
            </div>
          </div>
          {headerActions && (
            <div className="flex items-center gap-2">{headerActions}</div>
          )}
        </div>
      )}
      <div className="relative">{children}</div>
    </div>
  )
}

// Status Indicator Component
interface StatusIndicatorProps {
  status: 'online' | 'offline' | 'warning' | 'processing'
  label?: string
  value?: string | number
  className?: string
}

export function StatusIndicator({ status, label, value, className }: StatusIndicatorProps) {
  const statusColors = {
    online: 'status-light-active',
    offline: 'status-light-idle',
    warning: 'status-light-warning',
    processing: 'status-light-active animate-pulse',
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className={cn('status-light', statusColors[status])} />
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
      {value !== undefined && (
        <span className="ml-auto font-mono text-xs text-foreground">{value}</span>
      )}
    </div>
  )
}

// Divider with Label
interface DividerLabelProps {
  label: string
  className?: string
}

export function DividerLabel({ label, className }: DividerLabelProps) {
  return <div className={cn('divider-label my-4', className)}>{label}</div>
}

// Data Readout Component
interface DataReadoutProps {
  data: Array<{ label: string; value: string | number; highlight?: boolean }>
  className?: string
}

export function DataReadout({ data, className }: DataReadoutProps) {
  return (
    <div className={cn('data-readout space-y-1', className)}>
      {data.map((item, index) => (
        <div key={index} className="flex justify-between">
          <span className="text-muted-foreground">{item.label}:</span>
          <span className={item.highlight ? 'text-warning-orange' : 'text-foreground'}>
            {item.value}
          </span>
        </div>
      ))}
    </div>
  )
}

// Season Badge Component
interface SeasonBadgeProps {
  season: string
  className?: string
}

export function SeasonBadge({ season, className }: SeasonBadgeProps) {
  return <span className={cn('season-badge', className)}>{season}</span>
}

// Metric Display
interface MetricDisplayProps {
  label: string
  value: string | number
  unit?: string
  trend?: 'up' | 'down' | 'stable'
  variant?: 'default' | 'primary' | 'warning' | 'success' | 'error'
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function MetricDisplay({
  label,
  value,
  unit,
  trend,
  variant = 'default',
  size = 'md',
  className,
}: MetricDisplayProps) {
  const variantColors = {
    default: 'text-foreground',
    primary: 'text-cold-blue',
    warning: 'text-warning-orange',
    success: 'text-acid-green',
    error: 'text-alert-red',
  }

  const sizeStyles = {
    sm: { value: 'text-lg', label: 'text-[10px]' },
    md: { value: 'text-2xl', label: 'text-xs' },
    lg: { value: 'text-4xl', label: 'text-sm' },
  }

  return (
    <div className={cn('text-center', className)}>
      <div className={cn('font-bold tabular-nums', sizeStyles[size].value, variantColors[variant])}>
        {typeof value === 'number' ? value.toLocaleString() : value}
        {unit && <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span>}
        {trend && (
          <span className={cn(
            'ml-2 text-sm',
            trend === 'up' && 'text-acid-green',
            trend === 'down' && 'text-alert-red',
            trend === 'stable' && 'text-muted-foreground'
          )}>
            {trend === 'up' && '↑'}
            {trend === 'down' && '↓'}
            {trend === 'stable' && '→'}
          </span>
        )}
      </div>
      <p className={cn('uppercase tracking-wider text-muted-foreground', sizeStyles[size].label)}>
        {label}
      </p>
    </div>
  )
}
