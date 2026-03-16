import { useEffect, useMemo, useState } from 'react'
import { DoorOpen, OctagonX, Play, ShieldAlert, Skull, Wifi, WifiOff } from 'lucide-react'
import { useGameEngine } from '../hooks/use-game-engine'
import { cx } from '../lib/cx'
import type { GameCell, GameState, TowerState } from '../types/game-state'

const BOARD_DIMENSION = 29

const REFERENCE_GATE_LABELS = new Map<string, string>([
  ['13:15', 'p1'],
  ['15:15', 'p2'],
  ['15:13', 'p3'],
  ['13:13', 'p4'],
])

function isReferenceCoreCell(x: number, y: number) {
  return x >= 13 && x <= 15 && y >= 13 && y <= 15
}

function makeCoordKey(x: number, y: number) {
  return `${x}:${y}`
}

function addHorizontalLine(target: Set<string>, y: number, startX: number, endX: number) {
  const from = Math.min(startX, endX)
  const to = Math.max(startX, endX)

  for (let x = from; x <= to; x += 1) {
    target.add(makeCoordKey(x, y))
  }
}

function addVerticalLine(target: Set<string>, x: number, startY: number, endY: number) {
  const from = Math.min(startY, endY)
  const to = Math.max(startY, endY)

  for (let y = from; y <= to; y += 1) {
    target.add(makeCoordKey(x, y))
  }
}

function createReferenceRouteCells() {
  const cells = new Set<string>()

  addHorizontalLine(cells, 3, 3, 25)
  addHorizontalLine(cells, 25, 3, 25)
  addVerticalLine(cells, 3, 3, 25)
  addVerticalLine(cells, 25, 3, 25)

  addHorizontalLine(cells, 7, 7, 21)
  addHorizontalLine(cells, 21, 7, 21)
  addVerticalLine(cells, 7, 7, 21)
  addVerticalLine(cells, 21, 7, 21)

  addVerticalLine(cells, 13, 15, 18)
  addHorizontalLine(cells, 18, 7, 13)
  addHorizontalLine(cells, 15, 15, 18)
  addVerticalLine(cells, 18, 15, 21)
  addVerticalLine(cells, 15, 10, 13)
  addHorizontalLine(cells, 10, 15, 21)
  addHorizontalLine(cells, 13, 10, 13)
  addVerticalLine(cells, 10, 7, 13)

  addHorizontalLine(cells, 14, 3, 7)
  addVerticalLine(cells, 14, 21, 25)
  addHorizontalLine(cells, 14, 21, 25)
  addVerticalLine(cells, 14, 3, 7)

  for (const key of REFERENCE_GATE_LABELS.keys()) {
    cells.add(key)
  }

  return cells
}

const REFERENCE_ROUTE_CELLS = createReferenceRouteCells()

interface GamingPageProps {
  overloadTicks?: number
}

