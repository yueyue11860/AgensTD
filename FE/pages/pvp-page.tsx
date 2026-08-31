import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  BookOpenCheck,
  Check,
  ChevronRight,
  CircleDot,
  Clock3,
  Coins,
  Crown,
  DoorOpen,
  Eye,
  Gamepad2,
  History,
  LoaderCircle,
  Map,
  Medal,
  RefreshCcw,
  Search,
  Shield,
  ShieldAlert,
  Sparkles,
  Swords,
  Target,
  TimerReset,
  Trophy,
  UserRound,
  Users,
  Wifi,
  X,
} from 'lucide-react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { usePvpData } from '../hooks/use-pvp-data'
import { cx } from '../lib/cx'
import { resolvePlayerId } from '../lib/runtime-config'
import { useModalFocus } from '../hooks/use-modal-focus'
import type { PvpLeaderboardEntry, PvpMatchDetail, PvpMatchPublicState, PvpMatchResult, PvpMatchSummary, PvpMode, PvpProfile, PvpRoomSummary } from '../types/pvp'

const MODE_LABEL: Record<PvpMode, string> = {
  ranked_1v1: '排位斗法',
  casual_1v1: '休闲斗法',
  custom_1v1: '自定义斗法',
}

const RESULT_LABEL: Record<PvpMatchResult, string> = { win: '胜利', loss: '失败', draw: '平局', void: '无效局' }
const RANKED_PREVIEW_ENABLED = import.meta.env.DEV || import.meta.env.VITE_PVP_RANKED_ENABLED === 'true'

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

