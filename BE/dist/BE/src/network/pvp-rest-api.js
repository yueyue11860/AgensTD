"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPvpRestApiRouter = createPvpRestApiRouter;
const express_1 = require("express");
const types_1 = require("../pvp-platform-v1/types");
const gateway_auth_1 = require("./gateway-auth");
async function principalFrom(request, config) {
    const token = (0, gateway_auth_1.extractHttpToken)(request);
    // PVP 竞技边界不继承 PVE 本地“免鉴权回退到首个账号”的便利行为，
    // 否则 agent/anonymous 请求会被错认成默认真人。PVP 始终要求显式有效 token。
    const principal = await (0, gateway_auth_1.authenticateGatewayTokenAsync)({ ...config, authRequired: true }, token);
    if (!principal)
        throw new types_1.PvpPlatformError('UNAUTHORIZED', 'Missing or invalid gateway token', 401);
    if (process.env.NODE_ENV === 'production' && principal.authSource !== 'supabase') {
        throw new types_1.PvpPlatformError('SUPABASE_SESSION_REQUIRED', '正式 PVP 只接受 Supabase 真人会话', 401);
    }
    if (!(0, types_1.isHumanGatewayPrincipal)(principal))
        throw new types_1.PvpPlatformError('HUMAN_ACCOUNT_REQUIRED', 'PVP 只允许真人账号进入', 403);
    return principal;
}
function recordBody(request) {
    return typeof request.body === 'object' && request.body !== null && !Array.isArray(request.body)
        ? request.body
        : {};
}
function requiredString(value, field) {
    if (typeof value !== 'string' || !value.trim())
        throw new types_1.PvpPlatformError('BAD_PAYLOAD', `${field} is required`, 400);
    return value.trim();
}
function optionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function requiredInteger(value, field) {
    if (!Number.isSafeInteger(value) || Number(value) < 0)
        throw new types_1.PvpPlatformError('BAD_PAYLOAD', `${field} must be a non-negative integer`, 400);
    return Number(value);
}
function numberQuery(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.trunc(number) : undefined;
}
function sendError(response, error) {
    if (error instanceof types_1.PvpPlatformError) {
        response.status(error.status).json({ ok: false, code: error.code, message: error.message });
        return;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`PVP REST failure: ${message}`);
    response.status(503).json({ ok: false, code: 'PVP_SERVICE_UNAVAILABLE', message: 'PVP service is temporarily unavailable' });
}
function route(handler, config) {
    return async (request, response) => {
        try {
            const principal = await principalFrom(request, config);
            await handler(request, response, principal);
        }
        catch (error) {
            sendError(response, error);
        }
    };
}
function createPvpRestApiRouter(config, platform) {
    const router = (0, express_1.Router)();
    router.get('/profile', route(async (_request, response, principal) => {
        response.json({ ok: true, profile: await platform.profile(principal) });
    }, config));
    router.get('/seasons/current', route(async (request, response) => {
        const rawMode = optionalString(request.query.mode);
        const mode = rawMode === 'casual_1v1' || rawMode === 'custom_1v1' ? rawMode : 'ranked_1v1';
        response.json({ ok: true, season: await platform.currentSeason(mode) });
    }, config));
    router.get('/leaderboard', route(async (request, response, principal) => {
        const leaderboard = await platform.leaderboard(principal, numberQuery(request.query.limit), optionalString(request.query.cursor));
        response.json({ ok: true, leaderboard });
    }, config));
    router.get('/matches', route(async (request, response, principal) => {
        const history = await platform.history(principal, numberQuery(request.query.limit), optionalString(request.query.cursor));
        response.json({ ok: true, matches: history.entries, history });
    }, config));
    router.get('/matches/:matchId', route(async (request, response, principal) => {
        const detail = await platform.matchDetail(principal, requiredString(request.params.matchId, 'matchId'));
        response.json({ ok: true, detail });
    }, config));
    router.get('/matches/:matchId/state', route((request, response, principal) => {
        const state = platform.matchState(principal, requiredString(request.params.matchId, 'matchId'));
        response.json({ ok: true, state });
    }, config));
    router.get('/matches/:matchId/events', route((request, response, principal) => {
        const matchId = requiredString(request.params.matchId, 'matchId');
        // Validate match existence and participant access before committing the
        // HTTP response.  `subscribeMatchState` performs the same check, but doing
        // it first prevents a late 403/404 after SSE headers have already flushed
        // (which otherwise produces `Cannot set headers after they are sent`).
        platform.matchState(principal, matchId);
        platform.assertRealtimeCapacity(principal, matchId);
        response.status(200);
        response.setHeader('Content-Type', 'text/event-stream');
        response.setHeader('Cache-Control', 'no-cache, no-transform');
        response.setHeader('Connection', 'keep-alive');
        response.flushHeaders();
        const unsubscribe = platform.subscribeMatchState(principal, matchId, envelope => {
            response.write(`id: ${envelope.seq}\nevent: pvp-state\ndata: ${JSON.stringify(envelope)}\n\n`);
        });
        const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 15_000);
        request.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
    }, config));
    router.post('/matches/:matchId/load-ack', route((request, response, principal) => {
        const body = recordBody(request);
        const input = {
            requestId: requiredString(body.requestId, 'requestId'),
            rulesetVersion: requiredString(body.rulesetVersion, 'rulesetVersion'),
            mapId: requiredString(body.mapId, 'mapId'),
            mapVersion: Number.isSafeInteger(body.mapVersion) ? body.mapVersion : -1,
            routeHash: requiredString(body.routeHash, 'routeHash'),
            assetsVersion: requiredString(body.assetsVersion, 'assetsVersion'),
            status: body.status === 'loaded' ? 'loaded' : body.status === 'failed' ? 'failed' : (() => { throw new types_1.PvpPlatformError('BAD_PAYLOAD', 'status must be loaded or failed', 400); })(),
            ...(typeof body.failureCode === 'string' ? { failureCode: body.failureCode } : {}),
        };
        const result = platform.acknowledgeLoad(principal, requiredString(request.params.matchId, 'matchId'), input);
        response.status(result.ok ? 200 : 409).json(result);
    }, config));
    router.post('/queue', route(async (request, response, principal) => {
        const body = recordBody(request);
        const mode = body.mode === 'casual_1v1' ? 'casual_1v1' : body.mode === 'ranked_1v1' ? 'ranked_1v1' : null;
        if (!mode)
            throw new types_1.PvpPlatformError('UNSUPPORTED_MODE', 'mode must be ranked_1v1 or casual_1v1', 422);
        const join = {
            requestId: requiredString(body.requestId, 'requestId'),
            mode,
            // 身份、MMR、区域与规则最终值均由服务端确定；这里只做版本意图输入。
            region: optionalString(body.region) ?? 'auto',
            rulesetVersion: optionalString(body.rulesetVersion) ?? 'current',
            loadoutVersion: Number.isSafeInteger(body.loadoutVersion) && body.loadoutVersion >= 0
                ? body.loadoutVersion
                : 0,
        };
        response.status(201).json({ ok: true, ...await platform.joinQueue(principal, join) });
    }, config));
    router.get('/queue/:ticketId', route((request, response, principal) => {
        response.json({ ok: true, ...platform.queueStatus(principal, requiredString(request.params.ticketId, 'ticketId')) });
    }, config));
    router.delete('/queue/:ticketId', route((request, response, principal) => {
        const body = recordBody(request);
        response.json({
            ok: true,
            ...platform.cancelQueue(principal, requiredString(request.params.ticketId, 'ticketId'), requiredString(body.requestId, 'requestId')),
        });
    }, config));
    router.post('/proposals/:proposalId/accept', route(async (request, response, principal) => {
        const body = recordBody(request);
        response.json({
            ok: true,
            ...await platform.acceptProposal(principal, requiredString(request.params.proposalId, 'proposalId'), requiredString(body.requestId, 'requestId')),
        });
    }, config));
    router.post('/matches/:matchId/pressure', route((request, response, principal) => {
        const body = recordBody(request);
        const result = platform.sendPressure(principal, requiredString(request.params.matchId, 'matchId'), requiredString(body.requestId, 'requestId'));
        response.status(result.ok ? 200 : 409).json({ ...result });
    }, config));
    router.post('/matches/:matchId/recruit', route((request, response, principal) => {
        const body = recordBody(request);
        const result = platform.recruit(principal, requiredString(request.params.matchId, 'matchId'), {
            requestId: requiredString(body.requestId, 'requestId'),
            expectedTrayRevision: requiredInteger(body.expectedTrayRevision, 'expectedTrayRevision'),
        });
        response.status(result.ok ? 200 : 409).json(result);
    }, config));
    router.post('/matches/:matchId/deploy', route((request, response, principal) => {
        const body = recordBody(request);
        const result = platform.deploy(principal, requiredString(request.params.matchId, 'matchId'), {
            requestId: requiredString(body.requestId, 'requestId'), unitId: requiredString(body.unitId, 'unitId'),
            x: requiredInteger(body.x, 'x'), y: requiredInteger(body.y, 'y'),
            expectedTrayRevision: requiredInteger(body.expectedTrayRevision, 'expectedTrayRevision'),
            expectedBoardRevision: requiredInteger(body.expectedBoardRevision, 'expectedBoardRevision'),
        });
        response.status(result.ok ? 200 : 409).json(result);
    }, config));
    router.post('/matches/:matchId/move-or-merge', route((request, response, principal) => {
        const body = recordBody(request);
        const result = platform.moveOrMerge(principal, requiredString(request.params.matchId, 'matchId'), {
            requestId: requiredString(body.requestId, 'requestId'), entityId: requiredString(body.entityId, 'entityId'),
            x: requiredInteger(body.x, 'x'), y: requiredInteger(body.y, 'y'),
            expectedBoardRevision: requiredInteger(body.expectedBoardRevision, 'expectedBoardRevision'),
        });
        response.status(result.ok ? 200 : 409).json(result);
    }, config));
    router.post('/matches/:matchId/surrender', route(async (request, response, principal) => {
        const body = recordBody(request);
        const result = await platform.surrender(principal, requiredString(request.params.matchId, 'matchId'), requiredString(body.requestId, 'requestId'));
        response.status(result.ok ? 200 : 409).json({ ...result });
    }, config));
    router.get('/rooms', route(async (_request, response) => {
        response.json({ ok: true, rooms: await platform.listRooms() });
    }, config));
    router.post('/rooms', route((request, response, principal) => {
        const body = recordBody(request);
        const room = platform.createRoom(principal, {
            requestId: optionalString(body.requestId) ?? undefined,
            roomName: requiredString(body.roomName, 'roomName'),
            password: optionalString(body.password),
            spectatorsAllowed: body.spectatorsAllowed === true,
        });
        response.status(201).json({ ok: true, room });
    }, config));
    router.get('/rooms/:roomId', route((request, response) => {
        response.json({ ok: true, room: platform.getRoom(requiredString(request.params.roomId, 'roomId')) });
    }, config));
    router.post('/rooms/:roomId/join', route(async (request, response, principal) => {
        const body = recordBody(request);
        const room = await platform.joinRoom(principal, requiredString(request.params.roomId, 'roomId'), optionalString(body.password) ?? '');
        response.json({ ok: true, room });
    }, config));
    router.post('/rooms/:roomId/ready', route(async (request, response, principal) => {
        const body = recordBody(request);
        if (typeof body.ready !== 'boolean')
            throw new types_1.PvpPlatformError('BAD_PAYLOAD', 'ready must be boolean', 400);
        const room = await platform.setRoomReady(principal, requiredString(request.params.roomId, 'roomId'), body.ready);
        response.json({ ok: true, room });
    }, config));
    return router;
}
