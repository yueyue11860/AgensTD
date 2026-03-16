import { useEffect, useMemo, useState } from 'react'
import { OctagonX, ShieldAlert, Skull } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useGameEngine } from '../hooks/use-game-engine'
import { cx } from '../lib/cx'
import type { ActionDescriptor, GameAction, GameCell, GameState, TowerBlueprint, TowerState } from '../types/game-state'

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

const BLUEPRINT_LEVEL_PATTERN = /(?:[-_]?)(\d+)$/
const LABEL_LEVEL_PATTERN = /\s*\d+级$/

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
      { id: 'ice-1', type: 'ice', name: '冰塔', level: 1, status: 'active', cell: { x: 15, y: 12 }, footprint: { width: 1, height: 1 }, damage: 8, attackRate: 1.1 },
      { id: 'cannon-1', type: 'cannon', name: '炮塔', level: 1, status: 'idle', cell: { x: 12, y: 15 }, footprint: { width: 1, height: 1 }, damage: 20 },
      { id: 'arrow-1', type: 'arrow', name: '箭塔', level: 1, status: 'idle', cell: { x: 15, y: 15 }, footprint: { width: 1, height: 1 }, damage: 10, attackRate: 1.8 },
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
      { type: 'arrow-1', label: '箭塔 1级', description: '单体高速射击，适合补刀清杂。', costLabel: '2金币' },
      { type: 'ice-1', label: '冰塔 1级', description: '造成减速效果，帮助队友压制路线。', costLabel: '3金币' },
      { type: 'cannon-1', label: '炮塔 1级', description: '范围爆炸伤害，适合群体压制。', costLabel: '4金币' },
      { type: 'laser-1', label: '激光塔 1级', description: '持续锁定输出，对高血量目标更稳定。', costLabel: '4金币' },
    ],
  }
}

function getBlueprintLevel(blueprint: TowerBlueprint) {
  const typeMatch = blueprint.type.match(BLUEPRINT_LEVEL_PATTERN)
  if (typeMatch) {
    return Number(typeMatch[1])
  }

  const labelMatch = blueprint.label.match(/(\d+)级/)
  return labelMatch ? Number(labelMatch[1]) : Number.POSITIVE_INFINITY
}

function getBlueprintFamilyKey(blueprint: TowerBlueprint) {
  return blueprint.type.replace(BLUEPRINT_LEVEL_PATTERN, '').replace(/[-_]+$/, '').toLowerCase()
}

function getBlueprintFamilyLabel(blueprint: TowerBlueprint) {
  return blueprint.label.replace(LABEL_LEVEL_PATTERN, '').trim()
}

function createBaseBuildCatalog(buildPalette: TowerBlueprint[]) {
  const familyMap = new Map<string, TowerBlueprint>()

  for (const blueprint of buildPalette) {
    const familyKey = getBlueprintFamilyKey(blueprint)
    const current = familyMap.get(familyKey)

    if (!current || getBlueprintLevel(blueprint) < getBlueprintLevel(current)) {
      familyMap.set(familyKey, {
        ...blueprint,
        label: getBlueprintFamilyLabel(blueprint),
      })
    }
  }

  return Array.from(familyMap.values())
}

