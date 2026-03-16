"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAgentApiRouter = createAgentApiRouter;
const express_1 = require("express");
const competition_projection_1 = require("../core/competition-projection");
const state_projection_1 = require("../core/state-projection");
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
function createAgentApiRouter(engine, config, replayRecorder, competitionStore) {
    const router = (0, express_1.Router)();
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
        response.write(`event: ready\n`);
        response.write(`data: ${JSON.stringify({ ok: true, playerId: principal.playerId, playerKind: principal.playerKind })}\n\n`);
        const initialState = (0, state_projection_1.projectFrontendGameState)(engine.getStateSnapshot(), config);
        let lastStreamState = initialState;
        response.write(`event: tick_update\n`);
        response.write(`data: ${JSON.stringify({ mode: 'full', gameState: initialState })}\n\n`);
        const unsubscribe = engine.onTick((state) => {
            const uiUpdate = (0, state_projection_1.projectFrontendUiStateUpdate)(state, config, lastStreamState);
            const patch = (0, state_projection_1.projectFrontendGameStatePatch)(state, config, lastStreamState);
            lastStreamState = mergeFrontendUiStateUpdate(mergeFrontendGameStatePatch(lastStreamState, patch), uiUpdate);
            response.write(`event: tick_update\n`);
            response.write(`data: ${JSON.stringify({ mode: 'patch', patch })}\n\n`);
            if (Object.keys(uiUpdate).length > 0) {
                response.write(`event: ui_state_update\n`);
                response.write(`data: ${JSON.stringify(uiUpdate)}\n\n`);
            }
        });
        const heartbeat = setInterval(() => {
            response.write(`event: heartbeat\n`);
            response.write(`data: ${JSON.stringify({ now: new Date().toISOString() })}\n\n`);
        }, 15000);
        request.on('close', () => {
            clearInterval(heartbeat);
            unsubscribe();
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
function mergeFrontendGameStatePatch(previousState, patch) {
    if (!previousState) {
        return null;
    }
    return {
        ...previousState,
        ...patch,
        towers: patch.towers ?? applyEntityDelta(previousState.towers, patch.towerDelta),
        enemies: patch.enemies ?? applyEntityDelta(previousState.enemies, patch.enemyDelta),
        map: patch.map ?? previousState.map,
        notices: patch.notices ?? previousState.notices,
    };
}
function mergeFrontendUiStateUpdate(previousState, update) {
    if (!previousState) {
        return null;
    }
    return {
        ...previousState,
        buildPalette: update.buildPalette ?? previousState.buildPalette,
        actionBar: update.actionBar ?? previousState.actionBar,
    };
}
function applyEntityDelta(currentEntities, delta) {
    if (!delta) {
        return currentEntities;
    }
    const removeIds = new Set(delta.remove);
    const upsertById = new Map(delta.upsert.map((entity) => [entity.id, entity]));
    const nextEntities = [];
    for (const entity of currentEntities) {
        if (removeIds.has(entity.id)) {
            continue;
        }
        nextEntities.push(upsertById.get(entity.id) ?? entity);
        upsertById.delete(entity.id);
    }
    for (const entity of delta.upsert) {
        if (upsertById.has(entity.id)) {
            nextEntities.push(entity);
            upsertById.delete(entity.id);
        }
    }
    return nextEntities;
}
