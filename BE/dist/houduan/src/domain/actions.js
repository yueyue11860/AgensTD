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
        default:
            return null;
    }
}
