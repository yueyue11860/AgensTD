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
        case 'UPGRADE_TOWER':
        case 'SELL_TOWER':
            // Tower actions belonged to the retired PVE wave runtime.  Keep the
            // wire names in the shared type for source compatibility with old
            // clients, but reject them at the only action ingress so they cannot
            // mutate a waiting room or be persisted as an authoritative action.
            return null;
        case 'RECRUIT_BATCH':
            return typeof payload.expectedTrayRevision === 'number' || payload.expectedTrayRevision === undefined
                ? {
                    action: 'RECRUIT_BATCH',
                    ...(typeof payload.expectedTrayRevision === 'number'
                        ? { expectedTrayRevision: payload.expectedTrayRevision }
                        : {}),
                }
                : null;
        case 'USE_ACTIVE_ITEM':
            return (payload.slotIndex === 0 || payload.slotIndex === 1)
                && typeof payload.itemId === 'string'
                && isObject(payload.target)
                && typeof payload.target.kind === 'string'
                && Number.isInteger(payload.expectedItemRuntimeVersion)
                ? {
                    action: 'USE_ACTIVE_ITEM',
                    slotIndex: payload.slotIndex,
                    itemId: payload.itemId,
                    target: payload.target,
                    expectedItemRuntimeVersion: payload.expectedItemRuntimeVersion,
                }
                : null;
        case 'SET_TUTORIAL_PAUSED':
            return typeof payload.paused === 'boolean'
                ? { action: 'SET_TUTORIAL_PAUSED', paused: payload.paused }
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
                : null;
        case 'SWAP_RESERVE_BOARD':
            return Number.isInteger(payload.reserveIndex)
                && typeof payload.x === 'number'
                && typeof payload.y === 'number'
                ? {
                    action: 'SWAP_RESERVE_BOARD',
                    reserveIndex: payload.reserveIndex,
                    x: payload.x,
                    y: payload.y,
                    ...(typeof payload.expectedReserveRevision === 'number'
                        ? { expectedReserveRevision: payload.expectedReserveRevision }
                        : {}),
                    ...(typeof payload.expectedBoardRevision === 'number'
                        ? { expectedBoardRevision: payload.expectedBoardRevision }
                        : {}),
                }
                : null;
        case 'EXILE_RESERVE':
            return typeof payload.expectedReserveRevision === 'number' || payload.expectedReserveRevision === undefined
                ? {
                    action: 'EXILE_RESERVE',
                    ...(typeof payload.expectedReserveRevision === 'number'
                        ? { expectedReserveRevision: payload.expectedReserveRevision }
                        : {}),
                }
                : null;
        case 'SWAP_STORAGE_PIECES':
            return (payload.sourceZone === 'tray' || payload.sourceZone === 'reserve')
                && (payload.targetZone === 'tray' || payload.targetZone === 'reserve')
                && Number.isInteger(payload.sourceIndex)
                && Number.isInteger(payload.targetIndex)
                ? {
                    action: 'SWAP_STORAGE_PIECES',
                    sourceZone: payload.sourceZone,
                    sourceIndex: payload.sourceIndex,
                    targetZone: payload.targetZone,
                    targetIndex: payload.targetIndex,
                    ...(typeof payload.expectedTrayRevision === 'number'
                        ? { expectedTrayRevision: payload.expectedTrayRevision }
                        : {}),
                    ...(typeof payload.expectedReserveRevision === 'number'
                        ? { expectedReserveRevision: payload.expectedReserveRevision }
                        : {}),
                }
                : null;
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
                : null;
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
                : null;
        default:
            return null;
    }
}
