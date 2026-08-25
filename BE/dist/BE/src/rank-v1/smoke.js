"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const memory_pvp_store_1 = require("../data/memory-pvp-store");
const pvp_store_1 = require("../data/pvp-store");
const policy_1 = require("./policy");
const service_1 = require("./service");
const START = '2026-08-01T00:00:00.000Z';
const LOCK = '2026-09-01T00:00:00.000Z';
const END = '2026-09-02T00:00:00.000Z';
function mode(modeId, ranked, rewardScaleBps) {
    return {
        modeId, version: '1', name: modeId, teamSize: 1, ranked, rewardScaleBps,
        rulesetVersion: 'rules-1', mapPoolVersion: 'maps-1', enabled: true, createdAt: START, updatedAt: START,
    };
}
function season(modeId) {
    return {
        seasonId: `season-${modeId}`, modeId, modeVersion: '1', region: 'cn', name: `${modeId} S1`, status: 'active',
        startsAt: START, locksAt: LOCK, endsAt: END, rankPolicyVersion: policy_1.PVP_RANK_POLICY_VERSION,
        rewardPolicyVersion: 'reward-1', createdAt: START, updatedAt: START,
    };
}
const arena = {
    mapId: 'mirror-arena', version: '1', name: '镜像斗场', config: { width: 29, height: 29 }, checksum: 'map-sha',
    status: 'active', createdAt: START, updatedAt: START,
};
function matchInput(input) {
    const modeId = input.modeId ?? 'ranked_1v1';
    const left = input.left ?? 'alice';
    const right = input.right ?? 'bob';
    const endedAt = new Date(Date.parse(START) + (input.endedOffsetMinutes ?? 1) * 60_000).toISOString();
    return {
        requestId: input.requestId ?? `settle:${input.matchId}`,
        matchId: input.matchId,
        seasonId: `season-${modeId}`,
        modeId,
        modeVersion: '1',
        region: 'cn',
        mapId: arena.mapId,
        mapVersion: arena.version,
        rulesetVersion: 'rules-1',
        catalogVersion: 'catalog-1',
        effectSystemVersion: 'effects-1',
        seed: `seed:${input.matchId}`,
        winnerSide: input.winner === undefined ? 'A' : input.winner,
        endReason: input.endReason ?? 'core_destroyed',
        integrityStatus: input.integrityStatus ?? 'valid',
        startedAt: START,
        endedAt,
        participants: [
            { playerId: left, playerName: left.toUpperCase(), side: 'A', slot: 0, loadoutSnapshotId: `build:${left}`, stats: { kills: 10 }, reward: { gold: 10 } },
            { playerId: right, playerName: right.toUpperCase(), side: 'B', slot: 0, loadoutSnapshotId: `build:${right}`, stats: { kills: 8 }, reward: { gold: 5 } },
        ],
    };
}
async function main() {
    strict_1.default.equal(policy_1.PVP_INITIAL_RATING, 1500);
    strict_1.default.equal(policy_1.PVP_INITIAL_LEAGUE_POINTS, 0);
    strict_1.default.equal(policy_1.PVP_PLACEMENT_GAME_COUNT, 5);
    strict_1.default.deepEqual((0, policy_1.resolveVisibleRank)(299, 5), { tier: 'black_iron', division: 1 });
    strict_1.default.deepEqual((0, policy_1.resolveVisibleRank)(300, 5), { tier: 'bronze', division: 3 });
    strict_1.default.deepEqual((0, policy_1.resolveVisibleRank)(1499, 5), { tier: 'amethyst', division: 1 });
    strict_1.default.deepEqual((0, policy_1.resolveVisibleRank)(1500, 5), { tier: 'great_sage', division: null });
    const candidate = { ...(0, policy_1.createInitialPvpRating)({ seasonId: 's', modeId: 'ranked_1v1', playerId: 'p', at: START }), tier: 'great_sage', leaguePoints: 1800, provisionalGames: 5 };
    strict_1.default.equal((0, policy_1.projectLeaderboardRank)(candidate, 500).tier, 'victorious_fighting_buddha');
    strict_1.default.equal((0, policy_1.projectLeaderboardRank)(candidate, 501).tier, 'great_sage');
    const store = new memory_pvp_store_1.MemoryPvpStore();
    const service = new service_1.PvpRankService(store);
    for (const definition of [mode('ranked_1v1', true, 10_000), mode('casual_1v1', false, 5_000), mode('custom_1v1', false, 0)]) {
        await store.upsertMode(definition);
        await store.upsertSeason(season(definition.modeId));
    }
    strict_1.default.equal((await store.listModes(true)).length, 3);
    await store.upsertMap(arena);
    strict_1.default.equal((await store.listMaps('active')).length, 1);
    const ticket = {
        ticketId: 'ticket-1', requestId: 'queue-1', playerId: 'alice', seasonId: 'season-ranked_1v1', modeId: 'ranked_1v1',
        modeVersion: '1', region: 'cn', ratingSnapshot: 1500, state: 'searching', enqueuedAt: START,
        expiresAt: new Date(Date.parse(START) + 60_000).toISOString(), matchedMatchId: null, updatedAt: START,
    };
    strict_1.default.deepEqual(await store.createMatchmakingTicket(ticket), ticket);
    strict_1.default.deepEqual(await store.createMatchmakingTicket(ticket), ticket);
    await strict_1.default.rejects(() => store.createMatchmakingTicket({ ...ticket, ticketId: 'ticket-2', requestId: 'queue-2' }), pvp_store_1.PvpStoreError);
    strict_1.default.equal((await store.transitionMatchmakingTicket({ ticketId: ticket.ticketId, expectedState: 'searching', nextState: 'match_found', matchedMatchId: 'ranked-1', updatedAt: START }))?.state, 'match_found');
    strict_1.default.equal(await store.transitionMatchmakingTicket({ ticketId: ticket.ticketId, expectedState: 'searching', nextState: 'cancelled', updatedAt: START }), null);
    const firstInput = matchInput({ matchId: 'ranked-1', endedOffsetMinutes: 1 });
    const first = await service.settleMatch(firstInput);
    strict_1.default.equal(first.match.status, 'finished');
    strict_1.default.equal(first.match.settlementStatus, 'rating_committed_reward_pending');
    strict_1.default.deepEqual(first.participants.map(participant => participant.outcome), ['win', 'loss']);
    strict_1.default.ok(first.participants[0].ratingDelta > 0);
    strict_1.default.ok(first.participants[1].ratingDelta < 0);
    strict_1.default.ok(first.settlements.every(settlement => settlement.rewardStatus === 'pending'));
    const duplicate = await service.settleMatch({ ...firstInput, requestId: 'retry-with-new-transport-id' });
    strict_1.default.deepEqual(duplicate, first);
    strict_1.default.equal((await store.listRatingLedger('alice', 'season-ranked_1v1', 'ranked_1v1', 100)).length, 1);
    await strict_1.default.rejects(() => service.settleMatch(matchInput({ matchId: 'ranked-conflict', requestId: firstInput.requestId, endedOffsetMinutes: 2 })), pvp_store_1.PvpStoreError);
    for (let game = 2; game <= 5; game += 1) {
        await service.settleMatch(matchInput({ matchId: `ranked-${game}`, winner: game <= 3 ? 'A' : 'B', endedOffsetMinutes: game }));
    }
    const aliceAfterPlacement = await store.getRating('season-ranked_1v1', 'ranked_1v1', 'alice');
    strict_1.default.equal(aliceAfterPlacement?.games, 5);
    strict_1.default.equal(aliceAfterPlacement?.provisionalGames, 5);
    strict_1.default.notEqual(aliceAfterPlacement?.tier, 'unranked');
    strict_1.default.ok(aliceAfterPlacement?.division === null || [1, 2, 3].includes(aliceAfterPlacement.division));
    const pageOne = await store.getLeaderboard({ seasonId: 'season-ranked_1v1', modeId: 'ranked_1v1', limit: 1 });
    strict_1.default.equal(pageOne.entries.length, 1);
    strict_1.default.ok(pageOne.nextCursor);
    const pageTwo = await store.getLeaderboard({ seasonId: 'season-ranked_1v1', modeId: 'ranked_1v1', limit: 1, cursor: pageOne.nextCursor });
    strict_1.default.equal(pageTwo.entries.length, 1);
    strict_1.default.notEqual(pageOne.entries[0].playerId, pageTwo.entries[0].playerId);
    const historyOne = await store.listMatchHistory({ playerId: 'alice', limit: 2 });
    strict_1.default.equal(historyOne.entries.length, 2);
    strict_1.default.ok(historyOne.nextCursor);
    const historyTwo = await store.listMatchHistory({ playerId: 'alice', limit: 2, cursor: historyOne.nextCursor });
    strict_1.default.equal(historyTwo.entries.length, 2);
    strict_1.default.ok(historyOne.entries.every(entry => entry.self.playerId === 'alice' && entry.opponents.length === 1));
    const beforeNoContest = await store.getRating('season-ranked_1v1', 'ranked_1v1', 'alice');
    const noContest = await service.settleMatch(matchInput({
        matchId: 'ranked-void', winner: null, endReason: 'server_void', integrityStatus: 'invalid', endedOffsetMinutes: 6,
    }));
    strict_1.default.equal(noContest.match.status, 'no_contest');
    strict_1.default.equal(noContest.match.settlementStatus, 'committed');
    strict_1.default.ok(noContest.settlements.every(settlement => settlement.rewardStatus === 'not_applicable'));
    strict_1.default.deepEqual(await store.getRating('season-ranked_1v1', 'ranked_1v1', 'alice'), beforeNoContest);
    const casual = await service.settleMatch(matchInput({ matchId: 'casual-1', modeId: 'casual_1v1', left: 'casual-a', right: 'casual-b' }));
    strict_1.default.equal(casual.participants[0].ratingDelta, 0);
    strict_1.default.equal(casual.settlements[0].reward.rewardScaleBps, 5000);
    strict_1.default.equal(casual.match.settlementStatus, 'rating_committed_reward_pending');
    strict_1.default.equal(await store.getRating('season-casual_1v1', 'casual_1v1', 'casual-a'), null);
    strict_1.default.equal((await store.listRatingLedger('casual-a', 'season-casual_1v1', 'casual_1v1', 10)).length, 0);
    const custom = await service.settleMatch(matchInput({ matchId: 'custom-1', modeId: 'custom_1v1', left: 'custom-a', right: 'custom-b' }));
    strict_1.default.equal(custom.match.settlementStatus, 'committed');
    strict_1.default.ok(custom.settlements.every(settlement => settlement.rewardStatus === 'not_applicable'));
    strict_1.default.equal(await store.getRating('season-custom_1v1', 'custom_1v1', 'custom-a'), null);
    const claimed = await store.claimRewardOutbox('worker-1', 100, new Date(Date.parse(START) + 10 * 60_000).toISOString(), 30_000);
    strict_1.default.equal(claimed.length, 12);
    strict_1.default.ok(claimed.every(event => event.status === 'processing' && event.attempts === 1));
    for (const event of claimed)
        strict_1.default.equal(await store.completeRewardOutbox(event.eventId, 'worker-1', END), true);
    strict_1.default.equal((await store.getMatchDetail('ranked-1'))?.match.settlementStatus, 'committed');
    strict_1.default.equal(await store.completeRewardOutbox(claimed[0].eventId, 'worker-1', END), false);
    const manifest = {
        matchId: 'ranked-1', rulesetVersion: 'rules-1', catalogVersion: 'catalog-1', effectSystemVersion: 'effects-1',
        mapId: arena.mapId, mapVersion: arena.version, seed: 'seed:ranked-1', initialSnapshot: { tick: 0 }, initialSnapshotUri: null,
        actionCount: 0, chunkCount: 0, finalStateHash: null, visibility: 'participants', status: 'recording', createdAt: START, updatedAt: START,
    };
    strict_1.default.deepEqual(await service.createReplayManifest(manifest), manifest);
    const chunk = { matchId: 'ranked-1', chunkIndex: 0, firstTick: 0, lastTick: 100, payload: { actions: [] }, objectUri: null, sha256: 'chunk-sha', createdAt: START };
    await service.appendReplayChunk(chunk);
    await service.appendReplayChunk(chunk);
    await strict_1.default.rejects(() => service.appendReplayChunk({ ...chunk, chunkIndex: 2 }), pvp_store_1.PvpStoreError);
    const finalized = await store.finalizeReplay('ranked-1', 1, 12, 'final-sha', END);
    strict_1.default.equal(finalized.status, 'complete');
    strict_1.default.equal((await store.getReplay('ranked-1'))?.chunks.length, 1);
    console.log('rank-v1 smoke passed');
}
void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
