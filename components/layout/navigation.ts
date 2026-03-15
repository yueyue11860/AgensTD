'use client'

import type { LucideIcon } from 'lucide-react'
import {
  History,
  LayoutDashboard,
  Trophy,
} from 'lucide-react'

export interface NavigationItem {
  href: string
  label: string
  description: string
  icon: LucideIcon
}

export const primaryNavigationItems: NavigationItem[] = [
  {
    href: '/',
    label: '开始游戏',
    description: '开始挑战和单局推进',
    icon: LayoutDashboard,
  },
  {
    href: '/replays',
    label: '回放中心',
    description: '查阅结算记录和关键帧',
    icon: History,
  },
  {
    href: '/rankings',
    label: '赛季排行',
    description: '查看赛季名次变化',
    icon: Trophy,
  },
]