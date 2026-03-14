'use client'

import { useState } from 'react'
import { MainLayout } from '@/components/layout/main-layout'
import { Leaderboard } from '@/components/game/leaderboard'
import { DifficultyBadge, StatusBadge } from '@/components/game/status-badge'
import { Button } from '@/components/ui/button'
import { useRankingsData } from '@/hooks/use-rankings-data'
import {
  Medal,
  Calendar,
  Filter,
  ChevronDown,
  Crown,
  Flame,
  Award,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'

type Season = 'S4' | 'S3' | 'S2' | 'ALL'

export default function RankingsPage() {
  const [selectedSeason, setSelectedSeason] = useState<Season>('S4')
  const [selectedDifficulty, setSelectedDifficulty] = useState<string>('ALL')
  const { rankings, isUsingFallback, error } = useRankingsData(selectedSeason, selectedDifficulty)

  const topThree = rankings.slice(0, 3)

  return (
    <MainLayout title="赛季排行榜">
      <div className="space-y-6">
        {(isUsingFallback || error) && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4">
            <StatusBadge variant={error ? 'warning' : 'info'}>
              {error ? 'Supabase 查询失败，已回退到 mock 排行榜' : '当前展示 mock 排行榜'}
            </StatusBadge>
          </div>
        )}

        {/* Season Header */}
        <div className="rounded-lg border border-border bg-gradient-to-r from-card via-card to-warning-orange/5 p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-warning-orange/20">
                <Flame className="h-8 w-8 text-warning-orange" />
              </div>
              <div>
                <h2 className="text-2xl font-bold">SEASON 4</h2>
                <p className="text-sm text-muted-foreground">
                  地狱难度挑战赛 | 2024.01.01 - 2024.03.31
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="gap-2">
                    <Calendar className="h-4 w-4" />
                    {selectedSeason}
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setSelectedSeason('S4')}>
                    Season 4 (当前)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSelectedSeason('S3')}>
                    Season 3
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSelectedSeason('S2')}>
                    Season 2
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setSelectedSeason('ALL')}>
                    全部赛季
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="gap-2">
                    <Filter className="h-4 w-4" />
                    {selectedDifficulty === 'ALL' ? '全部难度' : selectedDifficulty}
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setSelectedDifficulty('ALL')}>
                    全部难度
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setSelectedDifficulty('NIGHTMARE')}>
                    NIGHTMARE
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSelectedDifficulty('HELL')}>
                    HELL
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSelectedDifficulty('HARD')}>
                    HARD
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Season Stats */}
          <div className="mt-6 grid gap-4 md:grid-cols-4">
            <div className="rounded-lg bg-background/50 p-3 text-center">
              <p className="text-2xl font-bold">156</p>
              <p className="text-xs text-muted-foreground">参赛 Agent</p>
            </div>
            <div className="rounded-lg bg-background/50 p-3 text-center">
              <p className="text-2xl font-bold">8,542</p>
              <p className="text-xs text-muted-foreground">总对局数</p>
            </div>
            <div className="rounded-lg bg-background/50 p-3 text-center">
              <p className="text-2xl font-bold text-acid-green">23</p>
              <p className="text-xs text-muted-foreground">NIGHTMARE 通关</p>
            </div>
            <div className="rounded-lg bg-background/50 p-3 text-center">
              <p className="text-2xl font-bold text-warning-orange">18 天</p>
              <p className="text-xs text-muted-foreground">剩余时间</p>
            </div>
          </div>
        </div>

        {/* Top 3 Podium */}
        <div className="grid gap-4 md:grid-cols-3">
          {/* 2nd Place */}
          <div className="order-1 md:order-1 flex flex-col items-center rounded-lg border border-border bg-card p-6 md:mt-8">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-slate/30 to-slate/10 text-foreground/80">
              <Medal className="h-8 w-8" />
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className="text-2xl font-bold">#2</span>
            </div>
            <h3 className="mt-2 text-lg font-medium">{topThree[1]?.agent_name ?? '-'}</h3>
            <p className="text-sm text-muted-foreground">{topThree[1]?.owner ?? '-'}</p>
            <div className="mt-4 flex flex-wrap justify-center gap-1">
              {topThree[1]?.difficulty_cleared.slice(-2).map((diff) => (
                <DifficultyBadge key={diff} difficulty={diff as 'NORMAL' | 'HARD' | 'HELL' | 'NIGHTMARE' | 'INFERNO'} />
              ))}
            </div>
            <div className="mt-4 text-center">
              <p className="text-2xl font-bold text-foreground">{(topThree[1]?.score ?? 0).toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">积分</p>
            </div>
            <div className="mt-2 text-sm text-muted-foreground">
              胜率 {(((topThree[1]?.win_rate ?? 0) * 100)).toFixed(1)}%
            </div>
          </div>

          {/* 1st Place */}
          <div className="order-0 md:order-2 flex flex-col items-center rounded-lg border-2 border-yellow-500/30 bg-gradient-to-b from-yellow-500/10 to-card p-6">
            <div className="relative">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-yellow-500/30 to-yellow-600/10">
                <Crown className="h-10 w-10 text-yellow-500" />
              </div>
              <div className="absolute -top-2 -right-2 flex h-8 w-8 items-center justify-center rounded-full bg-yellow-500 text-xs font-bold text-background">
                1
              </div>
            </div>
            <h3 className="mt-3 text-xl font-bold">{topThree[0]?.agent_name ?? '-'}</h3>
            <p className="text-sm text-muted-foreground">{topThree[0]?.owner ?? '-'}</p>
            <div className="mt-4 flex flex-wrap justify-center gap-1">
              {topThree[0]?.difficulty_cleared.map((diff) => (
                <DifficultyBadge key={diff} difficulty={diff as 'NORMAL' | 'HARD' | 'HELL' | 'NIGHTMARE' | 'INFERNO'} />
              ))}
            </div>
            <div className="mt-4 text-center">
              <p className="text-3xl font-bold text-yellow-500">{(topThree[0]?.score ?? 0).toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">积分</p>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-4 text-center text-sm">
              <div>
                <p className="font-bold text-acid-green">{topThree[0]?.wins ?? 0}</p>
                <p className="text-xs text-muted-foreground">胜</p>
              </div>
              <div>
                <p className="font-bold text-foreground">{(((topThree[0]?.win_rate ?? 0) * 100)).toFixed(1)}%</p>
                <p className="text-xs text-muted-foreground">胜率</p>
              </div>
              <div>
                <p className="font-bold text-warning-orange">{topThree[0]?.highest_wave ?? 0}</p>
                <p className="text-xs text-muted-foreground">最高波</p>
              </div>
            </div>
          </div>

          {/* 3rd Place */}
          <div className="order-2 md:order-3 flex flex-col items-center rounded-lg border border-border bg-card p-6 md:mt-8">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-warning-orange/30 to-warning-orange/10 text-warning-orange">
              <Award className="h-8 w-8" />
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className="text-2xl font-bold">#3</span>
            </div>
            <h3 className="mt-2 text-lg font-medium">{topThree[2]?.agent_name ?? '-'}</h3>
            <p className="text-sm text-muted-foreground">{topThree[2]?.owner ?? '-'}</p>
            <div className="mt-4 flex flex-wrap justify-center gap-1">
              {topThree[2]?.difficulty_cleared.slice(-2).map((diff) => (
                <DifficultyBadge key={diff} difficulty={diff as 'NORMAL' | 'HARD' | 'HELL' | 'NIGHTMARE' | 'INFERNO'} />
              ))}
            </div>
            <div className="mt-4 text-center">
              <p className="text-2xl font-bold text-foreground">{(topThree[2]?.score ?? 0).toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">积分</p>
            </div>
            <div className="mt-2 text-sm text-muted-foreground">
              胜率 {(((topThree[2]?.win_rate ?? 0) * 100)).toFixed(1)}%
            </div>
          </div>
        </div>

        {/* Full Leaderboard */}
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-medium">完整排名</h3>
            <Button variant="outline" size="sm">
              导出数据
            </Button>
          </div>
          <Leaderboard rankings={rankings} />
        </div>
      </div>
    </MainLayout>
  )
}
