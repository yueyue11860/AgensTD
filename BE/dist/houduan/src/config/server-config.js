"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createServerConfig = createServerConfig;
function readNumber(name, fallback) {
    const value = process.env[name];
    if (!value) {
        return fallback;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function readBoolean(name, fallback) {
    const value = process.env[name];
    if (!value) {
        return fallback;
    }
    return value === '1' || value.toLowerCase() === 'true';
}
function readString(name) {
    const value = process.env[name]?.trim();
    return value ? value : null;
}
function createDefaultMatchId() {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');
    return `agenstd-${stamp}`;
}
function buildAuthTokens() {
    return [
        {
            token: process.env.HUMAN_GATEWAY_TOKEN ?? 'human-dev-token',
            playerId: process.env.HUMAN_PLAYER_ID ?? 'human-dev',
            playerName: process.env.HUMAN_PLAYER_NAME ?? 'Human Player',
            playerKind: 'human',
        },
        {
            token: process.env.AGENT_GATEWAY_TOKEN ?? 'agent-dev-token',
            playerId: process.env.AGENT_PLAYER_ID ?? 'agent-dev',
            playerName: process.env.AGENT_PLAYER_NAME ?? 'Agent Player',
            playerKind: 'agent',
        },
    ];
}
function createServerConfig() {
    return {
        port: readNumber('PORT', 3000),
        corsOrigin: process.env.CORS_ORIGIN ?? '*',
        matchId: process.env.MATCH_ID ?? createDefaultMatchId(),
        tickRateMs: readNumber('TICK_RATE_MS', 100),
        mapWidth: readNumber('MAP_WIDTH', 12),
        mapHeight: readNumber('MAP_HEIGHT', 8),
        playerStartingGold: readNumber('PLAYER_STARTING_GOLD', 200),
        authRequired: readBoolean('AUTH_REQUIRED', true),
        actionRateLimitWindowMs: readNumber('ACTION_RATE_LIMIT_WINDOW_MS', 1000),
        actionRateLimitMax: readNumber('ACTION_RATE_LIMIT_MAX', 3),
        replayMaxFrames: readNumber('REPLAY_MAX_FRAMES', 300),
        replayMaxActions: readNumber('REPLAY_MAX_ACTIONS', 500),
        persistenceFlushEveryTicks: readNumber('PERSISTENCE_FLUSH_EVERY_TICKS', 10),
        supabaseUrl: readString('SUPABASE_URL'),
        supabaseServiceRoleKey: readString('SUPABASE_SERVICE_ROLE_KEY'),
        authTokens: buildAuthTokens(),
    };
}
