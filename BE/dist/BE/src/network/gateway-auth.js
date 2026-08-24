"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticateGatewayToken = authenticateGatewayToken;
exports.extractHttpToken = extractHttpToken;
exports.extractSocketToken = extractSocketToken;
const oauth_routes_1 = require("./oauth-routes");
function readAuthorizationToken(authorizationHeader) {
    if (!authorizationHeader) {
        return undefined;
    }
    const [scheme, credentials] = authorizationHeader.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !credentials) {
        return undefined;
    }
    return credentials;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** 尝试从 session token 解析已登录的 OAuth 用户 */
function resolveSessionPrincipal(token) {
    if (!token.startsWith('sess_'))
        return null;
    const session = (0, oauth_routes_1.getSessionByToken)(token);
    if (!session)
        return null;
    return {
        token,
        playerId: session.user.userId,
        playerName: session.user.name || session.user.userId,
        playerKind: 'human',
    };
}
function authenticateGatewayToken(config, token) {
    if (!config.authRequired) {
        const fallback = config.authTokens[0];
        if (!fallback) {
            return null;
        }
        return {
            token: fallback.token,
            playerId: fallback.playerId,
            playerName: fallback.playerName,
            playerKind: fallback.playerKind,
        };
    }
    if (!token) {
        return null;
    }
    // 优先检查 session token（OAuth 登录用户）
    const sessionPrincipal = resolveSessionPrincipal(token);
    if (sessionPrincipal)
        return sessionPrincipal;
    // 回退到静态 token 匹配（dev/agent token）
    const match = config.authTokens.find((candidate) => candidate.token === token);
    if (!match) {
        return null;
    }
    return {
        token: match.token,
        playerId: match.playerId,
        playerName: match.playerName,
        playerKind: match.playerKind,
    };
}
function extractHttpToken(request) {
    const headerToken = readAuthorizationToken(request.header('authorization') ?? undefined);
    if (headerToken) {
        return headerToken;
    }
    const apiKeyHeader = request.header('x-api-key');
    if (apiKeyHeader) {
        return apiKeyHeader;
    }
    if (isRecord(request.body) && typeof request.body.token === 'string') {
        return request.body.token;
    }
    return undefined;
}
function extractSocketToken(socket) {
    const authToken = isRecord(socket.handshake.auth) && typeof socket.handshake.auth.token === 'string'
        ? socket.handshake.auth.token
        : undefined;
    if (authToken) {
        return authToken;
    }
    const queryToken = socket.handshake.query.token;
    if (typeof queryToken === 'string' && queryToken.length > 0) {
        return queryToken;
    }
    const headerAuthorization = socket.handshake.headers.authorization;
    if (typeof headerAuthorization === 'string') {
        const bearerToken = readAuthorizationToken(headerAuthorization);
        if (bearerToken) {
            return bearerToken;
        }
    }
    const apiKeyHeader = socket.handshake.headers['x-api-key'];
    if (typeof apiKeyHeader === 'string' && apiKeyHeader.length > 0) {
        return apiKeyHeader;
    }
    return undefined;
}
