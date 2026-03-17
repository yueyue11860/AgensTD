import { useEffect, useMemo, useRef, useState } from 'react'
import { Coins, OctagonX, RadioTower, ShieldAlert, Skull } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { io, type Socket } from 'socket.io-client'
import { GameOverOverlay } from '../components/game-over-overlay'
import { MissionBriefingModal } from '../components/mission-briefing-modal'
import { cx } from '../lib/cx'
import { resolveGatewayToken, resolvePlayerId, resolvePlayerKind, resolveSocketUrl } from '../lib/runtime-config'

const BOARD_DIMENSION = 29
const DEFAULT_ROOM_ID = 'public-1'
const CELL_SIZE_CSS_VAR = 'var(--gaming-grid-cell-size)'

type RoomPhase = 'lobby' | 'countdown' | 'waiting_for_level' | 'playing'
type MatchStatus = 'waiting' | 'running' | 'finished'
type MatchOutcome = 'victory' | 'defeat'

interface ServerTowerState {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  damage?: number
  range?: number
  cooldownTicks?: number
}

interface ServerEnemyState {
  id: string
  kind: string
  x: number
  y: number
  hp: number
  maxHp: number
}

interface ServerWaveState {
  index: number
  label?: string
}

interface SelectedLevelInfo {
  levelId: number
  label: string
  description: string
  waveCount: number
  targetClearRate: number
  minPlayers: number
}

interface ServerDrivenGameState {
  roomId: string
  phase: RoomPhase
  tick: number
  status: MatchStatus
  towers: ServerTowerState[]
  enemies: ServerEnemyState[]
  gold: number
  overloadTicks: number
  currentWave: ServerWaveState
  result: {
    outcome: MatchOutcome
    reason?: string
  } | null
}

interface BuildOption {
  type: string
  label: string
  cost: number
  width: number
  height: number
  accentClassName: string
}

const BUILD_OPTIONS: BuildOption[] = [
  { type: 'arrow-1', label: '箭塔 1级', cost: 1, width: 1, height: 1, accentClassName: 'gaming-build-chip-cyan' },
  { type: 'ice-1', label: '冰塔 1级', cost: 2, width: 1, height: 1, accentClassName: 'gaming-build-chip-blue' },
  { type: 'cannon-1', label: '炮塔 1级', cost: 2, width: 1, height: 2, accentClassName: 'gaming-build-chip-orange' },
  { type: 'laser-1', label: '激光塔 1级', cost: 3, width: 1, height: 2, accentClassName: 'gaming-build-chip-red' },
]

const BUILD_OPTIONS_BY_TYPE = new Map(BUILD_OPTIONS.map((option) => [option.type, option]))

const REFERENCE_GATE_LABELS = new Map<string, string>([
  ['13:15', 'P1'],
  ['15:15', 'P2'],
  ['15:13', 'P3'],
  ['13:13', 'P4'],
])

const ARENA_PATHS = [
  [
    { x: 13, y: 15 },
    { x: 13, y: 18 },
    { x: 7, y: 18 },
    { x: 7, y: 21 },
    { x: 21, y: 21 },
    { x: 21, y: 7 },
    { x: 7, y: 7 },
    { x: 7, y: 14 },
    { x: 3, y: 14 },
    { x: 3, y: 3 },
    { x: 25, y: 3 },
    { x: 25, y: 25 },
    { x: 3, y: 25 },
    { x: 3, y: 14 },
  ],
  [
    { x: 15, y: 15 },
    { x: 18, y: 15 },
    { x: 18, y: 21 },
    { x: 21, y: 21 },
    { x: 21, y: 7 },
    { x: 7, y: 7 },
    { x: 7, y: 21 },
    { x: 14, y: 21 },
    { x: 14, y: 25 },
    { x: 3, y: 25 },
    { x: 3, y: 3 },
    { x: 25, y: 3 },
    { x: 25, y: 25 },
    { x: 14, y: 25 },
  ],
  [
    { x: 15, y: 13 },
    { x: 15, y: 10 },
    { x: 21, y: 10 },
    { x: 21, y: 7 },
    { x: 7, y: 7 },
    { x: 7, y: 21 },
    { x: 21, y: 21 },
    { x: 21, y: 14 },
    { x: 25, y: 14 },
    { x: 25, y: 25 },
    { x: 3, y: 25 },
    { x: 3, y: 3 },
    { x: 25, y: 3 },
    { x: 25, y: 14 },
  ],
  [
    { x: 13, y: 13 },
    { x: 10, y: 13 },
    { x: 10, y: 7 },
    { x: 7, y: 7 },
    { x: 7, y: 21 },
    { x: 21, y: 21 },
    { x: 21, y: 7 },
    { x: 14, y: 7 },
    { x: 14, y: 3 },
    { x: 25, y: 3 },
    { x: 25, y: 25 },
    { x: 3, y: 25 },
    { x: 3, y: 3 },
    { x: 14, y: 3 },
  ],
] as const

