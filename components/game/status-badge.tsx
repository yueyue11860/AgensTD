import { cn } from '@/lib/utils'

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'live'

interface StatusBadgeProps {
  variant?: BadgeVariant
  children: React.ReactNode
  className?: string
  pulse?: boolean
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-muted text-muted-foreground',
  success: 'bg-acid-green/15 text-acid-green border-acid-green/30',
  warning: 'bg-warning-orange/15 text-warning-orange border-warning-orange/30',
  error: 'bg-alert-red/15 text-alert-red border-alert-red/30',
  info: 'bg-cold-blue/15 text-cold-blue border-cold-blue/30',
  live: 'bg-alert-red/20 text-alert-red border-alert-red/40 animate-pulse-glow',
}

export function StatusBadge({ variant = 'default', children, className, pulse }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium',
        variantStyles[variant],
        pulse && 'animate-pulse-glow',
        className
      )}
    >
      {variant === 'live' && (
        <span className="h-1.5 w-1.5 rounded-full bg-current animate-status-blink" />
      )}
      {children}
    </span>
  )
}

// Difficulty Badge - Enhanced with danger level indicators
type Difficulty = 'NORMAL' | 'HARD' | 'HELL' | 'NIGHTMARE' | 'INFERNO'

const difficultyConfig: Record<Difficulty, { 
  style: string
  icon: string
  level: number
}> = {
  NORMAL: { 
    style: 'bg-slate/20 text-foreground/70 border-slate/30', 
    icon: '●',
    level: 1
  },
  HARD: { 
    style: 'bg-cold-blue/15 text-cold-blue border-cold-blue/30', 
    icon: '●●',
    level: 2
  },
  HELL: { 
    style: 'bg-warning-orange/15 text-warning-orange border-warning-orange/30', 
    icon: '●●●',
    level: 3
  },
  NIGHTMARE: { 
    style: 'bg-alert-red/15 text-alert-red border-alert-red/30', 
    icon: '●●●●',
    level: 4
  },
  INFERNO: { 
    style: 'bg-gradient-to-r from-alert-red/20 via-warning-orange/20 to-alert-red/20 text-warning-orange border-warning-orange/40 animate-pulse', 
    icon: '●●●●●',
    level: 5
  },
}

interface DifficultyBadgeProps {
  difficulty: Difficulty
  className?: string
  showLevel?: boolean
}

export function DifficultyBadge({ difficulty, className, showLevel = false }: DifficultyBadgeProps) {
  const config = difficultyConfig[difficulty]
  
  return (
    <span
      className={cn(
        'relative inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[10px] font-bold tracking-widest',
        config.style,
        className
      )}
    >
      {showLevel && (
        <span className="text-[8px] opacity-60">{config.icon}</span>
      )}
      {difficulty}
      {difficulty === 'INFERNO' && (
        <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-warning-orange animate-ping" />
      )}
    </span>
  )
}

// Run Status Badge
type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'timeout'

const runStatusStyles: Record<RunStatus, { variant: BadgeVariant; label: string }> = {
  queued: { variant: 'default', label: '排队中' },
  running: { variant: 'live', label: '运行中' },
  completed: { variant: 'success', label: '已完成' },
  failed: { variant: 'error', label: '失败' },
  timeout: { variant: 'warning', label: '超时' },
}

interface RunStatusBadgeProps {
  status: RunStatus
  className?: string
}

export function RunStatusBadge({ status, className }: RunStatusBadgeProps) {
  const config = runStatusStyles[status]
  return (
    <StatusBadge variant={config.variant} className={className}>
      {config.label}
    </StatusBadge>
  )
}

// Agent Status Badge
type AgentStatus = 'active' | 'inactive' | 'training' | 'error'

const agentStatusStyles: Record<AgentStatus, { variant: BadgeVariant; label: string }> = {
  active: { variant: 'success', label: '活跃' },
  inactive: { variant: 'default', label: '离线' },
  training: { variant: 'info', label: '训练中' },
  error: { variant: 'error', label: '错误' },
}

interface AgentStatusBadgeProps {
  status: AgentStatus
  className?: string
}

export function AgentStatusBadge({ status, className }: AgentStatusBadgeProps) {
  const config = agentStatusStyles[status]
  return (
    <StatusBadge variant={config.variant} className={className}>
      {config.label}
    </StatusBadge>
  )
}
