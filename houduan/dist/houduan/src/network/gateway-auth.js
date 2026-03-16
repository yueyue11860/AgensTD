"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticateGatewayToken = authenticateGatewayToken;
exports.extractHttpToken = extractHttpToken;
exports.extractSocketToken = extractSocketToken;
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
