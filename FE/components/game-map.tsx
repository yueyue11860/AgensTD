import { memo, useMemo } from 'react'
import { AlertTriangle, GitFork, RadioTower, Shield, Skull } from 'lucide-react'
import { cx } from '../lib/cx'
import type { EnemyState, GameCell, GameState, GridPosition, TowerState } from '../types/game-state'

interface GameMapProps {
  tick: GameState['tick']
  map: GameState['map']
  towers: GameState['towers']
  enemies: GameState['enemies']
  selectedCell: GridPosition | null
  selectedTowerId: string | null
  onCellClick: (cell: GameCell, tower: TowerState | null) => void
}

interface GridCellProps {
  x: number
  y: number
  cell: GameCell
  tower: TowerState | null
  isTowerAnchor: boolean
  enemy: EnemyState | null
  isSelectedCell: boolean
  isSelectedTower: boolean
  onCellClick: (cell: GameCell, tower: TowerState | null) => void
}

const cellTone: Record<GameCell['kind'], string> = {
  path: 'border-transparent bg-[#170505] shadow-[inset_0_0_12px_4px_rgba(220,38,38,0.4)]',
  build: 'border-[rgba(255,255,255,0.04)] bg-[#1e1b16] hover:shadow-[inset_0_0_0_1px_rgba(34,211,238,0.75)]',
  blocked: 'border-[rgba(255,255,255,0.02)] bg-[#0c0c0c]',
  relay: 'border-[rgba(62,231,210,0.25)] bg-[rgba(62,231,210,0.04)]',
  gate: 'border-[rgba(255,143,63,0.35)] bg-[rgba(255,100,20,0.08)]',
  core: 'border-[rgba(80,200,80,0.3)] bg-[rgba(40,80,40,0.1)]',
  hazard: 'border-[rgba(220,38,38,0.35)] bg-[rgba(60,8,8,0.2)]',
}

const towerTone: Record<TowerState['status'], string> = {
  idle: 'border-white/15 bg-white/10 text-slate-100',
  active: 'border-acid-green/35 bg-acid-green/12 text-acid-green',
  cooldown: 'border-warning-orange/35 bg-warning-orange/12 text-warning-orange',
  disabled: 'border-alert-red/35 bg-alert-red/12 text-alert-red',
}

const enemyTone: Record<EnemyState['threat'], string> = {
  low: 'border-white/10 bg-black/25 text-slate-200',
  medium: 'border-warning-orange/35 bg-warning-orange/12 text-warning-orange',
  high: 'border-alert-red/35 bg-alert-red/12 text-alert-red',
  boss: 'border-cold-blue/35 bg-cold-blue/12 text-cold-blue',
}

const GridCell = memo(function GridCell({
  x,
  y,
  cell,
  tower,
  isTowerAnchor,
  enemy,
  isSelectedCell,
  isSelectedTower,
  onCellClick,
}: GridCellProps) {
  const isAbyssEye = Math.abs(x - 14) <= 1 && Math.abs(y - 14) <= 1

  return (
    <button
      type="button"
      onClick={() => onCellClick(cell, tower)}
      className={cx(
        'relative aspect-square overflow-hidden rounded border text-left transition-all',
        isAbyssEye ? 'animate-pulse border-transparent' : cellTone[cell.kind],
        isSelectedCell && 'ring-2 ring-cold-blue',
        isSelectedTower && 'ring-2 ring-acid-green',
        tower && !isSelectedTower && 'ring-1 ring-inset ring-white/20',
        tower && !isTowerAnchor && 'opacity-80',
      )}
      style={isAbyssEye ? {
        background: '#1a0828',
        boxShadow: 'inset 0 0 16px 6px rgba(139, 0, 60, 0.65), 0 0 14px rgba(100, 0, 180, 0.5)',
      } : undefined}
      title={tower ? `${tower.name} Lv.${tower.level}` : `${cell.kind} (${x}, ${y})`}
    >
      {!isAbyssEye && cell.kind === 'gate' ? <GitFork className="absolute left-1 top-1 h-3 w-3 text-warning-orange" /> : null}
      {!isAbyssEye && cell.kind === 'core' ? <Shield className="absolute left-1 top-1 h-3 w-3 text-acid-green" /> : null}
      {!isAbyssEye && cell.kind === 'hazard' ? <AlertTriangle className="absolute left-1 top-1 h-3 w-3 text-alert-red" /> : null}

      {tower && isTowerAnchor ? (
        <div className={cx('absolute inset-1 flex flex-col items-center justify-center rounded border text-center', towerTone[tower.status])}>
          <RadioTower className="h-4 w-4" />
          <span className="mt-1 text-[10px] font-semibold leading-none">Lv.{tower.level}</span>
          <span className="mt-1 text-[9px] leading-none opacity-75">{tower.footprint.width}x{tower.footprint.height}</span>
        </div>
      ) : null}

      {tower && !isTowerAnchor ? (
        <div className={cx('absolute inset-1 rounded border border-dashed', towerTone[tower.status])} />
      ) : null}

      {enemy ? (
        <div className={cx('absolute bottom-1 right-1 rounded-md border px-1.5 py-0.5 text-[9px] font-semibold', enemyTone[enemy.threat])}>
          {enemy.threat === 'boss' ? 'BOSS' : enemy.count ?? 1}
        </div>
      ) : null}
    </button>
  )
}, (previousProps, nextProps) => {
  return previousProps.cell === nextProps.cell
    && previousProps.tower?.id === nextProps.tower?.id
    && previousProps.tower?.level === nextProps.tower?.level
    && previousProps.tower?.status === nextProps.tower?.status
    && previousProps.tower?.footprint.width === nextProps.tower?.footprint.width
    && previousProps.tower?.footprint.height === nextProps.tower?.footprint.height
    && previousProps.isTowerAnchor === nextProps.isTowerAnchor
    && previousProps.enemy?.id === nextProps.enemy?.id
    && previousProps.enemy?.position.x === nextProps.enemy?.position.x
    && previousProps.enemy?.position.y === nextProps.enemy?.position.y
    && previousProps.enemy?.threat === nextProps.enemy?.threat
    && previousProps.enemy?.count === nextProps.enemy?.count
    && previousProps.isSelectedCell === nextProps.isSelectedCell
    && previousProps.isSelectedTower === nextProps.isSelectedTower
    && previousProps.onCellClick === nextProps.onCellClick
})

