import type { ServerConfig } from '../config/server-config'
import type { GameState } from '../domain/game-state'
import type { FrontendGameCell, FrontendGameState } from '../domain/frontend-game-state'
import { towerCatalog } from '../domain/tower-catalog'

function buildCells(state: GameState): FrontendGameCell[] {
  return state.map.cells.map((cell) => ({
    x: cell.x,
    y: cell.y,
    kind: cell.kind,
    walkable: cell.walkable,
    buildable: cell.buildable,
    label: cell.label,
  }))
}

function getEnemyProgress(state: GameState, enemy: GameState['enemies'][number]) {
  const totalDistance = Math.abs(state.map.base.x - state.map.spawn.x) + Math.abs(state.map.base.y - state.map.spawn.y)
  const remainingDistance = Math.abs(state.map.base.x - enemy.x) + Math.abs(state.map.base.y - enemy.y)

  if (totalDistance === 0) {
    return 1
  }

  return Math.max(0, Math.min(1, 1 - remainingDistance / totalDistance))
}

export function projectFrontendGameState(state: GameState, config: ServerConfig): FrontendGameState {
  const primaryPlayer = state.players[0] ?? null

  return {
    matchId: state.matchId,
    tick: state.tick,
    status: state.players.length > 0 ? 'running' : 'waiting',
    map: {
      width: state.map.width,
      height: state.map.height,
      cells: buildCells(state),
    },
    resources: {
      gold: primaryPlayer?.gold ?? config.playerStartingGold,
      mana: 0,
      manaLimit: 100,
      heat: Math.min(state.towers.length * 5, 100),
      heatLimit: 100,
      repair: 0,
      threat: state.enemies.length * 10,
      fortress: state.base.hp,
      fortressMax: state.base.maxHp,
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
      progress: getEnemyProgress(state, enemy),
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
      : [`出生点位于 (${state.map.spawn.x}, ${state.map.spawn.y})，基地剩余 ${state.base.hp}/${state.base.maxHp}。`],
    score: primaryPlayer?.score ?? 0,
    updatedAt: new Date().toISOString(),
  }
}
