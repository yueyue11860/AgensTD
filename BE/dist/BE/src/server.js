"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const http_1 = __importDefault(require("http"));
const path_1 = __importDefault(require("path"));
const fs_1 = require("fs");
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const server_config_1 = require("./config/server-config");
const production_policy_1 = require("./config/production-policy");
const supabase_auth_1 = require("./auth/supabase-auth");
const Room_1 = require("./core/Room");
const performance_telemetry_1 = require("./core/performance-telemetry");
const projected_tick_stream_1 = require("./core/projected-tick-stream");
const replay_recorder_1 = require("./core/replay-recorder");
const supabase_competition_store_1 = require("./data/supabase-competition-store");
const memory_pvp_store_1 = require("./data/memory-pvp-store");
const supabase_pvp_store_1 = require("./data/supabase-pvp-store");
const action_rate_limiter_1 = require("./network/action-rate-limiter");
const agent_api_1 = require("./network/agent-api");
const rest_api_1 = require("./network/rest-api");
const pvp_rest_api_1 = require("./network/pvp-rest-api");
const supabase_auth_routes_1 = require("./network/supabase-auth-routes");
const e2e_control_api_1 = require("./network/e2e-control-api");
const socket_gateway_1 = require("./network/socket-gateway");
const pvp_platform_v1_1 = require("./pvp-platform-v1");
const outbox_worker_1 = require("./pvp-platform-v1/outbox-worker");
const progress_store_1 = require("./data/progress-store");
const supabase_user_store_1 = require("./data/supabase-user-store");
const account_v1_1 = require("./account-v1");
const memory_store_1 = require("./account-v1/memory-store");
const supabase_player_account_store_1 = require("./data/supabase-player-account-store");
const resilient_player_account_store_1 = require("./data/resilient-player-account-store");
const supabase_pve_reward_store_1 = require("./data/supabase-pve-reward-store");
const persistence_readiness_1 = require("./data/persistence-readiness");
const pve_reward_v1_1 = require("./pve-reward-v1");
const pve_checkpoint_v1_1 = require("./pve-checkpoint-v1");
const supabase_pve_checkpoint_store_1 = require("./data/supabase-pve-checkpoint-store");
const player_account_adapters_1 = require("./data/player-account-adapters");
const config = (0, server_config_1.createServerConfig)();
const isProduction = process.env.NODE_ENV === 'production';
const persistencePolicy = (0, production_policy_1.resolvePersistencePolicy)({
    nodeEnv: process.env.NODE_ENV,
    pvpStore: process.env.PVP_STORE,
    hasSupabaseCredentials: Boolean(config.supabaseUrl && config.supabaseServiceRoleKey),
});
const persistenceReadiness = new persistence_readiness_1.PersistenceReadinessTracker(persistencePolicy.requiresWritablePersistence || persistencePolicy.pvpStoreMode === 'supabase'
    ? 'supabase'
    : 'memory');
