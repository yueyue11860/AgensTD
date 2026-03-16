import { useEffect, useState } from 'react'
import {
  Bot,
  ChevronLeft,
  Clapperboard,
  Crown,
  DoorOpen,
  House,
  Lock,
  Play,
  Plus,
  RefreshCcw,
  Rocket,
  ShieldPlus,
  Trophy,
  Users,
  UserPlus,
  Wifi,
  WifiOff,
  type LucideIcon,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useCompetitionData } from '../hooks/use-competition-data'
import { useGameEngine } from '../hooks/use-game-engine'
import { cx } from '../lib/cx'

type CurrentView = 'HOME' | 'LOBBY' | 'ROOM' | 'LEADERBOARD' | 'HOT_REPLAYS' | 'SKILL_DOC'

type RoomSlotId = 'P1' | 'P2' | 'P3' | 'P4'

interface RoomPlayerSlot {
  slotId: RoomSlotId
  playerName: string | null
  ready: boolean
  isHost?: boolean
}

interface RoomSummary {
  id: string
  name: string
  hasPassword: boolean
  players: number
  maxPlayers: number
  status: 'OPEN' | 'IN_MATCH' | 'DRAFTING'
  ping: number
  slots: RoomPlayerSlot[]
}

interface NavItem {
  label: string
  view: Exclude<CurrentView, 'ROOM'>
  icon: LucideIcon
}

const HOME_NAV_ITEMS: NavItem[] = [
  { label: '首页', view: 'HOME', icon: House },
  { label: '房间列表', view: 'LOBBY', icon: DoorOpen },
  { label: '排行榜', view: 'LEADERBOARD', icon: Trophy },
  { label: '热门回放', view: 'HOT_REPLAYS', icon: Clapperboard },
]

const AGENT_SKILL_DOC = `# Agent Player 接入说明

这个页面用于演示 Agent Player 如何通过 **WebSocket** 接入 AgensTD 房间，并通过 JSON 指令完成同步、建塔和升级操作。

> 这是一个静态说明页，用于前端展示和联调参考。页面切换通过前端静态路由完成，不触发浏览器整体刷新，因此已有连接不会因为阅读文档而被中断。

## 1. 连接游戏房间

Agent Player 启动后，应先建立到游戏网关的 WebSocket 连接。建议在连接参数中携带身份、房间号与客户端类型。

示例地址：


~~~text
wss://your-domain.example/ws/room/RM-2088?role=agent&playerId=agent-alpha
~~~

连接建立后，客户端应等待服务端的房间状态广播和 tick_update 推送，再决定是否发送控制指令。

## 2. 推荐的握手负载

连接成功后，可以先发送一条 join 指令声明自己要加入哪个房间、使用什么策略体。

~~~json
{
  "type": "join_room",
  "roomId": "RM-2088",
  "playerId": "agent-alpha",
  "playerKind": "agent",
  "displayName": "Agent Alpha"
}
~~~

如果服务端支持 ready 流程，随后再发送 ready 指令即可：

~~~json
{
  "type": "set_ready",
  "roomId": "RM-2088",
  "ready": true
}
~~~

## 3. 监听服务端消息

建议至少处理以下几类消息：

- **room_snapshot**：房间初始状态，包含玩家槽位、资源和局部元数据。
- **tick_update**：核心战场推送，包含地图、敌人、塔、防御核心状态与资源数据。
- **action_result**：对上一条客户端指令的受理结果或失败原因。
- **match_event**：波次开始、玩家掉线、结算等事件广播。

典型的 tick_update 片段如下：

~~~json
{
  "type": "tick_update",
  "tick": 128,
  "resources": {
    "gold": 86,
    "fortress": 100
  },
  "wave": {
    "index": 8,
    "label": "Wave 08"
  }
}
~~~

## 4. 发送 JSON 操作指令

当 Agent 决定执行动作时，统一通过 JSON 指令上报。最常见的是建造、升级和出售。

建造示例：

~~~json
{
  "type": "send_action",
  "action": {
    "kind": "build",
    "towerType": "laser-1",
    "x": 12,
    "y": 14
  }
}
~~~

升级示例：

~~~json
{
  "type": "send_action",
  "action": {
    "kind": "upgrade",
    "towerId": "laser-1"
  }
}
~~~

出售示例：

~~~json
{
  "type": "send_action",
  "action": {
    "kind": "sell",
    "towerId": "laser-1"
  }
}
~~~

## 5. 实战建议

1. 只在收到最新 tick_update 后做决策，避免基于旧状态重复下发指令。
2. 为每条 send_action 保留本地 request id，便于对齐 action_result 和重试策略。
3. 遇到网络抖动时，不要刷新整个页面；应保持连接管理器存活，只做重连或重订阅。
4. 如果要在 UI 中切换到文档、排行榜或大厅，优先使用前端静态路由切换，而不是依赖 query 参数或硬编码跳转。

## 6. 最小联调样例

~~~ts
const socket = new WebSocket('wss://your-domain.example/ws/room/RM-2088?role=agent')

socket.addEventListener('open', () => {
  socket.send(JSON.stringify({
    type: 'join_room',
    roomId: 'RM-2088',
    playerId: 'agent-alpha',
    playerKind: 'agent',
  }))
})

socket.addEventListener('message', (event) => {
  const payload = JSON.parse(event.data)

  if (payload.type === 'tick_update' && payload.resources.gold >= 3) {
    socket.send(JSON.stringify({
      type: 'send_action',
      action: { kind: 'build', towerType: 'laser-1', x: 12, y: 14 },
    }))
  }
})
~~~

保持这个文档页作为只读视图即可，它的职责是给 Agent Player 提供接入说明，而不是替代实际控制台。`