function formatDuration(durationMs: number) {
  const seconds = Math.max(0, Math.floor(durationMs / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function rankName(profile: PvpProfile | null) {
  if (!profile) return '未入天榜'
  return `${profile.rating.tier}${profile.rating.division ? ` ${profile.rating.division}` : ''}`
}

function PvpShell({ children, title, eyebrow, actions }: { children: React.ReactNode; title: string; eyebrow: string; actions?: React.ReactNode }) {
  const location = useLocation()
  const nav = [
    { to: '/pvp', label: '竞技中心', icon: Swords },
    { to: '/pvp/rooms', label: '自定义房', icon: Users },
    { to: '/pvp/history', label: '对局记录', icon: History },
    { to: '/pvp/leaderboard', label: '赛季榜', icon: Trophy },
    { to: '/profile', label: '我的档案', icon: UserRound },
  ]

  return (
    <main className="pvp-page">
      <div className="pvp-grid" />
      <div className="pvp-shell">
        <header className="pvp-topbar">
          <Link to="/home" className="pvp-back"><ArrowLeft className="h-4 w-4" />返回主页</Link>
          <nav className="pvp-nav" aria-label="PVP 导航">
            {nav.map(({ to, label, icon: Icon }) => (
              <Link key={to} to={to} aria-label={label} className={cx('pvp-nav-link', location.pathname === to && 'pvp-nav-link-active')}>
                <Icon className="h-4 w-4" /><span>{label}</span>
              </Link>
            ))}
          </nav>
        </header>

        <section className="pvp-hero">
          <div>
            <p>{eyebrow}</p>
            <h1>{title}</h1>
          </div>
          {actions ? <div className="pvp-hero-actions">{actions}</div> : null}
        </section>
        {children}
      </div>
    </main>
  )
}

function ServiceNotice({ error, notice, loading }: { error: string | null; notice: string | null; loading: boolean }) {
  if (loading) return <div className="pvp-service-state" role="status" aria-live="polite"><LoaderCircle className="h-4 w-4 animate-spin" />正在探查斗法台…</div>
  return (
    <>
      {error ? <div className="pvp-service-state pvp-service-warning" role="alert"><ShieldAlert className="h-4 w-4" />{error}</div> : null}
      {notice ? <div className="pvp-service-state pvp-service-success" role="status" aria-live="polite"><Check className="h-4 w-4" />{notice}</div> : null}
    </>
  )
}

function RankCard({ profile }: { profile: PvpProfile | null }) {
  const rating = profile?.rating
  return (
    <article className="pvp-panel pvp-rank-card">
      <div className="pvp-rank-emblem"><Crown className="h-8 w-8" /></div>
      <div>
        <span className="pvp-kicker">CURRENT RANK</span>
        <h2>{rankName(profile)}</h2>
        <p>{rating ? `${rating.visibleLp} LP · 天梯 #${rating.rank ?? '—'}` : '完成教学并保存竞技构筑后即可开始定级'}</p>
      </div>
      <div className="pvp-rank-record">
        <strong>{rating?.wins ?? 0}</strong><span>胜</span>
        <strong>{rating?.losses ?? 0}</strong><span>负</span>
        <strong>{rating?.draws ?? 0}</strong><span>平</span>
      </div>
    </article>
  )
}

function HubPage() {
  const navigate = useNavigate()
  const service = usePvpData()
  const season = service.data.season
  const profile = service.data.profile
  const rankedLocked = !RANKED_PREVIEW_ENABLED || Boolean(profile && (!profile.tutorialCompleted || !profile.loadoutValid || profile.queuePenaltyUntil))
  const seasonEnds = season?.endsAt ? new Date(season.endsAt).getTime() - Date.now() : null
  const seasonDays = seasonEnds === null ? null : Math.max(0, Math.ceil(seasonEnds / 86_400_000))

  return (
    <PvpShell title="斗法竞技" eyebrow="两界斗法 · 一念落子定胜负">
      <ServiceNotice error={service.error} notice={service.notice} loading={service.isLoading} />
      <section className="pvp-overview-grid">
        <RankCard profile={profile} />
        <article className="pvp-panel pvp-season-card">
          <div><span className="pvp-kicker">ACTIVE SEASON</span><h2>{season?.name ?? '赛季数据待接入'}</h2></div>
          <div className="pvp-season-meta"><Clock3 className="h-5 w-5" /><strong>{seasonDays === null ? '—' : seasonDays}</strong><span>天后结束</span></div>
          <p>战场 {season?.mapIds.length ?? 1} 处 · 赛季余 {seasonDays === null ? '—' : seasonDays} 日</p>
        </article>
      </section>

      <section className="pvp-mode-grid">
        <article className="pvp-mode-card pvp-mode-ranked">
          <div className="pvp-mode-icon"><Medal className="h-7 w-7" /></div>
          <span className="pvp-kicker">RANKED 1V1</span><h2>排位斗法</h2>
          <p>竞技借用库、配对随机袋与冻结规则快照。胜负会改变当季段位与 LP。</p>
          {rankedLocked ? <small>完成入门试炼后解锁</small> : null}
          <button type="button" disabled={rankedLocked} onClick={() => navigate('/pvp/matchmaking?mode=ranked_1v1')}>{RANKED_PREVIEW_ENABLED ? '踏入排位' : '排位未开'}<ChevronRight className="h-4 w-4" /></button>
        </article>
        <article className="pvp-mode-card">
          <div className="pvp-mode-icon"><Gamepad2 className="h-7 w-7" /></div>
          <span className="pvp-kicker">CASUAL DUEL</span><h2>散修斗法</h2>
          <p>轻装上阵，试招、布阵、合字，不计入天梯名次。</p>
          <button type="button" onClick={() => navigate('/pvp/matchmaking?mode=casual_1v1')}>寻找对手<ChevronRight className="h-4 w-4" /></button>
        </article>
        <article className="pvp-mode-card">
          <div className="pvp-mode-icon"><DoorOpen className="h-7 w-7" /></div>
          <span className="pvp-kicker">CUSTOM ROOM</span><h2>自定义斗法</h2>
          <p>邀一位同道开局，约战两界斗法台。</p>
          <button type="button" onClick={() => navigate('/pvp/rooms')}>进入房厅<ChevronRight className="h-4 w-4" /></button>
        </article>
      </section>

      <section className="pvp-panel pvp-map-preview">
        <div className="pvp-map-copy"><span className="pvp-kicker">FIRST MAP</span><h2>两界斗法台</h2><p>29×29 镜像战场。双方只在自己的半场布阵，通过“真经”向对手发送公开、可防守的压力怪。</p><div><span>核心耐久 10</span><span>5 秒准备</span><span>6:00 天劫</span><span>12:00 硬裁决</span></div></div>
        <div className="pvp-dual-map" aria-label="两界斗法台示意图"><span>A 方领域</span><i /><span>B 方领域</span></div>
      </section>
    </PvpShell>
  )
}

function MatchmakingPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const requested = new URLSearchParams(location.search).get('mode')
  const mode = requested === 'casual_1v1' ? 'casual_1v1' : 'ranked_1v1'
  const service = usePvpData()
  const ticket = service.queueTicket
  const proposal = service.matchProposal ?? ticket?.proposal ?? null
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!ticket) return
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [ticket])
  const searchSeconds = ticket ? Math.max(0, Math.floor((now - ticket.searchStartedAt) / 1000)) : 0
  const confirmSeconds = proposal ? Math.max(0, Math.ceil((proposal.confirmDeadlineAt - now) / 1000)) : null

  return (
    <PvpShell title={MODE_LABEL[mode]} eyebrow="寻觅同道 · 斗法将启" actions={<button className="pvp-secondary-button" type="button" onClick={() => navigate('/pvp')}><X className="h-4 w-4" />离开</button>}>
      <ServiceNotice error={service.error} notice={service.notice} loading={service.isLoading} />
      <section className="pvp-matchmaking-stage">
        <div className={cx('pvp-search-orb', ticket && 'pvp-search-orb-active')}><Search className="h-12 w-12" /></div>
        <span className="pvp-kicker">{proposal ? 'MATCH FOUND' : ticket ? 'SEARCHING' : 'READY TO SEARCH'}</span>
        <h2>{proposal ? '已找到势均力敌的对手' : ticket ? '正在寻找真人对手' : '准备进入匹配队列'}</h2>
        <p>{ticket ? `天命寻敌 · 预计 ${ticket.estimatedWaitSeconds || 15} 秒` : '择一斗法门，静候同道。'}</p>
        {ticket ? <div className="pvp-search-timer"><TimerReset className="h-5 w-5" />{proposal ? `${confirmSeconds}s 内确认` : `${searchSeconds}s`}</div> : null}
        <div className="pvp-matchmaking-actions">
          {!ticket ? <button type="button" disabled={service.isMutating} onClick={() => void service.joinQueue(mode)}>确认进入{MODE_LABEL[mode]}</button> : null}
          {ticket && !proposal && !service.acceptedMatch ? <button type="button" className="pvp-danger-button" disabled={service.isMutating} onClick={() => void service.cancelQueue()}>取消匹配</button> : null}
          {proposal && !service.acceptedMatch ? <button type="button" disabled={service.isMutating || confirmSeconds === 0} onClick={() => void service.acceptMatch()}><Check className="h-4 w-4" />确认对局</button> : null}
          {service.acceptedMatch ? <button type="button" onClick={() => navigate(`/pvp/game/${service.acceptedMatch!.matchId}`)}>进入加载界面<ChevronRight className="h-4 w-4" /></button> : null}
        </div>
      </section>
      <section className="pvp-rule-strip"><span><Shield className="h-4 w-4" />借法入阵</span><span><CircleDot className="h-4 w-4" />天命随机</span><span><Wifi className="h-4 w-4" />灵脉畅通</span><span><Users className="h-4 w-4" />真人对决</span></section>
    </PvpShell>
  )
}

