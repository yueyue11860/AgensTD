"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createServerConfig = createServerConfig;
const default_wave_configs_1 = require("./default-wave-configs");
function readNumber(name, fallback, bounds = {}) {
    const value = process.env[name];
    const raw = value === undefined ? String(fallback) : value.trim();
    const parsed = Number(raw);
    const valid = Number.isFinite(parsed)
        && (!bounds.integer || Number.isSafeInteger(parsed))
        && (bounds.min === undefined || parsed >= bounds.min)
        && (bounds.max === undefined || parsed <= bounds.max);
    if (!valid) {
        const integerHint = bounds.integer ? ' integer' : '';
        const range = bounds.min !== undefined && bounds.max !== undefined
            ? ` in [${bounds.min}, ${bounds.max}]`
            : bounds.min !== undefined ? ` >= ${bounds.min}` : bounds.max !== undefined ? ` <= ${bounds.max}` : '';
        throw new Error(`Invalid configuration ${name}: expected a finite${integerHint} number${range}; received ${JSON.stringify(value)}`);
    }
    return parsed;
}
function readBoolean(name, fallback) {
    const value = process.env[name];
    if (!value) {
        return fallback;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === '1' || normalized === 'true')
        return true;
    if (normalized === '0' || normalized === 'false')
        return false;
    throw new Error(`Invalid configuration ${name}: expected true/false (or 1/0); received ${JSON.stringify(value)}`);
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
    const tickRateMs = readNumber('TICK_RATE_MS', 100, { integer: true, min: 1, max: 60_000 });
    const pveE2eEnabled = process.env.NODE_ENV !== 'production' && readBoolean('PVE_E2E_ENABLED', false);
    const requestedHostLoopIntervalMs = readNumber('HOST_LOOP_INTERVAL_MS', tickRateMs, { integer: true, min: 1, max: 60_000 });
    const hostLoopIntervalMs = pveE2eEnabled ? requestedHostLoopIntervalMs : tickRateMs;
    if (pveE2eEnabled && hostLoopIntervalMs > tickRateMs) {
        throw new Error(`Invalid configuration HOST_LOOP_INTERVAL_MS: must be <= TICK_RATE_MS (${tickRateMs}) when PVE_E2E_ENABLED=true`);
    }
    const broadcastIntervalMs = readNumber('BROADCAST_INTERVAL_MS', 200, { integer: true, min: 1, max: 600_000 });
    if (broadcastIntervalMs < tickRateMs) {
        throw new Error(`Invalid configuration BROADCAST_INTERVAL_MS: must be >= TICK_RATE_MS (${tickRateMs})`);
    }
    const fullSnapshotIntervalMs = readNumber('FULL_SNAPSHOT_INTERVAL_MS', 5000, { integer: true, min: 1, max: 3_600_000 });
    if (fullSnapshotIntervalMs < broadcastIntervalMs) {
        throw new Error(`Invalid configuration FULL_SNAPSHOT_INTERVAL_MS: must be >= BROADCAST_INTERVAL_MS (${broadcastIntervalMs})`);
    }
    const requestedDisconnectGraceMs = readNumber('DISCONNECT_GRACE_MS', 45_000, { integer: true, min: 1, max: 300_000 });
    const disconnectGraceMs = process.env.NODE_ENV === 'production'
        ? Math.min(60_000, Math.max(30_000, requestedDisconnectGraceMs))
        : requestedDisconnectGraceMs;
    return {
        port: readNumber('PORT', 3000, { integer: true, min: 1, max: 65_535 }),
        corsOrigin: process.env.CORS_ORIGIN ?? '*',
        matchId: process.env.MATCH_ID ?? createDefaultMatchId(),
        tickRateMs,
        hostLoopIntervalMs,
        pveE2eEnabled,
        broadcastIntervalMs,
        fullSnapshotIntervalMs,
        mapWidth: readNumber('MAP_WIDTH', 29, { integer: true, min: 29, max: 200 }),
        mapHeight: readNumber('MAP_HEIGHT', 29, { integer: true, min: 29, max: 200 }),
        playerStartingGold: readNumber('PLAYER_STARTING_GOLD', 200, { integer: true, min: 0, max: 1_000_000_000 }),
        authRequired: process.env.NODE_ENV === 'production' ? true : readBoolean('AUTH_REQUIRED', true),
        actionRateLimitWindowMs: readNumber('ACTION_RATE_LIMIT_WINDOW_MS', 1000, { integer: true, min: 1, max: 600_000 }),
        actionRateLimitMax: readNumber('ACTION_RATE_LIMIT_MAX', 3, { integer: true, min: 1, max: 10_000 }),
        disconnectGraceMs,
        replayMaxFrames: readNumber('REPLAY_MAX_FRAMES', 300, { integer: true, min: 1, max: 1_000_000 }),
        replayMaxActions: readNumber('REPLAY_MAX_ACTIONS', 500, { integer: true, min: 1, max: 1_000_000 }),
        persistenceFlushEveryTicks: readNumber('PERSISTENCE_FLUSH_EVERY_TICKS', 50, { integer: true, min: 1, max: 1_000_000 }),
        verboseGameLogs: readBoolean('VERBOSE_GAME_LOGS', process.env.NODE_ENV !== 'production'),
        pveInitialWaveNumber: process.env.NODE_ENV === 'production'
            ? 1
            : readNumber('PVE_INITIAL_WAVE', 1, { integer: true, min: 1, max: 20 }),
        supabaseUrl: readString('SUPABASE_URL'),
        supabaseServiceRoleKey: readString('SUPABASE_SERVICE_ROLE_KEY'),
        authTokens: buildAuthTokens(),
        waveConfigs: default_wave_configs_1.defaultWaveConfigs,
    };
}
