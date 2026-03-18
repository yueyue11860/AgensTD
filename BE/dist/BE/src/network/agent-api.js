"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAgentApiRouter = createAgentApiRouter;
const express_1 = require("express");
const competition_projection_1 = require("../core/competition-projection");
const gateway_auth_1 = require("./gateway-auth");
function resolveAgentPrincipal(request, config) {
    const principal = (0, gateway_auth_1.authenticateGatewayToken)(config, (0, gateway_auth_1.extractHttpToken)(request));
    if (!principal || principal.playerKind !== 'agent') {
        return null;
    }
    return principal;
}
function rejectAgentUnauthorized(response) {
    response.status(403).json({ ok: false, code: 'FORBIDDEN', message: 'Agent token required' });
}
function logCompetitionStoreFailure(operation, error) {
    const details = error instanceof Error ? error.message : String(error);
    console.error(`Competition store ${operation} failed for agent API; falling back to memory: ${details}`);
}
function createAgentApiRouter(projectedTickStream, config, replayRecorder, competitionStore, telemetry) {
    const router = (0, express_1.Router)();
    const sseConnections = new Set();
    router.get('/stream', (request, response) => {
        const principal = resolveAgentPrincipal(request, config);
        if (!principal) {
            rejectAgentUnauthorized(response);
            return;
        }
        response.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
        writeSseEvent(telemetry, 'agent.sse.ready', response, 'ready', {
            ok: true,
            playerId: principal.playerId,
            playerKind: principal.playerKind,
        });
        sseConnections.add(response);
        telemetry.setGauge('agent.sse.connections', sseConnections.size);
        writeSseEvent(telemetry, 'agent.sse.tick_update.full', response, 'tick_update', {
            mode: 'full',
            gameState: projectedTickStream.getCurrentFullState(),
        });
        const unsubscribe = projectedTickStream.subscribeBroadcast((event) => {
            if (!event.broadcast) {
                return;
            }
            writeSseEvent(telemetry, 'agent.sse.tick_update.patch', response, 'tick_update', {
                mode: 'patch',
                patch: event.broadcast.patch,
            });
            if (Object.keys(event.broadcast.uiUpdate).length > 0) {
                writeSseEvent(telemetry, 'agent.sse.ui_state_update', response, 'ui_state_update', event.broadcast.uiUpdate);
            }
            if (event.broadcast.noticeUpdate) {
                writeSseEvent(telemetry, 'agent.sse.notice_update', response, 'notice_update', event.broadcast.noticeUpdate);
            }
        });
        const heartbeat = setInterval(() => {
            writeSseEvent(telemetry, 'agent.sse.heartbeat', response, 'heartbeat', {
                now: new Date().toISOString(),
            });
        }, 15000);
        request.on('close', () => {
            clearInterval(heartbeat);
            unsubscribe();
            sseConnections.delete(response);
            telemetry.setGauge('agent.sse.connections', sseConnections.size);
            response.end();
        });
    });
    router.get('/replays/current', (request, response) => {
        const principal = resolveAgentPrincipal(request, config);
        if (!principal) {
            rejectAgentUnauthorized(response);
            return;
        }
        const replay = replayRecorder.getCurrentReplay();
        if (!replay) {
            response.status(404).json({ ok: false, code: 'REPLAY_NOT_FOUND', message: 'No replay available yet' });
            return;
        }
        response.json({
            ok: true,
            replay,
        });
    });
    router.get('/replays', async (request, response) => {
        const principal = resolveAgentPrincipal(request, config);
        if (!principal) {
            rejectAgentUnauthorized(response);
            return;
        }
        let persistedReplays = [];
        if (competitionStore?.isEnabled()) {
            try {
                persistedReplays = await competitionStore.listRecentReplays(20);
            }
            catch (error) {
                logCompetitionStoreFailure('listRecentReplays', error);
            }
        }
        if (persistedReplays.length > 0) {
            response.json({ ok: true, replays: persistedReplays });
            return;
        }
        const currentReplay = replayRecorder.getCurrentReplay();
        response.json({
            ok: true,
            replays: currentReplay ? [(0, competition_projection_1.buildReplaySummary)(currentReplay)] : [],
        });
    });
    router.get('/replays/:matchId', async (request, response) => {
        const principal = resolveAgentPrincipal(request, config);
        if (!principal) {
            rejectAgentUnauthorized(response);
            return;
        }
        const currentReplay = replayRecorder.getCurrentReplay();
        if (currentReplay?.matchId === request.params.matchId) {
            response.json({ ok: true, replay: currentReplay });
            return;
        }
        let persistedReplay = null;
        if (competitionStore?.isEnabled()) {
            try {
                persistedReplay = await competitionStore.getReplay(request.params.matchId);
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
    return router;
}
function writeSseEvent(telemetry, metricName, response, eventName, payload) {
    response.write(`event: ${eventName}\n`);
    response.write(`data: ${JSON.stringify(payload)}\n\n`);
    const payloadBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    telemetry.incrementCounter(`${metricName}.messages`, 1);
    telemetry.incrementCounter(`${metricName}.bytes`, payloadBytes);
    telemetry.setGauge(`${metricName}.lastPayloadBytes`, payloadBytes);
}