function RoomsPage() {
  const navigate = useNavigate()
  const service = usePvpData()
  const [isCreating, setIsCreating] = useState(false)
  const [name, setName] = useState('我的斗法房')
  const [password, setPassword] = useState('')
  const [spectatorsAllowed, setSpectatorsAllowed] = useState(true)
  const createDialogRef = useModalFocus<HTMLFormElement>(() => setIsCreating(false), isCreating)

  async function create() {
    const room = await service.createRoom({ roomName: name.trim() || '我的斗法房', password, spectatorsAllowed }).catch(() => null)
    if (room) navigate(`/pvp/rooms/${room.roomId}`)
  }

  return (
    <PvpShell title="自定义斗法房" eyebrow="自立战旗 · 邀友入阵" actions={<button type="button" onClick={() => setIsCreating(true)}><DoorOpen className="h-4 w-4" />立旗</button>}>
      <ServiceNotice error={service.error} notice={service.notice} loading={service.isLoading} />
      <section className="pvp-panel pvp-room-list">
        <header><div><span className="pvp-kicker">ROOM DIRECTORY</span><h2>公开房间</h2></div><button className="pvp-icon-button" type="button" onClick={() => void service.refresh()}><RefreshCcw className="h-4 w-4" /></button></header>
        {service.data.rooms.length ? service.data.rooms.map((room) => <RoomRow key={room.roomId} room={room} onOpen={() => navigate(`/pvp/rooms/${room.roomId}`)} />) : <EmptyState icon={DoorOpen} title="还没有斗法房" copy="立一面战旗，邀同道入阵。" />}
      </section>
      {isCreating ? <div className="pvp-modal-backdrop"><form ref={createDialogRef} className="pvp-modal" role="dialog" aria-modal="true" aria-labelledby="create-pvp-room-title" tabIndex={-1} onSubmit={(event) => { event.preventDefault(); void create() }}><button aria-label="关闭创建房间弹窗" className="pvp-modal-close" type="button" onClick={() => setIsCreating(false)}><X className="h-4 w-4" /></button><span className="pvp-kicker">CREATE CUSTOM ROOM</span><h2 id="create-pvp-room-title">创建自定义房</h2><label>房间名称<input value={name} onChange={(event) => setName(event.target.value)} maxLength={24} /></label><label>密码（可选）<input value={password} onChange={(event) => setPassword(event.target.value)} maxLength={16} type="password" /></label><label className="pvp-checkbox"><input checked={spectatorsAllowed} onChange={(event) => setSpectatorsAllowed(event.target.checked)} type="checkbox" />允许最多 8 名观众</label><div className="pvp-modal-summary"><Map className="h-4 w-4" />两界斗法台 · 标准 1v1 · 不计段位</div><button disabled={service.isMutating} type="submit">{service.isMutating ? '创建中…' : '创建房间'}</button></form></div> : null}
    </PvpShell>
  )
}

function RoomRow({ room, onOpen }: { room: PvpRoomSummary; onOpen: () => void }) {
  return <button type="button" className="pvp-room-row" onClick={onOpen}><div><strong>{room.roomName}</strong><small>{room.roomId}</small></div><span>{room.mapName || '两界斗法台'}</span><span>{room.playerCount}/{room.maxPlayers}</span><span>{room.hasPassword ? '有密码' : '公开'}</span><span>{room.status}</span><ChevronRight className="h-4 w-4" /></button>
}

