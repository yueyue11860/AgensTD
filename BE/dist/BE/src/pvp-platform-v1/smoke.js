"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const memory_pvp_store_1 = require("../data/memory-pvp-store");
const service_1 = require("./service");
function human(playerId) {
    return {
        token: `token-${playerId}`,
        playerId,
        playerName: playerId.toUpperCase(),
        playerKind: 'human',
    };
}
async function main() {
    const platform = new service_1.PvpPlatformService({ store: new memory_pvp_store_1.MemoryPvpStore(), autoTick: false });
    const alice = human('alice');
    const bob = human('bob');
    const outsider = human('outsider');
    try {
        await platform.ready;
        const season = await platform.currentSeason();
        strict_1.default.equal(season.rulesetVersion, 'pvp_rules_v1');
        strict_1.default.deepEqual(season.mapIds, ['pvp_dual_realm_v1']);
        strict_1.default.equal((await platform.profile(alice)).playerId, 'alice');
        const aliceQueue = await platform.joinQueue(alice, {
            requestId: 'queue-alice', mode: 'ranked_1v1', region: 'forged-region', rulesetVersion: 'current', loadoutVersion: 0,
        });
        const bobQueue = await platform.joinQueue(bob, {
            requestId: 'queue-bob', mode: 'ranked_1v1', region: 'forged-region', rulesetVersion: 'pvp_rules_v1', loadoutVersion: 0,
        });
        strict_1.default.equal(aliceQueue.ticket.playerId, 'alice');
        strict_1.default.equal(aliceQueue.ticket.region, 'auto');
        const proposal = bobQueue.proposal;
        strict_1.default.ok(proposal);
        strict_1.default.deepEqual(new Set(proposal.players.map(player => player.playerId)), new Set(['alice', 'bob']));
        const aliceAccepted = await platform.acceptProposal(alice, proposal.proposalId, 'accept-alice');
        strict_1.default.equal(aliceAccepted.match, null);
        const bobAccepted = await platform.acceptProposal(bob, proposal.proposalId, 'accept-bob');
        strict_1.default.ok(bobAccepted.match);
        const matchId = bobAccepted.match.matchId;
        strict_1.default.equal(platform.matchState(alice, matchId).phase, 'countdown');
        strict_1.default.throws(() => platform.matchState(outsider, matchId), /participants|MATCH_ACCESS_DENIED|参与者/);
        for (let tick = 0; tick < 49; tick += 1)
            platform.tick();
        strict_1.default.equal(platform.matchState(alice, matchId).phase, 'countdown');
        platform.tick();
        const playing = platform.matchState(alice, matchId);
        strict_1.default.equal(playing.phase, 'playing');
        strict_1.default.equal(playing.round.number, 1);
        strict_1.default.equal(playing.sides.A?.rations, 15);
        strict_1.default.equal(platform.sendPressure(alice, matchId, 'pressure-too-early').code, 'INSUFFICIENT_SCRIPTURE');
        let killed = 0;
        for (let attempts = 0; attempts < 400 && killed < 5; attempts += 1) {
            platform.tick();
            const target = platform.matchState(alice, matchId).sides.A?.enemies.find(enemy => !enemy.spawnProtected);
            if (!target)
                continue;
            const damage = platform.applyAuthoritativeDamage(matchId, {
                eventId: `trusted-damage-${killed}`,
                sourcePlayerId: alice.playerId,
                enemyId: target.enemyId,
                rawDamage: 1_000_000,
                resolvedDamage: 1_000_000,
            });
            strict_1.default.equal(damage.ok, true);
            killed += 1;
        }
        strict_1.default.equal(killed, 5);
        strict_1.default.equal(platform.sendPressure(alice, matchId, 'pressure-success').code, 'PRESSURE_QUEUED');
        const surrender = await platform.surrender(bob, matchId, 'surrender-bob');
        strict_1.default.equal(surrender.ok, true);
        strict_1.default.equal(platform.matchState(alice, matchId).phase, 'completed');
        const detail = await platform.matchDetail(alice, matchId);
        strict_1.default.equal(detail.match.endReason, 'surrendered');
        const history = await platform.history(alice, 20);
        strict_1.default.equal(history.entries.length, 1);
        strict_1.default.equal(history.entries[0]?.self.outcome, 'win');
        const aliceProfile = await platform.profile(alice);
        strict_1.default.equal(aliceProfile.rating.games, 1);
        strict_1.default.equal(aliceProfile.rating.wins, 1);
        const room = platform.createRoom(alice, { roomName: '真人约战', password: 'secret', spectatorsAllowed: true });
        await strict_1.default.rejects(() => platform.joinRoom(bob, room.roomId, 'wrong'), /WRONG_PASSWORD|密码/);
        const joined = await platform.joinRoom(bob, room.roomId, 'secret');
        strict_1.default.equal(joined.playerCount, 2);
        await platform.setRoomReady(alice, room.roomId, true);
        const readyRoom = await platform.setRoomReady(bob, room.roomId, true);
        strict_1.default.ok(readyRoom.matchId);
        strict_1.default.equal(platform.matchState(alice, readyRoom.matchId).phase, 'countdown');
        console.log('pvp-platform-v1 smoke passed');
    }
    finally {
        platform.shutdown();
    }
}
void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
