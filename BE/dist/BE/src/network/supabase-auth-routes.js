"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSupabaseAuthRouter = createSupabaseAuthRouter;
const express_1 = require("express");
const gateway_auth_1 = require("./gateway-auth");
function createSupabaseAuthRouter(config, userStore) {
    const router = (0, express_1.Router)();
    router.get('/auth/me', async (request, response) => {
        const principal = await (0, gateway_auth_1.authenticateGatewayTokenAsync)({ ...config, authRequired: true }, (0, gateway_auth_1.extractHttpToken)(request));
        if (!principal || principal.playerKind !== 'human' || principal.authSource !== 'supabase') {
            response.status(401).json({ ok: false, code: 'UNAUTHORIZED', message: 'Missing or invalid Supabase access token' });
            return;
        }
        const user = {
            userId: principal.playerId,
            name: principal.playerName,
            email: principal.email ?? '',
            avatar: principal.avatar ?? '',
            bio: '',
            route: '',
        };
        await userStore.upsertUser(user);
        await userStore.getOrCreateProgress(user.userId, 'HUMAN');
        response.json({ ok: true, user });
    });
    return router;
}