function RoomDetailPage({ roomId }: { roomId: string }) {
  const navigate = useNavigate()
  const service = usePvpData({ roomId })
  const [password, setPassword] = useState('')
  const room = service.room ?? service.data.rooms.find((candidate) => candidate.roomId === roomId) ?? null
  const currentPlayerId = service.data.profile?.playerId ?? resolvePlayerId()
  const currentPlayer = room?.players.find((player) => player.playerId === currentPlayerId)
  const isMember = Boolean(currentPlayer)

  async function join(event: React.FormEvent) {
    event.preventDefault()
    await service.joinRoom(roomId, password).catch(() => null)
  }

  return (
    <PvpShell title={room?.roomName ?? '斗法房间'} eyebrow="斗法战旗" actions={<Link className="pvp-secondary-button" to="/pvp/rooms"><ArrowLeft className="h-4 w-4" />返回房厅</Link>}>
      <ServiceNotice error={service.error} notice={service.notice} loading={service.isLoading} />
      <section className="pvp-room-stage">
        <article className="pvp-panel pvp-room-side"><span className="pvp-side-label">A 方</span><PlayerSlot player={room?.players.find((player) => player.side === 'A')} /></article>
        <div className="pvp-room-versus"><Swords className="h-8 w-8" /><strong>VS</strong><span>两界斗法台</span></div>
        <article className="pvp-panel pvp-room-side"><span className="pvp-side-label">B 方</span><PlayerSlot player={room?.players.find((player) => player.side === 'B')} /></article>
      </section>
      <section className="pvp-panel pvp-room-controls">
        <div><Eye className="h-5 w-5" /><span>{room?.spectatorsAllowed ? '允许观战' : '禁止观战'}</span></div>
        <div><Shield className="h-5 w-5" /><span>标准竞技借用库</span></div>
        {room?.matchId ? <button type="button" onClick={() => navigate(`/pvp/game/${room.matchId}`)}>入阵<ChevronRight className="h-4 w-4" /></button> : null}
        {room && !room.matchId && isMember ? <button type="button" disabled={service.isMutating} onClick={() => void service.setReady(room.roomId, !currentPlayer?.ready)}>{currentPlayer?.ready ? '取消准备' : '准备斗法'}</button> : null}
        {room && !room.matchId && !isMember ? <form className="pvp-room-join" onSubmit={(event) => void join(event)}>{room.hasPassword ? <label><span>房间密码</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} maxLength={16} autoComplete="current-password" /></label> : <span>加入后才能准备</span>}<button type="submit" disabled={service.isMutating || (room.hasPassword && !password)}>{service.isMutating ? '加入中…' : '加入房间'}</button></form> : null}
      </section>
    </PvpShell>
  )
}

function PlayerSlot({ player }: { player: PvpRoomSummary['players'][number] | undefined }) {
  if (!player) return <div className="pvp-empty-slot"><UserRound className="h-8 w-8" /><strong>等待真人玩家</strong><span>空闲席位</span></div>
  return <div className="pvp-player-slot"><div className="pvp-player-avatar">{player.playerName.slice(0, 1)}</div><strong>{player.playerName}</strong><span>{player.tier}{player.division ? ` ${player.division}` : ''}</span><i className={player.ready ? 'ready' : ''}>{player.ready ? '已准备' : player.connected ? '未准备' : '已断线'}</i></div>
}