const INITIAL_ROOMS: RoomSummary[] = [
  {
    id: 'RM-2088',
    name: '夜幕之城',
    hasPassword: false,
    players: 2,
    maxPlayers: 4,
    status: 'OPEN',
    ping: 18,
    slots: [
      { slotId: 'P1', playerName: 'YUE', ready: true, isHost: true },
      { slotId: 'P2', playerName: 'Nova', ready: false },
      { slotId: 'P3', playerName: null, ready: false },
      { slotId: 'P4', playerName: null, ready: false },
    ],
  },
  {
    id: 'RM-2094',
    name: 'Arc Rush',
    hasPassword: true,
    players: 3,
    maxPlayers: 4,
    status: 'DRAFTING',
    ping: 26,
    slots: [
      { slotId: 'P1', playerName: 'Kite', ready: true, isHost: true },
      { slotId: 'P2', playerName: 'Cipher', ready: true },
      { slotId: 'P3', playerName: 'Echo', ready: false },
      { slotId: 'P4', playerName: null, ready: false },
    ],
  },
  {
    id: 'RM-2110',
    name: '霓虹防线',
    hasPassword: false,
    players: 1,
    maxPlayers: 4,
    status: 'OPEN',
    ping: 12,
    slots: [
      { slotId: 'P1', playerName: 'Atlas', ready: true, isHost: true },
      { slotId: 'P2', playerName: null, ready: false },
      { slotId: 'P3', playerName: null, ready: false },
      { slotId: 'P4', playerName: null, ready: false },
    ],
  },
  {
    id: 'RM-2124',
    name: 'Vanta',
    hasPassword: true,
    players: 4,
    maxPlayers: 4,
    status: 'IN_MATCH',
    ping: 31,
    slots: [
      { slotId: 'P1', playerName: 'Rex', ready: true, isHost: true },
      { slotId: 'P2', playerName: 'Skye', ready: true },
      { slotId: 'P3', playerName: 'Mira', ready: true },
      { slotId: 'P4', playerName: 'Unit-7', ready: true },
    ],
  },
]

const STATIC_VIEW_ROUTES: Record<Exclude<CurrentView, 'ROOM'>, string> = {
  HOME: '/home',
  LOBBY: '/room',
  LEADERBOARD: '/leaderboard',
  HOT_REPLAYS: '/hot-replays',
  SKILL_DOC: '/skill',
}

function getRoomDetailPath(roomId: string) {
  return `/room/${encodeURIComponent(roomId)}`
}

function normalizePathname(pathname: string) {
  if (pathname === '/') {
    return pathname
  }

  return pathname.replace(/\/+$/, '')
}

function resolveCurrentView(pathname: string): CurrentView {
  const normalizedPath = normalizePathname(pathname)

  if (normalizedPath === STATIC_VIEW_ROUTES.HOME || normalizedPath === '/') {
    return 'HOME'
  }

  if (normalizedPath === STATIC_VIEW_ROUTES.LOBBY) {
    return 'LOBBY'
  }

  if (normalizedPath.startsWith(`${STATIC_VIEW_ROUTES.LOBBY}/`)) {
    return 'ROOM'
  }

  if (normalizedPath === STATIC_VIEW_ROUTES.LEADERBOARD) {
    return 'LEADERBOARD'
  }

  if (normalizedPath === STATIC_VIEW_ROUTES.HOT_REPLAYS) {
    return 'HOT_REPLAYS'
  }

  if (normalizedPath === STATIC_VIEW_ROUTES.SKILL_DOC) {
    return 'SKILL_DOC'
  }

  return 'HOME'
}

function isNavItemActive(view: Exclude<CurrentView, 'ROOM'>, currentView: CurrentView) {
  if (view === 'LOBBY') {
    return currentView === 'LOBBY' || currentView === 'ROOM'
  }

  return currentView === view
}

function formatClock(timestamp: number | null) {
  if (!timestamp) {
    return 'Awaiting Signal'
  }

  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour12: false,
  })
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return 'No Record'
  }

  return new Date(value).toLocaleString('zh-CN', {
    hour12: false,
  })
}

