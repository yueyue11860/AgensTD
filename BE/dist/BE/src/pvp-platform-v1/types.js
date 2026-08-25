"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PvpPlatformError = void 0;
exports.isHumanGatewayPrincipal = isHumanGatewayPrincipal;
function isHumanGatewayPrincipal(principal) {
    return principal?.playerKind === 'human'
        && principal.playerId.trim().length > 0
        && principal.playerName.trim().length > 0;
}
class PvpPlatformError extends Error {
    code;
    status;
    constructor(code, message, status = 400) {
        super(message);
        this.code = code;
        this.status = status;
        this.name = 'PvpPlatformError';
    }
}
exports.PvpPlatformError = PvpPlatformError;
