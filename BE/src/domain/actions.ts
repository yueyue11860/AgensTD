import type { BuildTowerAction, GameAction, PlayerIdentity, UpgradeTowerAction } from '../../../shared/contracts/game'

export type { BuildTowerAction, PlayerIdentity, UpgradeTowerAction } from '../../../shared/contracts/game'

export type ClientAction = GameAction

export interface QueuedAction {
  id: string
  receivedAt: number
  player: PlayerIdentity
  action: ClientAction
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseClientAction(payload: unknown): ClientAction | null {
  if (!isObject(payload) || typeof payload.action !== 'string') {
    return null
  }

  switch (payload.action) {
    case 'BUILD_TOWER':
      return typeof payload.type === 'string'
        && typeof payload.x === 'number'
        && typeof payload.y === 'number'
        ? {
            action: 'BUILD_TOWER',
            type: payload.type,
            x: payload.x,
            y: payload.y,
          }
        : null
    case 'UPGRADE_TOWER':
      return typeof payload.towerId === 'string'
        ? {
            action: 'UPGRADE_TOWER',
            towerId: payload.towerId,
          }
        : null
    case 'SELL_TOWER':
      return typeof payload.towerId === 'string'
        ? {
            action: 'SELL_TOWER',
            towerId: payload.towerId,
          }
        : null
    default:
      return null
  }
}