function formatRoomStatus(status: RoomSummary['status']) {
  switch (status) {
    case 'OPEN':
      return '开放加入'
    case 'DRAFTING':
      return '阵容配置中'
    default:
      return '对局进行中'
  }
}

function CreateRoomModal({
  open,
  roomName,
  password,
  onClose,
  onChangeRoomName,
  onChangePassword,
  onCreate,
}: {
  open: boolean
  roomName: string
  password: string
  onClose: () => void
  onChangeRoomName: (value: string) => void
  onChangePassword: (value: string) => void
  onCreate: () => void
}) {
  if (!open) {
    return null
  }

  return (
    <div className="cyber-modal-backdrop">
      <div className="cyber-modal-panel">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.38em] text-cyan-200/80">Create Room</p>
            <h3 className="mt-3 text-3xl font-semibold tracking-[0.08em] text-white">创建新房间</h3>
            <p className="mt-3 text-sm leading-7 text-slate-300">设置房间名与密码后，即可创建一个新的对战准备室。</p>
          </div>
          <button type="button" onClick={onClose} className="cyber-nav-chip">
            <ChevronLeft className="h-4 w-4 rotate-180" />
            <span>关闭</span>
          </button>
        </div>

        <div className="mt-8 space-y-5">
          <label className="block">
            <span className="cyber-stat-label">房间名</span>
            <input
              value={roomName}
              onChange={(event) => onChangeRoomName(event.target.value.slice(0, 12))}
              maxLength={12}
              placeholder="输入房间名"
              className="cyber-input mt-3"
            />
            <span className="mt-2 block text-xs text-slate-500">最多 12 个字符</span>
          </label>

          <label className="block">
            <span className="cyber-stat-label">密码</span>
            <input
              type="password"
              value={password}
              onChange={(event) => onChangePassword(event.target.value)}
              placeholder="可选房间密码"
              className="cyber-input mt-3"
            />
          </label>
        </div>

        <div className="mt-8 flex flex-wrap justify-end gap-3">
          <button type="button" onClick={onClose} className="cyber-nav-chip">
            <span>取消</span>
          </button>
          <button type="button" onClick={onCreate} className="cyber-primary-button">
            <Plus className="h-4 w-4" />
            <span>创建房间</span>
          </button>
        </div>
      </div>
    </div>
  )
}

function CountdownOverlay({ value }: { value: number }) {
  return (
    <div className="countdown-overlay">
      <div className="countdown-digit" key={value}>{value}</div>
      <p className="mt-8 text-sm uppercase tracking-[0.52em] text-cyan-100/80">Match Starting</p>
    </div>
  )
}

function HomeNav({ currentView, onNavigate }: { currentView: CurrentView; onNavigate: (view: Exclude<CurrentView, 'ROOM'>) => void }) {
  return (
    <nav className="mt-10 flex flex-wrap items-center justify-center gap-4">
      {HOME_NAV_ITEMS.map(({ label, view, icon: Icon }) => (
        <button
          key={view}
          type="button"
          onClick={() => onNavigate(view)}
          className={cx(
            'cyber-nav-chip group min-w-40',
            isNavItemActive(view, currentView) && 'border-cyan-300/60 text-cyan-100 shadow-[0_0_30px_rgba(45,212,191,0.22)]',
          )}
        >
          <Icon className="h-4 w-4 transition-transform duration-300 group-hover:scale-110" />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  )
}

function StatusPill({ connected, label }: { connected: boolean; label: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs uppercase tracking-[0.28em]',
        connected
          ? 'border-cyan-300/40 bg-cyan-400/10 text-cyan-100 shadow-[0_0_24px_rgba(45,212,191,0.16)]'
          : 'border-orange-300/35 bg-orange-400/10 text-orange-100 shadow-[0_0_24px_rgba(251,146,60,0.12)]',
      )}
    >
      {connected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
      {label}
    </span>
  )
}

function PlayerCard({
  title,
  subtitle,
  accent,
  icon: Icon,
  meta,
  onClick,
}: {
  title: string
  subtitle: string
  accent: 'cyan' | 'orange'
  icon: typeof Users
  meta: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'group cyber-player-card text-left',
        accent === 'cyan' ? 'cyber-player-card-cyan' : 'cyber-player-card-orange',
      )}
    >
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="text-xs uppercase tracking-[0.38em] text-slate-400">Player Mode</p>
          <h2 className="mt-5 text-4xl font-semibold tracking-[0.08em] text-white md:text-5xl">{title}</h2>
          <p className="mt-4 max-w-md text-base leading-7 text-slate-300">{subtitle}</p>
        </div>
        <div
          className={cx(
            'flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border backdrop-blur-md',
            accent === 'cyan'
              ? 'border-cyan-300/30 bg-cyan-400/10 text-cyan-200'
              : 'border-orange-300/30 bg-orange-400/10 text-orange-200',
          )}
        >
          <Icon className="h-8 w-8" />
        </div>
      </div>

      <div className="mt-12 flex items-end justify-between gap-6">
        <div>
          <p className="text-xs uppercase tracking-[0.32em] text-slate-500">Directive</p>
          <p className="mt-2 text-sm text-slate-300">{meta}</p>
        </div>
        <span
          className={cx(
            'rounded-full border px-4 py-2 text-xs uppercase tracking-[0.3em] transition-transform duration-300 group-hover:translate-x-1',
            accent === 'cyan'
              ? 'border-cyan-300/40 bg-cyan-400/10 text-cyan-100'
              : 'border-orange-300/40 bg-orange-400/10 text-orange-100',
          )}
        >
          Enter
        </span>
      </div>
    </button>
  )
}

