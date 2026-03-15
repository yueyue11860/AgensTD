'use client'

import { useState } from 'react'
import { MainLayout } from '@/components/layout/main-layout'
import { DifficultyBadge, RunStatusBadge, StatusBadge } from '@/components/game/status-badge'
import { Button } from '@/components/ui/button'
import { useReplaysData } from '@/hooks/use-replays-data'
import {
  Search,
  Play,
  Download,
  Share2,
  Clock,
  Calendar,
  Filter,
  ChevronDown,
  Film,
  Eye,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'

export default function ReplaysPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const { runs: completedRuns, isUsingFallback, error } = useReplaysData(searchQuery)

  const totalReplayDuration = completedRuns.reduce((acc, run) => acc + (run.duration_ms ?? 0), 0)
  const replayHours = totalReplayDuration > 0 ? `${Math.round(totalReplayDuration / 3600000)}h` : '0h'

  return (
    <MainLayout title="回放中心">
      <div className="space-y-6">
        {(isUsingFallback || error) && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4">
            <StatusBadge variant={error ? 'warning' : 'info'}>
              {error ? 'Supabase 查询失败，已回退到 mock 回放' : '当前展示 mock 回放数据'}
            </StatusBadge>
          </div>
        )}

        {/* Toolbar */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="搜索回放..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-muted/50 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <Filter className="h-4 w-4" />
                  筛选
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem>全部难度</DropdownMenuItem>
                <DropdownMenuSeparator />
                  <DropdownMenuItem>EASY</DropdownMenuItem>
                <DropdownMenuItem>NORMAL</DropdownMenuItem>
                <DropdownMenuItem>HARD</DropdownMenuItem>
                <DropdownMenuItem>HELL</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Stats */}
        <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-4">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Film className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{completedRuns.length}</p>
              <p className="text-xs text-muted-foreground">可回放对局</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-acid-green/10">
              <Eye className="h-5 w-5 text-acid-green" />
            </div>
            <div>
              <p className="text-2xl font-bold text-acid-green">12.5k</p>
              <p className="text-xs text-muted-foreground">总观看次数</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning-orange/10">
              <Clock className="h-5 w-5 text-warning-orange" />
            </div>
            <div>
              <p className="text-2xl font-bold text-warning-orange">{replayHours}</p>
              <p className="text-xs text-muted-foreground">总回放时长</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cold-blue/10">
              <Clock className="h-5 w-5 text-cold-blue" />
            </div>
            <div>
              <p className="text-2xl font-bold text-cold-blue">
                {completedRuns.filter((run) => run.is_live).length}
              </p>
              <p className="text-xs text-muted-foreground">直播中回放</p>
            </div>
          </div>
        </div>

        {/* Replay Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {completedRuns.map((run) => (
            <div
              key={run.run_id}
              className="group rounded-lg border border-border bg-card overflow-hidden transition-all hover:border-primary/30"
            >
              {/* Thumbnail */}
              <div className="relative aspect-video bg-muted">
                <div className="absolute inset-0 flex items-center justify-center bg-graphite">
                  {/* Grid pattern as placeholder */}
                  <div
                    className="absolute inset-0 opacity-30"
                    style={{
                      backgroundImage: `
                        linear-gradient(to right, oklch(0.25 0.01 250 / 0.5) 1px, transparent 1px),
                        linear-gradient(to bottom, oklch(0.25 0.01 250 / 0.5) 1px, transparent 1px)
                      `,
                      backgroundSize: '20px 20px',
                    }}
                  />
                  <Film className="h-12 w-12 text-muted-foreground/50" />
                </div>
                
                {/* Play Overlay */}
                <div className="absolute inset-0 flex items-center justify-center bg-background/50 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button size="lg" className="gap-2">
                    <Play className="h-5 w-5" />
                    播放回放
                  </Button>
                </div>

                {/* Duration Badge */}
                <div className="absolute bottom-2 right-2 rounded bg-background/80 px-2 py-1 text-xs font-mono">
                  {run.duration_ms ? `${Math.floor(run.duration_ms / 60000)}:${String(Math.floor((run.duration_ms % 60000) / 1000)).padStart(2, '0')}` : '--:--'}
                </div>

                {/* Status Badge */}
                <div className="absolute top-2 left-2">
                  <RunStatusBadge status={run.status} />
                </div>
              </div>

              {/* Info */}
              <div className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-medium">{run.agent_name}</h3>
                    <div className="mt-1 flex items-center gap-2">
                      <DifficultyBadge difficulty={run.difficulty} />
                      <span className="text-xs text-muted-foreground">
                        Wave {run.wave}/{run.max_wave}
                      </span>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <Share2 className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem className="gap-2">
                        <Share2 className="h-4 w-4" />
                        分享链接
                      </DropdownMenuItem>
                      <DropdownMenuItem className="gap-2">
                        <Download className="h-4 w-4" />
                        下载回放
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* Stats */}
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div className="text-center rounded bg-muted/50 p-2">
                    <p className="font-bold text-warning-orange">{run.score.toLocaleString()}</p>
                    <p className="text-muted-foreground">积分</p>
                  </div>
                  <div className="text-center rounded bg-muted/50 p-2">
                    <p className="font-bold text-acid-green">{run.enemies_killed}</p>
                    <p className="text-muted-foreground">击杀</p>
                  </div>
                  <div className="text-center rounded bg-muted/50 p-2">
                    <p className="font-bold text-cold-blue">{run.towers_built}</p>
                    <p className="text-muted-foreground">建筑</p>
                  </div>
                </div>

                {/* Date */}
                <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <Calendar className="h-3 w-3" />
                  <span>{run.end_time ? new Date(run.end_time).toLocaleString('zh-CN') : '-'}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </MainLayout>
  )
}
