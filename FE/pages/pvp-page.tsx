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
import type { PvpLeaderboardEntry, PvpMatchDetail, PvpMatchResult, PvpMatchSummary, PvpMode, PvpProfile, PvpRoomSummary } from '../types/pvp'

const MODE_LABEL: Record<PvpMode, string> = {
  ranked_1v1: '排位斗法',
  casual_1v1: '休闲斗法',
  custom_1v1: '自定义斗法',
}

const RESULT_LABEL: Record<PvpMatchResult, string> = { win: '胜利', loss: '失败', draw: '平局', void: '无效局' }

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
  if (!profile) return '段位尚未同步'
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
              <Link key={to} to={to} className={cx('pvp-nav-link', location.pathname === to && 'pvp-nav-link-active')}>
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
  if (loading) return <div className="pvp-service-state"><LoaderCircle className="h-4 w-4 animate-spin" />正在同步 PVP 权威数据…</div>
  return (
    <>
      {error ? <div className="pvp-service-state pvp-service-warning"><ShieldAlert className="h-4 w-4" />{error} 页面骨架仍可浏览，所有段位与结算以服务端返回为准。</div> : null}
      {notice ? <div className="pvp-service-state pvp-service-success"><Check className="h-4 w-4" />{notice}</div> : null}
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
  const rankedLocked = Boolean(profile && (!profile.tutorialCompleted || !profile.loadoutValid || profile.queuePenaltyUntil))
  const seasonEnds = season?.endsAt ? new Date(season.endsAt).getTime() - Date.now() : null
  const seasonDays = seasonEnds === null ? null : Math.max(0, Math.ceil(seasonEnds / 86_400_000))

  return (
    <PvpShell title="斗法竞技" eyebrow="真人实时 PVP · 服务器权威 · 公平竞技">
      <ServiceNotice error={service.error} notice={service.notice} loading={service.isLoading} />
      <section className="pvp-overview-grid">
        <RankCard profile={profile} />
        <article className="pvp-panel pvp-season-card">
          <div><span className="pvp-kicker">ACTIVE SEASON</span><h2>{season?.name ?? '赛季数据待接入'}</h2></div>
          <div className="pvp-season-meta"><Clock3 className="h-5 w-5" /><strong>{seasonDays === null ? '—' : seasonDays}</strong><span>天后结束</span></div>
          <p>规则版本 {season?.rulesetVersion ?? '—'} · 地图池 {season?.mapIds.length ?? 1}</p>
        </article>
      </section>

      <section className="pvp-mode-grid">
        <article className="pvp-mode-card pvp-mode-ranked">
          <div className="pvp-mode-icon"><Medal className="h-7 w-7" /></div>
          <span className="pvp-kicker">RANKED 1V1</span><h2>排位斗法</h2>
          <p>竞技借用库、配对随机袋与冻结规则快照。胜负会改变当季段位与 LP。</p>
          {rankedLocked ? <small>当前未满足教学、构筑或队列处罚条件。</small> : <small>MMR ±100 起步，每 10 秒扩大搜索范围。</small>}
          <button type="button" disabled={rankedLocked} onClick={() => navigate('/pvp/matchmaking?mode=ranked_1v1')}>开始排位<ChevronRight className="h-4 w-4" /></button>
        </article>
        <article className="pvp-mode-card">
          <div className="pvp-mode-icon"><Gamepad2 className="h-7 w-7" /></div>
          <span className="pvp-kicker">CASUAL 1V1</span><h2>休闲斗法</h2>
          <p>规则与排位一致，但不改变段位。适合验证构筑、熟悉真经压力节奏。</p>
          <small>只匹配在线真人，不会使用录像或伪装对手。</small>
          <button type="button" onClick={() => navigate('/pvp/matchmaking?mode=casual_1v1')}>快速匹配<ChevronRight className="h-4 w-4" /></button>
        </article>
        <article className="pvp-mode-card">
          <div className="pvp-mode-icon"><DoorOpen className="h-7 w-7" /></div>
          <span className="pvp-kicker">CUSTOM ROOM</span><h2>自定义斗法</h2>
          <p>创建或加入 1v1 标准房，可配置密码和观战。自定义对局不发可交易奖励。</p>
          <small>首发地图：两界斗法台。</small>
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
    <PvpShell title={MODE_LABEL[mode]} eyebrow="MATCHMAKING · 仅真人玩家" actions={<button className="pvp-secondary-button" type="button" onClick={() => navigate('/pvp')}><X className="h-4 w-4" />离开队列页</button>}>
      <ServiceNotice error={service.error} notice={service.notice} loading={service.isLoading} />
      <section className="pvp-matchmaking-stage">
        <div className={cx('pvp-search-orb', ticket && 'pvp-search-orb-active')}><Search className="h-12 w-12" /></div>
        <span className="pvp-kicker">{proposal ? 'MATCH FOUND' : ticket ? 'SEARCHING' : 'READY TO SEARCH'}</span>
        <h2>{proposal ? '已找到势均力敌的对手' : ticket ? '正在寻找真人对手' : '准备进入匹配队列'}</h2>
        <p>{ticket ? `搜索范围 ±${ticket.searchRange || 100} MMR · 预计 ${ticket.estimatedWaitSeconds || 15} 秒` : '服务器将校验教学、竞技构筑、处罚状态与规则版本。'}</p>
        {ticket ? <div className="pvp-search-timer"><TimerReset className="h-5 w-5" />{proposal ? `${confirmSeconds}s 内确认` : `${searchSeconds}s`}</div> : null}
        <div className="pvp-matchmaking-actions">
          {!ticket ? <button type="button" disabled={service.isMutating} onClick={() => void service.joinQueue(mode)}>确认进入{MODE_LABEL[mode]}</button> : null}
          {ticket && !proposal && !service.acceptedMatch ? <button type="button" className="pvp-danger-button" disabled={service.isMutating} onClick={() => void service.cancelQueue()}>取消匹配</button> : null}
          {proposal && !service.acceptedMatch ? <button type="button" disabled={service.isMutating || confirmSeconds === 0} onClick={() => void service.acceptMatch()}><Check className="h-4 w-4" />确认对局</button> : null}
          {service.acceptedMatch ? <button type="button" onClick={() => navigate(`/pvp/game/${service.acceptedMatch!.matchId}`)}>进入加载界面<ChevronRight className="h-4 w-4" /></button> : null}
        </div>
      </section>
      <section className="pvp-rule-strip"><span><Shield className="h-4 w-4" />竞技借用库</span><span><CircleDot className="h-4 w-4" />配对随机袋</span><span><Wifi className="h-4 w-4" />目标 RTT &lt;120ms</span><span><Users className="h-4 w-4" />仅真人匹配</span></section>
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

  async function create() {
    const room = await service.createRoom({ roomName: name.trim() || '我的斗法房', password, spectatorsAllowed }).catch(() => null)
    if (room) navigate(`/pvp/rooms/${room.roomId}`)
  }

  return (
    <PvpShell title="自定义斗法房" eyebrow="CUSTOM 1V1 · 标准竞技预设" actions={<button type="button" onClick={() => setIsCreating(true)}><DoorOpen className="h-4 w-4" />创建房间</button>}>
      <ServiceNotice error={service.error} notice={service.notice} loading={service.isLoading} />
      <section className="pvp-panel pvp-room-list">
        <header><div><span className="pvp-kicker">ROOM DIRECTORY</span><h2>公开房间</h2></div><button className="pvp-icon-button" type="button" onClick={() => void service.refresh()}><RefreshCcw className="h-4 w-4" /></button></header>
        {service.data.rooms.length ? service.data.rooms.map((room) => <RoomRow key={room.roomId} room={room} onOpen={() => navigate(`/pvp/rooms/${room.roomId}`)} />) : <EmptyState icon={DoorOpen} title="当前没有公开斗法房" copy="创建一间标准 1v1 房，或稍后刷新。自定义房不会伪装成排位赛。" />}
      </section>
      {isCreating ? <div className="pvp-modal-backdrop"><form className="pvp-modal" onSubmit={(event) => { event.preventDefault(); void create() }}><button className="pvp-modal-close" type="button" onClick={() => setIsCreating(false)}><X className="h-4 w-4" /></button><span className="pvp-kicker">CREATE CUSTOM ROOM</span><h2>创建自定义房</h2><label>房间名称<input value={name} onChange={(event) => setName(event.target.value)} maxLength={24} /></label><label>密码（可选）<input value={password} onChange={(event) => setPassword(event.target.value)} maxLength={16} type="password" /></label><label className="pvp-checkbox"><input checked={spectatorsAllowed} onChange={(event) => setSpectatorsAllowed(event.target.checked)} type="checkbox" />允许最多 8 名观众</label><div className="pvp-modal-summary"><Map className="h-4 w-4" />两界斗法台 · 标准 1v1 · 不计段位</div><button disabled={service.isMutating} type="submit">{service.isMutating ? '创建中…' : '创建房间'}</button></form></div> : null}
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
    <PvpShell title={room?.roomName ?? '斗法房间'} eyebrow={`CUSTOM ROOM · ${roomId}`} actions={<Link className="pvp-secondary-button" to="/pvp/rooms"><ArrowLeft className="h-4 w-4" />返回房厅</Link>}>
      <ServiceNotice error={service.error} notice={service.notice} loading={service.isLoading} />
      <section className="pvp-room-stage">
        <article className="pvp-panel pvp-room-side"><span className="pvp-side-label">A 方</span><PlayerSlot player={room?.players.find((player) => player.side === 'A')} /></article>
        <div className="pvp-room-versus"><Swords className="h-8 w-8" /><strong>VS</strong><span>两界斗法台</span></div>
        <article className="pvp-panel pvp-room-side"><span className="pvp-side-label">B 方</span><PlayerSlot player={room?.players.find((player) => player.side === 'B')} /></article>
      </section>
      <section className="pvp-panel pvp-room-controls">
        <div><Eye className="h-5 w-5" /><span>{room?.spectatorsAllowed ? '允许观战' : '禁止观战'}</span></div>
        <div><Shield className="h-5 w-5" /><span>标准竞技借用库</span></div>
        {room?.matchId ? <button type="button" onClick={() => navigate(`/pvp/game/${room.matchId}`)}>进入战场<ChevronRight className="h-4 w-4" /></button> : null}
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
  const terminal = state?.status === 'completed' || state?.status === 'voided'
  useEffect(() => {
    if (!terminal) return
    const timer = window.setTimeout(() => navigate(`/pvp/results/${matchId}`, { replace: true }), 1200)
    return () => window.clearTimeout(timer)
  }, [matchId, navigate, terminal])
  return (
    <PvpShell title="两界斗法台" eyebrow={`LIVE MATCH · ${matchId}`} actions={<button className="pvp-danger-button" type="button" disabled={terminal || service.isMutating} onClick={() => setConfirmSurrender(true)}>投降</button>}>
      <ServiceNotice error={service.error} notice={service.notice} loading={service.isLoading} />
      {terminal ? <div className="pvp-service-state pvp-service-success"><Check className="h-4 w-4" />权威对局已结束，正在进入服务器结算…</div> : null}
      <section className="pvp-game-hud">
        <div><span>我方核心</span><strong>{state?.self.coreHp ?? 10}</strong></div><div><span>斋饭</span><strong>{state?.self.rations ?? 10}</strong></div><div><span>真经</span><strong>{state?.self.scripture ?? 0}</strong></div><div><span>当前阵次</span><strong>{state?.round ?? 0}</strong></div><div><span>对方核心</span><strong>{state?.opponent.coreHp ?? 10}</strong></div>
      </section>
      <section className="pvp-battle-skeleton">
        <div className="pvp-half pvp-half-a"><span>我方部署区</span><div className="pvp-core"><Shield className="h-6 w-6" />{state?.self.coreHp ?? 10}</div></div>
        <div className="pvp-neutral-line">中立分界带</div>
        <div className="pvp-half pvp-half-b"><span>对手公开战场</span><div className="pvp-core"><Shield className="h-6 w-6" />{state?.opponent.coreHp ?? 10}</div></div>
        {!state ? <div className="pvp-game-empty"><LoaderCircle className="h-7 w-7" /><strong>等待 PVP 权威状态</strong><span>这里不会读取或复用 PVE GameState。</span></div> : null}
      </section>
      <section className="pvp-pressure-bar"><div><Sparkles className="h-5 w-5" /><span>遣妖</span><small>{service.pressureMessage ?? '消耗 5 真经，向对方安全队列加入压力怪'}</small></div><button type="button" disabled={!state || state.status !== 'playing' || state.self.scripture < 5 || service.isMutating} onClick={() => void service.sendPressure(matchId)}>{service.isMutating ? '发送中…' : '发送压力'}</button></section>
      {confirmSurrender ? <div className="pvp-modal-backdrop"><div className="pvp-modal"><span className="pvp-kicker">SURRENDER</span><h2>确认投降？</h2><p>投降将由服务器立即判负；排位照常结算段位，恶意短局不发奖励。</p><div className="pvp-modal-buttons"><button className="pvp-secondary-button" type="button" onClick={() => setConfirmSurrender(false)}>继续战斗</button><button className="pvp-danger-button" type="button" onClick={() => { setConfirmSurrender(false); void service.surrender(matchId) }}>确认投降</button></div></div></div> : null}
    </PvpShell>
  )
}

function HistoryPage() {
  const service = usePvpData()
  const [mode, setMode] = useState<'all' | PvpMode>('all')
  const [result, setResult] = useState<'all' | PvpMatchResult>('all')
  const matches = service.data.history.filter((match) => (mode === 'all' || match.mode === mode) && (result === 'all' || match.result === result))
  return (
    <PvpShell title="对局记录" eyebrow="MY MATCH HISTORY · 权威结算摘要" actions={<button className="pvp-secondary-button" type="button" onClick={() => void service.refresh()}><RefreshCcw className="h-4 w-4" />刷新</button>}>
      <ServiceNotice error={service.error} notice={service.notice} loading={service.isLoading} />
      <section className="pvp-filter-bar"><label>模式<select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="all">全部模式</option><option value="ranked_1v1">排位斗法</option><option value="casual_1v1">休闲斗法</option><option value="custom_1v1">自定义房</option></select></label><label>结果<select value={result} onChange={(event) => setResult(event.target.value as typeof result)}><option value="all">全部结果</option><option value="win">胜利</option><option value="loss">失败</option><option value="draw">平局</option><option value="void">无效局</option></select></label></section>
      <section className="pvp-panel pvp-history-list">{matches.length ? matches.map((match) => <HistoryRow key={match.matchId} match={match} />) : <EmptyState icon={History} title="暂无符合条件的对局" copy="完成第一场真人 PVP 后，权威结算摘要会出现在这里。" />}</section>
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
      {match ? <MatchDetail match={match} resultPage={resultPage} /> : <section className="pvp-panel"><EmptyState icon={BookOpenCheck} title="结算详情尚未就绪" copy="等待服务器完成唯一结算事务；客户端不会估算 LP、奖励或胜负原因。" /></section>}
    </PvpShell>
  )
}

function MatchDetail({ match, resultPage }: { match: PvpMatchDetail; resultPage: boolean }) {
  return <><section className={cx('pvp-result-banner', `pvp-result-${match.result}`)}><span>{MODE_LABEL[match.mode]}</span><h2>{RESULT_LABEL[match.result]}</h2><p>{match.resultReason} · {formatDuration(match.durationMs)}</p><strong>{match.lpDelta > 0 ? '+' : ''}{match.lpDelta} LP</strong></section><section className="pvp-stat-grid">{match.participants.map((participant) => <article key={participant.playerId} className="pvp-panel"><span className="pvp-kicker">{participant.side} SIDE · {RESULT_LABEL[participant.result]}</span><h2>{participant.playerName}</h2><div className="pvp-stats"><span>核心剩余<strong>{participant.coreHpRemaining}</strong></span><span>基础击杀<strong>{participant.baseKills}</strong></span><span>压力击杀<strong>{participant.pressureKills}</strong></span><span>泄漏<strong>{participant.leaks}</strong></span><span>造成伤害<strong>{participant.damageDealt}</strong></span><span>真经消耗<strong>{participant.scriptureSpent}</strong></span></div><p>{participant.tierBefore} {participant.lpBefore} LP → {participant.tierAfter} {participant.lpAfter} LP</p></article>)}</section><section className="pvp-panel pvp-reward-row"><div><Coins className="h-5 w-5" /><span>权威奖励</span></div>{match.rewards.length ? match.rewards.map((reward) => <span key={`${reward.type}-${reward.label}`}>{reward.label} +{reward.amount}</span>) : <span>{match.result === 'void' ? '无效局不发奖励' : '奖励流水待同步'}</span>}<button type="button" disabled={match.replayStatus !== 'available'}>{match.replayStatus === 'available' ? '观看回放' : `回放：${match.replayStatus}`}</button>{resultPage ? <Link to="/pvp/matchmaking?mode=ranked_1v1">再来一局</Link> : null}</section></>
}

function LeaderboardPage() {
  const service = usePvpData()
  const board = service.data.leaderboard
  return (
    <PvpShell title="赛季天梯榜" eyebrow="RANKED 1V1 · 仅真人玩家" actions={<button className="pvp-secondary-button" type="button" onClick={() => void service.refresh()}><RefreshCcw className="h-4 w-4" />刷新榜单</button>}>
      <ServiceNotice error={service.error} notice={service.notice} loading={service.isLoading} />
      {board?.self ? <section className="pvp-self-rank"><Target className="h-5 w-5" /><span>我的排名</span><strong>#{board.self.rank}</strong><span>{board.self.tier} {board.self.division ?? ''}</span><span>{board.self.visibleLp} LP</span></section> : null}
      <section className="pvp-panel pvp-leaderboard"><header><span>名次</span><span>玩家</span><span>段位</span><span>LP</span><span>胜负</span><span>胜率</span></header>{board?.entries.length ? board.entries.map((entry) => <LeaderboardRow key={entry.playerId} entry={entry} />) : <EmptyState icon={Trophy} title="赛季榜尚未生成" copy="榜单按 LP、MMR、胜场和达成时间稳定排序，不沿用旧双榜或 PVE 最高波次。" />}</section>
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