let pveCheckpointReadiness = {
    status: 'checking', code: null, recovered: false,
};
let gateway = null;
const checkpointStoreMode = (0, production_policy_1.resolvePveCheckpointStoreMode)(process.env.NODE_ENV, process.env.PVE_CHECKPOINT_STORE);
const supabaseCheckpointStore = new supabase_pve_checkpoint_store_1.SupabasePveCheckpointStore(config);
if (checkpointStoreMode === 'supabase' && !supabaseCheckpointStore.isEnabled()) {
    throw new Error('PVE_CHECKPOINT_STORE=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
}
const pveCheckpointStore = checkpointStoreMode === 'supabase'
    ? supabaseCheckpointStore
    : new pve_checkpoint_v1_1.MemoryPveCheckpointStore();
const pveCheckpointCoordinator = new pve_checkpoint_v1_1.PveCheckpointCoordinator(pveCheckpointStore, {
    checkpointEveryTicks: (() => {
        const configured = Number(process.env.PVE_CHECKPOINT_EVERY_TICKS ?? 50);
        return Number.isFinite(configured) ? Math.max(1, Math.round(configured)) : 50;
    })(),
    onFatal: () => {
        pveCheckpointReadiness = { status: 'not_ready', code: 'PVE_CHECKPOINT_UNHEALTHY', recovered: pveCheckpointReadiness.recovered };
        gateway?.stopRoomLoops();
    },
});
const app = (0, express_1.default)();
const frontendDistDir = path_1.default.resolve(process.cwd(), '../FE/dist');
const frontendIndexFile = path_1.default.join(frontendDistDir, 'index.html');
const hasFrontendBuild = (0, fs_1.existsSync)(frontendIndexFile);
function isFrontendPageRequest(request) {
    if (request.path.startsWith('/api') || request.path.startsWith('/health') || request.path.startsWith('/socket.io')) {
        return false;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return false;
    }
    if (path_1.default.extname(request.path)) {
        return false;
    }
    const acceptHeader = request.headers.accept ?? '';
    return acceptHeader.includes('text/html');
}
app.use((0, cors_1.default)({ origin: config.corsOrigin === '*' ? true : config.corsOrigin, credentials: true }));
app.use(express_1.default.json());
if (hasFrontendBuild) {
    app.use(express_1.default.static(frontendDistDir));
}
app.get('/health', (_request, response) => {
    const persistence = persistenceReadiness.snapshot();
    const ok = (0, persistence_readiness_1.isPersistenceReadyForTraffic)(persistence, persistencePolicy.requiresWritablePersistence)
        && pveCheckpointReadiness.status === 'ready';
    response.status(ok ? 200 : 503).json({
        ok,
        service: 'agenstd-houduan',
        persistence,
        stores: {
            auth: config.supabaseUrl && config.supabaseServiceRoleKey ? 'supabase' : 'static',
            pvp: persistencePolicy.pvpStoreMode,
            pveCheckpoint: checkpointStoreMode,
        },
        pveCheckpoint: pveCheckpointReadiness,
    });
});
const httpServer = http_1.default.createServer(app);
const supabaseAccountStore = new supabase_player_account_store_1.SupabasePlayerAccountStore(config);
if (isProduction && !supabaseAccountStore.isEnabled()) {
    throw new Error('Production requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for player accounts');
}
const accountStore = isProduction
    ? supabaseAccountStore
    : new resilient_player_account_store_1.ResilientPlayerAccountStore(supabaseAccountStore, new memory_store_1.MemoryPlayerAccountStore());
const accountBuildResolver = new player_account_adapters_1.V1MatchBuildDefinitionResolver();
const accountService = new account_v1_1.PlayerAccountService(accountStore, new player_account_adapters_1.V1AccountShopCatalog());
const rewardStoreMode = (0, production_policy_1.resolvePveRewardStoreMode)(process.env.NODE_ENV, process.env.PVE_REWARD_STORE);
const supabaseRewardStore = new supabase_pve_reward_store_1.SupabasePveRewardStore(config);
if (rewardStoreMode === 'supabase' && !supabaseRewardStore.isEnabled()) {
    throw new Error('PVE_REWARD_STORE=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
}
const pveRewardStore = rewardStoreMode === 'supabase' ? supabaseRewardStore : new pve_reward_v1_1.MemoryPveRewardStore();
const pveRewardService = new pve_reward_v1_1.PveRewardService(pveRewardStore);
const pveSettlementCoordinator = new pve_reward_v1_1.PveSettlementCoordinator(pveRewardStore, accountService);
const roomManager = new Room_1.RoomManager(config, {
    accountService,
    buildResolver: accountBuildResolver,
});
const room = roomManager.getOrCreateRoom('public-1');
const engine = room.engine;
const performanceTelemetry = new performance_telemetry_1.PerformanceTelemetry();
engine.attachPerformanceTelemetry(performanceTelemetry);
const competitionStore = new supabase_competition_store_1.SupabaseCompetitionStore(config);
const projectedTickStream = new projected_tick_stream_1.ProjectedTickStream(engine, config, performanceTelemetry);
const replayRecorder = new replay_recorder_1.ReplayRecorder(engine, projectedTickStream, config, competitionStore, performanceTelemetry);
const actionLimiter = new action_rate_limiter_1.ActionRateLimiter(config.actionRateLimitWindowMs, config.actionRateLimitMax);
const progressStore = new progress_store_1.ProgressStore();
const userStore = new supabase_user_store_1.SupabaseUserStore(config);
progressStore.setUserStore(userStore);
const supabaseAuthVerifier = new supabase_auth_1.SupabaseAuthVerifier(config);
(0, supabase_auth_1.configureSupabaseAuthVerifier)(supabaseAuthVerifier);
if (isProduction && (!supabaseAuthVerifier.isEnabled() || !userStore.isEnabled())) {
    throw new Error('Production Supabase Auth requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
}
const pvpStore = persistencePolicy.pvpStoreMode === 'supabase' ? new supabase_pvp_store_1.SupabasePvpStore(config) : new memory_pvp_store_1.MemoryPvpStore();
const pvpPlatform = new pvp_platform_v1_1.PvpPlatformService({ store: pvpStore });
const pvpRewardWorker = new outbox_worker_1.PvpRewardOutboxWorker(pvpStore);
gateway = new socket_gateway_1.SocketGateway(httpServer, roomManager, config, performanceTelemetry, actionLimiter, progressStore, projectedTickStream, accountService, pveRewardService, pveSettlementCoordinator, pveCheckpointCoordinator, true);
app.use('/api', (0, supabase_auth_routes_1.createSupabaseAuthRouter)(config, userStore));
app.use('/api/e2e', (0, e2e_control_api_1.createE2eControlRouter)(config, gateway));
app.use('/api/pvp', (0, pvp_rest_api_1.createPvpRestApiRouter)(config, pvpPlatform));
app.use('/api', (0, rest_api_1.createRestApiRouter)(engine, roomManager, config, actionLimiter, replayRecorder, competitionStore, progressStore, accountService, pveRewardStore, pveCheckpointCoordinator));
app.use('/api/agent', (0, agent_api_1.createAgentApiRouter)(projectedTickStream, config, replayRecorder, competitionStore, performanceTelemetry));
if (hasFrontendBuild) {
    app.use((request, response, next) => {
        if (!isFrontendPageRequest(request)) {
            next();
            return;
        }
        response.sendFile(frontendIndexFile);
    });
}
void Promise.all([
    pveSettlementCoordinator.recover(),
    persistenceReadiness.snapshot().mode === 'supabase'
        ? (0, persistence_readiness_1.probeSupabaseWrite)(config)
        : Promise.resolve({ status: 'ready', writable: true, checkedAt: new Date().toISOString(), code: null }),
    (async () => {
        // Ask for one sentinel beyond the supported room budget. Silently omitting an older active
        // room would advertise readiness while abandoning its authoritative match.
        const latest = await pveCheckpointStore.listLatestCheckpoints(1001);
        if (latest.length > 1000)
            throw new Error('PVE_CHECKPOINT_DISCOVERY_ROOM_LIMIT_EXCEEDED');
        const roomIds = new Set(latest.flatMap((checkpoint) => {
            const engineState = checkpoint.payload.engine?.state;
            return engineState?.status === 'finished' ? [] : [checkpoint.roomId];
        }));
        const results = await Promise.all([...roomIds].map((roomId) => (pveCheckpointCoordinator.recoverAndAttach(roomManager.getOrCreateRoom(roomId)))));
        return {
            recovered: results.some((result) => result.recovered),
            recoveredRooms: results.filter((result) => result.recovered).length,
            replayedActions: results.reduce((total, result) => total + result.replayedActions, 0),
        };
    })(),
])
    .then(([{ recovered, failed }, persistenceProbe, checkpointRecovery]) => {
    persistenceReadiness.mark(persistenceProbe);
    if (persistenceProbe.status !== 'ready' || !persistenceProbe.writable) {
        throw new Error(`Persistence readiness failed: ${persistenceProbe.code ?? 'NOT_WRITABLE'}`);
    }
    pveCheckpointReadiness = { status: 'ready', code: null, recovered: checkpointRecovery.recovered };
    if (recovered > 0 || failed > 0)
        console.info(`PVE settlement recovery: recovered=${recovered} failed=${failed}`);
    if (isProduction && failed > 0)
        throw new Error(`PVE settlement recovery left ${failed} failed record(s)`);
    gateway.prepareRoomRuntimes();
    gateway.startRoomLoops();
    void pvpPlatform.ready.then(() => pvpRewardWorker.start());
    httpServer.listen(config.port, () => { });
})
    .catch((error) => {
    const details = error instanceof Error ? error.message : String(error);
    persistenceReadiness.mark({ status: 'not_ready', writable: false, checkedAt: new Date().toISOString(), code: 'BOOTSTRAP_FAILED' });
    pveCheckpointReadiness = { status: 'not_ready', code: 'BOOTSTRAP_FAILED', recovered: false };
    console.error(`Persistence bootstrap failed; refusing to listen: ${details}`);
    pvpPlatform.shutdown();
    void pvpRewardWorker.stop();
    gateway.shutdown(() => { process.exitCode = 1; });
});
const shutdown = () => {
    pvpPlatform.shutdown();
    void pvpRewardWorker.stop();
    pveCheckpointCoordinator.shutdown();
    void replayRecorder.flushLatest()
        .catch((error) => {
        const details = error instanceof Error ? error.message : String(error);
        console.error(`Final replay persistence failed during shutdown: ${details}`);
    })
        .finally(() => {
        gateway.shutdown(() => {
            httpServer.close(() => {
                process.exit(0);
            });
        });
    });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
