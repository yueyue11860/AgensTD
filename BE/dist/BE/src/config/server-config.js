"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createServerConfig = createServerConfig;
const default_wave_configs_1 = require("./default-wave-configs");
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
    const production = process.env.NODE_ENV === 'production';
    const humanToken = process.env.HUMAN_GATEWAY_TOKEN?.trim() || (production ? null : 'human-dev-token');
    const agentToken = process.env.AGENT_GATEWAY_TOKEN?.trim() || (production ? null : 'agent-dev-token');
    const tokens = [];
    if (humanToken) {
        tokens.push({
            token: humanToken,
            playerId: process.env.HUMAN_PLAYER_ID ?? 'human-dev',
            playerName: process.env.HUMAN_PLAYER_NAME ?? 'Human Player',
            playerKind: 'human',
        });
    }
    if (agentToken) {
        tokens.push({
            token: agentToken,
            playerId: process.env.AGENT_PLAYER_ID ?? 'agent-dev',
            playerName: process.env.AGENT_PLAYER_NAME ?? 'Agent Player',
            playerKind: 'agent',
        });
    }
    return tokens;
}
function createServerConfig() {
    const tickRateMs = readNumber('TICK_RATE_MS', 100);
    const pveE2eEnabled = process.env.NODE_ENV !== 'production' && readBoolean('PVE_E2E_ENABLED', false);
    const hostLoopIntervalMs = pveE2eEnabled
        ? Math.max(1, Math.min(tickRateMs, Math.round(readNumber('HOST_LOOP_INTERVAL_MS', tickRateMs))))
        : tickRateMs;
    const broadcastIntervalMs = Math.max(tickRateMs, readNumber('BROADCAST_INTERVAL_MS', 200));
    const fullSnapshotIntervalMs = Math.max(broadcastIntervalMs, readNumber('FULL_SNAPSHOT_INTERVAL_MS', 5000));
    const requestedDisconnectGraceMs = Math.max(0, Math.round(readNumber('DISCONNECT_GRACE_MS', 45_000)));
    const disconnectGraceMs = process.env.NODE_ENV === 'production'
        ? Math.min(60_000, Math.max(30_000, requestedDisconnectGraceMs))
        : requestedDisconnectGraceMs;
    return {
        port: readNumber('PORT', 3000),
        corsOrigin: process.env.CORS_ORIGIN ?? '*',
        matchId: process.env.MATCH_ID ?? createDefaultMatchId(),
        tickRateMs,
        hostLoopIntervalMs,
        pveE2eEnabled,
        broadcastIntervalMs,
        fullSnapshotIntervalMs,
        mapWidth: readNumber('MAP_WIDTH', 29),
        mapHeight: readNumber('MAP_HEIGHT', 29),
        playerStartingGold: readNumber('PLAYER_STARTING_GOLD', 200),
        authRequired: process.env.NODE_ENV === 'production' ? true : readBoolean('AUTH_REQUIRED', true),
        actionRateLimitWindowMs: readNumber('ACTION_RATE_LIMIT_WINDOW_MS', 1000),
        actionRateLimitMax: readNumber('ACTION_RATE_LIMIT_MAX', 3),
        disconnectGraceMs,
        replayMaxFrames: readNumber('REPLAY_MAX_FRAMES', 300),
        replayMaxActions: readNumber('REPLAY_MAX_ACTIONS', 500),
        persistenceFlushEveryTicks: Math.max(1, Math.round(readNumber('PERSISTENCE_FLUSH_EVERY_TICKS', 50))),
        verboseGameLogs: readBoolean('VERBOSE_GAME_LOGS', process.env.NODE_ENV !== 'production'),
        pveInitialWaveNumber: process.env.NODE_ENV === 'production'
            ? 1
            : Math.min(20, Math.max(1, Math.trunc(readNumber('PVE_INITIAL_WAVE', 1)))),
        supabaseUrl: readString('SUPABASE_URL'),
        supabaseServiceRoleKey: readString('SUPABASE_SERVICE_ROLE_KEY'),
        authTokens: buildAuthTokens(),
        waveConfigs: default_wave_configs_1.defaultWaveConfigs,
    };
}
