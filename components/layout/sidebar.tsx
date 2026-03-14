'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Bot,
  Eye,
  History,
  Trophy,
  Lock,
  ChevronLeft,
  ChevronRight,
  Zap,
  Radio
} from 'lucide-react'

const navItems = [
  { href: '/', label: '主战场', icon: LayoutDashboard, badge: null, section: 'main' },
  { href: '/agents', label: 'Agent 管理', icon: Bot, badge: '5', section: 'main' },
  { href: '/spectate', label: '观战台', icon: Eye, badge: 'LIVE', section: 'main' },
  { href: '/replays', label: '回放中心', icon: History, badge: null, section: 'analysis' },
  { href: '/rankings', label: '赛季排行', icon: Trophy, badge: null, section: 'analysis' },
  { href: '/progress', label: '难度进度', icon: Lock, badge: null, section: 'analysis' },
]

interface SidebarProps {
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
  mobile?: boolean
  onNavigate?: () => void
}

export function Sidebar({ collapsed = false, onCollapsedChange, mobile = false, onNavigate }: SidebarProps) {
  const pathname = usePathname()

  const mainItems = navItems.filter(item => item.section === 'main')
  const analysisItems = navItems.filter(item => item.section === 'analysis')

  return (
    <aside
      className={cn(
        'h-full border-r border-border bg-sidebar',
        mobile
          ? 'w-full'
          : cn('fixed left-0 top-0 z-40 transition-all duration-300', collapsed ? 'w-16' : 'w-64')
      )}
    >
      {/* Subtle grid background */}
      <div className="pointer-events-none absolute inset-0 bg-grid-dense opacity-30" />
      
      {/* Logo */}
      <div className="relative flex h-16 items-center justify-between border-b border-sidebar-border px-4">
        {!collapsed && (
          <Link href="/" className="flex items-center gap-3">
            <div className="relative flex h-9 w-9 items-center justify-center">
              <div className="absolute inset-0 rounded-lg bg-primary/20" />
              <div className="absolute inset-0 rounded-lg bg-primary/10 blur-md" />
              <Zap className="relative h-5 w-5 text-primary" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-bold tracking-widest text-foreground">NEXUS</span>
              <span className="text-[10px] tracking-[0.2em] text-muted-foreground">ARENA S4</span>
            </div>
          </Link>
        )}
        {collapsed && (
          <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
            <Zap className="h-5 w-5 text-primary" />
          </div>
        )}
        {!mobile && (
          <button
            onClick={() => onCollapsedChange?.(!collapsed)}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="relative flex flex-col gap-1 p-2">
        {/* Main Section */}
        {!collapsed && (
          <div className="mb-1 px-3 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
              作战中心
            </span>
          </div>
        )}
        {mainItems.map((item) => (
          <NavItem key={item.href} item={item} isActive={pathname === item.href} collapsed={collapsed} onNavigate={onNavigate} />
        ))}

        {/* Analysis Section */}
        {!collapsed && (
          <div className="mb-1 mt-4 px-3 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
              数据分析
            </span>
          </div>
        )}
        {collapsed && <div className="my-2 border-t border-sidebar-border" />}
        {analysisItems.map((item) => (
          <NavItem key={item.href} item={item} isActive={pathname === item.href} collapsed={collapsed} onNavigate={onNavigate} />
        ))}
      </nav>

      {/* Status Panel */}
      {!collapsed && !mobile && (
        <div className="absolute bottom-0 left-0 right-0 border-t border-sidebar-border bg-sidebar/80 p-4 backdrop-blur-sm">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="status-light status-light-active" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                系统状态
              </span>
            </div>
            <Radio className="h-3 w-3 animate-pulse text-acid-green" />
          </div>
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">服务器负载</span>
                <span className="font-mono text-acid-green">67%</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full w-[67%] rounded-full bg-gradient-to-r from-acid-green/80 to-acid-green transition-all" />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">API 延迟</span>
                <span className="font-mono text-cold-blue">12ms</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full w-[15%] rounded-full bg-gradient-to-r from-cold-blue/80 to-cold-blue transition-all" />
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-sidebar-border pt-2 text-xs">
              <span className="text-muted-foreground">活跃对局</span>
              <span className="font-mono text-warning-orange">23 LIVE</span>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}

// NavItem Component
interface NavItemProps {
  item: typeof navItems[0]
  isActive: boolean
  collapsed: boolean
  onNavigate?: () => void
}

function NavItem({ item, isActive, collapsed, onNavigate }: NavItemProps) {
  const Icon = item.icon
  
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        'group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-all',
        isActive
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'
      )}
    >
      {isActive && (
        <div className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-primary shadow-[0_0_8px_rgba(101,144,247,0.5)]" />
      )}
      <Icon className={cn('h-4 w-4 shrink-0', isActive && 'text-primary')} />
      {!collapsed && (
        <>
          <span className="flex-1 truncate text-xs">{item.label}</span>
          {item.badge && (
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide',
                item.badge === 'LIVE'
                  ? 'animate-pulse bg-alert-red/20 text-alert-red'
                  : 'bg-muted/80 text-muted-foreground'
              )}
            >
              {item.badge}
            </span>
          )}
        </>
      )}
    </Link>
  )
}
