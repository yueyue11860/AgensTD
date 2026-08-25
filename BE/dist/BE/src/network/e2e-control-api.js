"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isE2eControlAvailable = isE2eControlAvailable;
exports.createE2eControlRouter = createE2eControlRouter;
const express_1 = require("express");
const gateway_auth_1 = require("./gateway-auth");
function isE2eControlAvailable(config, nodeEnv = process.env.NODE_ENV) {
    return nodeEnv !== 'production' && config.pveE2eEnabled;
}
function createE2eControlRouter(config, gateway) {
    const router = (0, express_1.Router)();
    const principal = (request) => ((0, gateway_auth_1.authenticateGatewayToken)(config, (0, gateway_auth_1.extractHttpToken)(request)));
    router.post('/host-loop', (request, response) => {
        if (!isE2eControlAvailable(config)) {
            response.status(404).json({ ok: false, code: 'NOT_FOUND' });
            return;
        }
        const identity = principal(request);
        if (!identity) {
            response.status(401).json({ ok: false, code: 'UNAUTHORIZED' });
            return;
        }
        const roomId = typeof request.body?.roomId === 'string' ? request.body.roomId : '';
        const intervalMs = typeof request.body?.intervalMs === 'number' ? request.body.intervalMs : Number.NaN;
        const result = gateway.setE2eHostLoopInterval(roomId, identity.playerId, intervalMs);
        if (!result.ok) {
            const status = result.code === 'ROOM_NOT_FOUND' ? 404 : result.code === 'ROOM_ACCESS_DENIED' ? 403 : 400;
            response.status(status).json(result);
            return;
        }
        response.json(result);
    });
    router.get('/renderer-stress', (request, response) => {
        if (!isE2eControlAvailable(config))
            return response.status(404).json({ ok: false, code: 'NOT_FOUND' });
        const identity = principal(request);
        if (!identity)
            return response.status(401).json({ ok: false, code: 'UNAUTHORIZED' });
        response.json({ ok: true, roomId: 'E2E-RENDERER-STRESS', writesAccount: false, createsSettlement: false });
    });
    router.get('/rooms/:roomId/state', (request, response) => {
        if (!isE2eControlAvailable(config))
            return response.status(404).json({ ok: false, code: 'NOT_FOUND' });
        const identity = principal(request);
        if (!identity)
            return response.status(401).json({ ok: false, code: 'UNAUTHORIZED' });
        const state = gateway.getE2eAuthoritativeState(request.params.roomId, identity.playerId);
        if (!state)
            return response.status(404).json({ ok: false, code: 'ROOM_NOT_FOUND' });
        response.json({ ok: true, state });
    });
    router.post('/rooms/:roomId/actions', async (request, response) => {
        if (!isE2eControlAvailable(config))
            return response.status(404).json({ ok: false, code: 'NOT_FOUND' });
        const identity = principal(request);
        if (!identity)
            return response.status(401).json({ ok: false, code: 'UNAUTHORIZED' });
        const result = await gateway.submitE2eAction(request.params.roomId, identity, request.body);
        response.status(result.status).json(result);
    });
    return router;
}
