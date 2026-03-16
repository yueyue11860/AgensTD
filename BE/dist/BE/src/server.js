"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const http_1 = __importDefault(require("http"));
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const server_config_1 = require("./config/server-config");
const Room_1 = require("./core/Room");
const game_loop_1 = require("./core/game-loop");
const performance_telemetry_1 = require("./core/performance-telemetry");
const projected_tick_stream_1 = require("./core/projected-tick-stream");
const replay_recorder_1 = require("./core/replay-recorder");
const supabase_competition_store_1 = require("./data/supabase-competition-store");
const action_rate_limiter_1 = require("./network/action-rate-limiter");
const agent_api_1 = require("./network/agent-api");
const rest_api_1 = require("./network/rest-api");
const socket_gateway_1 = require("./network/socket-gateway");
const config = (0, server_config_1.createServerConfig)();
const app = (0, express_1.default)();
app.use((0, cors_1.default)({ origin: config.corsOrigin === '*' ? true : config.corsOrigin, credentials: true }));
app.use(express_1.default.json());
app.get('/health', (_request, response) => {
    response.json({
        ok: true,
        service: 'agenstd-houduan',
        port: config.port,
        tickRateMs: config.tickRateMs,
    });
});
const httpServer = http_1.default.createServer(app);
const roomManager = new Room_1.RoomManager(config);
const room = roomManager.getOrCreateRoom('public-1');
const engine = room.engine;
const performanceTelemetry = new performance_telemetry_1.PerformanceTelemetry();
engine.attachPerformanceTelemetry(performanceTelemetry);
const loop = new game_loop_1.GameLoop(engine, config.tickRateMs);
const competitionStore = new supabase_competition_store_1.SupabaseCompetitionStore(config);
const projectedTickStream = new projected_tick_stream_1.ProjectedTickStream(engine, config, performanceTelemetry);
const replayRecorder = new replay_recorder_1.ReplayRecorder(engine, projectedTickStream, config, competitionStore, performanceTelemetry);
const actionLimiter = new action_rate_limiter_1.ActionRateLimiter(config.actionRateLimitWindowMs, config.actionRateLimitMax);
const gateway = new socket_gateway_1.SocketGateway(httpServer, room, config, projectedTickStream, performanceTelemetry, actionLimiter);
app.use('/api', (0, rest_api_1.createRestApiRouter)(engine, config, actionLimiter, replayRecorder, competitionStore));
app.use('/api/agent', (0, agent_api_1.createAgentApiRouter)(projectedTickStream, config, replayRecorder, competitionStore, performanceTelemetry));
httpServer.listen(config.port, () => {
    loop.start();
});
const shutdown = () => {
    loop.stop();
    void replayRecorder.flushLatest().finally(() => {
        gateway.io.close(() => {
            httpServer.close(() => {
                process.exit(0);
            });
        });
    });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
