"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMatchmakingV1SmokeChecks = runMatchmakingV1SmokeChecks;
const strict_1 = __importDefault(require("node:assert/strict"));
const service_1 = require("./service");
class FakeClock {
    value = 1_000_000;
    now() {
        return this.value;
    }
    advance(ms) {
        this.value += ms;
    }
}
class FakeIds {
    ticket = 0;
    proposal = 0;
    match = 0;
    nextTicketId = () => `ticket-${++this.ticket}`;
    nextProposalId = () => `proposal-${++this.proposal}`;
    nextMatchId = () => `match-${++this.match}`;
}
const request = (requestId) => ({
    requestId,
    mode: 'ranked_1v1',
    region: 'cn-east',
    rulesetVersion: 'rules-v1',
    loadoutVersion: 1,
});
const principal = (playerId) => ({ kind: 'human', playerId, playerName: playerId });
function join(service, playerId, rating, options) {
    return service.join({
        principal: principal(playerId),
        request: request(options?.requestId ?? `join-${playerId}`),
        profile: {
            rating,
            isPlacement: options?.isPlacement ?? false,
            leaderboardRank: options?.rank ?? null,
            recentOpponentIds: options?.recent ?? [],
        },
    });
}
function validateConfirmation() {
    const clock = new FakeClock();
    const service = new service_1.InMemoryPvpMatchmakingService(clock, new FakeIds());
    strict_1.default.equal(join(service, 'alpha', 1500).ok, true);
    strict_1.default.equal(join(service, 'beta', 1540).ok, true);
    const proposal = service.snapshot().proposals[0];
    strict_1.default.ok(proposal);
    strict_1.default.equal(proposal.confirmDeadlineAt, clock.now() + 10_000);
    strict_1.default.deepEqual(new Set(proposal.players.map((player) => player.playerId)), new Set(['alpha', 'beta']));
    strict_1.default.equal(Object.prototype.hasOwnProperty.call(proposal.players[0], 'rating'), false);
    const alphaTicket = service.getTicket(proposal.players.find((player) => player.playerId === 'alpha').ticketId);
    strict_1.default.equal(Object.prototype.hasOwnProperty.call(alphaTicket, 'rating'), false);
    strict_1.default.equal(Object.prototype.hasOwnProperty.call(alphaTicket, 'recentOpponentIds'), false);
    const acceptedOne = service.accept('alpha', proposal.proposalId, 'accept-alpha');
    strict_1.default.equal(acceptedOne.code, 'MATCH_ACCEPT_RECORDED');
    const replay = service.accept('alpha', proposal.proposalId, 'accept-alpha');
    strict_1.default.equal(replay.duplicate, true);
    const acceptedBoth = service.accept('beta', proposal.proposalId, 'accept-beta');
    strict_1.default.equal(acceptedBoth.code, 'MATCH_ACCEPTED');
    strict_1.default.equal(service.snapshot().acceptedMatches.length, 1);
    strict_1.default.deepEqual(service.snapshot().acceptedMatches[0]?.players.map((player) => player.side), ['A', 'B']);
    strict_1.default.deepEqual(service.snapshot().acceptedMatches[0]?.players.map((player) => player.loadoutVersion), [1, 1]);
}
function validateRatingExpansionAndPlacementProtection() {
    const clock = new FakeClock();
    const service = new service_1.InMemoryPvpMatchmakingService(clock, new FakeIds());
    join(service, 'low', 1500);
    join(service, 'high', 1750);
    strict_1.default.equal(service.snapshot().proposals.length, 0);
    clock.advance(30_000);
    service.advance();
    strict_1.default.equal(service.snapshot().proposals.length, 1);
    const protectedClock = new FakeClock();
    const protectedService = new service_1.InMemoryPvpMatchmakingService(protectedClock, new FakeIds());
    join(protectedService, 'placement', 1500, { isPlacement: true });
    join(protectedService, 'top-200', 1500, { rank: 100 });
    protectedClock.advance(100_000);
    protectedService.advance();
    strict_1.default.equal(protectedService.snapshot().proposals.length, 0);
}
function validateTimeoutPriorityAndHumanBoundary() {
    const clock = new FakeClock();
    const service = new service_1.InMemoryPvpMatchmakingService(clock, new FakeIds());
    join(service, 'confirmed', 1500);
    join(service, 'ignored', 1500);
    const proposal = service.snapshot().proposals[0];
    service.accept('confirmed', proposal.proposalId, 'accept-confirmed');
    clock.advance(10_000);
    service.advance();
    strict_1.default.equal(service.getTicket(proposal.players.find((player) => player.playerId === 'confirmed').ticketId)?.state, 'searching');
    strict_1.default.equal(service.getTicket(proposal.players.find((player) => player.playerId === 'confirmed').ticketId)?.priorityReturn, true);
    strict_1.default.equal(service.getTicket(proposal.players.find((player) => player.playerId === 'ignored').ticketId)?.state, 'expired');
    strict_1.default.equal(service.getPlayerCooldownUntil('ignored'), 0);
    const forged = service.join({
        principal: { kind: 'agent', playerId: 'agent', playerName: 'agent' },
        request: request('agent-join'),
        profile: { rating: 1500, isPlacement: false, leaderboardRank: null, recentOpponentIds: [] },
    });
    strict_1.default.equal(forged.code, 'HUMAN_ACCOUNT_REQUIRED');
    const cancelClock = new FakeClock();
    const cancelService = new service_1.InMemoryPvpMatchmakingService(cancelClock, new FakeIds());
    join(cancelService, 'canceller', 1500);
    join(cancelService, 'innocent', 1500);
    const cancelProposal = cancelService.snapshot().proposals[0];
    const cancellerTicket = cancelProposal.players.find((player) => player.playerId === 'canceller').ticketId;
    const innocentTicket = cancelProposal.players.find((player) => player.playerId === 'innocent').ticketId;
    strict_1.default.equal(cancelService.cancel('canceller', cancellerTicket, 'cancel-found').ok, true);
    strict_1.default.equal(cancelService.getTicket(cancellerTicket)?.state, 'cancelled');
    strict_1.default.equal(cancelService.getTicket(innocentTicket)?.state, 'searching');
    strict_1.default.equal(cancelService.getTicket(innocentTicket)?.priorityReturn, true);
}
function runMatchmakingV1SmokeChecks() {
    validateConfirmation();
    validateRatingExpansionAndPlacementProtection();
    validateTimeoutPriorityAndHumanBoundary();
}
if (require.main === module) {
    runMatchmakingV1SmokeChecks();
    console.log('matchmaking-v1 smoke checks passed');
}
