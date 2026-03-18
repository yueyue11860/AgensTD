import { memo } from 'react'
import { Bot, RefreshCcw, Trophy, UserRound, Waves } from 'lucide-react'
import type { CompetitionRealtimeStatus, DualLeaderboard, LeaderboardEntry, MatchReplay, ReplaySummary } from '../types/competition'
import { cx } from '../lib/cx'

interface CompetitionPanelsProps {
  apiBaseUrl: string | null
  leaderboards: DualLeaderboard
  replays: ReplaySummary[]
  selectedReplayId: string | null
  selectedReplay: MatchReplay | null
  isLoadingOverview: boolean
  isLoadingReplayDetail: boolean
  error: string | null
  realtimeStatus: CompetitionRealtimeStatus
  realtimeError: string | null
  onRefresh: () => void
  onSelectReplay: (matchId: string) => void
}

function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

function formatRealtimeLabel(status: CompetitionRealtimeStatus) {
  switch (status) {
    case 'subscribed':
      return 'Realtime 已连接'
    case 'connecting':
      return 'Realtime 连接中'
    case 'error':
      return 'Realtime 异常'
    default:
      return 'Realtime 未配置'
  }
}

function getRealtimeBadgeClassName(status: CompetitionRealtimeStatus) {
  switch (status) {
    case 'subscribed':
      return 'border-acid-green/30 bg-acid-green/10 text-acid-green'
    case 'connecting':
      return 'border-warning-orange/30 bg-warning-orange/10 text-warning-orange'
    case 'error':
      return 'border-alert-red/30 bg-alert-red/10 text-alert-red'
    default:
      return 'border-white/10 bg-white/[0.04] text-slate-300'
  }
}

function LeaderboardList({
  title,
  icon,
  entries,
}: {
  title: string
  icon: React.ReactNode
  entries: LeaderboardEntry[]
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-center gap-2 text-sm text-white">
        <span className="text-cold-blue">{icon}</span>
        <span>{title}</span>
      </div>

      <div className="mt-4 space-y-3">
        {entries.length > 0 ? entries.map((entry, index) => (
          <article key={`${entry.playerKind}-${entry.playerId}`} className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-slate-500">#{index + 1}</p>
                <p className="mt-2 text-sm font-semibold text-white">{entry.playerName}</p>
                <p className="mt-1 text-xs text-slate-400">{entry.playerId}</p>
              </div>
              <span className={cx(
                'rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.2em]',
                entry.playerKind === 'agent'
                  ? 'border-cold-blue/30 bg-cold-blue/10 text-cold-blue'
                  : 'border-warning-orange/30 bg-warning-orange/10 text-warning-orange',
              )}>
                {entry.playerKind}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-slate-300">
              <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">最高分</p>
                <p className="mt-1 text-sm font-semibold text-white">{entry.bestScore}</p>
              </div>
              <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">最高波次</p>
                <p className="mt-1 text-sm font-semibold text-white">{entry.bestSurvivedWaves}</p>
              </div>
            </div>
          </article>
        )) : (
          <p className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-slate-400">暂无数据，等首个玩家或 Agent 打出成绩后会自动出现。</p>
        )}
      </div>
    </section>
  )
}

