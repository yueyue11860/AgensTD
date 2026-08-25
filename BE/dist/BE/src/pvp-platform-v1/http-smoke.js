"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_http_1 = __importDefault(require("node:http"));
const express_1 = __importDefault(require("express"));
const server_config_1 = require("../config/server-config");
const memory_pvp_store_1 = require("../data/memory-pvp-store");
const pvp_rest_api_1 = require("../network/pvp-rest-api");
const service_1 = require("./service");
async function main() {
    const platform = new service_1.PvpPlatformService({ store: new memory_pvp_store_1.MemoryPvpStore(), autoTick: false });
    await platform.ready;
    const config = {
        ...(0, server_config_1.createServerConfig)(),
        authRequired: true,
        authTokens: [
            { token: 'alice-token', playerId: 'alice-http', playerName: 'Alice HTTP', playerKind: 'human' },
            { token: 'bob-token', playerId: 'bob-http', playerName: 'Bob HTTP', playerKind: 'human' },
            { token: 'agent-token', playerId: 'agent-http', playerName: 'Agent HTTP', playerKind: 'agent' },
        ],
    };
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use('/api/pvp', (0, pvp_rest_api_1.createPvpRestApiRouter)(config, platform));
    const server = node_http_1.default.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    strict_1.default.ok(address && typeof address !== 'string');
    const root = `http://127.0.0.1:${address.port}/api/pvp`;
    const call = async (path, token, init = {}) => {
        const headers = new Headers(init.headers);
        headers.set('Authorization', `Bearer ${token}`);
        if (init.body)
            headers.set('Content-Type', 'application/json');
        const response = await fetch(`${root}${path}`, { ...init, headers });
        return { status: response.status, body: await response.json() };
    };
    try {
        const rejectedAgent = await call('/profile', 'agent-token');
        strict_1.default.equal(rejectedAgent.status, 403);
        strict_1.default.equal(rejectedAgent.body.code, 'HUMAN_ACCOUNT_REQUIRED');
        const join = (token, requestId, forgedPlayerId) => call('/queue', token, {
            method: 'POST',
            body: JSON.stringify({
                requestId,
                playerId: forgedPlayerId,
                playerName: 'forged',
                rating: 99999,
                mode: 'ranked_1v1',
                region: 'forged',
                rulesetVersion: 'current',
                loadoutVersion: 0,
            }),
        });
        const aliceJoin = await join('alice-token', 'http-queue-alice', 'bob-http');
        strict_1.default.equal(aliceJoin.status, 201);
        strict_1.default.equal(aliceJoin.body.ticket?.playerId, 'alice-http');
        strict_1.default.equal(aliceJoin.body.ticket?.region, 'auto');
        const bobJoin = await join('bob-token', 'http-queue-bob', 'alice-http');
        strict_1.default.equal(bobJoin.status, 201);
        const proposal = bobJoin.body.proposal;
        strict_1.default.ok(proposal);
        const accept = (token, requestId) => call(`/proposals/${proposal.proposalId}/accept`, token, {
            method: 'POST', body: JSON.stringify({ requestId, playerId: 'forged-player' }),
        });
        strict_1.default.equal((await accept('alice-token', 'http-accept-alice')).body.match, null);
        const accepted = await accept('bob-token', 'http-accept-bob');
        const matchId = accepted.body.match?.matchId;
        strict_1.default.ok(matchId);
        strict_1.default.equal((await call(`/matches/${matchId}/state`, 'alice-token')).body.state?.phase, 'countdown');
        for (let tick = 0; tick < 50; tick += 1)
            platform.tick();
        strict_1.default.equal((await call(`/matches/${matchId}/state`, 'alice-token')).body.state?.phase, 'playing');
        const surrendered = await call(`/matches/${matchId}/surrender`, 'bob-token', {
            method: 'POST', body: JSON.stringify({ requestId: 'http-surrender', playerId: 'alice-http' }),
        });
        strict_1.default.equal(surrendered.status, 200);
        const history = await call('/matches?limit=20', 'alice-token');
        strict_1.default.equal(history.status, 200);
        strict_1.default.equal(history.body.matches?.length, 1);
        const previousNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            const productionStaticToken = await call('/profile', 'alice-token');
            strict_1.default.equal(productionStaticToken.status, 401);
            strict_1.default.equal(productionStaticToken.body.code, 'OAUTH_SESSION_REQUIRED');
        }
        finally {
            if (previousNodeEnv === undefined)
                delete process.env.NODE_ENV;
            else
                process.env.NODE_ENV = previousNodeEnv;
        }
        console.log('pvp-platform-v1 HTTP smoke passed');
    }
    finally {
        platform.shutdown();
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
}
void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