function GamePage({ matchId }: { matchId: string }) {
  const navigate = useNavigate()
  const service = usePvpData({ matchId })
  const state = service.gameState
  const [confirmSurrender, setConfirmSurrender] = useState(false)
  const surrenderDialogRef = useModalFocus<HTMLDivElement>(() => setConfirmSurrender(false), confirmSurrender)
  const terminal = state?.status === 'completed' || state?.status === 'voided'
  const preBattle = !state || state.status === 'ready_check' || state.status === 'loading' || state.status === 'countdown'
  useEffect(() => {
    if (!terminal) return
    const timer = window.setTimeout(() => navigate(`/pvp/results/${matchId}`, { replace: true }), 1200)
    return () => window.clearTimeout(timer)
  }, [matchId, navigate, terminal])
  return (
    <PvpShell title="两界斗法台" eyebrow="镜像战场 · 生死一局" actions={<button className="pvp-danger-button" type="button" disabled={terminal || preBattle || service.isMutating} onClick={() => setConfirmSurrender(true)}>投降</button>}>
      <ServiceNotice error={service.error} notice={service.notice} loading={service.isLoading} />
      {terminal ? <div className="pvp-service-state pvp-service-success"><Check className="h-4 w-4" />此局已落幕</div> : null}
      {preBattle ? <section className="pvp-loading-stage">
        <span className="pvp-kicker">斗法台 · 候场</span><h2>{state?.status === 'countdown' ? '双方已就位' : '等待对手入阵'}</h2>
        <p>战旗已立，待双方落子。</p>
        <div className="pvp-load-players"><LoadPlayer label="我方" name={state?.self.playerName} connected={state?.self.connected} status={state?.self.loadStatus ?? service.loadAckStatus} /><LoadPlayer label="对方" name={state?.opponent.playerName} connected={state?.opponent.connected} status={state?.opponent.loadStatus ?? 'idle'} /></div>
        {service.loadAckStatus === 'failed' ? <button type="button" onClick={service.retryLoad}>重新入阵</button> : null}
      </section> : null}
      {!preBattle ? <>
      <section className="pvp-game-hud">
        <div><span>我方核心</span><strong>{state?.self.coreHp ?? 10}</strong></div><div><span>斋饭</span><strong>{state?.self.rations ?? 10}</strong></div><div><span>真经</span><strong>{state?.self.scripture ?? 0}</strong></div><div><span>当前阵次</span><strong>{state?.round ?? 0}</strong></div><div><span>对方核心</span><strong>{state?.opponent.coreHp ?? 10}</strong></div>
      </section>
      {state ? <PvpPlayableBattlefield state={state} matchId={matchId} service={service} /> : <div className="pvp-game-empty"><LoaderCircle className="h-7 w-7" /><strong>等待战场显形</strong></div>}
      <section className="pvp-pressure-bar"><div><Sparkles className="h-5 w-5" /><span>遣妖</span><small>{service.pressureMessage ?? '消耗 5 真经，向对方安全队列加入压力怪'}</small></div><button type="button" disabled={!state || state.status !== 'playing' || state.self.scripture < 5 || service.isMutating} onClick={() => void service.sendPressure(matchId)}>{service.isMutating ? '发送中…' : '发送压力'}</button></section>
      </> : null}
      {confirmSurrender ? <div className="pvp-modal-backdrop"><div ref={surrenderDialogRef} className="pvp-modal" role="dialog" aria-modal="true" aria-labelledby="pvp-surrender-title" tabIndex={-1}><span className="pvp-kicker">SURRENDER</span><h2 id="pvp-surrender-title">确认投降？</h2><p>投降将由服务器立即判负；排位照常结算段位，恶意短局不发奖励。</p><div className="pvp-modal-buttons"><button className="pvp-secondary-button" type="button" onClick={() => setConfirmSurrender(false)}>继续战斗</button><button className="pvp-danger-button" type="button" onClick={() => { setConfirmSurrender(false); void service.surrender(matchId) }}>确认投降</button></div></div></div> : null}
    </PvpShell>
  )
}

function LoadPlayer({ label, name, connected, status }: { label: string; name?: string; connected?: boolean; status: string }) {
  const statusLabel = status === 'loaded' || status === 'acknowledged' ? '已 ACK' : status === 'failed' ? '加载失败' : status === 'preloading' || status === 'loading' ? '预载中' : '等待中'
  return <article className={cx('pvp-load-player', `pvp-load-${status}`)}><span>{label}</span><strong>{name || '真人玩家'}</strong><small>{connected === false ? '连接中断 · 可在截止前恢复' : statusLabel}</small></article>
}

