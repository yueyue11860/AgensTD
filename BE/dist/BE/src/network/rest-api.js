"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRestApiRouter = createRestApiRouter;
const express_1 = require("express");
const competition_projection_1 = require("../core/competition-projection");
const state_projection_1 = require("../core/state-projection");
const action_submission_1 = require("./action-submission");
const gateway_auth_1 = require("./gateway-auth");
const unlock_logic_1 = require("../core/unlock-logic");
function resolvePrincipal(request, config) {
    return (0, gateway_auth_1.authenticateGatewayToken)(config, (0, gateway_auth_1.extractHttpToken)(request));
}
function rejectUnauthorized(response) {
    response.status(401).json({ ok: false, code: 'UNAUTHORIZED', message: 'Missing or invalid gateway token' });
}
function parseLimit(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return Math.floor(parsed);
}
function logCompetitionStoreFailure(operation, error) {
    const details = error instanceof Error ? error.message : String(error);
    console.error(`Competition store ${operation} failed; falling back to memory: ${details}`);
}
function createRestApiRouter(engine, config, limiter, replayRecorder, competitionStore, progressStore) {
    const router = (0, express_1.Router)();
    router.get('/state', (request, response) => {
        const principal = resolvePrincipal(request, config);
        if (!principal) {
            rejectUnauthorized(response);
            return;
        }
        response.json({
            ok: true,
            player: {
                playerId: principal.playerId,
                playerName: principal.playerName,
                playerKind: principal.playerKind,
            },
            gameState: (0, state_projection_1.projectFrontendGameState)(engine.getStateSnapshot(), config),
        });
    });
    router.post('/actions', (request, response) => {
        const principal = resolvePrincipal(request, config);
        if (!principal) {
            rejectUnauthorized(response);
            return;
        }
        const submission = (0, action_submission_1.submitAction)({
            engine,
            limiter,
            player: principal,
            payload: request.body,
        });
        if (!submission.ok) {
            response.status(submission.status).json({
                ok: false,
                code: submission.code,
                message: submission.message,
                retryAfterMs: submission.retryAfterMs,
            });
            return;
        }
        response.status(202).json({
            ok: true,
            accepted: true,
            action: submission.action,
            rateLimitRemaining: submission.rateLimitRemaining,
            gameState: (0, state_projection_1.projectFrontendGameState)(engine.getStateSnapshot(), config),
        });
    });
    router.get('/leaderboard', async (request, response) => {
        const principal = resolvePrincipal(request, config);
        if (!principal) {
            rejectUnauthorized(response);
            return;
        }
        const limit = parseLimit(request.query.limit, 10);
        const liveLeaderboards = (0, competition_projection_1.buildLiveLeaderboards)(engine.getStateSnapshot());
        let persistedLeaderboards = null;
        if (competitionStore?.isEnabled()) {
            try {
                persistedLeaderboards = await competitionStore.getDualLeaderboards(limit);
            }
            catch (error) {
                logCompetitionStoreFailure('getDualLeaderboards', error);
            }
        }
        let usingPersistedLeaderboards = false;
        let leaderboards = liveLeaderboards;
        if (persistedLeaderboards) {
            usingPersistedLeaderboards = persistedLeaderboards.all.length > 0
                || persistedLeaderboards.human.length > 0
                || persistedLeaderboards.agent.length > 0;
            if (usingPersistedLeaderboards) {
                leaderboards = persistedLeaderboards;
            }
        }
        response.json({
            ok: true,
            source: usingPersistedLeaderboards ? 'supabase' : 'memory',
            leaderboards,
        });
    });
    router.get('/replays', async (request, response) => {
        const principal = resolvePrincipal(request, config);
        if (!principal) {
            rejectUnauthorized(response);
            return;
        }
        const limit = parseLimit(request.query.limit, 10);
        const currentReplay = replayRecorder.getCurrentReplay();
        let persisted = [];
        if (competitionStore?.isEnabled()) {
            try {
                persisted = await competitionStore.listRecentReplays(limit);
            }
            catch (error) {
                logCompetitionStoreFailure('listRecentReplays', error);
            }
        }
        const summaries = persisted.length > 0
            ? persisted
            : currentReplay
                ? [(0, competition_projection_1.buildReplaySummary)(currentReplay)]
                : [];
        response.json({
            ok: true,
            source: persisted.length > 0 ? 'supabase' : 'memory',
            replays: summaries,
        });
    });
    // ── POST /replays — 仅存储胜利录像 ─────────────────────────────────────────
    // 收到失败数据包时，直接丢弃并返回 200 OK，不占用数据库空间。
    router.post('/replays', (request, response) => {
        const principal = resolvePrincipal(request, config);
        if (!principal) {
            rejectUnauthorized(response);
            return;
        }
        const body = request.body;
        if (typeof body !== 'object'
            || body === null
            || !body.isVictory) {
            // 非胜利数据直接丢弃，返回 200 OK
            response.status(200).json({ ok: true, stored: false, reason: 'defeat_discarded' });
            return;
        }
        const payload = body;
        const level = typeof payload.level === 'number' ? payload.level : null;
        if (level === null || !Number.isFinite(level)) {
            response.status(400).json({ ok: false, code: 'MISSING_LEVEL', message: 'level (number) is required' });
            return;
        }
        const playerType = principal.playerKind === 'human' ? 'HUMAN' : 'AGENT';
        const progress = progressStore.recordLevelClear(principal.playerId, level, playerType);
        response.status(201).json({ ok: true, stored: true, progress });
    });
    router.get('/replays/current', async (request, response) => {
        const principal = resolvePrincipal(request, config);
        if (!principal) {
            rejectUnauthorized(response);
            return;
        }
        const currentReplay = replayRecorder.getCurrentReplay();
        if (!currentReplay) {
            response.status(404).json({ ok: false, code: 'REPLAY_NOT_FOUND', message: 'No replay available yet' });
            return;
        }
        response.json({ ok: true, replay: currentReplay });
    });
    router.get('/replays/:matchId', async (request, response) => {
        const principal = resolvePrincipal(request, config);
        if (!principal) {
            rejectUnauthorized(response);
            return;
        }
        const { matchId } = request.params;
        const currentReplay = replayRecorder.getCurrentReplay();
        if (currentReplay?.matchId === matchId) {
            response.json({ ok: true, replay: currentReplay });
            return;
        }
        let persistedReplay = null;
        if (competitionStore?.isEnabled()) {
            try {
                persistedReplay = await competitionStore.getReplay(matchId);
            }
            catch (error) {
                logCompetitionStoreFailure('getReplay', error);
            }
        }
        if (!persistedReplay) {
            response.status(404).json({ ok: false, code: 'REPLAY_NOT_FOUND', message: 'Replay not found' });
            return;
        }
        response.json({ ok: true, replay: persistedReplay });
    });
    // ── GET /leaderboard/level5 — Level 5 大师排行榜 ───────────────────────────
    // 只返回 level5ClearCount > 0 的玩家，按通关次数降序，包含名次与硅基/碳基标识。
    router.get('/leaderboard/level5', (request, response) => {
        const principal = resolvePrincipal(request, config);
        if (!principal) {
            rejectUnauthorized(response);
            return;
        }
        const leaderboard = progressStore.getLevel5Leaderboard();
        response.json({ ok: true, leaderboard });
    });
    // ── GET /progress/:playerId — 查询玩家进度 ────────────────────────────────────
    router.get('/progress/:playerId', (request, response) => {
        const principal = resolvePrincipal(request, config);
        if (!principal) {
            rejectUnauthorized(response);
            return;
        }
        const { playerId } = request.params;
        const existing = progressStore.getProgress(playerId);
        if (!existing) {
            response.status(404).json({ ok: false, code: 'PROGRESS_NOT_FOUND', message: `No progress record for player ${playerId}` });
            return;
        }
        response.json({ ok: true, progress: existing });
    });
    // ── GET /progress/:playerId/unlock/:level — 检查关卡解锁状态 ─────────────────
    router.get('/progress/:playerId/unlock/:level', (request, response) => {
        const principal = resolvePrincipal(request, config);
        if (!principal) {
            rejectUnauthorized(response);
            return;
        }
        const targetLevel = Number(request.params.level);
        if (!Number.isFinite(targetLevel)) {
            response.status(400).json({ ok: false, code: 'INVALID_LEVEL', message: 'level must be a valid number' });
            return;
        }
        const playerType = principal.playerKind === 'human' ? 'HUMAN' : 'AGENT';
        const progress = progressStore.getOrCreate(request.params.playerId, playerType);
        const result = (0, unlock_logic_1.checkUnlock)(progress, targetLevel);
        response.json({ ok: true, targetLevel, ...result });
    });
    return router;
}
