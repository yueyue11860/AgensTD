"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_http_1 = __importDefault(require("node:http"));
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const server_config_1 = require("../config/server-config");
const memory_pvp_store_1 = require("../data/memory-pvp-store");
const pvp_rest_api_1 = require("../network/pvp-rest-api");
const service_1 = require("./service");
if (process.env.PVP_E2E_ENABLED !== 'true' || process.env.NODE_ENV === 'production') {
    throw new Error('PVP_E2E_SERVER_FORBIDDEN');
}
const port = Number(process.env.PVP_E2E_BE_PORT ?? 3310);
const config = {
    ...(0, server_config_1.createServerConfig)(),
    port,
    authRequired: true,
    corsOrigin: '*',
    authTokens: [
        { token: 'pvp-e2e-alice-token', playerId: 'pvp-e2e-alice', playerName: 'E2E Alice', playerKind: 'human' },
        { token: 'pvp-e2e-bob-token', playerId: 'pvp-e2e-bob', playerName: 'E2E Bob', playerKind: 'human' },
    ],
};
const platform = new service_1.PvpPlatformService({
    store: new memory_pvp_store_1.MemoryPvpStore(),
    runtimeTickRateMs: 20,
    timerIntervalMs: 10,
    countdownMs: 120,
    roundIntervalMs: 4_000,
    disconnectForfeitMs: 25_000,
    terminalRetentionMs: 1_000,
    maxRetainedTerminalMatches: 4,
});
const app = (0, express_1.default)();
app.use((0, cors_1.default)({ origin: true, credentials: true }));
app.use(express_1.default.json());
app.get('/health', (_request, response) => response.json({ ok: true, service: 'pvp-e2e', realAuthority: true }));
app.get('/e2e/diagnostics', (_request, response) => response.json({ ok: true, diagnostics: platform.diagnostics() }));
app.post('/e2e/shutdown-runtime', (_request, response) => {
    platform.shutdown();
    response.json({ ok: true, diagnostics: platform.diagnostics() });
});
app.post('/e2e/matches/:matchId/skip-realtime-seq', (request, response) => {
    platform.injectRealtimeGapForE2e(request.params.matchId, 1);
    response.json({ ok: true, skipped: 1 });
});
app.use('/api/pvp', (0, pvp_rest_api_1.createPvpRestApiRouter)(config, platform));
const server = node_http_1.default.createServer(app);
const shutdown = () => {
    platform.shutdown();
    console.log(JSON.stringify({ shutdownDiagnostics: platform.diagnostics() }));
    server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
void platform.ready
    .then(() => new Promise((resolve) => server.listen(port, '127.0.0.1', resolve)))
    .then(() => console.log(JSON.stringify({ ready: true, port, principals: config.authTokens.map(({ playerId }) => playerId) })))
    .catch((error) => {
    console.error(error);
    process.exitCode = 1;
    shutdown();
});