function PvpPlayableBattlefield({ state, matchId, service }: { state: PvpMatchPublicState; matchId: string; service: ReturnType<typeof usePvpData> }) {
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null)
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null)
  const selfSlots = state.rulesSnapshot?.deploymentSlots[state.self.side] ?? []
  const opponentSlots = state.rulesSnapshot?.deploymentSlots[state.opponent.side] ?? []
  const recruits = [...state.self.tray, ...state.self.reserve].filter((unit) => unit !== null)
  const recentCombat = state.recentEvents.filter((event) => ['PIECE_ATTACKED', 'ENEMY_DAMAGED', 'ENEMY_KILLED', 'CORE_DAMAGED', 'PIECE_MERGED'].includes(event.type)).slice(-4).reverse()
  const clickSelfCell = (x: number, y: number, occupantId?: string) => {
    if (service.isMutating) return
    if (selectedUnitId && !occupantId) {
      void service.deploy(matchId, selectedUnitId, x, y).then((result) => { if (result?.ok) setSelectedUnitId(null) })
      return
    }
    if (selectedEntityId && occupantId !== selectedEntityId) {
      void service.moveOrMerge(matchId, selectedEntityId, x, y).then((result) => { if (result?.ok) setSelectedEntityId(null) })
      return
    }
    setSelectedUnitId(null)
    setSelectedEntityId(occupantId && occupantId !== selectedEntityId ? occupantId : null)
  }
  return <section className="pvp-playable-battle" aria-label="两界斗法战场">
    <header className="pvp-battle-rules"><span>借用库 <b>{state.rulesSnapshot?.catalogVersion ?? '未知'}</b></span><span>人口 <b>{state.self.populationUsed}/{state.self.populationCap}</b></span><span>招募 <b>{state.rulesSnapshot?.recruitCost ?? 3} 斋饭</b></span><span>只读战斗 Tick <b>{state.tick}</b></span></header>
    <div className="pvp-live-lanes">
      <PvpDefenseLane label="对手公开防线" coreHp={state.opponent.coreHp} enemies={state.opponent.enemies} pieces={state.opponent.boardPieces} />
      <div className="pvp-versus-seal">斗</div>
      <PvpDefenseLane label="我方防线" coreHp={state.self.coreHp} enemies={state.self.enemies} pieces={state.self.boardPieces} own />
    </div>
    <div className="pvp-deployment-zones">
      <div className="pvp-deployment-zone pvp-opponent-zone"><strong>对手布阵 · 公开只读</strong><div className="pvp-slot-grid">{opponentSlots.map((slot) => {
        const piece = state.opponent.boardPieces.find((candidate) => candidate.x === slot.x && candidate.y === slot.y)
        return <div key={`${slot.x}:${slot.y}`} className="pvp-deploy-cell pvp-deploy-readonly">{piece ? <span data-type={piece.soldierType}>{piece.glyph}<small>Lv.{piece.level}</small></span> : <i />}</div>
      })}</div></div>
      <div className="pvp-deployment-zone"><strong>我方布阵 · 点击部署/移动/合成</strong><div className="pvp-slot-grid">{selfSlots.map((slot) => {
        const piece = state.self.boardPieces.find((candidate) => candidate.x === slot.x && candidate.y === slot.y)
        return <button key={`${slot.x}:${slot.y}`} type="button" disabled={service.isMutating} className={cx('pvp-deploy-cell', piece?.entityId === selectedEntityId && 'selected', selectedUnitId && !piece && 'deploy-target')} aria-label={piece ? `${piece.glyph} ${piece.soldierType} 等级 ${piece.level}` : `空部署位 ${slot.x},${slot.y}`} onClick={() => clickSelfCell(slot.x, slot.y, piece?.entityId)}>{piece ? <span data-type={piece.soldierType}>{piece.glyph}<small>Lv.{piece.level}</small></span> : <i />}</button>
      })}</div></div>
    </div>
    <div className="pvp-recruit-dock">
      <div><strong>我方私有托盘</strong><small>对手投影不包含此数据</small></div>
      <div className="pvp-tray-units">{recruits.length ? recruits.map((unit) => <button type="button" key={unit.unitId} disabled={service.isMutating} className={cx(unit.unitId === selectedUnitId && 'selected')} onClick={() => { setSelectedEntityId(null); setSelectedUnitId(unit.unitId === selectedUnitId ? null : unit.unitId) }}><b>{unit.glyph}</b><span>{state.rulesSnapshot?.soldiers[unit.soldierType]?.name ?? unit.soldierType}</span></button>) : <span>托盘暂空，先招募天兵</span>}</div>
      <button className="pvp-recruit-button" type="button" disabled={service.isMutating || state.status !== 'playing' || state.self.rations < (state.rulesSnapshot?.recruitCost ?? 3)} onClick={() => void service.recruit(matchId)}>{service.isMutating ? '召唤中…' : `招募 · ${state.rulesSnapshot?.recruitCost ?? 3}斋饭`}</button>
    </div>
    <div className="pvp-battle-receipt" role="status" aria-live="polite"><span>{service.battleActionMessage ?? '选中托盘天兵后点击空位部署；选中已部署天兵后点同类同级可合成。'}</span>{recentCombat.map((event) => <small key={event.eventId}>{event.type.replaceAll('_', ' ')} · tick {event.tick}</small>)}</div>
  </section>
}

function PvpDefenseLane({ label, coreHp, enemies, pieces, own = false }: { label: string; coreHp: number; enemies: PvpMatchPublicState['self']['enemies']; pieces: PvpMatchPublicState['self']['boardPieces']; own?: boolean }) {
  return <article className={cx('pvp-defense-lane', own && 'own')}><header><span>{label}</span><b><Shield className="h-4 w-4" />{coreHp}</b></header><div className="pvp-lane-track"><div className="pvp-lane-pieces">{pieces.map((piece, index) => <i key={piece.entityId} data-type={piece.soldierType} style={{ left: `${8 + (index % 8) * 11}%` }}>{piece.glyph}</i>)}</div>{enemies.map((enemy) => <span key={enemy.enemyId} className={cx('pvp-lane-enemy', enemy.kind === 'pressure' && 'pressure')} style={{ left: `${Math.min(94, 3 + (enemy.routeCellIndex + enemy.routeProgressMilli / 1000) * 1.45)}%` }}><b>{enemy.glyph}</b><small>{enemy.hp}/{enemy.maxHp}</small></span>)}{!enemies.length ? <em>等待下一只字妖</em> : null}</div></article>
}