const GameMapGrid = memo(function GameMapGrid({
  map,
  towers,
  enemies,
  selectedCell,
  selectedTowerId,
  onCellClick,
}: Omit<GameMapProps, 'tick'>) {
  const cellMap = useMemo(() => {
    return new Map(map.cells.map((cell) => [`${cell.x},${cell.y}`, cell]))
  }, [map.cells])

  const towerMap = useMemo(() => {
    const map = new Map<string, { tower: TowerState; isAnchor: boolean }>()

    for (const tower of towers) {
      for (let dx = 0; dx < tower.footprint.width; dx += 1) {
        for (let dy = 0; dy < tower.footprint.height; dy += 1) {
          map.set(`${tower.cell.x + dx},${tower.cell.y + dy}`, {
            tower,
            isAnchor: dx === 0 && dy === 0,
          })
        }
      }
    }

    return map
  }, [towers])

  const enemyMap = useMemo(() => {
    return new Map(enemies.map((enemy) => [`${enemy.position.x},${enemy.position.y}`, enemy]))
  }, [enemies])

  const gridCoordinates = useMemo(() => {
    return Array.from({ length: map.width * map.height }, (_, index) => ({
      x: index % map.width,
      y: Math.floor(index / map.width),
      key: `${index % map.width},${Math.floor(index / map.width)}`,
    }))
  }, [map.height, map.width])

  return (
    <div
      className="mt-4 overflow-auto rounded-xl p-3"
      style={{
        background: 'radial-gradient(ellipse at center, #2d2828 0%, #1e1a1a 50%, #111010 100%)',
        border: '1px solid rgba(80, 45, 45, 0.3)',
        boxShadow: '0 0 40px rgba(0, 0, 0, 0.8)',
      }}
    >
      <div
        className="grid gap-1"
        style={{
          gridTemplateColumns: `repeat(${map.width}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${map.height}, minmax(0, 1fr))`,
          aspectRatio: `${map.width} / ${map.height}`,
          minWidth: 'min(100%, 960px)',
        }}
      >
        {gridCoordinates.map(({ x, y, key }) => {
          const cell = cellMap.get(key) ?? { x, y, kind: 'blocked' as const }
          const towerEntry = towerMap.get(key)
          const tower = towerEntry?.tower ?? null
          const enemy = enemyMap.get(key)
          const isSelectedCell = selectedCell?.x === x && selectedCell?.y === y
          const isSelectedTower = selectedTowerId !== null && tower?.id === selectedTowerId

          return (
            <GridCell
              key={key}
              x={x}
              y={y}
              cell={cell}
              tower={tower}
              isTowerAnchor={towerEntry?.isAnchor ?? false}
              enemy={enemy ?? null}
              isSelectedCell={isSelectedCell}
              isSelectedTower={isSelectedTower}
              onCellClick={onCellClick}
            />
          )
        })}
      </div>
    </div>
  )
})

export const GameMap = memo(function GameMap({ tick, map, towers, enemies, selectedCell, selectedTowerId, onCellClick }: GameMapProps) {

  return (
      <section
        className="rounded-3xl p-4 backdrop-blur-md"
        style={{
          background: 'radial-gradient(ellipse at 50% 20%, #231e1e 0%, #141010 55%, #0a0808 100%)',
          border: '1px solid rgba(60, 35, 35, 0.35)',
          boxShadow: '0 4px 60px rgba(0, 0, 0, 0.9)',
        }}
      >
      <div className="flex flex-col gap-2 border-b border-white/10 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.26em] text-cold-blue">战场画布</p>
          <h2 className="mt-2 text-xl font-semibold text-white">Tick {tick.toLocaleString()}</h2>
          <p className="mt-1 text-sm text-slate-400">整个棋盘仅根据最近一次 TICK_UPDATE 重绘，不保留任何本地战斗模拟。</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-slate-300">
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">地图 {map.width} x {map.height}</span>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">塔 {towers.length}</span>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">敌人 {enemies.length}</span>
        </div>
      </div>

      <GameMapGrid
        map={map}
        towers={towers}
        enemies={enemies}
        selectedCell={selectedCell}
        selectedTowerId={selectedTowerId}
        onCellClick={onCellClick}
      />

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-400">
            <Shield className="h-3.5 w-3.5 text-acid-green" />
            建筑
          </div>
          <p className="mt-2 text-sm text-slate-300">点击建筑格或塔本体只改变前端焦点，不会直接修改游戏状态。</p>
        </article>
        <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-400">
            <Skull className="h-3.5 w-3.5 text-alert-red" />
            敌潮
          </div>
          <p className="mt-2 text-sm text-slate-300">敌人位置、数量和血量全部以服务端广播的最新数据为准。</p>
        </article>
        <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-400">
            <GitFork className="h-3.5 w-3.5 text-warning-orange" />
            指令
          </div>
          <p className="mt-2 text-sm text-slate-300">建塔等操作全部转换为 JSON 指令，通过 SEND_ACTION 上报后等待下一帧回流。</p>
        </article>
      </div>
    </section>
  )
})