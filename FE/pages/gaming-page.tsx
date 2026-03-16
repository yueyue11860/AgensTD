import { useEffect, useMemo, useState } from 'react'
import { DoorOpen, OctagonX, Play, ShieldAlert, Wifi, WifiOff } from 'lucide-react'
import { useGameEngine } from '../hooks/use-game-engine'
import { cx } from '../lib/cx'
import type { GameCell, GameState, TowerState } from '../types/game-state'

const BOARD_DIMENSION = 29

interface GamingPageProps {
  overloadTicks?: number
}

function createFallbackBoardState(): Pick<GameState, 'tick' | 'map' | 'towers' | 'enemies' | 'resources' | 'wave' | 'buildPalette'> {
  const cells: GameCell[] = []

  for (let y = 0; y < BOARD_DIMENSION; y += 1) {
    for (let x = 0; x < BOARD_DIMENSION; x += 1) {
      const isRing = x === 0 || y === 0 || x === BOARD_DIMENSION - 1 || y === BOARD_DIMENSION - 1
      const isGate = x === 3 && y === 14
      const isLane = y === 14 || (x === 7 && y > 6 && y < 20) || (x === 21 && y > 8 && y < 22)
      const isHub = x >= 13 && x <= 15 && y >= 13 && y <= 15

      cells.push({
        x,
        y,
        kind: isHub ? 'core' : isGate ? 'gate' : isLane ? 'path' : isRing ? 'blocked' : 'build',
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
      { id: 'laser-1', type: 'laser', name: '激光塔', level: 1, status: 'active', cell: { x: 13, y: 12 }, footprint: { width: 1, height: 1 }, damage: 12 },
      { id: 'laser-2', type: 'laser', name: '激光塔', level: 1, status: 'active', cell: { x: 15, y: 12 }, footprint: { width: 1, height: 1 }, damage: 12 },
      { id: 'cannon-1', type: 'cannon', name: '电塔', level: 1, status: 'idle', cell: { x: 13, y: 15 }, footprint: { width: 1, height: 1 }, damage: 20 },
      { id: 'cannon-2', type: 'cannon', name: '电塔', level: 1, status: 'idle', cell: { x: 15, y: 15 }, footprint: { width: 1, height: 1 }, damage: 20 },
    ],
    enemies: [
      { id: 'enemy-a', type: 'runner', name: 'Runner', position: { x: 22, y: 21 }, hp: 30, maxHp: 30, threat: 'medium', count: 1 },
      { id: 'enemy-b', type: 'runner', name: 'Runner', position: { x: 22, y: 22 }, hp: 30, maxHp: 30, threat: 'medium', count: 1 },
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
  const cellMap = new Map(gameState.map.cells.map((cell) => [`${cell.x}:${cell.y}`, cell]))
  const towerMap = new Map(gameState.towers.map((tower) => [`${tower.cell.x}:${tower.cell.y}`, tower]))
  const enemyMap = new Map(gameState.enemies.map((enemy) => [`${enemy.position.x}:${enemy.position.y}`, enemy]))

  const boardCells = Array.from({ length: BOARD_DIMENSION * BOARD_DIMENSION }, (_, index) => {
    const x = index % BOARD_DIMENSION
    const y = Math.floor(index / BOARD_DIMENSION)
    const key = `${x}:${y}`
    const cell = cellMap.get(key) ?? { x, y, kind: 'build' as const }
    const tower = towerMap.get(key) ?? null
    const enemy = enemyMap.get(key) ?? null
    return { key, cell, tower, enemy }
  })

  return (
    <div className="gaming-board-frame">
      <div className="gaming-board-grid" style={{ gridTemplateColumns: `repeat(${BOARD_DIMENSION}, minmax(0, 1fr))` }}>
        {boardCells.map(({ key, cell, tower, enemy }) => (
          <button
            key={key}
            type="button"
            onClick={() => onCellClick(cell, tower)}
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