function HistoryPage() {
  const service = usePvpData()
  const [mode, setMode] = useState<'all' | PvpMode>('all')
  const [result, setResult] = useState<'all' | PvpMatchResult>('all')
  const matches = service.data.history.filter((match) => (mode === 'all' || match.mode === mode) && (result === 'all' || match.result === result))
  return (
      <PvpShell title="对局记录" eyebrow="刀光留痕 · 每一局都算数" actions={<button className="pvp-secondary-button" type="button" onClick={() => void service.refresh()}><RefreshCcw className="h-4 w-4" />翻新</button>}>
      <ServiceNotice error={service.error} notice={service.notice} loading={service.isLoading} />
      <section className="pvp-filter-bar"><label>模式<select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="all">全部模式</option><option value="ranked_1v1">排位斗法</option><option value="casual_1v1">休闲斗法</option><option value="custom_1v1">自定义房</option></select></label><label>结果<select value={result} onChange={(event) => setResult(event.target.value as typeof result)}><option value="all">全部结果</option><option value="win">胜利</option><option value="loss">失败</option><option value="draw">平局</option><option value="void">无效局</option></select></label></section>
      <section className="pvp-panel pvp-history-list">{matches.length ? matches.map((match) => <HistoryRow key={match.matchId} match={match} />) : <EmptyState icon={History} title="还没有战绩" copy="完成第一场斗法后，战果会留在这里。" />}</section>
    </PvpShell>
  )
}

function HistoryRow({ match }: { match: PvpMatchSummary }) {
  return <Link to={`/pvp/history/${match.matchId}`} className={cx('pvp-history-row', `pvp-result-${match.result}`)}><strong>{RESULT_LABEL[match.result]}</strong><div><span>{MODE_LABEL[match.mode]}</span><small>对手：{match.opponentName || '—'} · {match.mapName || '两界斗法台'}</small></div><span>{formatDuration(match.durationMs)}</span><span className={match.lpDelta >= 0 ? 'positive' : 'negative'}>{match.lpDelta > 0 ? '+' : ''}{match.lpDelta} LP</span><span>{formatDate(match.startedAt)}</span><ChevronRight className="h-4 w-4" /></Link>
}

function MatchDetailPage({ matchId, resultPage = false }: { matchId: string; resultPage?: boolean }) {
  const service = usePvpData({ matchId })
  const match = service.match
  return (
    <PvpShell title={resultPage ? '斗法结算' : '对局详情'} eyebrow={`MATCH · ${matchId}`} actions={<Link className="pvp-secondary-button" to={resultPage ? '/pvp' : '/pvp/history'}><ArrowLeft className="h-4 w-4" />{resultPage ? '返回竞技中心' : '返回记录'}</Link>}>
      <ServiceNotice error={service.error} notice={service.notice} loading={service.isLoading} />
      {match ? <MatchDetail match={match} resultPage={resultPage} /> : <section className="pvp-panel"><EmptyState icon={BookOpenCheck} title="战果尚未显现" copy="稍后再来查看。" /></section>}
    </PvpShell>
  )
}

function MatchDetail({ match, resultPage }: { match: PvpMatchDetail; resultPage: boolean }) {
  return <><section className={cx('pvp-result-banner', `pvp-result-${match.result}`)}><span>{MODE_LABEL[match.mode]}</span><h2>{RESULT_LABEL[match.result]}</h2><p>{match.resultReason} · {formatDuration(match.durationMs)}</p><strong>{match.lpDelta > 0 ? '+' : ''}{match.lpDelta} LP</strong></section><section className="pvp-stat-grid">{match.participants.map((participant) => <article key={participant.playerId} className="pvp-panel"><span className="pvp-kicker">{participant.side} SIDE · {RESULT_LABEL[participant.result]}</span><h2>{participant.playerName}</h2><div className="pvp-stats"><span>核心剩余<strong>{participant.coreHpRemaining}</strong></span><span>基础击杀<strong>{participant.baseKills}</strong></span><span>压力击杀<strong>{participant.pressureKills}</strong></span><span>泄漏<strong>{participant.leaks}</strong></span><span>造成伤害<strong>{participant.damageDealt}</strong></span><span>真经消耗<strong>{participant.scriptureSpent}</strong></span></div><p>{participant.tierBefore} {participant.lpBefore} LP → {participant.tierAfter} {participant.lpAfter} LP</p></article>)}</section><section className="pvp-panel pvp-reward-row"><div><Coins className="h-5 w-5" /><span>战果奖励</span></div>{match.rewards.length ? match.rewards.map((reward) => <span key={`${reward.type}-${reward.label}`}>{reward.label} +{reward.amount}</span>) : <span>{match.result === 'void' ? '无效局不发奖励' : '暂无奖励'}</span>}<button type="button" disabled={match.replayStatus !== 'available'}>{match.replayStatus === 'available' ? '观看回放' : '回放未留存'}</button>{resultPage ? <Link to="/pvp/matchmaking?mode=ranked_1v1">再来一局</Link> : null}</section></>
}

