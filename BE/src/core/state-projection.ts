import type { ServerConfig } from '../config/server-config'
import type { GameState } from '../domain/game-state'
import type { FrontendGameCell, FrontendGameState } from '../domain/frontend-game-state'
import { enemyCatalog } from '../domain/enemy-catalog'
import { getNextTowerCatalogEntryById, towerCatalog } from '../domain/tower-catalog'

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
  const resultNotice = state.result
    ? state.result.outcome === 'victory'
      ? `战局结束：胜利。${state.result.reason ?? '已清空全部波次。'}`
      : `战局结束：失败。${state.result.reason ?? '场上怪物持续超载。'}`
    : null

  return {
    matchId: state.matchId,
    tick: state.tick,
    status: state.status,
    result: state.result,
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
      fortress: Math.max(0, state.maxCapacity - state.enemies.length),
      fortressMax: state.maxCapacity,
    },
    towers: state.towers.map((tower) => {
      const towerDefinition = towerCatalog[tower.type]
      const nextTowerDefinition = getNextTowerCatalogEntryById(tower.type)
      const towerOwner = state.players.find((player) => player.id === tower.ownerId)
      const canUpgrade = Boolean(nextTowerDefinition) && (towerOwner?.gold ?? 0) >= (nextTowerDefinition?.cost ?? 0)

      return {
        id: tower.id,
        type: tower.type,
        name: towerDefinition?.label ?? tower.type,
        level: towerDefinition?.level ?? 1,
        status: tower.cooldownTicks > 0 ? 'cooldown' : 'idle',
        cell: { x: tower.x, y: tower.y },
        footprint: { width: tower.width, height: tower.height },
        range: tower.range,
        damage: tower.damage,
        attackRate: typeof tower.fireRateTicks === 'number' ? tower.fireRateTicks : undefined,
        hp: 100,
        maxHp: 100,
        tags: [tower.type],
        commands: [
          {
            id: `${tower.id}-upgrade`,
            label: '升级',
            description: nextTowerDefinition
              ? `升级到 ${nextTowerDefinition.label}，费用 ${nextTowerDefinition.cost} 金币。`
              : '当前已是最高等级。',
            payload: { action: 'UPGRADE_TOWER', towerId: tower.id },
            disabled: !canUpgrade,
            reason: nextTowerDefinition
              ? ((towerOwner?.gold ?? 0) < nextTowerDefinition.cost ? '金币不足。' : undefined)
              : '当前已是最高等级。',
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
      }
    }),
    enemies: state.enemies.map((enemy) => {
      const enemyConfig = enemyCatalog[enemy.kind]

      return {
        id: enemy.id,
        type: enemy.kind,
        name: enemyConfig?.label ?? enemy.kind,
        position: { x: enemy.x, y: enemy.y },
        hp: enemy.hp,
        maxHp: enemy.maxHp,
        threat: enemyConfig?.threat ?? 'low',
        intent: 'advance',
        progress: getEnemyProgress(state, enemy),
      }
    }),
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
      summary: '防御塔会按各自策略选择目标；升级与出售暂未实现。',
      actions: [],
    },
    wave: {
      index: state.wave.index,
      label: `${state.wave.label} · 剩余刷怪 ${state.wave.remainingSpawns}`,
    },
    notices: state.players.length === 0
      ? ['等待玩家或 Agent 连接网关。']
      : [
        `当前 ${state.playerCount} 人房间，刷怪容量 ${state.enemies.length}/${state.maxCapacity}，超载计数 ${state.overloadTicks}/100。`,
        ...(resultNotice ? [resultNotice] : []),
      ],
    score: primaryPlayer?.score ?? 0,
    updatedAt: new Date().toISOString(),
  }
}
