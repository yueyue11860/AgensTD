'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { primaryNavigationItems } from './navigation'
import {
  Bell,
  User,
  ChevronDown,
  Clock,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface HeaderProps {
  title?: string
  subtitle?: string
}

export function Header({}: HeaderProps) {
  const [currentTime, setCurrentTime] = useState<Date | null>(null)
  const isConnected = true
  const pathname = usePathname()

  useEffect(() => {
    queueMicrotask(() => setCurrentTime(new Date()))
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
      {/* Top accent line */}
      <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
      
      <div className="relative flex h-14 items-center justify-between gap-4 px-4 lg:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-dashed border-primary/40 bg-primary/8 text-[9px] font-medium uppercase tracking-[0.24em] text-primary/80">
            Logo
          </div>
          <div>
            <h1 className="text-base font-bold tracking-[0.18em] text-foreground">零域裁决</h1>
          </div>
        </div>

        <nav className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 lg:block">
          <div className="pointer-events-auto flex items-center gap-2 rounded-2xl border border-border/70 bg-card/55 px-2 py-1 backdrop-blur-md">
            {primaryNavigationItems.map((item) => {
              const Icon = item.icon
              const isActive = pathname === item.href

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex h-10 items-center gap-2 rounded-xl border px-3 text-sm transition-colors',
                    isActive
                      ? 'border-primary/40 bg-primary/12 text-primary shadow-[0_0_0_1px_rgba(101,144,247,0.16)]'
                      : 'border-transparent text-muted-foreground hover:border-primary/20 hover:bg-muted/30 hover:text-foreground',
                  )}
                >
                  <span className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-lg border',
                    isActive ? 'border-primary/30 bg-primary/10' : 'border-border/60 bg-background/50',
                  )}>
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="font-medium whitespace-nowrap">{item.label}</span>
                </Link>
              )
            })}
          </div>
        </nav>

        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-2 rounded border border-border bg-muted/30 px-3 py-1.5 lg:flex">
            <Clock className="h-3 w-3 text-muted-foreground" />
            <span className="font-mono text-[10px] tabular-nums text-foreground">
              {currentTime ? currentTime.toLocaleTimeString('zh-CN', { hour12: false }) : '--:--:--'}
            </span>
          </div>

          <div
            className={cn(
              'flex items-center gap-1.5 rounded px-2 py-1.5',
              isConnected
                ? 'bg-acid-green/10'
                : 'bg-alert-red/10'
            )}
          >
            <div className={cn(
              'status-light',
              isConnected ? 'status-light-active' : 'status-light-error'
            )} />
            {isConnected ? (
              <span className="hidden font-mono text-[10px] text-acid-green sm:inline">ONLINE</span>
            ) : (
              <span className="hidden font-mono text-[10px] text-alert-red sm:inline">OFFLINE</span>
            )}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative">
                <Bell className="h-4 w-4 text-muted-foreground" />
                <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-warning-orange" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-sm font-medium">通知</span>
                <span className="text-xs text-muted-foreground">3 条未读</span>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="flex flex-col items-start gap-1 p-3">
                <span className="text-sm">TowerMaster-Pro 完成 HELL 难度</span>
                <span className="text-xs text-muted-foreground">2 分钟前</span>
              </DropdownMenuItem>
              <DropdownMenuItem className="flex flex-col items-start gap-1 p-3">
                <span className="text-sm">新赛季 S4 已开启</span>
                <span className="text-xs text-muted-foreground">1 小时前</span>
              </DropdownMenuItem>
              <DropdownMenuItem className="flex flex-col items-start gap-1 p-3">
                <span className="text-sm">DeepDefender-v3 排名上升至 #2</span>
                <span className="text-xs text-muted-foreground">3 小时前</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="flex items-center gap-2 px-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/20 text-primary">
                  <User className="h-4 w-4" />
                </div>
                <div className="hidden flex-col items-start lg:flex">
                  <span className="text-sm font-medium">team_alpha</span>
                  <span className="text-[10px] text-muted-foreground">开发者</span>
                </div>
                <ChevronDown className="hidden h-4 w-4 text-muted-foreground lg:block" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem>个人资料</DropdownMenuItem>
              <DropdownMenuItem>账单设置</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-alert-red">退出登录</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}
