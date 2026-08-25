"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticateGatewayTokenAsync = authenticateGatewayTokenAsync;
exports.authenticateGatewayToken = authenticateGatewayToken;
exports.extractHttpToken = extractHttpToken;
exports.extractSocketToken = extractSocketToken;
const supabase_auth_1 = require("../auth/supabase-auth");
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
/** 验证静态服务 token，或由 Supabase Auth 验证真人 JWT。 */
async function authenticateGatewayTokenAsync(config, token) {
    const staticPrincipal = authenticateGatewayToken(config, token);
    if (staticPrincipal || !token)
        return staticPrincipal;
    const identity = await (0, supabase_auth_1.getSupabaseAuthVerifier)()?.verify(token);
    if (identity) {
        return {
            token,
            playerId: identity.userId,
            playerName: identity.name || identity.userId,
            playerKind: 'human',
            email: identity.email,
            avatar: identity.avatar,
            authSource: 'supabase',
        };
    }
    return null;
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
            authSource: 'static',
        };
    }
    if (!token) {
        return null;
    }
    // 静态 token 只用于开发、E2E 和 agent 接入；真人使用异步 Supabase JWT 验证。
    const match = config.authTokens.find((candidate) => candidate.token === token);
    if (!match) {
        return null;
    }
    return {
        token: match.token,
        playerId: match.playerId,
        playerName: match.playerName,
        playerKind: match.playerKind,
        authSource: 'static',
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
