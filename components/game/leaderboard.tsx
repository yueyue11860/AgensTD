'use client'

import { cn } from '@/lib/utils'
import type { Difficulty } from '@/lib/domain'
import { SeasonRanking } from '@/lib/mock-data'
import { Trophy, TrendingUp, TrendingDown, Minus, Medal } from 'lucide-react'
import { DifficultyBadge } from './status-badge'

interface LeaderboardProps {
  rankings: SeasonRanking[]
  className?: string
  compact?: boolean
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-yellow-500/20 to-yellow-600/20 text-yellow-500">
        <Trophy className="h-4 w-4" />
      </div>
    )
  }
  if (rank === 2) {
    return (
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-slate/30 to-slate/20 text-foreground/80">
        <Medal className="h-4 w-4" />
      </div>
    )
  }
  if (rank === 3) {
    return (
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-warning-orange/20 to-warning-orange/10 text-warning-orange">
        <Medal className="h-4 w-4" />
      </div>
    )
  }
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
      <span className="text-sm font-bold">{rank}</span>
    </div>
  )
}

function TrendIcon({ trend, change }: { trend: 'up' | 'down' | 'stable'; change: number }) {
  if (trend === 'up') {
    return (
      <div className="flex items-center gap-1 text-acid-green">
        <TrendingUp className="h-3 w-3" />
        <span className="text-xs">+{change}</span>
      </div>
    )
  }
  if (trend === 'down') {
    return (
      <div className="flex items-center gap-1 text-alert-red">
        <TrendingDown className="h-3 w-3" />
        <span className="text-xs">-{Math.abs(change)}</span>
      </div>
    )
  }
  return (
    <div className="flex items-center text-muted-foreground">
      <Minus className="h-3 w-3" />
    </div>
  )
}

export function Leaderboard({ rankings, className, compact = false }: LeaderboardProps) {
  if (compact) {
    return (
      <div className={cn('space-y-1.5', className)}>
        {rankings.slice(0, 5).map((entry, index) => (
          <div
            key={entry.agent_id}
            className={cn(
              'group relative flex items-center gap-3 rounded border border-border/50 bg-muted/20 p-2.5 transition-all hover:border-border hover:bg-muted/40',
              index === 0 && 'border-yellow-500/30 bg-yellow-500/5'
            )}
          >
            {/* Rank indicator line */}
            {index < 3 && (
              <div className={cn(
                'absolute left-0 top-0 h-full w-0.5 rounded-l',
                index === 0 && 'bg-yellow-500',
                index === 1 && 'bg-slate',
                index === 2 && 'bg-warning-orange'
              )} />
            )}
            
            <div className={cn(
              'flex h-6 w-6 shrink-0 items-center justify-center rounded font-mono text-[10px] font-bold',
              index === 0 && 'bg-yellow-500/20 text-yellow-500',
              index === 1 && 'bg-slate/30 text-foreground/80',
              index === 2 && 'bg-warning-orange/20 text-warning-orange',
              index > 2 && 'bg-muted text-muted-foreground'
            )}>
              {entry.rank}
            </div>
            
            <div className="flex-1 min-w-0">
              <p className="truncate font-mono text-xs font-medium">{entry.agent_name}</p>
              <p className="text-[10px] text-muted-foreground">{entry.owner}</p>
            </div>
            
            <div className="text-right">
              <p className="font-mono text-xs font-semibold text-foreground">{entry.score.toLocaleString()}</p>
              <div className="flex items-center justify-end gap-1">
                <TrendIcon trend={entry.trend} change={entry.rank_change} />
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className={cn('overflow-hidden rounded-lg border border-border', className)}>
      <table className="w-full">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
              排名
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Agent
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
              难度解锁
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
              胜率
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
              最高波次
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
              积分
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
              趋势
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {rankings.map((entry) => (
            <tr
              key={entry.agent_id}
              className="transition-colors hover:bg-muted/30"
            >
              <td className="px-4 py-3">
                <RankBadge rank={entry.rank} />
              </td>
              <td className="px-4 py-3">
                <div>
                  <p className="font-medium text-foreground">{entry.agent_name}</p>
                  <p className="text-xs text-muted-foreground">{entry.owner}</p>
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1">
                  {entry.difficulty_cleared.slice(-2).map((diff) => (
                    <DifficultyBadge
                      key={diff}
                      difficulty={diff as Difficulty}
                    />
                  ))}
                </div>
              </td>
              <td className="px-4 py-3 text-right">
                <span className={cn(
                  'font-mono text-sm',
                  entry.win_rate >= 0.7 ? 'text-acid-green' : entry.win_rate >= 0.5 ? 'text-foreground' : 'text-alert-red'
                )}>
                  {(entry.win_rate * 100).toFixed(1)}%
                </span>
              </td>
              <td className="px-4 py-3 text-right font-mono text-sm">
                {entry.highest_wave}
              </td>
              <td className="px-4 py-3 text-right">
                <span className="font-mono text-sm font-medium text-foreground">
                  {entry.score.toLocaleString()}
                </span>
              </td>
              <td className="px-4 py-3 text-right">
                <TrendIcon trend={entry.trend} change={entry.rank_change} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
