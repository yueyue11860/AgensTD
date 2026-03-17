import { useEffect, useState } from 'react'
import {
  ChevronLeft,
  Clapperboard,
  Crown,
  DoorOpen,
  House,
  Lock,
  Plus,
  RefreshCcw,
  Rocket,
  Search,
  ShieldPlus,
  Trophy,
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

连接建立后，客户端应等待服务端的房间状态广播和 TICK_UPDATE 推送，再决定是否发送控制指令。

## 2. 推荐的握手负载

连接成功后，可以先发送一条 join 指令声明自己要加入哪个房间、使用什么策略体。

~~~json
{
  "type": "JOIN_ROOM",
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
- **TICK_UPDATE**：核心战场推送，包含地图、敌人、塔、防御核心状态与资源数据。
- **action_result**：对上一条客户端指令的受理结果或失败原因。
- **match_event**：波次开始、玩家掉线、结算等事件广播。

典型的 TICK_UPDATE 片段如下：

~~~json
{
  "type": "TICK_UPDATE",
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
  "type": "SEND_ACTION",
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
  "type": "SEND_ACTION",
  "action": {
    "kind": "upgrade",
    "towerId": "laser-1"
  }
}
~~~

出售示例：

~~~json
{
  "type": "SEND_ACTION",
  "action": {
    "kind": "sell",
    "towerId": "laser-1"
  }
}
~~~

## 5. 实战建议

1. 只在收到最新 TICK_UPDATE 后做决策，避免基于旧状态重复下发指令。
2. 为每条 SEND_ACTION 保留本地 request id，便于对齐 action_result 和重试策略。
3. 遇到网络抖动时，不要刷新整个页面；应保持连接管理器存活，只做重连或重订阅。
4. 如果要在 UI 中切换到文档、排行榜或大厅，优先使用前端静态路由切换，而不是依赖 query 参数或硬编码跳转。

## 6. 最小联调样例

~~~ts
const socket = new WebSocket('wss://your-domain.example/ws/room/RM-2088?role=agent')

socket.addEventListener('open', () => {
  socket.send(JSON.stringify({
    type: 'JOIN_ROOM',
    roomId: 'RM-2088',
    playerId: 'agent-alpha',
    playerKind: 'agent',
  }))
})

socket.addEventListener('message', (event) => {
  const payload = JSON.parse(event.data)

  if (payload.type === 'TICK_UPDATE' && payload.resources.gold >= 3) {
    socket.send(JSON.stringify({
      type: 'SEND_ACTION',
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
    ping: 12,
    slots: [
      { slotId: 'P1', playerName: 'YUE', ready: true, isHost: true },
      { slotId: 'P2', playerName: 'Nova', ready: false },
      { slotId: 'P3', playerName: null, ready: false },
      { slotId: 'P4', playerName: null, ready: false },
    ],
  },
  {
    id: 'RM-2094',
    name: '算力深渊',
    hasPassword: true,
    players: 4,
    maxPlayers: 4,
    status: 'IN_MATCH',
    ping: 26,
    slots: [
      { slotId: 'P1', playerName: 'Kite', ready: true, isHost: true },
      { slotId: 'P2', playerName: 'Cipher', ready: true },
      { slotId: 'P3', playerName: 'Echo', ready: true },
      { slotId: 'P4', playerName: 'Vex', ready: true },
    ],
  },
  {
    id: 'RM-2110',
    name: '霓虹防线',
    hasPassword: false,
    players: 1,
    maxPlayers: 4,
    status: 'OPEN',
    ping: 18,
    slots: [
      { slotId: 'P1', playerName: 'Atlas', ready: true, isHost: true },
      { slotId: 'P2', playerName: null, ready: false },
      { slotId: 'P3', playerName: null, ready: false },
      { slotId: 'P4', playerName: null, ready: false },
    ],
  },
  {
    id: 'RM-2111',
    name: '硅基一号测试点',
    hasPassword: true,
    players: 3,
    maxPlayers: 4,
    status: 'OPEN',
    ping: 9,
    slots: [
      { slotId: 'P1', playerName: 'Rex', ready: true, isHost: true },
      { slotId: 'P2', playerName: 'Skye', ready: true },
      { slotId: 'P3', playerName: 'Mira', ready: false },
      { slotId: 'P4', playerName: null, ready: false },
    ],
  },
  {
    id: 'RM-2115',
    name: '零度阵列',
    hasPassword: false,
    players: 2,
    maxPlayers: 4,
    status: 'OPEN',
    ping: 15,
    slots: [
      { slotId: 'P1', playerName: 'Unit-7', ready: true, isHost: true },
      { slotId: 'P2', playerName: 'Axon', ready: false },
      { slotId: 'P3', playerName: null, ready: false },
      { slotId: 'P4', playerName: null, ready: false },
    ],
  },
]

const ROOMS_STORAGE_KEY = 'agenstd_rooms'

function loadRoomsFromStorage(): RoomSummary[] {
  try {
    const stored = sessionStorage.getItem(ROOMS_STORAGE_KEY)
    if (stored) {
      return JSON.parse(stored) as RoomSummary[]
    }
  } catch {
    // ignore parse / storage errors
  }
  return INITIAL_ROOMS
}

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
      return '部署中'
    case 'DRAFTING':
      return '配置中'
    default:
      return '交战中'
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
  useEffect(() => {
    if (!open) return
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
      if (event.key === 'Enter') onCreate()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose, onCreate])

  if (!open) {
    return null
  }

  return (
    <div className="term-modal-backdrop" onClick={onClose}>
      <div className="term-modal" onClick={(e) => e.stopPropagation()}>

        {/* 头部 */}
        <div className="term-modal-head">
          <span className="term-modal-title">&gt;_ INITIALIZE_NEW_NODE</span>
        </div>
        <div className="term-divider" />

        {/* 表单 */}
        <div className="term-modal-body">
          <div className="term-field">
            <span className="term-field-label">战区代号 <span className="term-field-meta">(MAX_12_CHAR)</span> :</span>
            <div className="term-input-row">
              <span className="term-block-cursor" aria-hidden>█</span>
              <input
                autoFocus
                value={roomName}
                onChange={(event) => onChangeRoomName(event.target.value.slice(0, 12))}
                maxLength={12}
                placeholder="输入战区名称..."
                className="term-input"
              />
            </div>
          </div>

          <div className="term-field">
            <span className="term-field-label">安全密匙 <span className="term-field-meta">(OPTIONAL_SEC_KEY)</span> :</span>
            <div className="term-input-row">
              <span className="term-block-cursor term-block-cursor-red" aria-hidden>█</span>
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => onChangePassword(event.target.value)}
                placeholder="留空则对全网开放..."
                className="term-input"
              />
            </div>
          </div>
        </div>

        {/* 底部 */}
        <div className="term-divider" />
        <div className="term-modal-foot">
          <span className="term-sys-msg">&gt; SYS_MSG: 节点算力已就绪...</span>
          <div className="term-modal-actions">
            <button type="button" onClick={onClose} className="term-btn term-btn-cancel">[ 终止进程 (ESC) ]</button>
            <button type="button" onClick={onCreate} className="term-btn term-btn-confirm">[ 部署节点 (ENT) ]</button>
          </div>
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
    <nav className="split-nav" aria-label="Primary navigation">
      {HOME_NAV_ITEMS.filter((item) => item.view !== 'SKILL_DOC').map(({ label, view, icon: Icon }) => (
        <button
          key={view}
          type="button"
          onClick={() => onNavigate(view)}
          className={cx(
            'split-nav-item',
            isNavItemActive(view, currentView) && 'split-nav-item-active',
          )}
        >
          <Icon className="h-3.5 w-3.5" />
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
  side,
  title,
  description,
  actionLabel,
  onClick,
}: {
  side: 'HUMAN' | 'AGENT'
  title: string
  description: string
  actionLabel: string
  onClick: () => void
}) {
  const isHuman = side === 'HUMAN'

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() }
      }}
      className={cx(
        'absolute inset-0 overflow-hidden outline-none',
        isHuman ? 'split-side-human' : 'split-side-agent',
      )}
    >
      <div className="split-side-fx" aria-hidden="true">
        {!isHuman && <div className="split-chip-fx" />}
      </div>

      <div
        className={cx(
          'relative z-10 flex h-full flex-col justify-center gap-3',
          isHuman
            ? 'items-start pl-[clamp(2.5rem,7vw,6rem)] pr-[32%] text-left'
            : 'items-end pr-[clamp(2.5rem,7vw,6rem)] pl-[32%] text-right',
        )}
      >
        <span
          className={cx(
            'text-[0.62rem] font-bold uppercase tracking-[0.6em]',
            isHuman ? 'text-cyan-400/65' : 'text-red-400/65',
          )}
        >
          {isHuman ? 'CARBON CORE ///' : '/// SILICON STACK'}
        </span>

        <h2 className={cx('split-side-title', isHuman ? 'split-title-cyan' : 'split-title-red')}>
          {isHuman ? (<>HUMAN<br />PLAYER</>) : (<>AGENT<br />INTERFACE</>)}
        </h2>

        <p className="mt-2 max-w-[26rem] text-[0.9rem] leading-[1.85] text-slate-300/80">
          {description}
        </p>

        <span className={cx('split-side-cta', isHuman ? 'split-cta-cyan' : 'split-cta-red')}>
          {actionLabel}
        </span>
      </div>
    </div>
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

function RoomSlotCard({
  slot,
  onDoubleClick,
}: {
  slot: RoomPlayerSlot | null
  onDoubleClick?: () => void
}) {
  const occupied = !!slot?.playerName
  const ready = !!(slot?.ready)
  const canMove = !occupied && !!onDoubleClick
  return (
    <div
      className={cx(
        'room-slot-card',
        occupied && ready && 'room-slot-card-ready',
        occupied && !ready && 'room-slot-card-pending',
        canMove && 'room-slot-card-movable',
      )}
      onDoubleClick={canMove ? onDoubleClick : undefined}
      title={canMove ? '双击切换到此防线' : undefined}
    >
      <div className="flex flex-col items-center gap-3 py-2">
        <div className={cx(
          'flex h-14 w-14 items-center justify-center rounded-full border text-2xl transition-all duration-300',
          occupied && ready
            ? 'border-cyan-400/40 bg-cyan-400/10 shadow-[0_0_16px_rgba(34,211,238,0.22)]'
            : occupied
            ? 'border-red-500/40 bg-red-500/10'
            : 'border-slate-700/40 bg-slate-700/10',
        )}>
          👤
        </div>

        <div className="min-h-[3rem] text-center">
          <p className="font-semibold tracking-wider text-white">
            {slot?.playerName ?? '待接入...'}
          </p>
          {slot?.isHost ? (
            <span className="text-xs tracking-wider text-orange-300/70">Host</span>
          ) : null}
        </div>

        <div className={cx(
          'flex items-center gap-1.5 font-mono text-xs tracking-wider',
          occupied && ready ? 'text-cyan-400' : occupied ? 'text-red-400' : 'text-slate-600',
        )}>
          <span className={cx(
            'h-1.5 w-1.5 rounded-full',
            occupied && ready
              ? 'bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.9)]'
              : occupied
              ? 'bg-red-500 animate-pulse'
              : 'bg-slate-600',
          )} />
          {occupied ? (ready ? '算力就绪' : '算力部署中...') : (canMove ? '双击切换至此' : '待接入...')}
        </div>
      </div>
    </div>
  )
}

export function TowerDefenseFrontendPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { roomId: routeRoomId } = useParams<{ roomId?: string }>()
  const currentView = resolveCurrentView(location.pathname)
  const [rooms, setRooms] = useState<RoomSummary[]>(() => loadRoomsFromStorage())
  const [selectedRoomId, setSelectedRoomId] = useState<string>(INITIAL_ROOMS[0]?.id ?? '')
  const [searchQuery, setSearchQuery] = useState('')
  const [isCreateRoomOpen, setIsCreateRoomOpen] = useState(false)
  const [newRoomName, setNewRoomName] = useState('')
  const [newRoomPassword, setNewRoomPassword] = useState('')
  const [countdownValue, setCountdownValue] = useState<number | null>(null)
  const activeRoomId = routeRoomId ? decodeURIComponent(routeRoomId) : selectedRoomId

  const {
    socketUrl,
    connectionState,
    error: engineError,
    isConnected,
    lastTickAt,
    roomPhase,
    countdownSeconds,
    sendSocketEvent,
    reconnect,
  } = useGameEngine({
    roomId: currentView === 'ROOM' ? activeRoomId : undefined,
  })

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
  const selectedRoom = rooms.find((room) => room.id === activeRoomId) ?? (currentView === 'ROOM' ? null : rooms[0] ?? null)
  const filteredRooms = searchQuery.trim()
    ? rooms.filter((room) =>
        room.name.toLowerCase().includes(searchQuery.toLowerCase())
        || room.id.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : rooms

  const mySlot = selectedRoom?.slots.find((s) => s.isHost) ?? null
  const allReady = selectedRoom
    ? selectedRoom.slots.every((s) => !s.playerName || s.ready)
    : false

  function navigateToView(view: Exclude<CurrentView, 'ROOM'>) {
    navigate(STATIC_VIEW_ROUTES[view])
  }

  useEffect(() => {
    try {
      sessionStorage.setItem(ROOMS_STORAGE_KEY, JSON.stringify(rooms))
    } catch {
      // ignore storage errors
    }
  }, [rooms])

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
    if (typeof countdownSeconds !== 'number') {
      setCountdownValue(null)
      return
    }

    setCountdownValue(countdownSeconds)
  }, [countdownSeconds])

  useEffect(() => {
    if (currentView !== 'ROOM') {
      return
    }

    if (roomPhase !== 'waiting_for_level' && roomPhase !== 'playing') {
      return
    }

    if (countdownValue === 0 || roomPhase === 'waiting_for_level' || roomPhase === 'playing') {
      const gamingPath = activeRoomId
        ? `/gaming?roomId=${encodeURIComponent(activeRoomId)}`
        : '/gaming'
      navigate(gamingPath)
      setCountdownValue(null)
    }
  }, [activeRoomId, countdownValue, currentView, navigate, roomPhase])

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
    void sendSocketEvent('START_MATCH')
  }

  function toggleMyReady() {
    if (!activeRoomId) return
    setRooms((current) =>
      current.map((room) =>
        room.id !== activeRoomId
          ? room
          : {
              ...room,
              slots: room.slots.map((slot) =>
                slot.isHost ? { ...slot, ready: !slot.ready } : slot,
              ),
            },
      ),
    )
  }

  function moveToSlot(targetSlotId: RoomSlotId) {
    if (!activeRoomId) return
    setRooms((current) =>
      current.map((room) => {
        if (room.id !== activeRoomId) return room
        const hostSlot = room.slots.find((s) => s.isHost)
        if (!hostSlot) return room
        const target = room.slots.find((s) => s.slotId === targetSlotId)
        if (!target || target.playerName) return room
        return {
          ...room,
          slots: room.slots.map((s) => {
            if (s.slotId === hostSlot.slotId) {
              return { slotId: s.slotId, playerName: null, ready: false }
            }
            if (s.slotId === targetSlotId) {
              return { ...hostSlot, slotId: targetSlotId }
            }
            return s
          }),
        }
      }),
    )
  }

  if (currentView === 'HOME') {
    return (
      <main className="relative h-screen w-screen overflow-hidden bg-[#020408]">
        <div className="split-home-logo">
          <h1 className="split-home-title">Myriad TD</h1>
        </div>

        <section className="absolute inset-0 split-container">
          <PlayerCard
            side="HUMAN"
            title="HUMAN PLAYER"
            description=""
            actionLabel="ENTER LOBBY ›"
            onClick={() => navigateToView('LOBBY')}
          />

          <PlayerCard
            side="AGENT"
            title="AGENT INTERFACE"
            description=""
            actionLabel="‹ OPEN INTERFACE"
            onClick={() => navigateToView('SKILL_DOC')}
          />

        </section>

        <HomeNav currentView={currentView} onNavigate={navigateToView} />
      </main>
    )
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="cyber-background" />
      <div className="cyber-grid" />
      <div className="cyber-noise" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1600px] flex-col px-5 py-6 lg:px-8 lg:py-8">
        <section className="flex-1 py-8 lg:py-10">
          {currentView === 'SKILL_DOC' ? <SkillDocPage onBack={() => navigateToView('HOME')} /> : null}

          {currentView !== 'SKILL_DOC' ? (
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
                <section className="cyber-panel overflow-hidden !p-0">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(45,212,191,0.06),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(251,146,60,0.05),transparent_25%)]" />
                  <div className="relative">
                    {/* Toolbar */}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-6 py-4">
                      <div className="flex flex-1 items-center gap-2 font-mono text-xs text-cyan-400/70">
                        <span className="shrink-0 text-cyan-400">&gt;</span>
                        <span className="shrink-0 tracking-wider">检索目标：</span>
                        <div className="relative min-w-0 flex-1">
                          <Search className="pointer-events-none absolute left-3 top-1/2 h-3 w-3 -translate-y-1/2 text-cyan-400/50" />
                          <input
                            value={searchQuery}
                            onChange={(event) => setSearchQuery(event.target.value)}
                            placeholder="输入房间名称或节点 ID 进行搜索..."
                            className="cyber-grid-search"
                          />
                        </div>
                      </div>
                      <button type="button" onClick={() => setIsCreateRoomOpen(true)} className="cyber-primary-button shrink-0">
                        <Plus className="h-4 w-4" />
                        <span>新建战区</span>
                      </button>
                    </div>

                    {/* Table header */}
                    <div className="cyber-dg-header">
                      <div>节点ID</div>
                      <div>战区ID</div>
                      <div className="text-center">玩家数</div>
                      <div className="text-center">延迟</div>
                      <div className="text-center">密匙</div>
                      <div>当前状态</div>
                      <div>操作指令</div>
                    </div>

                    {/* Table body */}
                    <div className="cyber-dg-body">
                      {filteredRooms.map((room) => {
                        const isInMatch = room.status === 'IN_MATCH'
                        return (
                          <div
                            key={room.id}
                            onClick={() => setSelectedRoomId(room.id)}
                            onDoubleClick={() => !isInMatch && joinRoom(room.id)}
                            className={cx(
                              'cyber-dg-row',
                              selectedRoomId === room.id && 'cyber-dg-row-selected',
                              isInMatch && 'cyber-dg-row-inactive',
                            )}
                          >
                            <div className="font-mono text-cyan-400/80 tracking-wider">{room.id}</div>
                            <div className="font-medium text-white/90">{room.name}</div>
                            <div className="text-center tabular-nums text-slate-300">
                              {room.players}&thinsp;/&thinsp;{room.maxPlayers}
                            </div>
                            <div className="text-center tabular-nums text-cyan-200/70">
                              {String(room.ping).padStart(2, '0')}ms
                            </div>
                            <div className="text-center">
                              {room.hasPassword ? <span className="text-orange-300/80">🔒</span> : null}
                            </div>
                            <div>
                              <span className={cx(
                                'cyber-status-badge',
                                isInMatch ? 'cyber-status-badge-red' : 'cyber-status-badge-cyan',
                              )}>
                                {formatRoomStatus(room.status)}
                              </span>
                            </div>
                            <div>
                              {isInMatch ? (
                                <span className="font-mono text-xs text-slate-600 tracking-wider">----</span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={(event) => { event.stopPropagation(); joinRoom(room.id) }}
                                  className="cyber-action-btn"
                                >
                                  接入
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })}

                      {filteredRooms.length === 0 ? (
                        <div className="py-10 text-center font-mono text-xs tracking-[0.3em] text-slate-600 uppercase">
                          &gt;_ 未找到匹配的节点
                        </div>
                      ) : null}
                    </div>

                    {/* Footer hint */}
                    <div className="border-t border-white/[0.05] px-6 py-2.5 text-right font-mono text-xs text-slate-700 tracking-wider">
                      * 双击行可直接覆盖接入
                    </div>
                  </div>
                </section>
              ) : null}

              {currentView === 'ROOM' && selectedRoom ? (
                <section className="cyber-panel overflow-hidden !p-0">

                  {/* ── Header ── */}
                  <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.07] px-6 py-4">
                    <button type="button" onClick={() => navigateToView('LOBBY')} className="cyber-nav-chip">
                      <ChevronLeft className="h-4 w-4" />
                      <span>返回大厅</span>
                    </button>

                    <button
                      type="button"
                      className="flex items-center gap-2 font-mono text-sm tracking-wider transition hover:text-cyan-200"
                      onClick={() => { navigator.clipboard?.writeText(selectedRoom.id) }}
                      title="点击复制节点 ID"
                    >
                      <span className="text-slate-400">节点 ID:</span>
                      <span className="text-cyan-300">{selectedRoom.id}</span>
                      <span className="text-slate-500">📋</span>
                    </button>

                    <div className="flex items-center gap-2 font-mono text-sm">
                      <span className={cx(
                        'h-2 w-2 rounded-full',
                        allReady
                          ? 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.9)]'
                          : 'bg-red-500 animate-pulse',
                      )} />
                      <span className={cx('tracking-wider', allReady ? 'text-cyan-300' : 'text-red-400')}>
                        {allReady ? '算力全线就绪' : '等待算力注入...'}
                      </span>
                    </div>
                  </div>

                  {/* ── 四象限矩阵 ── */}
                  <div className="relative px-8 py-10">

                    {/* SVG 连接线 */}
                    <svg className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="none" aria-hidden>
                      <line x1="26%" y1="30%" x2="50%" y2="50%" stroke="rgba(62,231,210,0.13)" strokeWidth="1" strokeDasharray="5 4" />
                      <line x1="74%" y1="30%" x2="50%" y2="50%" stroke="rgba(62,231,210,0.13)" strokeWidth="1" strokeDasharray="5 4" />
                      <line x1="26%" y1="70%" x2="50%" y2="50%" stroke="rgba(62,231,210,0.13)" strokeWidth="1" strokeDasharray="5 4" />
                      <line x1="74%" y1="70%" x2="50%" y2="50%" stroke="rgba(62,231,210,0.13)" strokeWidth="1" strokeDasharray="5 4" />
                    </svg>

                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-6 gap-y-3">

                      {/* 行 0: 上方标签 */}
                      <p className="text-center font-mono text-[0.68rem] uppercase tracking-[0.32em] text-cyan-400/50">P4 | 左上防线</p>
                      <div />
                      <p className="text-center font-mono text-[0.68rem] uppercase tracking-[0.32em] text-cyan-400/50">P3 | 右上防线</p>

                      {/* 行 1: 上方卡片 */}
                      <RoomSlotCard
                        slot={selectedRoom.slots.find((s) => s.slotId === 'P4') ?? null}
                        onDoubleClick={mySlot ? () => moveToSlot('P4') : undefined}
                      />
                      <div />
                      <RoomSlotCard
                        slot={selectedRoom.slots.find((s) => s.slotId === 'P3') ?? null}
                        onDoubleClick={mySlot ? () => moveToSlot('P3') : undefined}
                      />

                      {/* 行 2: 中心按钮 */}
                      <div />
                      <button
                        type="button"
                        onClick={toggleMyReady}
                        className={cx('room-deploy-btn', mySlot?.ready && 'room-deploy-btn-cancel')}
                      >
                        {mySlot?.ready ? '[ 取消部署 ]' : '[ 部署 ]'}
                      </button>
                      <div />

                      {/* 行 3: 下方卡片 */}
                      <RoomSlotCard
                        slot={selectedRoom.slots.find((s) => s.slotId === 'P1') ?? null}
                        onDoubleClick={mySlot ? () => moveToSlot('P1') : undefined}
                      />
                      <div />
                      <RoomSlotCard
                        slot={selectedRoom.slots.find((s) => s.slotId === 'P2') ?? null}
                        onDoubleClick={mySlot ? () => moveToSlot('P2') : undefined}
                      />

                      {/* 行 4: 下方标签 */}
                      <p className="text-center font-mono text-[0.68rem] uppercase tracking-[0.32em] text-cyan-400/50">P1 | 左下防线</p>
                      <div />
                      <p className="text-center font-mono text-[0.68rem] uppercase tracking-[0.32em] text-cyan-400/50">P2 | 右下防线</p>

                    </div>
                  </div>

                  {/* ── Footer ── */}
                  <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/[0.07] px-6 py-4">
                    <div className="flex flex-wrap items-center gap-6 font-mono text-xs">
                      <span className="text-slate-500">延迟: <span className="text-cyan-300">{selectedRoom.ping}ms</span></span>
                      <span className="text-slate-500">承载量: <span className="text-cyan-300">{selectedRoom.players}/4</span></span>
                      <span className="text-slate-500">接口: <span className={isConnected ? 'text-green-400' : 'text-orange-300'}>{isConnected ? 'CONNECTED' : connectionState.toUpperCase()}</span></span>
                    </div>

                    <button
                      type="button"
                      onClick={onStartGame}
                      disabled={!allReady}
                      className={cx(
                        'cyber-start-button !py-3 !text-sm',
                        !allReady && 'opacity-30 pointer-events-none',
                      )}
                    >
                      <Rocket className="h-4 w-4" />
                      <span>启动战局 (START)</span>
                    </button>
                  </div>

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
