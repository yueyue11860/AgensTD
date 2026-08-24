import type {
  BuildTowerAction,
  DeployTrayPieceAction,
  GameAction,
  MergeSoldiersAction,
  MoveBoardPieceAction,
  PlayerIdentity,
  RecruitBatchAction,
  SwapReserveBoardAction,
  UpgradeTowerAction,
  ExileReserveAction,
  SwapStoragePiecesAction,
  SetGeneralFixedAction,
  MoveFixedGeneralAction,
} from '../../../shared/contracts/game'

export type {
  BuildTowerAction,
  DeployTrayPieceAction,
  MergeSoldiersAction,
  MoveBoardPieceAction,
  PlayerIdentity,
  RecruitBatchAction,
  SwapReserveBoardAction,
  UpgradeTowerAction,
  ExileReserveAction,
  SwapStoragePiecesAction,
  SetGeneralFixedAction,
  MoveFixedGeneralAction,
} from '../../../shared/contracts/game'

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
    case 'RECRUIT_BATCH':
      return typeof payload.expectedTrayRevision === 'number' || payload.expectedTrayRevision === undefined
        ? {
            action: 'RECRUIT_BATCH',
            ...(typeof payload.expectedTrayRevision === 'number'
              ? { expectedTrayRevision: payload.expectedTrayRevision }
              : {}),
          }
        : null
    case 'DEPLOY_TRAY_PIECE':
      return Number.isInteger(payload.trayIndex)
        && typeof payload.x === 'number'
        && typeof payload.y === 'number'
        ? {
            action: 'DEPLOY_TRAY_PIECE',
            trayIndex: payload.trayIndex as number,
            x: payload.x,
            y: payload.y,
            ...(typeof payload.expectedTrayRevision === 'number'
              ? { expectedTrayRevision: payload.expectedTrayRevision }
              : {}),
            ...(typeof payload.expectedBoardRevision === 'number'
              ? { expectedBoardRevision: payload.expectedBoardRevision }
              : {}),
          }
        : null
    case 'MOVE_BOARD_PIECE':
      return typeof payload.entityId === 'string'
        && typeof payload.x === 'number'
        && typeof payload.y === 'number'
        ? {
            action: 'MOVE_BOARD_PIECE',
            entityId: payload.entityId,
            x: payload.x,
            y: payload.y,
            ...(typeof payload.expectedBoardRevision === 'number'
              ? { expectedBoardRevision: payload.expectedBoardRevision }
              : {}),
          }
        : null
    case 'MERGE_SOLDIERS':
      return typeof payload.sourceEntityId === 'string'
        && typeof payload.targetEntityId === 'string'
        ? {
            action: 'MERGE_SOLDIERS',
            sourceEntityId: payload.sourceEntityId,
            targetEntityId: payload.targetEntityId,
            ...(typeof payload.expectedTrayRevision === 'number'
              ? { expectedTrayRevision: payload.expectedTrayRevision }
              : {}),
            ...(typeof payload.expectedBoardRevision === 'number'
              ? { expectedBoardRevision: payload.expectedBoardRevision }
              : {}),
            ...(typeof payload.expectedReserveRevision === 'number'
              ? { expectedReserveRevision: payload.expectedReserveRevision }
              : {}),
          }
        : null
    case 'SWAP_RESERVE_BOARD':
      return Number.isInteger(payload.reserveIndex)
        && typeof payload.x === 'number'
        && typeof payload.y === 'number'
        ? {
            action: 'SWAP_RESERVE_BOARD',
            reserveIndex: payload.reserveIndex as number,
            x: payload.x,
            y: payload.y,
            ...(typeof payload.expectedReserveRevision === 'number'
              ? { expectedReserveRevision: payload.expectedReserveRevision }
              : {}),
            ...(typeof payload.expectedBoardRevision === 'number'
              ? { expectedBoardRevision: payload.expectedBoardRevision }
              : {}),
          }
        : null
    case 'EXILE_RESERVE':
      return typeof payload.expectedReserveRevision === 'number' || payload.expectedReserveRevision === undefined
        ? {
            action: 'EXILE_RESERVE',
            ...(typeof payload.expectedReserveRevision === 'number'
              ? { expectedReserveRevision: payload.expectedReserveRevision }
              : {}),
          }
        : null
    case 'SWAP_STORAGE_PIECES':
      return (payload.sourceZone === 'tray' || payload.sourceZone === 'reserve')
        && (payload.targetZone === 'tray' || payload.targetZone === 'reserve')
        && Number.isInteger(payload.sourceIndex)
        && Number.isInteger(payload.targetIndex)
        ? {
            action: 'SWAP_STORAGE_PIECES',
            sourceZone: payload.sourceZone,
            sourceIndex: payload.sourceIndex as number,
            targetZone: payload.targetZone,
            targetIndex: payload.targetIndex as number,
            ...(typeof payload.expectedTrayRevision === 'number'
              ? { expectedTrayRevision: payload.expectedTrayRevision }
              : {}),
            ...(typeof payload.expectedReserveRevision === 'number'
              ? { expectedReserveRevision: payload.expectedReserveRevision }
              : {}),
          }
        : null
    case 'SET_GENERAL_FIXED':
      return typeof payload.formationId === 'string' && typeof payload.fixed === 'boolean'
        ? {
            action: 'SET_GENERAL_FIXED',
            formationId: payload.formationId,
            fixed: payload.fixed,
            ...(typeof payload.expectedBoardRevision === 'number'
              ? { expectedBoardRevision: payload.expectedBoardRevision }
              : {}),
          }
        : null
    case 'MOVE_FIXED_GENERAL':
      return typeof payload.formationId === 'string'
        && typeof payload.x === 'number'
        && typeof payload.y === 'number'
        ? {
            action: 'MOVE_FIXED_GENERAL',
            formationId: payload.formationId,
            x: payload.x,
            y: payload.y,
            ...(typeof payload.expectedBoardRevision === 'number'
              ? { expectedBoardRevision: payload.expectedBoardRevision }
              : {}),
          }
        : null
    default:
      return null
  }
}