function createFallbackBoardState(): Pick<GameState, 'tick' | 'map' | 'towers' | 'enemies' | 'resources' | 'wave' | 'buildPalette'> {
  const cells: GameCell[] = []

  for (let y = 0; y < BOARD_DIMENSION; y += 1) {
    for (let x = 0; x < BOARD_DIMENSION; x += 1) {
      const key = makeCoordKey(x, y)
      const label = REFERENCE_GATE_LABELS.get(key)
      const isGate = Boolean(label)
      const isCore = isReferenceCoreCell(x, y)
      const isLane = REFERENCE_ROUTE_CELLS.has(key)

      cells.push({
        x,
        y,
        kind: isGate ? 'gate' : isCore ? 'core' : isLane ? 'path' : 'build',
        label,
      })
    }
  }

  return {
    tick: 128,
    map: {
      width: BOARD_DIMENSION,
      height: BOARD_DIMENSION,
      cells,
    },
    towers: [
      { id: 'laser-1', type: 'laser', name: '激光塔', level: 1, status: 'active', cell: { x: 12, y: 12 }, footprint: { width: 1, height: 1 }, damage: 12 },
      { id: 'laser-2', type: 'laser', name: '激光塔', level: 1, status: 'active', cell: { x: 15, y: 12 }, footprint: { width: 1, height: 1 }, damage: 12 },
      { id: 'cannon-1', type: 'cannon', name: '电塔', level: 1, status: 'idle', cell: { x: 12, y: 15 }, footprint: { width: 1, height: 1 }, damage: 20 },
      { id: 'cannon-2', type: 'cannon', name: '电塔', level: 1, status: 'idle', cell: { x: 15, y: 15 }, footprint: { width: 1, height: 1 }, damage: 20 },
    ],
    enemies: [
      { id: 'enemy-a', type: 'runner', name: 'Runner', position: { x: 21, y: 20 }, hp: 30, maxHp: 30, threat: 'medium', count: 1 },
      { id: 'enemy-b', type: 'runner', name: 'Runner', position: { x: 21, y: 21 }, hp: 30, maxHp: 30, threat: 'medium', count: 1 },
    ],
    resources: {
      gold: 86,
      mana: 0,
      heat: 0,
      repair: 0,
      threat: 22,
      fortress: 100,
      fortressMax: 100,
    },
    wave: {
      index: 8,
      label: 'Wave 08',
    },
    buildPalette: [
      { type: 'laser-1', label: '激光塔 1级', description: '每 Tick 造成伤害，5 秒内最多叠加到 5% 锁定增伤。', costLabel: '3金币' },
      { type: 'laser-2', label: '激光塔 2级', description: '每 Tick 造成伤害，5 秒内最多叠加到 10% 锁定增伤。', costLabel: '6金币' },
      { type: 'laser-3', label: '激光塔 3级', description: '每 Tick 造成伤害，5 秒内最多叠加到 15% 锁定增伤。', costLabel: '10金币' },
      { type: 'tesla-1', label: '电塔 1级', description: '3x3 范围伤害并附加减防。', costLabel: '3金币' },
      { type: 'tesla-2', label: '电塔 2级', description: '3x3 范围伤害并附加强力减防。', costLabel: '6金币' },
      { type: 'tesla-3', label: '电塔 3级', description: '高频 3x3 范围伤害并附加减防。', costLabel: '10金币' },
      { type: 'magic-1', label: '魔法塔 1级', description: '全图火焰打击并施加永久灼烧。', costLabel: '3金币' },
      { type: 'magic-2', label: '魔法塔 2级', description: '更快的全图火焰打击并施加永久灼烧。', costLabel: '6金币' },
      { type: 'magic-3', label: '魔法塔 3级', description: '高频全图火焰打击并施加永久灼烧。', costLabel: '10金币' },
    ],
  }
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
  onCellClick,
}: {
  gameState: Pick<GameState, 'map' | 'towers' | 'enemies'>
  selectedBuildType: string | null
  onCellClick: (cell: GameCell, tower: TowerState | null) => void
}) {
  const boardWidth = gameState.map.width
  const boardHeight = gameState.map.height
  const cellMap = new Map(gameState.map.cells.map((cell) => [`${cell.x}:${cell.y}`, cell]))
  const towerMap = new Map(gameState.towers.map((tower) => [`${tower.cell.x}:${tower.cell.y}`, tower]))
  const enemyMap = new Map(gameState.enemies.map((enemy) => [`${enemy.position.x}:${enemy.position.y}`, enemy]))

  const boardCells = Array.from({ length: boardWidth * boardHeight }, (_, index) => {
    const x = index % boardWidth
    const y = Math.floor(index / boardWidth)
    const key = `${x}:${y}`
    const cell = cellMap.get(key) ?? { x, y, kind: 'build' as const }
    const tower = towerMap.get(key) ?? null
    const enemy = enemyMap.get(key) ?? null
    return { key, cell, tower, enemy }
  })

  return (
    <div className="gaming-board-frame">
      <div
        className="gaming-board-grid"
        style={{
          gridTemplateColumns: `repeat(${boardWidth}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${boardHeight}, minmax(0, 1fr))`,
        }}
      >
        {boardCells.map(({ key, cell, tower, enemy }) => (
          <button
            key={key}
            type="button"
            onClick={() => onCellClick(cell, tower)}
            aria-label={cell.kind === 'gate' ? `${cell.label ?? '入口'} 刷怪口` : undefined}
            className={cx(
              'gaming-cell',
              cell.kind === 'path' && 'gaming-cell-path',
              cell.kind === 'core' && 'gaming-cell-core',
              cell.kind === 'blocked' && 'gaming-cell-blocked',
              cell.kind === 'gate' && 'gaming-cell-gate',
              tower && 'gaming-cell-tower',
              enemy && 'gaming-cell-enemy',
              selectedBuildType && cell.kind === 'build' && !tower && 'gaming-cell-armable',
            )}
          >
            {!tower && !enemy && cell.kind === 'gate' ? (
              <span className="gaming-cell-gate-icon" title={cell.label ?? '入口'}>
                <Skull className="h-3.5 w-3.5" strokeWidth={2.1} />
              </span>
            ) : null}
            {tower ? <span className="gaming-tower-dot" /> : null}
            {enemy ? <span className="gaming-enemy-count">{enemy.count ?? 1}</span> : null}
          </button>
        ))}
      </div>
    </div>
  )
}

