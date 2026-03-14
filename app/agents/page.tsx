'use client'

import { useState } from 'react'
import { MainLayout } from '@/components/layout/main-layout'
import { AgentStatusBadge, StatusBadge } from '@/components/game/status-badge'
import { Button } from '@/components/ui/button'
import { useAgentsData } from '@/hooks/use-agents-data'
import { enqueueRun } from '@/lib/supabase/functions'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  Plus,
  Search,
  Bot,
  Play,
  Settings,
  Trash2,
  MoreVertical,
  TrendingUp,
  Clock,
  Target,
  Activity,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'

export default function AgentsPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [launchingAgentId, setLaunchingAgentId] = useState<string | null>(null)
  const { agents, isLoading, error, isUsingFallback } = useAgentsData()

  const filteredAgents = agents.filter((agent) => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      return (
        agent.name.toLowerCase().includes(query) ||
        agent.owner.toLowerCase().includes(query)
      )
    }
    return true
  })

  const activeAgents = agents.filter((agent) => agent.status === 'active').length
  const averageWinRate = agents.length > 0
    ? (agents.reduce((acc, agent) => acc + agent.win_rate, 0) / agents.length) * 100
    : 0
  const totalRuns = agents.reduce((acc, agent) => acc + agent.total_runs, 0)

  async function handleLaunchRun(agentId: string, agentName: string) {
    setLaunchingAgentId(agentId)

    const result = await enqueueRun({
      agentId,
      difficulty: 'HELL',
    })

    setLaunchingAgentId(null)

    if (result.error || !result.data) {
      toast.error(`无法为 ${agentName} 创建 Run`, {
        description: result.error?.message ?? '请检查 Supabase Edge Function 与环境变量配置。',
      })
      return
    }

    toast.success(`已为 ${agentName} 提交 Run`, {
      description: `Run Code: ${result.data.runCode}`,
    })
  }

  return (
    <MainLayout title="Agent 管理">
      <div className="space-y-6">
        {(isUsingFallback || error) && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4">
            <StatusBadge variant={error ? 'warning' : 'info'}>
              {error ? 'Supabase 查询失败，已回退到 mock 数据' : 'Supabase 未配置，当前使用 mock 数据'}
            </StatusBadge>
            {isLoading && <StatusBadge variant="default">同步中</StatusBadge>}
          </div>
        )}

        {/* Toolbar */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="搜索 Agent..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-muted/50 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            创建 Agent
          </Button>
        </div>

        {/* Stats */}
        <div className="grid gap-4 sm:grid-cols-4">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Bot className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{agents.length}</p>
              <p className="text-xs text-muted-foreground">总 Agent 数</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-acid-green/10">
              <Activity className="h-5 w-5 text-acid-green" />
            </div>
            <div>
              <p className="text-2xl font-bold text-acid-green">
                {activeAgents}
              </p>
              <p className="text-xs text-muted-foreground">活跃</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cold-blue/10">
              <TrendingUp className="h-5 w-5 text-cold-blue" />
            </div>
            <div>
              <p className="text-2xl font-bold text-cold-blue">
                {averageWinRate.toFixed(1)}%
              </p>
              <p className="text-xs text-muted-foreground">平均胜率</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning-orange/10">
              <Target className="h-5 w-5 text-warning-orange" />
            </div>
            <div>
              <p className="text-2xl font-bold text-warning-orange">
                {totalRuns.toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground">总运行次数</p>
            </div>
          </div>
        </div>

        {/* Agent Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredAgents.map((agent) => (
            <div
              key={agent.id}
              className="rounded-lg border border-border bg-card p-4 transition-all hover:border-primary/30"
            >
              {/* Header */}
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                    <Bot className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-medium">{agent.name}</h3>
                    <p className="text-xs text-muted-foreground">v{agent.version}</p>
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem className="gap-2" onClick={() => handleLaunchRun(agent.id, agent.name)}>
                      <Play className="h-4 w-4" />
                      启动 Run
                    </DropdownMenuItem>
                    <DropdownMenuItem className="gap-2">
                      <Settings className="h-4 w-4" />
                      配置
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="gap-2 text-alert-red">
                      <Trash2 className="h-4 w-4" />
                      删除
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Status */}
              <div className="mt-3 flex items-center gap-2">
                <AgentStatusBadge status={agent.status} />
                <span className="text-xs text-muted-foreground">
                  by {agent.owner}
                </span>
              </div>

              {/* Stats Grid */}
              <div className="mt-4 grid grid-cols-3 gap-4 border-t border-border pt-4">
                <div className="text-center">
                  <p className="text-lg font-bold">{agent.total_runs}</p>
                  <p className="text-xs text-muted-foreground">运行次数</p>
                </div>
                <div className="text-center">
                  <p className={cn(
                    'text-lg font-bold',
                    agent.win_rate >= 0.7 ? 'text-acid-green' : agent.win_rate >= 0.5 ? 'text-foreground' : 'text-alert-red'
                  )}>
                    {(agent.win_rate * 100).toFixed(0)}%
                  </p>
                  <p className="text-xs text-muted-foreground">胜率</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-warning-orange">
                    {(agent.avg_score / 1000).toFixed(1)}k
                  </p>
                  <p className="text-xs text-muted-foreground">平均分</p>
                </div>
              </div>

              {/* Actions */}
              <div className="mt-4 flex gap-2">
                <Button
                  variant="secondary"
                  className="flex-1 gap-2"
                  size="sm"
                  disabled={launchingAgentId === agent.id}
                  onClick={() => handleLaunchRun(agent.id, agent.name)}
                >
                  <Play className="h-4 w-4" />
                  {launchingAgentId === agent.id ? '提交中...' : '启动'}
                </Button>
                <Button variant="outline" className="flex-1 gap-2" size="sm">
                  <Settings className="h-4 w-4" />
                  调试
                </Button>
              </div>

              {/* Last Active */}
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span>最后活跃: {new Date(agent.last_active).toLocaleString('zh-CN')}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Empty State */}
        {filteredAgents.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16">
            <Bot className="h-12 w-12 text-muted-foreground/50" />
            <h3 className="mt-4 text-lg font-medium">没有找到 Agent</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              尝试调整搜索条件或创建新的 Agent
            </p>
            <Button className="mt-4 gap-2">
              <Plus className="h-4 w-4" />
              创建 Agent
            </Button>
          </div>
        )}
      </div>
    </MainLayout>
  )
}
