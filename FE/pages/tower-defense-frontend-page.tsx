import { useCallback, useMemo, useState } from 'react'
import { Plug, RefreshCcw, ShieldAlert, Wifi, WifiOff } from 'lucide-react'
import { CompetitionPanels } from '../components/competition-panels'
import { FrontendShell } from '../components/frontend-shell'
import { GameMap } from '../components/game-map'
import { GameResources, ThreatCard } from '../components/game-resources'
import { GameSidebar } from '../components/game-sidebar'
import { useCompetitionData } from '../hooks/use-competition-data'
import { cx } from '../lib/cx'
import { useGameEngine } from '../hooks/use-game-engine'
import type { GameAction, GameCell, GridPosition, TowerState } from '../types/game-state'

function formatTime(timestamp: number | null) {
  if (!timestamp) {
    return '暂无'
  }

  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour12: false,
  })
}

export function TowerDefenseFrontendPage() {
  const {
    socketUrl,
    gameState,
    connectionState,
    error,
    isConnected,
    lastTickAt,
    lastActionAt,
    sendAction,
    reconnect,
  } = useGameEngine()

  const {
    apiBaseUrl,
    leaderboards,
    replays,
    selectedReplayId,
    selectedReplay,
    isLoadingOverview,
    isLoadingReplayDetail,
    error: competitionError,
    realtimeStatus,
    realtimeError,
    selectReplay,
    refresh: refreshCompetition,
  } = useCompetitionData()

  const [selectedCell, setSelectedCell] = useState<GridPosition | null>(null)
  const [selectedTowerId, setSelectedTowerId] = useState<string | null>(null)
  const [selectedBuildType, setSelectedBuildType] = useState<string | null>(null)
  const [lastSentAction, setLastSentAction] = useState<GameAction | null>(null)

  const selectedTower = useMemo(() => {
    if (!gameState || !selectedTowerId) {
      return null
    }

    return gameState.towers.find((tower) => tower.id === selectedTowerId) ?? null
  }, [gameState, selectedTowerId])

  const selectedCellData = useMemo(() => {
    if (!gameState || !selectedCell) {
      return null
    }

    return gameState.map.cells.find((cell) => cell.x === selectedCell.x && cell.y === selectedCell.y) ?? null
  }, [gameState, selectedCell])

  const mapState = useMemo(() => {
    if (!gameState) {
      return null
    }

    return {
      tick: gameState.tick,
      map: gameState.map,
      towers: gameState.towers,
      enemies: gameState.enemies,
    }
  }, [gameState])

  const sidebarState = useMemo(() => {
    return {
      buildPalette: gameState?.buildPalette ?? [],
      actionBar: gameState?.actionBar,
      notices: gameState?.notices,
    }
  }, [gameState?.actionBar, gameState?.buildPalette, gameState?.notices])

  const handleAction = useCallback((action: GameAction) => {
    if (sendAction(action)) {
      setLastSentAction(action)
    }
  }, [sendAction])

  const handleCellClick = useCallback((cell: GameCell, tower: TowerState | null) => {
    setSelectedCell({ x: cell.x, y: cell.y })
    setSelectedTowerId(tower?.id ?? null)

    if (tower || cell.kind !== 'build' || !selectedBuildType) {
      return
    }

    handleAction({
      action: 'BUILD_TOWER',
      type: selectedBuildType,
      x: cell.x,
      y: cell.y,
    })
  }, [handleAction, selectedBuildType])

  return (
    <FrontendShell>
      <div className="space-y-4">
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
            <article className="rounded-3xl border border-white/10 bg-black/20 p-4 backdrop-blur-md">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.26em] text-cold-blue">连接状态</p>
                  <h2 className="mt-2 text-xl font-semibold text-white">{isConnected ? '已连接游戏引擎' : '等待游戏引擎'}</h2>
                  <p className="mt-2 text-sm text-slate-400">开发环境优先读取 WebSocket 环境变量，缺省时回退到当前站点同源地址。</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className={cx(
                    'inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs',
                    isConnected ? 'border-acid-green/30 bg-acid-green/10 text-acid-green' : 'border-white/10 bg-white/[0.04] text-slate-300',
                  )}>
                    {isConnected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
                    {connectionState}
                  </span>
                  <button
                    type="button"
                    onClick={reconnect}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white transition-colors hover:bg-white/[0.08]"
                  >
                    <RefreshCcw className="h-4 w-4" />
                    重新连接
                  </button>
                </div>
              </div>

              <div className="mt-4 grid gap-3 text-sm text-slate-300 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Socket 地址</p>
                  <p className="mt-2 break-all text-white">{socketUrl ?? '未解析'}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">最近 Tick</p>
                  <p className="mt-2 text-white">{formatTime(lastTickAt)}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">最近动作</p>
                  <p className="mt-2 text-white">{formatTime(lastActionAt)}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">比赛状态</p>
                  <p className="mt-2 text-white">
                    {gameState?.status ?? 'waiting'}
                    {gameState?.result ? ` · ${gameState.result.outcome}` : ''}
                  </p>
                </div>
              </div>

              {error ? (
                <div className="mt-4 flex items-start gap-3 rounded-2xl border border-alert-red/20 bg-alert-red/10 px-4 py-3 text-sm text-alert-red">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : null}

              {gameState?.result ? (
                <div className={cx(
                  'mt-4 rounded-2xl border px-4 py-3 text-sm',
                  gameState.result.outcome === 'victory'
                    ? 'border-acid-green/20 bg-acid-green/10 text-acid-green'
                    : 'border-alert-red/20 bg-alert-red/10 text-alert-red',
                )}>
                  {gameState.result.outcome === 'victory' ? '胜利' : '失败'}
                  {gameState.result.reason ? ` · ${gameState.result.reason}` : ''}
                  {` · Tick ${gameState.result.decidedAtTick}`}
                </div>
              ) : null}
            </article>

            <ThreatCard value={gameState?.resources.threat ?? 0} />
          </div>

          {gameState ? <GameResources resources={gameState.resources} /> : null}

          {gameState ? (
            <GameMap
              tick={mapState?.tick ?? 0}
              map={mapState?.map ?? gameState.map}
              towers={mapState?.towers ?? gameState.towers}
              enemies={mapState?.enemies ?? gameState.enemies}
              selectedCell={selectedCell}
              selectedTowerId={selectedTowerId}
              onCellClick={handleCellClick}
            />
          ) : (
            <section className="rounded-3xl border border-dashed border-white/10 bg-black/20 p-10 text-center backdrop-blur-md">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-cold-blue/20 bg-cold-blue/10 text-cold-blue">
                <Plug className="h-6 w-6" />
              </div>
              <h2 className="mt-4 text-xl font-semibold text-white">等待首个 tick_update</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
                当前前端不会生成任何本地 mock 战场，也不会自行推进 Tick。只有当后端通过 Socket.io 推送最新 GameState 后，网格、塔和敌人才会开始渲染。
              </p>
            </section>
          )}
          </div>

          <GameSidebar
            buildPalette={sidebarState.buildPalette}
            actionBar={sidebarState.actionBar}
            notices={sidebarState.notices}
            selectedCell={selectedCell}
            selectedCellData={selectedCellData}
            selectedTower={selectedTower}
            selectedBuildType={selectedBuildType}
            lastSentAction={lastSentAction}
            onSelectBuildType={setSelectedBuildType}
            onAction={handleAction}
          />
        </section>

        <CompetitionPanels
          apiBaseUrl={apiBaseUrl}
          leaderboards={leaderboards}
          replays={replays}
          selectedReplayId={selectedReplayId}
          selectedReplay={selectedReplay}
          isLoadingOverview={isLoadingOverview}
          isLoadingReplayDetail={isLoadingReplayDetail}
          error={competitionError}
          realtimeStatus={realtimeStatus}
          realtimeError={realtimeError}
          onRefresh={refreshCompetition}
          onSelectReplay={selectReplay}
        />
      </div>
    </FrontendShell>
  )
}