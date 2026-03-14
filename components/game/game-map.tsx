'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { Enemy, Tower } from '@/lib/domain'
import { Crosshair, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface GameMapProps {
  towers: Tower[]
  enemies: Enemy[]
  className?: string
}

const GRID_SIZE = 25
const CELL_SIZE = 24

const towerColors: Record<Tower['type'], string> = {
  CANNON: 'bg-slate/80',
  LASER: 'bg-cold-blue',
  FROST: 'bg-cyber-cyan',
  TESLA: 'bg-acid-green',
  MISSILE: 'bg-alert-red',
  FLAME: 'bg-warning-orange',
}

const enemyColors: Record<Enemy['type'], string> = {
  GRUNT: 'bg-red-400/80',
  TANK: 'bg-red-600',
  SWIFT: 'bg-yellow-400',
  HEALER: 'bg-green-400',
  BOSS: 'bg-purple-500',
  ELITE: 'bg-orange-500',
}

export function GameMap({ towers, enemies, className }: GameMapProps) {
  const [zoom, setZoom] = useState(1)
  const [selectedCell, setSelectedCell] = useState<{ x: number; y: number } | null>(null)

  // Generate path cells (simplified maze-like pattern)
  const pathCells = new Set<string>()
  for (let x = 0; x < GRID_SIZE; x++) {
    pathCells.add(`${x},${Math.floor(GRID_SIZE / 2)}`)
    pathCells.add(`${x},${Math.floor(GRID_SIZE / 2) + 1}`)
  }
  for (let y = 0; y < GRID_SIZE; y++) {
    pathCells.add(`${Math.floor(GRID_SIZE / 4)},${y}`)
    pathCells.add(`${Math.floor(GRID_SIZE * 3 / 4)},${y}`)
  }

  return (
    <div className={cn('rounded-lg border border-border bg-card overflow-hidden', className)}>
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">战场视图</h3>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {GRID_SIZE}x{GRID_SIZE}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="w-12 text-center text-xs text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setZoom(Math.min(2, zoom + 0.25))}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <Maximize2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Map Container */}
      <div className="relative overflow-auto p-4" style={{ height: '400px' }}>
        <div
          className="relative mx-auto"
          style={{
            width: GRID_SIZE * CELL_SIZE * zoom,
            height: GRID_SIZE * CELL_SIZE * zoom,
            transform: `scale(${zoom})`,
            transformOrigin: 'top left',
          }}
        >
          {/* Grid Background */}
          <div
            className="absolute inset-0 bg-graphite"
            style={{
              backgroundImage: `
                linear-gradient(to right, oklch(0.25 0.01 250 / 0.5) 1px, transparent 1px),
                linear-gradient(to bottom, oklch(0.25 0.01 250 / 0.5) 1px, transparent 1px)
              `,
              backgroundSize: `${CELL_SIZE}px ${CELL_SIZE}px`,
            }}
          />

          {/* Path Cells */}
          {Array.from(pathCells).map((cell) => {
            const [x, y] = cell.split(',').map(Number)
            return (
              <div
                key={cell}
                className="absolute bg-gunmetal/50"
                style={{
                  left: x * CELL_SIZE,
                  top: y * CELL_SIZE,
                  width: CELL_SIZE,
                  height: CELL_SIZE,
                }}
              />
            )
          })}

          {/* Spawn Point */}
          <div
            className="absolute flex items-center justify-center bg-alert-red/30 border-2 border-alert-red/50"
            style={{
              left: (GRID_SIZE - 1) * CELL_SIZE,
              top: Math.floor(GRID_SIZE / 2) * CELL_SIZE,
              width: CELL_SIZE,
              height: CELL_SIZE * 2,
            }}
          >
            <span className="text-[8px] font-bold text-alert-red">SPAWN</span>
          </div>

          {/* Base */}
          <div
            className="absolute flex items-center justify-center bg-acid-green/30 border-2 border-acid-green/50"
            style={{
              left: 0,
              top: Math.floor(GRID_SIZE / 2) * CELL_SIZE,
              width: CELL_SIZE,
              height: CELL_SIZE * 2,
            }}
          >
            <span className="text-[8px] font-bold text-acid-green">BASE</span>
          </div>

          {/* Towers */}
          {towers.map((tower) => (
            <div
              key={tower.id}
              className={cn(
                'absolute flex items-center justify-center rounded-sm border-2 transition-all cursor-pointer',
                towerColors[tower.type],
                tower.status === 'active' && 'border-acid-green/50',
                tower.status === 'charging' && 'border-cold-blue/50 animate-pulse',
                tower.status === 'overheated' && 'border-warning-orange/50',
                tower.status === 'disabled' && 'border-alert-red/50 opacity-50'
              )}
              style={{
                left: tower.position.x * CELL_SIZE + 2,
                top: tower.position.y * CELL_SIZE + 2,
                width: CELL_SIZE - 4,
                height: CELL_SIZE - 4,
              }}
              title={`${tower.type} Lv.${tower.level}`}
              onClick={() => setSelectedCell(tower.position)}
            >
              <span className="text-[8px] font-bold text-white drop-shadow-lg">
                {tower.type[0]}
              </span>
            </div>
          ))}

          {/* Enemies */}
          {enemies.map((enemy) => (
            <div
              key={enemy.id}
              className={cn(
                'absolute rounded-full border transition-all',
                enemyColors[enemy.type],
                enemy.status === 'stunned' && 'opacity-50',
                enemy.status === 'dead' && 'opacity-20'
              )}
              style={{
                left: enemy.position.x * CELL_SIZE + 4,
                top: enemy.position.y * CELL_SIZE + 4,
                width: enemy.type === 'BOSS' ? CELL_SIZE - 4 : CELL_SIZE - 8,
                height: enemy.type === 'BOSS' ? CELL_SIZE - 4 : CELL_SIZE - 8,
              }}
              title={`${enemy.type} HP: ${enemy.health}/${enemy.max_health}`}
            >
              {/* Health Bar */}
              <div
                className="absolute -top-2 left-0 h-1 w-full overflow-hidden rounded-full bg-black/50"
              >
                <div
                  className="h-full bg-acid-green"
                  style={{ width: `${(enemy.health / enemy.max_health) * 100}%` }}
                />
              </div>
            </div>
          ))}

          {/* Selection Indicator */}
          {selectedCell && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: selectedCell.x * CELL_SIZE - 2,
                top: selectedCell.y * CELL_SIZE - 2,
                width: CELL_SIZE + 4,
                height: CELL_SIZE + 4,
              }}
            >
              <Crosshair className="h-full w-full text-primary animate-pulse" />
            </div>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="border-t border-border bg-muted/20 px-4 py-2">
        <div className="flex flex-wrap gap-4 text-[10px]">
          <div className="flex items-center gap-4">
            <span className="text-muted-foreground">塔防:</span>
            {Object.entries(towerColors).map(([type, color]) => (
              <div key={type} className="flex items-center gap-1">
                <div className={cn('h-2 w-2 rounded-sm', color)} />
                <span className="text-muted-foreground">{type}</span>
              </div>
            ))}
          </div>
          <div className="h-3 w-px bg-border" />
          <div className="flex items-center gap-4">
            <span className="text-muted-foreground">敌人:</span>
            {Object.entries(enemyColors).slice(0, 4).map(([type, color]) => (
              <div key={type} className="flex items-center gap-1">
                <div className={cn('h-2 w-2 rounded-full', color)} />
                <span className="text-muted-foreground">{type}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