function createTowerActions(tower: TowerState): ActionDescriptor[] {
  if (tower.commands?.length) {
    return tower.commands
  }

  return [
    {
      id: `${tower.id}-upgrade`,
      label: '升级',
      description: '消耗金币将当前建筑提升 1 级。',
      payload: {
        action: 'UPGRADE_TOWER',
        towerId: tower.id,
      },
    },
    {
      id: `${tower.id}-sell`,
      label: '拆除',
      description: '移除当前建筑，并回收部分已投入资源。',
      payload: {
        action: 'SELL_TOWER',
        towerId: tower.id,
      },
    },
  ]
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
  selectedTowerId,
  onCellClick,
}: {
  gameState: Pick<GameState, 'map' | 'towers' | 'enemies'>
  selectedBuildType: string | null
  selectedTowerId: string | null
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
              tower?.id === selectedTowerId && 'gaming-cell-selected',
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
  const navigate = useNavigate()
  const { gameState, sendAction, error, socketUrl } = useGameEngine()
  const liveState = useMemo(() => gameState ?? createFallbackBoardState(), [gameState])
  const buildCatalog = useMemo(() => createBaseBuildCatalog(liveState.buildPalette), [liveState.buildPalette])
  const [selectedBuildType, setSelectedBuildType] = useState<string | null>(buildCatalog[0]?.type ?? null)
  const [selectedTowerId, setSelectedTowerId] = useState<string | null>(null)
  const [isLeaveConfirmOpen, setIsLeaveConfirmOpen] = useState(false)
  const selectedBlueprint = buildCatalog.find((item) => item.type === selectedBuildType) ?? buildCatalog[0] ?? null
  const selectedTower = liveState.towers.find((tower) => tower.id === selectedTowerId) ?? null
  const selectedTowerActions = useMemo(() => (selectedTower ? createTowerActions(selectedTower) : []), [selectedTower])

  useEffect(() => {
    if (!buildCatalog.length) {
      setSelectedBuildType(null)
      return
    }

    if (!selectedBuildType || !buildCatalog.some((item) => item.type === selectedBuildType)) {
      setSelectedBuildType(buildCatalog[0].type)
    }
  }, [buildCatalog, selectedBuildType])

  useEffect(() => {
    if (selectedTowerId && !liveState.towers.some((tower) => tower.id === selectedTowerId)) {
      setSelectedTowerId(null)
    }
  }, [liveState.towers, selectedTowerId])

  useEffect(() => {
    if (!isLeaveConfirmOpen) {
      return
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsLeaveConfirmOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isLeaveConfirmOpen])

  function handleCellClick(cell: GameCell, tower: TowerState | null) {
    if (tower) {
      setSelectedTowerId((current) => (current === tower.id ? null : tower.id))
      return
    }

    setSelectedTowerId(null)

    if (!selectedBuildType || cell.kind !== 'build') {
      return
    }

    void sendAction({
      action: 'BUILD_TOWER',
      type: selectedBuildType,
      x: cell.x,
      y: cell.y,
    })
  }

  function handleTowerAction(action: GameAction) {
    void sendAction(action)
  }

  function requestLeaveGame() {
    setIsLeaveConfirmOpen(true)
  }

  function closeLeaveConfirm() {
    setIsLeaveConfirmOpen(false)
  }

  function leaveGame() {
    document.body.classList.remove('crisis-overload-active')
    navigate('/room')
  }

  return (
    <main className="gaming-page">
      <div className="cyber-background" />
      <div className="cyber-noise" />
      <CrisisWarning overloadTicks={overloadTicks} />

      <section className="gaming-shell">
        <div className="gaming-stage">
          <aside className="gaming-side-rail gaming-side-rail-build">
            <div className="gaming-pill-group gaming-pill-group-compact">
              <div className="gaming-pill gaming-pill-compact">
                <span>金币</span>
                <strong>{liveState.resources.gold}</strong>
              </div>
              <div className="gaming-pill gaming-pill-compact">
                <span>波数</span>
                <strong>{liveState.wave?.index ?? 0}</strong>
              </div>
            </div>

            <div className="gaming-side-rail-scroll">
              <section className="gaming-panel-card">
                <div className="gaming-build-list gaming-build-list-vertical">
                  {buildCatalog.map((blueprint) => (
                    <button
                      key={blueprint.type}
                      type="button"
                      disabled={blueprint.disabled}
                      onClick={() => setSelectedBuildType(blueprint.type)}
                      className={cx('gaming-build-chip gaming-build-chip-stacked', selectedBlueprint?.type === blueprint.type && 'gaming-build-chip-active')}
                    >
                      <span className="gaming-build-chip-title">{blueprint.label}</span>
                      <span className="gaming-build-chip-cost">{blueprint.costLabel ?? '--'}</span>
                    </button>
                  ))}
                </div>
              </section>

              {selectedTower ? (
                <section className="gaming-selected-card gaming-selected-card-compact">
                  <>
                    <div className="gaming-selected-header">
                      <h2 className="text-lg font-semibold tracking-[0.04em] text-white">{selectedTower.name}</h2>
                      <span className="gaming-selected-level">Lv.{selectedTower.level}</span>
                    </div>

                    <div className="gaming-tower-stats">
                      <div className="gaming-tower-stat">伤害 {selectedTower.damage ?? '-'}</div>
                      <div className="gaming-tower-stat">范围 {selectedTower.range ?? '-'}</div>
                      <div className="gaming-tower-stat">攻速 {selectedTower.attackRate ?? '-'}</div>
                      <div className="gaming-tower-stat">状态 {selectedTower.status}</div>
                    </div>

                    <div className="gaming-tower-actions">
                      {selectedTowerActions.map((descriptor) => (
                        <button
                          key={descriptor.id}
                          type="button"
                          disabled={descriptor.disabled}
                          onClick={() => handleTowerAction(descriptor.payload)}
                          className={cx(
                            'gaming-tower-action',
                            descriptor.payload.action === 'SELL_TOWER' && 'gaming-tower-action-danger',
                            descriptor.disabled && 'gaming-tower-action-disabled',
                          )}
                        >
                          <span className="gaming-tower-action-title">{descriptor.label}</span>
                        </button>
                      ))}
                    </div>
                  </>
                  {error ? <p className="mt-3 text-sm text-orange-100">{error}</p> : null}
                  <p className="mt-3 text-xs text-slate-500">{socketUrl ?? 'Socket unavailable'}</p>
                </section>
              ) : null}
            </div>
          </aside>

          <GamingBoard gameState={liveState} selectedBuildType={selectedBuildType} selectedTowerId={selectedTowerId} onCellClick={handleCellClick} />

          <aside className="gaming-side-rail gaming-side-rail-right">
            <button type="button" onClick={requestLeaveGame} className="gaming-exit-card">
              <OctagonX className="h-5 w-5" />
              <span>退出游戏</span>
            </button>
          </aside>
        </div>
      </section>

      {isLeaveConfirmOpen ? (
        <div className="cyber-modal-backdrop" onClick={closeLeaveConfirm}>
          <div className="gaming-confirm-panel" onClick={(event) => event.stopPropagation()}>
            <p className="gaming-confirm-eyebrow">Exit Match</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[0.08em] text-white">确认退出游戏？</h2>
            <p className="mt-3 text-sm leading-7 text-slate-300">确认后将离开当前对局，并返回房间列表页面。</p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
              <button type="button" onClick={closeLeaveConfirm} className="gaming-confirm-button gaming-confirm-button-muted">
                取消
              </button>
              <button type="button" onClick={leaveGame} className="gaming-confirm-button gaming-confirm-button-danger">
                确认退出
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}
