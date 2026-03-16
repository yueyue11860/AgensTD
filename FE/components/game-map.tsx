import { memo, useMemo } from 'react'
import { AlertTriangle, GitFork, RadioTower, Shield, Skull } from 'lucide-react'
import { cx } from '../lib/cx'
import type { EnemyState, GameCell, GameState, GridPosition, TowerState } from '../types/game-state'

interface GameMapProps {
  gameState: GameState
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
  path: 'border-slate-700/80 bg-slate-900/80',
  build: 'border-slate-700/70 bg-slate-800/80 hover:border-cold-blue/50 hover:bg-slate-800',
  blocked: 'border-slate-800/80 bg-black/40',
  relay: 'border-cold-blue/40 bg-cold-blue/10',
  gate: 'border-warning-orange/45 bg-warning-orange/10',
  core: 'border-acid-green/45 bg-acid-green/10',
  hazard: 'border-alert-red/45 bg-alert-red/10',
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
  return (
    <button
      type="button"
      onClick={() => onCellClick(cell, tower)}
      className={cx(
        'relative aspect-square overflow-hidden rounded border text-left transition-all',
        cellTone[cell.kind],
        isSelectedCell && 'ring-2 ring-cold-blue',
        isSelectedTower && 'ring-2 ring-acid-green',
        tower && !isSelectedTower && 'ring-1 ring-inset ring-white/20',
        tower && !isTowerAnchor && 'opacity-80',
      )}
      title={tower ? `${tower.name} Lv.${tower.level}` : `${cell.kind} (${x}, ${y})`}
    >
      {cell.kind === 'gate' ? <GitFork className="absolute left-1 top-1 h-3 w-3 text-warning-orange" /> : null}
      {cell.kind === 'core' ? <Shield className="absolute left-1 top-1 h-3 w-3 text-acid-green" /> : null}
      {cell.kind === 'hazard' ? <AlertTriangle className="absolute left-1 top-1 h-3 w-3 text-alert-red" /> : null}

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

export const GameMap = memo(function GameMap({ gameState, selectedCell, selectedTowerId, onCellClick }: GameMapProps) {
  const cellMap = useMemo(() => {
    return new Map(gameState.map.cells.map((cell) => [`${cell.x},${cell.y}`, cell]))
  }, [gameState.map.cells])

  const towerMap = useMemo(() => {
    const map = new Map<string, { tower: TowerState; isAnchor: boolean }>()

    for (const tower of gameState.towers) {
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
  }, [gameState.towers])

  const enemyMap = useMemo(() => {
    return new Map(gameState.enemies.map((enemy) => [`${enemy.position.x},${enemy.position.y}`, enemy]))
  }, [gameState.enemies])

  const gridCoordinates = useMemo(() => {
    return Array.from({ length: gameState.map.width * gameState.map.height }, (_, index) => ({
      x: index % gameState.map.width,
      y: Math.floor(index / gameState.map.width),
      key: `${index % gameState.map.width},${Math.floor(index / gameState.map.width)}`,
    }))
  }, [gameState.map.width, gameState.map.height])

  return (
    <section className="rounded-3xl border border-white/10 bg-black/20 p-4 backdrop-blur-md">
      <div className="flex flex-col gap-2 border-b border-white/10 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.26em] text-cold-blue">战场画布</p>
          <h2 className="mt-2 text-xl font-semibold text-white">Tick {gameState.tick.toLocaleString()}</h2>
          <p className="mt-1 text-sm text-slate-400">整个棋盘仅根据最近一次 tick_update 重绘，不保留任何本地战斗模拟。</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-slate-300">
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">地图 {gameState.map.width} x {gameState.map.height}</span>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">塔 {gameState.towers.length}</span>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">敌人 {gameState.enemies.length}</span>
        </div>
      </div>

      <div className="mt-4 overflow-auto rounded-2xl border border-white/10 bg-slate-950/60 p-3">
        <div
          className="grid gap-1"
          style={{
            gridTemplateColumns: `repeat(${gameState.map.width}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${gameState.map.height}, minmax(0, 1fr))`,
            aspectRatio: `${gameState.map.width} / ${gameState.map.height}`,
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
          <p className="mt-2 text-sm text-slate-300">建塔等操作全部转换为 JSON 指令，通过 send_action 上报后等待下一帧回流。</p>
        </article>
      </div>
    </section>
  )
})