const BOARD_COORDINATES = Array.from({ length: BOARD_DIMENSION * BOARD_DIMENSION }, (_, index) => ({
  x: index % BOARD_DIMENSION,
  y: Math.floor(index / BOARD_DIMENSION),
  key: `${index % BOARD_DIMENSION}:${Math.floor(index / BOARD_DIMENSION)}`,
}))

const EMPTY_WAVE_STATE: ServerWaveState = { index: 0, label: '等待同步' }

function makeCoordKey(x: number, y: number) {
  return `${x}:${y}`
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isReferenceCoreCell(x: number, y: number) {
  return x >= 13 && x <= 15 && y >= 13 && y <= 15
}

function markLine(target: number[][], start: { x: number; y: number }, end: { x: number; y: number }) {
  if (start.x === end.x) {
    const step = start.y <= end.y ? 1 : -1
    for (let y = start.y; y !== end.y + step; y += step) {
      target[y][start.x] = 0
    }
    return
  }

  const step = start.x <= end.x ? 1 : -1
  for (let x = start.x; x !== end.x + step; x += step) {
    target[start.y][x] = 0
  }
}

function createArenaTerrainMatrix() {
  const matrix = Array.from({ length: BOARD_DIMENSION }, () => Array<number>(BOARD_DIMENSION).fill(1))

  for (const path of ARENA_PATHS) {
    for (let index = 0; index < path.length - 1; index += 1) {
      markLine(matrix, path[index], path[index + 1])
    }
  }

  return matrix
}

const ARENA_TERRAIN_MATRIX = createArenaTerrainMatrix()

function extractSyncCandidate(payload: unknown) {
  if (!isObject(payload)) {
    return null
  }

  if (isObject(payload.gameState)) {
    return payload.gameState
  }

  if (isObject(payload.state)) {
    return payload.state
  }

  return payload
}

function normalizeTower(rawTower: unknown): ServerTowerState | null {
  if (!isObject(rawTower)) {
    return null
  }

  const x = typeof rawTower.x === 'number'
    ? rawTower.x
    : isObject(rawTower.cell) && typeof rawTower.cell.x === 'number'
      ? rawTower.cell.x
      : null
  const y = typeof rawTower.y === 'number'
    ? rawTower.y
    : isObject(rawTower.cell) && typeof rawTower.cell.y === 'number'
      ? rawTower.cell.y
      : null
  const width = typeof rawTower.width === 'number'
    ? rawTower.width
    : isObject(rawTower.footprint) && typeof rawTower.footprint.width === 'number'
      ? rawTower.footprint.width
      : 1
  const height = typeof rawTower.height === 'number'
    ? rawTower.height
    : isObject(rawTower.footprint) && typeof rawTower.footprint.height === 'number'
      ? rawTower.footprint.height
      : 1

  if (typeof rawTower.id !== 'string' || typeof rawTower.type !== 'string' || x === null || y === null) {
    return null
  }

  return {
    id: rawTower.id,
    type: rawTower.type,
    x,
    y,
    width,
    height,
    damage: typeof rawTower.damage === 'number' ? rawTower.damage : undefined,
    range: typeof rawTower.range === 'number' ? rawTower.range : undefined,
    cooldownTicks: typeof rawTower.cooldownTicks === 'number'
      ? rawTower.cooldownTicks
      : typeof rawTower.attackRate === 'number'
        ? rawTower.attackRate
        : undefined,
  }
}

function normalizeEnemy(rawEnemy: unknown): ServerEnemyState | null {
  if (!isObject(rawEnemy)) {
    return null
  }

  const x = typeof rawEnemy.x === 'number'
    ? rawEnemy.x
    : isObject(rawEnemy.position) && typeof rawEnemy.position.x === 'number'
      ? rawEnemy.position.x
      : null
  const y = typeof rawEnemy.y === 'number'
    ? rawEnemy.y
    : isObject(rawEnemy.position) && typeof rawEnemy.position.y === 'number'
      ? rawEnemy.position.y
      : null
  const kind = typeof rawEnemy.kind === 'string'
    ? rawEnemy.kind
    : typeof rawEnemy.type === 'string'
      ? rawEnemy.type
      : null

  if (typeof rawEnemy.id !== 'string' || kind === null || x === null || y === null) {
    return null
  }

  return {
    id: rawEnemy.id,
    kind,
    x,
    y,
    hp: typeof rawEnemy.hp === 'number' ? rawEnemy.hp : 0,
    maxHp: typeof rawEnemy.maxHp === 'number' ? rawEnemy.maxHp : Math.max(1, typeof rawEnemy.hp === 'number' ? rawEnemy.hp : 1),
  }
}

function normalizeSyncState(payload: unknown): ServerDrivenGameState | null {
  const candidate = extractSyncCandidate(payload)
  if (!candidate) {
    return null
  }

  const towers = Array.isArray(candidate.towers)
    ? candidate.towers.map(normalizeTower).filter((tower): tower is ServerTowerState => tower !== null)
    : []
  const enemies = Array.isArray(candidate.enemies)
    ? candidate.enemies.map(normalizeEnemy).filter((enemy): enemy is ServerEnemyState => enemy !== null)
    : []
  const currentWave = isObject(candidate.currentWave)
    ? candidate.currentWave
    : isObject(candidate.wave)
      ? candidate.wave
      : null
  const resultOutcome: MatchOutcome | null = isObject(candidate.result)
    && (candidate.result.outcome === 'victory' || candidate.result.outcome === 'defeat')
    ? candidate.result.outcome
    : null
  const result = resultOutcome
    ? {
        outcome: resultOutcome,
        reason: isObject(candidate.result) && typeof candidate.result.reason === 'string' ? candidate.result.reason : undefined,
      }
    : null

  if (
    typeof candidate.tick !== 'number'
    || (typeof candidate.gold !== 'number' && !(isObject(candidate.resources) && typeof candidate.resources.gold === 'number'))
  ) {
    return null
  }

  return {
    roomId: typeof candidate.roomId === 'string' ? candidate.roomId : DEFAULT_ROOM_ID,
    phase: candidate.phase === 'countdown' || candidate.phase === 'waiting_for_level' || candidate.phase === 'playing' ? candidate.phase : 'lobby',
    tick: candidate.tick,
    status: candidate.status === 'running' || candidate.status === 'finished' ? candidate.status : 'waiting',
    towers,
    enemies,
    gold: typeof candidate.gold === 'number' ? candidate.gold : (candidate.resources as { gold: number }).gold,
    overloadTicks: typeof candidate.overloadTicks === 'number' ? candidate.overloadTicks : 0,
    currentWave: currentWave && typeof currentWave.index === 'number'
      ? {
          index: currentWave.index,
          label: typeof currentWave.label === 'string' ? currentWave.label : undefined,
        }
      : EMPTY_WAVE_STATE,
    result,
  }
}

function findTowerAtCell(towers: ServerTowerState[], x: number, y: number) {
  return towers.find((tower) => x >= tower.x && x < tower.x + tower.width && y >= tower.y && y < tower.y + tower.height) ?? null
}

function evaluateTowerPlacement(gameState: ServerDrivenGameState | null, option: BuildOption | null, x: number, y: number) {
  if (!gameState || !option) {
    return { allowed: false, reason: null as string | null }
  }

  if (gameState.gold < option.cost) {
    return { allowed: false, reason: '金币不足' }
  }

  for (let offsetY = 0; offsetY < option.height; offsetY += 1) {
    for (let offsetX = 0; offsetX < option.width; offsetX += 1) {
      const nextX = x + offsetX
      const nextY = y + offsetY

      if (nextX < 0 || nextX >= BOARD_DIMENSION || nextY < 0 || nextY >= BOARD_DIMENSION) {
        return { allowed: false, reason: '越界' }
      }

      if (isReferenceCoreCell(nextX, nextY)) {
        return { allowed: false, reason: '核心区域不可建' }
      }

      if (ARENA_TERRAIN_MATRIX[nextY][nextX] !== 1) {
        return { allowed: false, reason: '该地块不是可建地基' }
      }

      if (findTowerAtCell(gameState.towers, nextX, nextY)) {
        return { allowed: false, reason: '已被占用' }
      }
    }
  }

  return { allowed: true, reason: '点击建造' }
}

function getTowerGlyph(type: string) {
  if (type.includes('laser')) {
    return 'LS'
  }

  if (type.includes('cannon')) {
    return 'CN'
  }

  if (type.includes('ice')) {
    return 'IC'
  }

  if (type.includes('arrow')) {
    return 'AR'
  }

  return type.slice(0, 2).toUpperCase()
}

function getTowerTone(type: string) {
  if (type.includes('laser')) {
    return 'gaming-tower-node-laser'
  }

  if (type.includes('cannon')) {
    return 'gaming-tower-node-cannon'
  }

  if (type.includes('ice')) {
    return 'gaming-tower-node-ice'
  }

  return 'gaming-tower-node-arrow'
}

function getEnemyTone(kind: string) {
  if (kind.toLowerCase().includes('lord')) {
    return 'gaming-enemy-node-boss'
  }

  if (kind.toLowerCase().includes('tank')) {
    return 'gaming-enemy-node-heavy'
  }

  return 'gaming-enemy-node-light'
}

function CrisisWarning({ overloadTicks }: { overloadTicks: number }) {
  useEffect(() => {
    if (overloadTicks > 0) {
      document.body.classList.add('crisis-overload-active')
      return () => {
        document.body.classList.remove('crisis-overload-active')
      }
    }

    document.body.classList.remove('crisis-overload-active')
    return () => {
      document.body.classList.remove('crisis-overload-active')
    }
  }, [overloadTicks])

  if (overloadTicks <= 0) {
    return null
  }

  return (
    <div className="gaming-warning-card">
      <ShieldAlert className="h-5 w-5 text-red-200" />
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-red-200/80">Overload</p>
        <p className="mt-1 text-sm text-red-50">满怪危机持续 {overloadTicks} ticks</p>
      </div>
    </div>
  )
}

function GamingBoard({
  gameState,
  selectedBuildType,
  hoveredCell,
  selectedTowerId,
  onCellClick,
  onCellHover,
  onCellLeave,
  onTowerClick,
}: {
  gameState: ServerDrivenGameState | null
  selectedBuildType: string | null
  hoveredCell: { x: number; y: number } | null
  selectedTowerId: string | null
  onCellClick: (x: number, y: number) => void
  onCellHover: (x: number, y: number) => void
  onCellLeave: () => void
  onTowerClick: (towerId: string) => void
}) {
  const towers = gameState?.towers ?? []
  const enemies = gameState?.enemies ?? []
  const selectedBuildOption = selectedBuildType ? BUILD_OPTIONS_BY_TYPE.get(selectedBuildType) ?? null : null
  const hoveredPlacement = hoveredCell && selectedBuildOption
    ? evaluateTowerPlacement(gameState, selectedBuildOption, hoveredCell.x, hoveredCell.y)
    : null
  const canPreviewAtHoveredCell = hoveredPlacement?.allowed ?? false
  const hoverHintDirection = hoveredCell && hoveredCell.y < 3 ? 'below' : 'above'

  return (
    <section className="gaming-board-frame">
      <div className="gaming-board-viewport">
        <div className="gaming-board-surface">
          <div className="gaming-board-grid">
            {BOARD_COORDINATES.map(({ x, y, key }) => {
              const terrain = ARENA_TERRAIN_MATRIX[y][x]
              const tower = findTowerAtCell(towers, x, y)
              const isCore = isReferenceCoreCell(x, y)
              const gateLabel = REFERENCE_GATE_LABELS.get(makeCoordKey(x, y))

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onCellClick(x, y)}
                  onMouseEnter={() => onCellHover(x, y)}
                  onMouseLeave={onCellLeave}
                  className={cx(
                    'gaming-terrain-cell',
                    terrain === 0 ? 'gaming-terrain-cell-abyss' : 'gaming-terrain-cell-ground',
                    isCore && 'gaming-terrain-cell-core',
                    tower && 'gaming-terrain-cell-occupied',
                    selectedBuildType && terrain === 1 && !isCore && !tower && 'gaming-terrain-cell-armable',
                    tower?.id === selectedTowerId && 'gaming-terrain-cell-selected',
                  )}
                  aria-label={gateLabel ? `${gateLabel} 刷怪口` : `坐标 ${x}, ${y}`}
                >
                  {gateLabel ? <span className="gaming-gate-badge">{gateLabel}</span> : null}
                </button>
              )
            })}
          </div>

          {hoveredCell && selectedBuildOption && canPreviewAtHoveredCell ? (
            <div className="gaming-board-overlay gaming-board-overlay-preview" aria-hidden="true">
              <div
                className="gaming-build-preview"
                style={{
                  left: `calc(${hoveredCell.x} * ${CELL_SIZE_CSS_VAR})`,
                  top: `calc(${hoveredCell.y} * ${CELL_SIZE_CSS_VAR})`,
                  width: `calc(${selectedBuildOption.width} * ${CELL_SIZE_CSS_VAR})`,
                  height: `calc(${selectedBuildOption.height} * ${CELL_SIZE_CSS_VAR})`,
                }}
              >
                <span className="gaming-build-preview-crosshair" />
              </div>
            </div>
          ) : null}

          {hoveredCell && selectedBuildOption && hoveredPlacement?.reason ? (
            <div className="gaming-board-overlay gaming-board-overlay-preview" aria-hidden="true">
              <div
                className={cx(
                  'gaming-hover-hint',
                  hoveredPlacement.allowed ? 'gaming-hover-hint-allowed' : 'gaming-hover-hint-blocked',
                  hoverHintDirection === 'below' ? 'gaming-hover-hint-below' : 'gaming-hover-hint-above',
                )}
                style={{
                  left: `calc(${hoveredCell.x} * ${CELL_SIZE_CSS_VAR})`,
                  top: `calc(${hoveredCell.y} * ${CELL_SIZE_CSS_VAR})`,
                  width: `calc(${selectedBuildOption.width} * ${CELL_SIZE_CSS_VAR})`,
                }}
              >
                <span className="gaming-hover-hint-title">{selectedBuildOption.label}</span>
                <span className="gaming-hover-hint-reason">{hoveredPlacement.reason}</span>
              </div>
            </div>
          ) : null}

          <div className="gaming-board-overlay gaming-board-overlay-towers">
            {towers.map((tower) => (
              <button
                key={tower.id}
                type="button"
                onClick={() => onTowerClick(tower.id)}
                className={cx(
                  'gaming-tower-node',
                  getTowerTone(tower.type),
                  selectedTowerId === tower.id && 'gaming-tower-node-selected',
                )}
                style={{
                  left: `calc(${tower.x} * ${CELL_SIZE_CSS_VAR})`,
                  top: `calc(${tower.y} * ${CELL_SIZE_CSS_VAR})`,
                  width: `calc(${tower.width} * ${CELL_SIZE_CSS_VAR})`,
                  height: `calc(${tower.height} * ${CELL_SIZE_CSS_VAR})`,
                }}
                title={`${tower.type} @ (${tower.x}, ${tower.y})`}
              >
                <span className="gaming-tower-glyph">{getTowerGlyph(tower.type)}</span>
              </button>
            ))}
          </div>

          <div className="gaming-board-overlay gaming-board-overlay-enemies">
            {enemies.map((enemy) => {
              const hpRatio = enemy.maxHp > 0 ? Math.max(0, Math.min(enemy.hp / enemy.maxHp, 1)) : 0

              return (
                <div
                  key={enemy.id}
                  className={cx('gaming-enemy-node', getEnemyTone(enemy.kind))}
                  style={{
                    left: `calc(${enemy.x} * ${CELL_SIZE_CSS_VAR})`,
                    top: `calc(${enemy.y} * ${CELL_SIZE_CSS_VAR})`,
                  }}
                  title={`${enemy.kind} HP ${enemy.hp}/${enemy.maxHp}`}
                >
                  <div className="gaming-enemy-core">
                    <Skull className="h-3.5 w-3.5" strokeWidth={2.2} />
                  </div>
                  <div className="gaming-enemy-hpbar">
                    <span style={{ width: `${hpRatio * 100}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}

export function GamingPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const roomId = searchParams.get('roomId') ?? DEFAULT_ROOM_ID
  const socketUrl = useMemo(() => resolveSocketUrl(), [])
  const gatewayToken = useMemo(() => resolveGatewayToken(), [])
  const playerId = useMemo(() => resolvePlayerId() ?? 'human-dev', [])
  const playerKind = resolvePlayerKind()
  const socketRef = useRef<Socket | null>(null)
  const [gameState, setGameState] = useState<ServerDrivenGameState | null>(null)
  const [selectedBuildType, setSelectedBuildType] = useState<string | null>(BUILD_OPTIONS[0]?.type ?? null)
  const [hoveredCell, setHoveredCell] = useState<{ x: number; y: number } | null>(null)
  const [selectedTowerId, setSelectedTowerId] = useState<string | null>(null)
  const [isLeaveConfirmOpen, setIsLeaveConfirmOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedLevelInfo, setSelectedLevelInfo] = useState<SelectedLevelInfo | null>(null)
  const [mySlot, setMySlot] = useState<string | null>(null)

  const selectedTower = useMemo(() => {
    if (!gameState || !selectedTowerId) {
      return null
    }

    return gameState.towers.find((tower) => tower.id === selectedTowerId) ?? null
  }, [gameState, selectedTowerId])

  const selectedBuildOption = useMemo(
    () => (selectedBuildType ? BUILD_OPTIONS_BY_TYPE.get(selectedBuildType) ?? null : null),
    [selectedBuildType],
  )

  useEffect(() => {
    const rootElement = document.getElementById('root')

    document.documentElement.classList.add('gaming-route-active')
    document.body.classList.add('gaming-route-active')
    rootElement?.classList.add('gaming-route-active')

    return () => {
      document.documentElement.classList.remove('gaming-route-active')
      document.body.classList.remove('gaming-route-active')
      document.body.classList.remove('crisis-overload-active')
      rootElement?.classList.remove('gaming-route-active')
    }
  }, [])

  useEffect(() => {
    if (!socketUrl || typeof window === 'undefined') {
      setError('未解析到 WebSocket 地址。')
      return
    }

    const socket = io(socketUrl, {
      autoConnect: true,
      withCredentials: true,
      auth: gatewayToken ? { token: gatewayToken } : undefined,
      query: {
        roomId,
        playerId,
        playerKind,
      },
    })

    socketRef.current = socket

    const handleSyncState = (payload: unknown) => {
      const nextState = normalizeSyncState(payload)
      if (!nextState) {
        return
      }

      setGameState(nextState)
      setError(null)
    }

    const handleRoomJoined = (payload: unknown) => {
      if (isObject(payload) && typeof payload.slot === 'string') {
        setMySlot(payload.slot)
      }
    }

    const handleRoomPhaseChanged = (payload: unknown) => {
      if (!isObject(payload) || typeof payload.phase !== 'string') {
        return
      }

      setGameState((current) => current
        ? {
            ...current,
            phase: payload.phase === 'countdown' || payload.phase === 'waiting_for_level' || payload.phase === 'playing'
              ? payload.phase
              : 'lobby',
          }
        : current)
    }

    const handleLevelSelected = (payload: unknown) => {
      if (
        isObject(payload)
        && typeof payload.levelId === 'number'
        && typeof payload.label === 'string'
        && typeof payload.description === 'string'
        && typeof payload.waveCount === 'number'
        && typeof payload.targetClearRate === 'number'
        && typeof payload.minPlayers === 'number'
      ) {
        setSelectedLevelInfo({
          levelId: payload.levelId,
          label: payload.label,
          description: payload.description,
          waveCount: payload.waveCount,
          targetClearRate: payload.targetClearRate,
          minPlayers: payload.minPlayers,
        })
      }
    }

    socket.on('connect', () => {
      setError(null)
      socket.emit('JOIN_ROOM', {
        roomId,
        playerId,
        playerName: playerId,
        playerKind,
      })
    })

    socket.on('disconnect', () => {
    })

    socket.on('connect_error', (connectError) => {
      setError(connectError.message)
    })

    socket.on('engine_error', (engineError: unknown) => {
      if (typeof engineError === 'string') {
        setError(engineError)
        return
      }

      if (isObject(engineError) && typeof engineError.message === 'string') {
        setError(engineError.message)
      }
    })

    socket.on('SYNC_STATE', handleSyncState)
    socket.on('ROOM_JOINED', handleRoomJoined)
    socket.on('ROOM_PHASE_CHANGED', handleRoomPhaseChanged)
    socket.on('LEVEL_SELECTED', handleLevelSelected)

    return () => {
      socket.off('SYNC_STATE', handleSyncState)
      socket.off('ROOM_JOINED', handleRoomJoined)
      socket.off('ROOM_PHASE_CHANGED', handleRoomPhaseChanged)
      socket.off('LEVEL_SELECTED', handleLevelSelected)
      socket.disconnect()
      socketRef.current = null
    }
  }, [gatewayToken, playerId, playerKind, roomId, socketUrl])

  useEffect(() => {
    if (selectedTowerId && gameState && !gameState.towers.some((tower) => tower.id === selectedTowerId)) {
      setSelectedTowerId(null)
    }
  }, [gameState, selectedTowerId])

  useEffect(() => {
    if (!selectedBuildOption || (gameState?.gold ?? 0) >= selectedBuildOption.cost) {
      return
    }

    setSelectedBuildType((current) => (current === selectedBuildOption.type ? null : current))
    setHoveredCell(null)
  }, [gameState?.gold, selectedBuildOption])

  function emitSocketEvent(event: string, payload?: unknown) {
    const socket = socketRef.current
    if (!socket || !socket.connected) {
      setError('WebSocket 尚未连接。')
      return false
    }

    socket.emit(event, payload)
    return true
  }

  function handleCellClick(x: number, y: number) {
    const tower = findTowerAtCell(gameState?.towers ?? [], x, y)
    if (tower) {
      setSelectedTowerId((current) => current === tower.id ? null : tower.id)
      return
    }

    const option = selectedBuildType ? BUILD_OPTIONS_BY_TYPE.get(selectedBuildType) ?? null : null
    if (!option) {
      setSelectedTowerId(null)
      return
    }

    const placement = evaluateTowerPlacement(gameState, option, x, y)
    if (!placement.allowed) {
      setSelectedTowerId(null)
      return
    }

    setSelectedTowerId(null)
    setHoveredCell(null)
    emitSocketEvent('BUILD_TOWER', {
      x,
      y,
      towerType: option.type,
    })
  }

  function leaveGame() {
    document.body.classList.remove('crisis-overload-active')
    navigate(`/room/${encodeURIComponent(roomId)}`)
  }

  return (
    <main className="gaming-page">
      <div className="cyber-background" />
      <div className="cyber-noise" />
      <CrisisWarning overloadTicks={gameState?.overloadTicks ?? 0} />

      <section className="gaming-shell">
        <div className="gaming-stage">
          <aside className="gaming-side-rail gaming-side-rail-build">
            <div className="gaming-side-rail-scroll">
              {error ? (
                <section className="gaming-panel-card">
                  <p className="gaming-error-text">{error}</p>
                </section>
              ) : null}

              <section className="gaming-panel-card">
                <p className="gaming-section-label">建造指令</p>
                <div className="gaming-build-list gaming-build-list-vertical">
                  {BUILD_OPTIONS.map((option) => (
                    <button
                      key={option.type}
                      type="button"
                      onClick={() => {
                        if ((gameState?.gold ?? 0) < option.cost) {
                          return
                        }

                        setSelectedBuildType((current) => (current === option.type ? null : option.type))
                        setSelectedTowerId(null)
                      }}
                      disabled={(gameState?.gold ?? 0) < option.cost}
                      className={cx(
                        'gaming-build-chip gaming-build-chip-stacked',
                        option.accentClassName,
                        selectedBuildType === option.type && 'gaming-build-chip-active',
                        (gameState?.gold ?? 0) < option.cost && 'gaming-build-chip-disabled',
                      )}
                      aria-pressed={selectedBuildType === option.type}
                    >
                      <span className="gaming-build-chip-title">{option.label}</span>
                      <span className="gaming-build-chip-cost">{option.cost} 金币</span>
                    </button>
                  ))}
                </div>
              </section>

              {selectedTower ? (
                <section className="gaming-selected-card gaming-selected-card-compact">
                  <div className="gaming-selected-header">
                    <h2 className="text-lg font-semibold tracking-[0.04em] text-white">{selectedTower.type}</h2>
                    <span className="gaming-selected-level">{selectedTower.x},{selectedTower.y}</span>
                  </div>
                  <div className="gaming-tower-stats">
                    <div className="gaming-tower-stat">伤害 {selectedTower.damage ?? '-'}</div>
                    <div className="gaming-tower-stat">范围 {selectedTower.range ?? '-'}</div>
                    <div className="gaming-tower-stat">冷却 {selectedTower.cooldownTicks ?? '-'}</div>
                    <div className="gaming-tower-stat">尺寸 {selectedTower.width}x{selectedTower.height}</div>
                  </div>
                </section>
              ) : null}
            </div>
          </aside>

          <GamingBoard
            gameState={gameState}
            selectedBuildType={selectedBuildType}
            hoveredCell={hoveredCell}
            selectedTowerId={selectedTowerId}
            onCellClick={handleCellClick}
            onCellHover={(x, y) => setHoveredCell({ x, y })}
            onCellLeave={() => setHoveredCell(null)}
            onTowerClick={(towerId) => setSelectedTowerId((current) => current === towerId ? null : towerId)}
          />

          <aside className="gaming-side-rail gaming-side-rail-right">
            <section className="gaming-panel-card">
              <p className="gaming-section-label">战场状态</p>
              <div className="gaming-status-stack">
                <div className="gaming-status-row">
                  <Coins className="h-4 w-4 text-amber-300" />
                  <span>当前金币</span>
                  <strong>{gameState?.gold ?? 0}</strong>
                </div>
                <div className="gaming-status-row">
                  <RadioTower className="h-4 w-4 text-cyan-300" />
                  <span>已部署塔</span>
                  <strong>{gameState?.towers.length ?? 0}</strong>
                </div>
                <div className="gaming-status-row">
                  <Skull className="h-4 w-4 text-red-300" />
                  <span>活跃敌人</span>
                  <strong>{gameState?.enemies.length ?? 0}</strong>
                </div>
                <div className="gaming-status-row">
                  <ShieldAlert className="h-4 w-4 text-orange-300" />
                  <span>当前波次</span>
                  <strong>{gameState?.currentWave.label ?? gameState?.currentWave.index ?? 0}</strong>
                </div>
              </div>
            </section>

            {selectedLevelInfo ? (
              <section className="gaming-panel-card">
                <p className="gaming-section-label">已选关卡</p>
                <h2 className="mt-2 text-lg font-semibold text-white">{selectedLevelInfo.label}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-300">{selectedLevelInfo.description}</p>
              </section>
            ) : null}

            <button type="button" onClick={() => setIsLeaveConfirmOpen(true)} className="gaming-exit-card">
              <OctagonX className="h-5 w-5" />
              <span>退出游戏</span>
            </button>
          </aside>
        </div>
      </section>

      {isLeaveConfirmOpen ? (
        <div className="cyber-modal-backdrop" onClick={() => setIsLeaveConfirmOpen(false)}>
          <div className="gaming-confirm-panel" onClick={(event) => event.stopPropagation()}>
            <p className="gaming-confirm-eyebrow">Exit Match</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[0.08em] text-white">确认退出游戏？</h2>
            <p className="mt-3 text-sm leading-7 text-slate-300">确认后将离开当前对局，并返回等待房间页面。</p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setIsLeaveConfirmOpen(false)} className="gaming-confirm-button gaming-confirm-button-muted">
                取消
              </button>
              <button type="button" onClick={leaveGame} className="gaming-confirm-button gaming-confirm-button-danger">
                确认退出
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {gameState?.phase === 'waiting_for_level' ? (
        <MissionBriefingModal
          isHost={mySlot === 'P1'}
          playerKind={playerKind}
          onSelectLevel={(levelId) => emitSocketEvent('SELECT_LEVEL', { levelId })}
          engineError={error}
        />
      ) : null}

      {gameState?.result?.outcome ? (
        <GameOverOverlay
          outcome={gameState.result.outcome}
          currentLevelId={selectedLevelInfo?.levelId ?? null}
          actionLog={[]}
          onLeave={leaveGame}
        />
      ) : null}
    </main>
  )
}
