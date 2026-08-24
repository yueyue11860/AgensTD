"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseClientAction = parseClientAction;
function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function parseClientAction(payload) {
    if (!isObject(payload) || typeof payload.action !== 'string') {
        return null;
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
                : null;
        case 'UPGRADE_TOWER':
            return typeof payload.towerId === 'string'
                ? {
                    action: 'UPGRADE_TOWER',
                    towerId: payload.towerId,
                }
                : null;
        case 'SELL_TOWER':
            return typeof payload.towerId === 'string'
                ? {
                    action: 'SELL_TOWER',
                    towerId: payload.towerId,
                }
                : null;
        case 'RECRUIT_BATCH':
            return typeof payload.expectedTrayRevision === 'number' || payload.expectedTrayRevision === undefined
                ? {
                    action: 'RECRUIT_BATCH',
                    ...(typeof payload.expectedTrayRevision === 'number'
                        ? { expectedTrayRevision: payload.expectedTrayRevision }
                        : {}),
                }
                : null;
        case 'DEPLOY_TRAY_PIECE':
            return Number.isInteger(payload.trayIndex)
                && typeof payload.x === 'number'
                && typeof payload.y === 'number'
                ? {
                    action: 'DEPLOY_TRAY_PIECE',
                    trayIndex: payload.trayIndex,
                    x: payload.x,
                    y: payload.y,
                    ...(typeof payload.expectedTrayRevision === 'number'
                        ? { expectedTrayRevision: payload.expectedTrayRevision }
                        : {}),
                    ...(typeof payload.expectedBoardRevision === 'number'
                        ? { expectedBoardRevision: payload.expectedBoardRevision }
                        : {}),
                }
                : null;
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
                : null;
        case 'MERGE_SOLDIERS':
            return typeof payload.sourceEntityId === 'string'
                && typeof payload.targetEntityId === 'string'
                ? {
                    action: 'MERGE_SOLDIERS',
                    sourceEntityId: payload.sourceEntityId,
                    targetEntityId: payload.targetEntityId,
                    ...(typeof payload.expectedBoardRevision === 'number'
                        ? { expectedBoardRevision: payload.expectedBoardRevision }
                        : {}),
                }
                : null;
        default:
            return null;
    }
}
