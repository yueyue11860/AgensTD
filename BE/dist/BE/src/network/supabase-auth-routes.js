"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSupabaseAuthRouter = createSupabaseAuthRouter;
const express_1 = require("express");
const gateway_auth_1 = require("./gateway-auth");
function createSupabaseAuthRouter(config, userStore) {
    const router = (0, express_1.Router)();
    router.get('/auth/me', async (request, response) => {
        const principal = await (0, gateway_auth_1.authenticateGatewayTokenAsync)({ ...config, authRequired: true }, (0, gateway_auth_1.extractHttpToken)(request));
        const acceptedAuthSource = principal?.authSource === 'supabase'
            || (process.env.NODE_ENV !== 'production' && principal?.authSource === 'static');
        if (!principal || principal.playerKind !== 'human' || !acceptedAuthSource) {
            response.status(401).json({ ok: false, code: 'UNAUTHORIZED', message: 'Missing or invalid access token' });
            return;
        }
        const user = {
            userId: principal.playerId,
            name: principal.playerName,
            email: principal.authSource === 'supabase' ? principal.email ?? '' : '',
            avatar: principal.authSource === 'supabase' ? principal.avatar ?? '' : '',
            bio: '',
            route: '',
        };
        if (principal.authSource === 'supabase') {
            await userStore.upsertUser(user);
            await userStore.getOrCreateProgress(user.userId, 'HUMAN');
        }
        response.json({ ok: true, user });
    });
    return router;
}