export const CompetitionPanels = memo(function CompetitionPanels({
  apiBaseUrl,
  leaderboards,
  replays,
  selectedReplayId,
  selectedReplay,
  isLoadingOverview,
  isLoadingReplayDetail,
  error,
  realtimeStatus,
  realtimeError,
  onRefresh,
  onSelectReplay,
}: CompetitionPanelsProps) {
  const latestFrames = selectedReplay?.frames.slice(-5).reverse() ?? []
  const latestActions = selectedReplay?.actions.slice(-5).reverse() ?? []

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      <article className="rounded-3xl border border-white/10 bg-black/20 p-4 backdrop-blur-md">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.26em] text-cold-blue">Dual Leaderboards</p>
            <h2 className="mt-2 text-xl font-semibold text-white">碳基榜 / 硅基榜</h2>
            <p className="mt-2 text-sm text-slate-400">排行榜优先读 Supabase 持久化成绩；已配置 Realtime 时会在 leaderboard_entries 变更后自动刷新，未配置时回退到轮询和当前进程快照。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={cx(
              'inline-flex items-center rounded-full border px-3 py-2 text-[11px] uppercase tracking-[0.18em]',
              getRealtimeBadgeClassName(realtimeStatus),
            )}>
              {formatRealtimeLabel(realtimeStatus)}
            </span>
            <button
              type="button"
              onClick={onRefresh}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white transition-colors hover:bg-white/[0.08]"
            >
              <RefreshCcw className={cx('h-4 w-4', isLoadingOverview && 'animate-spin')} />
              刷新榜单
            </button>
          </div>
        </div>

        {realtimeError ? <p className="mt-3 text-xs text-alert-red">{realtimeError}</p> : null}

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <LeaderboardList title="Human" icon={<UserRound className="h-4 w-4" />} entries={leaderboards.human} />
          <LeaderboardList title="Agent" icon={<Bot className="h-4 w-4" />} entries={leaderboards.agent} />
        </div>
      </article>

      <article className="rounded-3xl border border-white/10 bg-black/20 p-4 backdrop-blur-md">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.26em] text-cold-blue">Replay Archive</p>
            <h2 className="mt-2 text-xl font-semibold text-white">回放摘要与最近帧</h2>
            <p className="mt-2 text-sm text-slate-400">接口基址：{apiBaseUrl ?? '未解析'}。列表来自 Supabase，当前对局未落库时会回退到内存回放。</p>
          </div>
          {error ? <p className="text-xs text-alert-red">{error}</p> : null}
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
          <section className="space-y-3">
            {replays.length > 0 ? replays.map((replay) => (
              <button
                key={replay.matchId}
                type="button"
                onClick={() => onSelectReplay(replay.matchId)}
                className={cx(
                  'w-full rounded-2xl border px-4 py-3 text-left transition-colors',
                  selectedReplayId === replay.matchId
                    ? 'border-cold-blue/30 bg-cold-blue/10'
                    : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08]',
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-white">{replay.matchId}</span>
                  <Waves className="h-4 w-4 text-cold-blue" />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-300">
                  <span>Tick {replay.latestTick}</span>
                  <span>Wave {replay.topWave}</span>
                  <span>{replay.frameCount} 帧</span>
                  <span>{replay.actionCount} 动作</span>
                </div>
                <p className="mt-3 text-[11px] text-slate-500">更新于 {formatTime(replay.updatedAt)}</p>
              </button>
            )) : (
              <p className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-slate-400">当前还没有可读取的回放摘要。</p>
            )}
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            {selectedReplay ? (
              <>
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Frames</p>
                    <p className="mt-2 text-lg font-semibold text-white">{selectedReplay.frames.length}</p>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Actions</p>
                    <p className="mt-2 text-lg font-semibold text-white">{selectedReplay.actions.length}</p>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Created</p>
                    <p className="mt-2 text-sm font-semibold text-white">{formatTime(selectedReplay.createdAt)}</p>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Updated</p>
                    <p className="mt-2 text-sm font-semibold text-white">{formatTime(selectedReplay.updatedAt)}</p>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <section className="rounded-2xl border border-white/8 bg-black/20 p-4">
                    <div className="flex items-center gap-2 text-sm text-white">
                      <Trophy className="h-4 w-4 text-warning-orange" />
                      最近帧
                    </div>
                    <div className="mt-4 space-y-3">
                      {latestFrames.length > 0 ? latestFrames.map((frame) => (
                        <article key={`${frame.tick}-${frame.recordedAt}`} className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-3 text-sm text-slate-300">
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-semibold text-white">Tick {frame.tick}</span>
                            <span className="text-xs text-slate-500">Wave {frame.gameState.wave?.index ?? '-'}</span>
                          </div>
                          <p className="mt-2 text-xs text-slate-400">敌人数 {frame.gameState.enemies.length}，塔数 {frame.gameState.towers.length}，分数 {frame.gameState.score ?? 0}</p>
                        </article>
                      )) : (
                        <p className="text-sm text-slate-400">暂无帧数据。</p>
                      )}
                    </div>
                  </section>

                  <section className="rounded-2xl border border-white/8 bg-black/20 p-4">
                    <div className="flex items-center gap-2 text-sm text-white">
                      <Bot className="h-4 w-4 text-cold-blue" />
                      最近动作
                    </div>
                    <div className="mt-4 space-y-3">
                      {latestActions.length > 0 ? latestActions.map((action) => (
                        <article key={action.id} className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-3 text-sm text-slate-300">
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-semibold text-white">{action.player.playerName}</span>
                            <span className="text-xs uppercase tracking-[0.2em] text-slate-500">{action.action.action}</span>
                          </div>
                          <p className="mt-2 text-xs text-slate-400">{new Date(action.receivedAt).toLocaleString('zh-CN', { hour12: false })}</p>
                        </article>
                      )) : (
                        <p className="text-sm text-slate-400">暂无动作记录。</p>
                      )}
                    </div>
                  </section>
                </div>
              </>
            ) : (
              <div className="flex min-h-[260px] items-center justify-center rounded-2xl border border-dashed border-white/10 text-sm text-slate-400">
                {isLoadingReplayDetail ? '正在读取回放详情…' : '从左侧选择一条回放以查看最近帧和动作。'}
              </div>
            )}
          </section>
        </div>
      </article>
    </section>
  )
})