export function GamingPage({ overloadTicks = 0 }: GamingPageProps) {
  const { gameState, sendAction, connectionState, isConnected, error, socketUrl } = useGameEngine()
  const liveState = useMemo(() => gameState ?? createFallbackBoardState(), [gameState])
  const [selectedBuildType, setSelectedBuildType] = useState<string | null>(liveState.buildPalette[0]?.type ?? null)
  const selectedBlueprint = liveState.buildPalette.find((item) => item.type === selectedBuildType) ?? liveState.buildPalette[0] ?? null

  useEffect(() => {
    if (!liveState.buildPalette.length) {
      setSelectedBuildType(null)
      return
    }

    if (!selectedBuildType || !liveState.buildPalette.some((item) => item.type === selectedBuildType)) {
      setSelectedBuildType(liveState.buildPalette[0].type)
    }
  }, [liveState.buildPalette, selectedBuildType])

  function handleCellClick(cell: GameCell, tower: TowerState | null) {
    if (!selectedBuildType || tower || cell.kind !== 'build') {
      return
    }

    void sendAction({
      action: 'BUILD_TOWER',
      type: selectedBuildType,
      x: cell.x,
      y: cell.y,
    })
  }

  function leaveGame() {
    document.body.classList.remove('crisis-overload-active')
    window.location.assign('/')
  }

  return (
    <main className="gaming-page">
      <div className="cyber-background" />
      <div className="cyber-noise" />
      <CrisisWarning overloadTicks={overloadTicks} />

      <section className="gaming-shell">
        <div className="gaming-topbar">
          <div className="gaming-pill-group">
            <div className="gaming-pill">
              <span>金币</span>
              <strong>{liveState.resources.gold}</strong>
            </div>
            <div className="gaming-pill">
              <span>波数</span>
              <strong>{liveState.wave?.index ?? 0}</strong>
            </div>
            <div className="gaming-pill gaming-pill-status">
              {isConnected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
              <strong>{connectionState}</strong>
            </div>
          </div>

          <div className="gaming-button-group">
            <button type="button" onClick={leaveGame} className="gaming-action-button gaming-action-button-muted">
              <DoorOpen className="h-4 w-4" />
              <span>返回大厅</span>
            </button>
            <button type="button" onClick={leaveGame} className="gaming-action-button gaming-action-button-danger">
              <OctagonX className="h-4 w-4" />
              <span>结束游戏</span>
            </button>
          </div>
        </div>

        <div className="gaming-stage">
          <GamingBoard gameState={liveState} selectedBuildType={selectedBuildType} onCellClick={handleCellClick} />
        </div>

        <div className="gaming-bottom-dock">
          <div className="gaming-build-list">
            {liveState.buildPalette.map((blueprint) => (
              <button
                key={blueprint.type}
                type="button"
                onClick={() => setSelectedBuildType(blueprint.type)}
                className={cx('gaming-build-chip', selectedBlueprint?.type === blueprint.type && 'gaming-build-chip-active')}
              >
                <span className="gaming-build-chip-title">{blueprint.label}</span>
                <span className="gaming-build-chip-cost">{blueprint.costLabel ?? '--'}</span>
              </button>
            ))}
          </div>

          <div className="gaming-selected-card">
            {selectedBlueprint ? (
              <>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Selected</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-[0.04em] text-white">{selectedBlueprint.label}</h2>
                <p className="mt-2 text-sm text-cyan-100">{selectedBlueprint.costLabel ?? '未标注费用'}</p>
                <p className="mt-3 text-sm leading-7 text-slate-300">{selectedBlueprint.description ?? '暂无描述。'}</p>
              </>
            ) : null}
            {error ? <p className="mt-3 text-sm text-orange-100">{error}</p> : null}
            <p className="mt-3 text-xs text-slate-500">{socketUrl ?? 'Socket unavailable'}</p>
          </div>
        </div>
      </section>
    </main>
  )
}