function LeaderboardPage() {
  const service = usePvpData()
  const board = service.data.leaderboard
  return (
    <PvpShell title="赛季天梯榜" eyebrow="RANKED 1V1 · 仅真人玩家" actions={<button className="pvp-secondary-button" type="button" onClick={() => void service.refresh()}><RefreshCcw className="h-4 w-4" />刷新榜单</button>}>
      <ServiceNotice error={service.error} notice={service.notice} loading={service.isLoading} />
      {board?.self ? <section className="pvp-self-rank"><Target className="h-5 w-5" /><span>我的排名</span><strong>#{board.self.rank}</strong><span>{board.self.tier} {board.self.division ?? ''}</span><span>{board.self.visibleLp} LP</span></section> : null}
      <section className="pvp-panel pvp-leaderboard"><header><span>名次</span><span>玩家</span><span>段位</span><span>LP</span><span>胜负</span><span>胜率</span></header>{board?.entries.length ? board.entries.map((entry) => <LeaderboardRow key={entry.playerId} entry={entry} />) : <EmptyState icon={Trophy} title="天榜尚未显现" copy="待更多斗法者留下姓名。" />}</section>
    </PvpShell>
  )
}

function LeaderboardRow({ entry }: { entry: PvpLeaderboardEntry }) {
  return <div className={cx('pvp-leaderboard-row', entry.rank <= 3 && 'pvp-leaderboard-top')}><strong>#{entry.rank}</strong><div><span className="pvp-mini-avatar">{entry.playerName.slice(0, 1)}</span><span>{entry.playerName}</span></div><span>{entry.tier} {entry.division ?? ''}</span><strong>{entry.visibleLp}</strong><span>{entry.wins} / {entry.losses} / {entry.draws}</span><span>{Math.round(entry.winRate * (entry.winRate <= 1 ? 100 : 1))}%</span></div>
}

function ProfilePage() {
  const service = usePvpData()
  const profile = service.data.profile
  const rating = profile?.rating
  const total = (rating?.wins ?? 0) + (rating?.losses ?? 0) + (rating?.draws ?? 0)
  const winRate = total ? Math.round(((rating?.wins ?? 0) / total) * 100) : 0
  return (
    <PvpShell title="我的竞技档案" eyebrow="PLAYER PROFILE · PVP SEASON">
      <ServiceNotice error={service.error} notice={service.notice} loading={service.isLoading} />
      <section className="pvp-profile-grid"><article className="pvp-panel pvp-profile-card"><div className="pvp-profile-avatar">{profile?.playerName?.slice(0, 1) ?? '游'}</div><div><span className="pvp-kicker">{profile?.playerId ?? 'PLAYER ID'}</span><h2>{profile?.playerName ?? '未登录玩家'}</h2><p>{profile?.region ?? '地区未设置'} · 真人竞技账户</p></div></article><RankCard profile={profile} /></section>
      <section className="pvp-stat-grid pvp-profile-stats"><article className="pvp-panel"><span className="pvp-kicker">WIN RATE</span><strong>{winRate}%</strong><p>{total} 场有效排位</p></article><article className="pvp-panel"><span className="pvp-kicker">SEASON PEAK</span><strong>{rating?.peakLp ?? 0}</strong><p>赛季最高 LP</p></article><article className="pvp-panel"><span className="pvp-kicker">PLACEMENT</span><strong>{rating?.placementGames ?? 0}/5</strong><p>当季定级赛</p></article><article className="pvp-panel"><span className="pvp-kicker">STREAK</span><strong>{rating?.streak ?? 0}</strong><p>当前连胜</p></article></section>
      <section className="pvp-panel pvp-profile-checklist"><h2>竞技准入</h2><span className={profile?.tutorialCompleted ? 'done' : ''}><Check className="h-4 w-4" />PVP 教学演练</span><span className={profile?.loadoutValid ? 'done' : ''}><Check className="h-4 w-4" />合法竞技构筑</span><span className={!profile?.queuePenaltyUntil ? 'done' : ''}><Check className="h-4 w-4" />无队列处罚</span><span><Shield className="h-4 w-4" />局外 PVE 强度不进入排位</span></section>
    </PvpShell>
  )
}

function EmptyState({ icon: Icon, title, copy }: { icon: typeof Trophy; title: string; copy: string }) {
  return <div className="pvp-empty"><Icon className="h-8 w-8" /><div><strong>{title}</strong><p>{copy}</p></div></div>
}

export function PvpPage() {
  const location = useLocation()
  const params = useParams<{ roomId?: string; matchId?: string }>()
  const path = location.pathname
  if (path === '/pvp') return <HubPage />
  if (path === '/pvp/matchmaking') return <MatchmakingPage />
  if (path === '/pvp/rooms') return <RoomsPage />
  if (path.startsWith('/pvp/rooms/') && params.roomId) return <RoomDetailPage roomId={params.roomId} />
  if (path.startsWith('/pvp/game/') && params.matchId) return <GamePage matchId={params.matchId} />
  if (path.startsWith('/pvp/results/') && params.matchId) return <MatchDetailPage matchId={params.matchId} resultPage />
  if (path === '/pvp/history') return <HistoryPage />
  if (path.startsWith('/pvp/history/') && params.matchId) return <MatchDetailPage matchId={params.matchId} />
  if (path === '/pvp/leaderboard') return <LeaderboardPage />
  if (path === '/profile') return <ProfilePage />
  return <HubPage />
}
