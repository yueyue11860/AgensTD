import type { ServerConfig } from '../config/server-config'
import type { GameState } from '../domain/game-state'
import type { FrontendGameCell, FrontendGameState } from '../domain/frontend-game-state'
import { towerCatalog } from '../domain/tower-catalog'

function getLaneRow(config: ServerConfig) {
  return Math.floor(config.mapHeight / 2)
}

function buildCells(config: ServerConfig): FrontendGameCell[] {
  const laneRow = getLaneRow(config)
  const cells: FrontendGameCell[] = []

  for (let y = 0; y < config.mapHeight; y += 1) {
    for (let x = 0; x < config.mapWidth; x += 1) {
      if (y === laneRow && x === 0) {
        cells.push({ x, y, kind: 'gate', walkable: true, buildable: false, label: '入口' })
        continue
      }

      if (y === laneRow && x === config.mapWidth - 1) {
        cells.push({ x, y, kind: 'core', walkable: true, buildable: false, label: '主堡' })
        continue
      }

      if (y === laneRow) {
        cells.push({ x, y, kind: 'path', walkable: true, buildable: false })
        continue
      }

      cells.push({ x, y, kind: 'build', walkable: false, buildable: true })
    }
  }

  return cells
}

export function projectFrontendGameState(state: GameState, config: ServerConfig): FrontendGameState {
  const primaryPlayer = state.players[0] ?? null
  const laneRow = getLaneRow(config)

  return {
    matchId: state.matchId,
    tick: state.tick,
    status: state.players.length > 0 ? 'running' : 'waiting',
    map: {
      width: state.map.width,
      height: state.map.height,
      cells: buildCells(config),
    },
    resources: {
      gold: primaryPlayer?.gold ?? config.playerStartingGold,
      mana: 0,
      manaLimit: 100,
      heat: Math.min(state.towers.length * 5, 100),
      heatLimit: 100,
      repair: 0,
      threat: state.enemies.length * 10,
      fortress: 100,
      fortressMax: 100,
    },
    towers: state.towers.map((tower) => ({
      id: tower.id,
      type: tower.type,
      name: towerCatalog[tower.type]?.label ?? tower.type,
      level: 1,
      status: tower.cooldownTicks > 0 ? 'cooldown' : 'idle',
      cell: { x: tower.x, y: tower.y },
      footprint: { width: 1, height: 1 },
      range: tower.range,
      damage: tower.damage,
      attackRate: tower.fireRateTicks,
      hp: 100,
      maxHp: 100,
      tags: [tower.type],
      commands: [
        {
          id: `${tower.id}-upgrade`,
          label: '升级',
          description: '升级逻辑尚未在后端实现。',
          payload: { action: 'UPGRADE_TOWER', towerId: tower.id },
          disabled: true,
          reason: '后端暂未实现升级。',
        },
        {
          id: `${tower.id}-sell`,
          label: '出售',
          description: '出售逻辑尚未在后端实现。',
          payload: { action: 'SELL_TOWER', towerId: tower.id },
          disabled: true,
          reason: '后端暂未实现出售。',
        },
      ],
    })),
    enemies: state.enemies.map((enemy) => ({
      id: enemy.id,
      type: enemy.kind,
      name: 'Runner',
      position: { x: enemy.x, y: enemy.y },
      hp: enemy.hp,
      maxHp: enemy.maxHp,
      threat: enemy.maxHp >= 200 ? 'high' : 'low',
      intent: 'advance',
      progress: config.mapWidth <= 1 ? 1 : enemy.x / (config.mapWidth - 1),
    })),
    buildPalette: Object.values(towerCatalog).map((entry, index) => ({
      type: entry.type,
      label: entry.label,
      description: entry.description,
      costLabel: `${entry.cost} 金币`,
      hotkey: String(index + 1),
      disabled: (primaryPlayer?.gold ?? config.playerStartingGold) < entry.cost,
      reason: (primaryPlayer?.gold ?? config.playerStartingGold) < entry.cost ? '金币不足' : undefined,
    })),
    actionBar: {
      title: '建议动作',
      summary: '当前版本仅实现 BUILD_TOWER，升级与出售保留为禁用占位。',
      actions: [],
    },
    wave: {
      index: Math.floor(state.tick / 10) + 1,
      label: `第 ${Math.floor(state.tick / 10) + 1} 波`,
    },
    notices: state.players.length === 0
      ? ['等待玩家或 Agent 连接网关。']
      : [`当前行军路径位于第 ${laneRow + 1} 行。`],
    score: primaryPlayer?.score ?? 0,
    updatedAt: new Date().toISOString(),
  }
}