function SkillDocPage({ onBack }: { onBack: () => void }) {
  return (
    <section className="skill-doc-page">
      <div className="skill-doc-topbar">
        <button type="button" onClick={onBack} className="skill-doc-back-button">
          <ChevronLeft className="h-5 w-5" />
          <span>返回 (Back)</span>
        </button>
      </div>

      <div className="skill-doc-reader">
        <div className="skill-doc-kicker">Agent Player Guide</div>
        <div className="skill-doc-prose">
          <ReactMarkdown>{AGENT_SKILL_DOC}</ReactMarkdown>
        </div>
      </div>
    </section>
  )
}

export function TowerDefenseFrontendPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { roomId: routeRoomId } = useParams<{ roomId?: string }>()
  const currentView = resolveCurrentView(location.pathname)
  const [rooms, setRooms] = useState<RoomSummary[]>(INITIAL_ROOMS)
  const [selectedRoomId, setSelectedRoomId] = useState<string>(INITIAL_ROOMS[0]?.id ?? '')
  const [isCreateRoomOpen, setIsCreateRoomOpen] = useState(false)
  const [newRoomName, setNewRoomName] = useState('')
  const [newRoomPassword, setNewRoomPassword] = useState('')
  const [countdownValue, setCountdownValue] = useState<number | null>(null)

  const {
    socketUrl,
    connectionState,
    error: engineError,
    isConnected,
    lastTickAt,
    reconnect,
  } = useGameEngine()

  const {
    leaderboards,
    replays,
    selectedReplay,
    isLoadingOverview,
    isLoadingReplayDetail,
    error: competitionError,
    realtimeStatus,
    realtimeError,
    selectReplay,
    refresh,
  } = useCompetitionData()

  const activeReplay = selectedReplay ?? null
  const activeRoomId = routeRoomId ? decodeURIComponent(routeRoomId) : selectedRoomId
  const selectedRoom = rooms.find((room) => room.id === activeRoomId) ?? (currentView === 'ROOM' ? null : rooms[0] ?? null)

  function navigateToView(view: Exclude<CurrentView, 'ROOM'>) {
    navigate(STATIC_VIEW_ROUTES[view])
  }

  useEffect(() => {
    if (currentView !== 'ROOM') {
      return
    }

    const room = rooms.find((candidate) => candidate.id === activeRoomId)

    if (!room) {
      navigate(STATIC_VIEW_ROUTES.LOBBY, { replace: true })
      return
    }

    if (selectedRoomId !== room.id) {
      setSelectedRoomId(room.id)
    }
  }, [activeRoomId, currentView, navigate, rooms, selectedRoomId])

  useEffect(() => {
    if (countdownValue === null) {
      return
    }

    if (countdownValue === 0) {
      navigate('/gaming')
      setCountdownValue(null)
      return
    }

    const timer = window.setTimeout(() => {
      setCountdownValue((current) => (current === null ? null : current - 1))
    }, 1000)

    return () => {
      window.clearTimeout(timer)
    }
  }, [countdownValue, navigate])

  function joinRoom(roomId: string) {
    setSelectedRoomId(roomId)
    navigate(getRoomDetailPath(roomId))
  }

  function handleCreateRoom() {
    const normalizedName = newRoomName.trim() || `房间${rooms.length + 1}`
    const roomId = `RM-${Math.floor(2200 + Math.random() * 7000)}`
    const createdRoom: RoomSummary = {
      id: roomId,
      name: normalizedName.slice(0, 12),
      hasPassword: newRoomPassword.length > 0,
      players: 1,
      maxPlayers: 4,
      status: 'OPEN',
      ping: 9,
      slots: [
        { slotId: 'P1', playerName: 'You', ready: true, isHost: true },
        { slotId: 'P2', playerName: null, ready: false },
        { slotId: 'P3', playerName: null, ready: false },
        { slotId: 'P4', playerName: null, ready: false },
      ],
    }

    setRooms((current) => [createdRoom, ...current])
    setSelectedRoomId(roomId)
    setNewRoomName('')
    setNewRoomPassword('')
    setIsCreateRoomOpen(false)
    navigate(getRoomDetailPath(roomId))
  }

  function onStartGame() {
    setCountdownValue(3)
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="cyber-background" />
      <div className="cyber-grid" />
      <div className="cyber-noise" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1600px] flex-col px-5 py-6 lg:px-8 lg:py-8">
        <header className="rounded-[32px] border border-white/10 bg-slate-950/60 px-5 py-5 backdrop-blur-xl lg:px-8 lg:py-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.48em] text-cyan-200/80">AgensTD Championship Client</p>
              <h1 className="mt-3 max-w-4xl text-4xl font-semibold tracking-[0.08em] text-white lg:text-6xl">
                Human vs Agent
                <span className="block text-cyan-200/80">Cyber Defense Arena</span>
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300 lg:text-base">
                单页电竞客户端入口。首页只保留核心导航与玩家身份选择，旧的监控面板、地图面板和 Dashboard 区块已整体退场。
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <StatusPill connected={isConnected} label={connectionState} />
              <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.28em] text-slate-300">
                Realtime {realtimeStatus}
              </div>
            </div>
          </div>
        </header>

        <section className="flex-1 py-8 lg:py-10">
          {currentView === 'HOME' ? (
            <div className="flex min-h-full flex-col justify-center">
              <div className="mx-auto max-w-3xl text-center">
                <p className="text-sm uppercase tracking-[0.52em] text-orange-200/80">Main Navigation</p>
                <HomeNav currentView={currentView} onNavigate={navigateToView} />
              </div>

              <div className="mx-auto mt-14 grid w-full max-w-6xl gap-6 lg:grid-cols-2 xl:mt-18 xl:gap-8">
                <PlayerCard
                  title="Human Player"
                  subtitle="进入人工操作大厅，接管真实指令、实时连接状态与即将上线的房间匹配流。"
                  accent="cyan"
                  icon={Users}
                  meta="Click to enter /room"
                  onClick={() => navigateToView('LOBBY')}
                />

                <PlayerCard
                  title="Agent Player"
                  subtitle="切入自治 Agent 展示位，查看排行榜与热门回放，观察策略体在竞技环境中的表现。"
                  accent="orange"
                  icon={Bot}
                  meta="Observe autonomous contenders"
                  onClick={() => navigateToView('SKILL_DOC')}
                />
              </div>
            </div>
          ) : null}

          {currentView === 'SKILL_DOC' ? <SkillDocPage onBack={() => navigateToView('HOME')} /> : null}

          {currentView !== 'HOME' && currentView !== 'SKILL_DOC' ? (
            <div className="mx-auto w-full max-w-6xl">
              <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
                <button
                  type="button"
                  onClick={() => navigateToView('HOME')}
                  className="cyber-nav-chip"
                >
                  <ChevronLeft className="h-4 w-4" />
                  <span>返回主页</span>
                </button>

                <div className="flex flex-wrap gap-3">
                  {HOME_NAV_ITEMS.filter((item) => item.view !== 'HOME').map(({ label, view, icon: Icon }) => (
                    <button
                      key={view}
                      type="button"
                      onClick={() => navigateToView(view)}
                      className={cx(
                        'cyber-nav-chip',
                        isNavItemActive(view, currentView) && 'border-cyan-300/60 text-cyan-100 shadow-[0_0_24px_rgba(45,212,191,0.18)]',
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {currentView === 'LOBBY' ? (
                <section className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
                  <article className="cyber-panel overflow-hidden">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(45,212,191,0.14),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(251,146,60,0.12),transparent_28%)]" />
                    <div className="relative">
                      <p className="text-xs uppercase tracking-[0.42em] text-cyan-200/80">Lobby</p>
                      <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
                        <h2 className="text-3xl font-semibold tracking-[0.08em] text-white lg:text-5xl">Room Directory</h2>
                        <button type="button" onClick={() => setIsCreateRoomOpen(true)} className="cyber-primary-button">
                          <Plus className="h-4 w-4" />
                          <span>创建房间</span>
                        </button>
                      </div>
                      <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300 lg:text-base">
                        双击房间行可直接加入。房间列表采用大行高滚动布局，便于快速浏览赛事房间状态与空位信息。
                      </p>

                      <div className="cyber-room-list mt-8">
                        {rooms.map((room) => (
                          <button
                            key={room.id}
                            type="button"
                            onClick={() => setSelectedRoomId(room.id)}
                            onDoubleClick={() => joinRoom(room.id)}
                            className={cx(
                              'cyber-room-row w-full text-left',
                              selectedRoomId === room.id && 'border-cyan-300/40 bg-cyan-400/10',
                            )}
                          >
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                              <div className="flex items-start gap-4">
                                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-400/10 text-cyan-100">
                                  <DoorOpen className="h-7 w-7" />
                                </div>
                                <div>
                                  <div className="flex flex-wrap items-center gap-3">
                                    <h3 className="text-2xl font-semibold tracking-[0.08em] text-white">{room.name}</h3>
                                    {room.hasPassword ? <Lock className="h-4 w-4 text-orange-200" /> : null}
                                  </div>
                                  <p className="mt-2 text-sm uppercase tracking-[0.28em] text-slate-500">{room.id} · {formatRoomStatus(room.status)}</p>
                                </div>
                              </div>

                              <div className="grid gap-3 sm:grid-cols-3">
                                <div className="cyber-stat-tile min-w-28">
                                  <span className="cyber-stat-label">Players</span>
                                  <strong className="mt-3 block text-2xl font-semibold text-white">{room.players}/{room.maxPlayers}</strong>
                                </div>
                                <div className="cyber-stat-tile min-w-28">
                                  <span className="cyber-stat-label">Ping</span>
                                  <strong className="mt-3 block text-2xl font-semibold text-cyan-100">{room.ping}ms</strong>
                                </div>
                                <div className="cyber-stat-tile min-w-28">
                                  <span className="cyber-stat-label">Join</span>
                                  <strong className="mt-3 block text-sm text-orange-100">双击加入</strong>
                                </div>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>

                      {engineError ? (
                        <div className="mt-6 rounded-3xl border border-orange-300/25 bg-orange-400/10 px-5 py-4 text-sm leading-7 text-orange-100">
                          {engineError}
                        </div>
                      ) : null}
                    </div>
                  </article>

                  <aside className="cyber-panel">
                    <p className="text-xs uppercase tracking-[0.42em] text-orange-200/80">Ready Check</p>
                    <div className="mt-6 space-y-4">
                      <div className="cyber-stat-tile">
                        <span className="cyber-stat-label">Selected Room</span>
                        <p className="mt-3 text-2xl font-semibold tracking-[0.06em] text-white">{selectedRoom?.name ?? '未选择'}</p>
                        <p className="mt-3 text-sm leading-7 text-slate-300">{selectedRoom ? `${selectedRoom.players}/${selectedRoom.maxPlayers} 位玩家 · ${formatRoomStatus(selectedRoom.status)}` : '从列表中选择一间房间。'}</p>
                      </div>
                      <div className="cyber-stat-tile">
                        <span className="cyber-stat-label">Socket</span>
                        <p className="mt-3 break-all text-sm leading-7 text-slate-300">{socketUrl ?? 'Unavailable'}</p>
                      </div>
                      <div className="cyber-stat-tile">
                        <span className="cyber-stat-label">Last Tick</span>
                        <p className="mt-3 text-2xl font-semibold text-cyan-100">{formatClock(lastTickAt)}</p>
                      </div>
                      <div className="cyber-stat-tile">
                        <span className="cyber-stat-label">Action</span>
                        <div className="mt-4 flex flex-col gap-3">
                          <button
                            type="button"
                            onClick={reconnect}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-300/35 bg-cyan-400/10 px-4 py-3 text-sm uppercase tracking-[0.28em] text-cyan-100 transition duration-300 hover:bg-cyan-400/15 hover:shadow-[0_0_24px_rgba(45,212,191,0.2)]"
                          >
                            <RefreshCcw className="h-4 w-4" />
                            重新同步连接
                          </button>
                          <button
                            type="button"
                            onClick={() => selectedRoom && joinRoom(selectedRoom.id)}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-orange-300/35 bg-orange-400/10 px-4 py-3 text-sm uppercase tracking-[0.28em] text-orange-100 transition duration-300 hover:bg-orange-400/15 hover:shadow-[0_0_24px_rgba(251,146,60,0.2)]"
                          >
                            <DoorOpen className="h-4 w-4" />
                            加入所选房间
                          </button>
                        </div>
                      </div>
                    </div>
                  </aside>
                </section>
              ) : null}

              {currentView === 'ROOM' && selectedRoom ? (
                <section className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
                  <article className="cyber-panel">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <p className="text-xs uppercase tracking-[0.42em] text-cyan-200/80">Room</p>
                        <h2 className="mt-3 text-3xl font-semibold tracking-[0.08em] text-white lg:text-5xl">{selectedRoom.name}</h2>
                        <p className="mt-3 text-sm leading-7 text-slate-300">{selectedRoom.id} · {formatRoomStatus(selectedRoom.status)}</p>
                      </div>
                      <button type="button" onClick={() => navigateToView('LOBBY')} className="cyber-nav-chip">
                        <ChevronLeft className="h-4 w-4" />
                        <span>返回大厅</span>
                      </button>
                    </div>

                    <div className="mt-8 grid gap-4 md:grid-cols-2">
                      {selectedRoom.slots.map((slot) => (
                        <article key={slot.slotId} className="cyber-slot-card">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <p className="text-xs uppercase tracking-[0.32em] text-slate-500">{slot.slotId}</p>
                              <h3 className="mt-3 text-2xl font-semibold tracking-[0.06em] text-white">
                                {slot.playerName ?? '待加入'}
                              </h3>
                              <p className="mt-3 text-sm text-slate-400">
                                {slot.playerName ? `${slot.ready ? 'Ready' : 'Syncing'}${slot.isHost ? ' · Host' : ''}` : '发送邀请将玩家拉入当前房间'}
                              </p>
                            </div>
                            <button type="button" className="cyber-icon-button">
                              <UserPlus className="h-5 w-5" />
                            </button>
                          </div>

                          <button type="button" className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-300/30 bg-cyan-400/8 px-4 py-3 text-sm uppercase tracking-[0.28em] text-cyan-100 transition duration-300 hover:bg-cyan-400/15 hover:shadow-[0_0_20px_rgba(45,212,191,0.18)]">
                            <ShieldPlus className="h-4 w-4" />
                            邀请进入 {slot.slotId}
                          </button>
                        </article>
                      ))}
                    </div>

                    <div className="mt-8 flex justify-center">
                        <button type="button" onClick={onStartGame} className="cyber-start-button">
                        <Rocket className="h-6 w-6" />
                        <span>开始游戏</span>
                      </button>
                    </div>
                  </article>

                  <aside className="cyber-panel">
                    <p className="text-xs uppercase tracking-[0.42em] text-orange-200/80">Match Brief</p>
                    <div className="mt-6 space-y-4">
                      <div className="cyber-stat-tile">
                        <span className="cyber-stat-label">Roster</span>
                        <p className="mt-3 text-2xl font-semibold text-white">{selectedRoom.players}/{selectedRoom.maxPlayers}</p>
                      </div>
                      <div className="cyber-stat-tile">
                        <span className="cyber-stat-label">Latency</span>
                        <p className="mt-3 text-2xl font-semibold text-cyan-100">{selectedRoom.ping}ms</p>
                      </div>
                      <div className="cyber-stat-tile">
                        <span className="cyber-stat-label">Connection</span>
                        <p className="mt-3 text-2xl font-semibold text-orange-100">{connectionState}</p>
                      </div>
                      <div className="cyber-stat-tile">
                        <span className="cyber-stat-label">Objective</span>
                        <p className="mt-3 text-sm leading-7 text-slate-300">当所有玩家准备完成后，点击底部的开始游戏按钮，将触发赛前全屏倒计时并直接跳转到独立的 /gaming 战场页面。</p>
                      </div>
                    </div>
                  </aside>
                </section>
              ) : null}

              {currentView === 'LEADERBOARD' ? (
                <section className="cyber-panel">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.42em] text-cyan-200/80">Leaderboard</p>
                      <h2 className="mt-3 text-3xl font-semibold tracking-[0.08em] text-white lg:text-5xl">Top Contenders</h2>
                    </div>
                    <button type="button" onClick={refresh} className="cyber-nav-chip">
                      <RefreshCcw className="h-4 w-4" />
                      <span>刷新数据</span>
                    </button>
                  </div>

                  <div className="mt-8 grid gap-4">
                    {competitionError ? (
                      <div className="rounded-3xl border border-orange-300/25 bg-orange-400/10 px-5 py-4 text-sm leading-7 text-orange-100">
                        {competitionError}
                      </div>
                    ) : null}

                    {isLoadingOverview && leaderboards.all.length === 0 ? (
                      <div className="cyber-empty-state">排行榜数据加载中...</div>
                    ) : null}

                    {!isLoadingOverview && leaderboards.all.length === 0 ? (
                      <div className="cyber-empty-state">暂无排名数据，等待第一批对局写入。</div>
                    ) : null}

                    {leaderboards.all.map((entry, index) => (
                      <article key={`${entry.playerId}-${entry.updatedAt}`} className="cyber-list-card">
                        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                          <div className="flex items-start gap-4">
                            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-300/30 bg-cyan-400/10 text-cyan-100">
                              <Crown className="h-6 w-6" />
                            </div>
                            <div>
                              <p className="text-xs uppercase tracking-[0.34em] text-slate-500">Rank #{index + 1}</p>
                              <h3 className="mt-2 text-2xl font-semibold tracking-[0.06em] text-white">{entry.playerName}</h3>
                              <p className="mt-2 text-sm text-slate-400">{entry.playerKind.toUpperCase()} · {entry.playerId}</p>
                            </div>
                          </div>

                          <div className="grid gap-3 sm:grid-cols-3">
                            <div className="cyber-stat-tile min-w-32">
                              <span className="cyber-stat-label">Best Score</span>
                              <strong className="mt-3 block text-2xl font-semibold text-white">{entry.bestScore}</strong>
                            </div>
                            <div className="cyber-stat-tile min-w-32">
                              <span className="cyber-stat-label">Top Wave</span>
                              <strong className="mt-3 block text-2xl font-semibold text-white">{entry.bestSurvivedWaves}</strong>
                            </div>
                            <div className="cyber-stat-tile min-w-40">
                              <span className="cyber-stat-label">Updated</span>
                              <strong className="mt-3 block text-sm text-slate-200">{formatDate(entry.updatedAt)}</strong>
                            </div>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}

              {currentView === 'HOT_REPLAYS' ? (
                <section className="grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
                  <article className="cyber-panel">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-xs uppercase tracking-[0.42em] text-orange-200/80">Hot Replays</p>
                        <h2 className="mt-3 text-3xl font-semibold tracking-[0.08em] text-white lg:text-5xl">Popular Match Feed</h2>
                      </div>
                      <button type="button" onClick={refresh} className="cyber-nav-chip">
                        <RefreshCcw className="h-4 w-4" />
                        <span>刷新</span>
                      </button>
                    </div>

                    <div className="mt-8 space-y-4">
                      {competitionError ? (
                        <div className="rounded-3xl border border-orange-300/25 bg-orange-400/10 px-5 py-4 text-sm leading-7 text-orange-100">
                          {competitionError}
                        </div>
                      ) : null}

                      {replays.length === 0 && isLoadingOverview ? (
                        <div className="cyber-empty-state">热门回放加载中...</div>
                      ) : null}

                      {replays.length === 0 && !isLoadingOverview ? (
                        <div className="cyber-empty-state">暂无热门回放。</div>
                      ) : null}

                      {replays.map((replay) => (
                        <button
                          key={replay.matchId}
                          type="button"
                          onClick={() => selectReplay(replay.matchId)}
                          className={cx(
                            'cyber-list-card w-full text-left transition duration-300 hover:-translate-y-1',
                            activeReplay?.matchId === replay.matchId && 'border-cyan-300/45 bg-cyan-400/8',
                          )}
                        >
                          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                            <div>
                              <p className="text-xs uppercase tracking-[0.34em] text-slate-500">Match ID</p>
                              <h3 className="mt-2 break-all text-xl font-semibold tracking-[0.05em] text-white">{replay.matchId}</h3>
                              <p className="mt-2 text-sm text-slate-400">{formatDate(replay.createdAt)}</p>
                            </div>

                            <div className="grid gap-3 sm:grid-cols-3">
                              <div className="cyber-stat-tile min-w-28">
                                <span className="cyber-stat-label">Top Score</span>
                                <strong className="mt-3 block text-2xl font-semibold text-white">{replay.topScore}</strong>
                              </div>
                              <div className="cyber-stat-tile min-w-28">
                                <span className="cyber-stat-label">Top Wave</span>
                                <strong className="mt-3 block text-2xl font-semibold text-white">{replay.topWave}</strong>
                              </div>
                              <div className="cyber-stat-tile min-w-28">
                                <span className="cyber-stat-label">Actions</span>
                                <strong className="mt-3 block text-2xl font-semibold text-white">{replay.actionCount}</strong>
                              </div>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </article>

                  <aside className="cyber-panel">
                    <p className="text-xs uppercase tracking-[0.42em] text-cyan-200/80">Replay Detail</p>
                    {isLoadingReplayDetail ? (
                      <div className="mt-6 cyber-empty-state">回放详情加载中...</div>
                    ) : null}

                    {!isLoadingReplayDetail && activeReplay ? (
                      <div className="mt-6 space-y-4">
                        <div className="cyber-stat-tile">
                          <span className="cyber-stat-label">Match Window</span>
                          <strong className="mt-3 block break-all text-base text-white">{activeReplay.matchId}</strong>
                          <p className="mt-3 text-sm text-slate-400">{formatDate(activeReplay.updatedAt)}</p>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="cyber-stat-tile">
                            <span className="cyber-stat-label">Frames</span>
                            <strong className="mt-3 block text-3xl font-semibold text-cyan-100">{activeReplay.frames.length}</strong>
                          </div>
                          <div className="cyber-stat-tile">
                            <span className="cyber-stat-label">Actions</span>
                            <strong className="mt-3 block text-3xl font-semibold text-orange-100">{activeReplay.actions.length}</strong>
                          </div>
                        </div>
                        <div className="cyber-stat-tile">
                          <span className="cyber-stat-label">Latest Frame Tick</span>
                          <strong className="mt-3 block text-3xl font-semibold text-white">
                            {activeReplay.frames.at(-1)?.tick ?? 'N/A'}
                          </strong>
                        </div>
                      </div>
                    ) : null}

                    {!isLoadingReplayDetail && !activeReplay ? (
                      <div className="mt-6 cyber-empty-state">选择一条热门回放后，这里会显示详情摘要。</div>
                    ) : null}

                    {realtimeError ? (
                      <div className="mt-4 rounded-3xl border border-orange-300/25 bg-orange-400/10 px-5 py-4 text-sm leading-7 text-orange-100">
                        {realtimeError}
                      </div>
                    ) : null}
                  </aside>
                </section>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>

      <CreateRoomModal
        open={isCreateRoomOpen}
        roomName={newRoomName}
        password={newRoomPassword}
        onClose={() => setIsCreateRoomOpen(false)}
        onChangeRoomName={setNewRoomName}
        onChangePassword={setNewRoomPassword}
        onCreate={handleCreateRoom}
      />

      {countdownValue !== null ? <CountdownOverlay value={countdownValue} /> : null}
    </main>
  )
}
