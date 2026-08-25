import assert from 'node:assert/strict'
import type { PvpQueueJoinRequest } from '../../../shared/contracts/pvp'
import { InMemoryPvpMatchmakingService } from './service'
import type { HumanPvpPrincipal, MatchmakingClock, MatchmakingIdFactory } from './types'

class FakeClock implements MatchmakingClock {
  value = 1_000_000

  now(): number {
    return this.value
  }

  advance(ms: number): void {
    this.value += ms
  }
}

class FakeIds implements MatchmakingIdFactory {
  ticket = 0
  proposal = 0
  match = 0
  nextTicketId = () => `ticket-${++this.ticket}`
  nextProposalId = () => `proposal-${++this.proposal}`
  nextMatchId = () => `match-${++this.match}`
}

const request = (requestId: string): PvpQueueJoinRequest => ({
  requestId,
  mode: 'ranked_1v1',
  region: 'cn-east',
  rulesetVersion: 'rules-v1',
  loadoutVersion: 1,
})

const principal = (playerId: string): HumanPvpPrincipal => ({ kind: 'human', playerId, playerName: playerId })

function join(
  service: InMemoryPvpMatchmakingService,
  playerId: string,
  rating: number,
  options?: { requestId?: string, isPlacement?: boolean, rank?: number | null, recent?: string[] },
) {
  return service.join({
    principal: principal(playerId),
    request: request(options?.requestId ?? `join-${playerId}`),
    profile: {
      rating,
      isPlacement: options?.isPlacement ?? false,
      leaderboardRank: options?.rank ?? null,
      recentOpponentIds: options?.recent ?? [],
    },
  })
}

function validateConfirmation(): void {
  const clock = new FakeClock()
  const service = new InMemoryPvpMatchmakingService(clock, new FakeIds())
  assert.equal(join(service, 'alpha', 1500).ok, true)
  assert.equal(join(service, 'beta', 1540).ok, true)
  const proposal = service.snapshot().proposals[0]
  assert.ok(proposal)
  assert.equal(proposal.confirmDeadlineAt, clock.now() + 10_000)
  assert.deepEqual(new Set(proposal.players.map((player) => player.playerId)), new Set(['alpha', 'beta']))
  assert.equal(Object.prototype.hasOwnProperty.call(proposal.players[0], 'rating'), false)
  const alphaTicket = service.getTicket(proposal.players.find((player) => player.playerId === 'alpha')!.ticketId)!
  assert.equal(Object.prototype.hasOwnProperty.call(alphaTicket, 'rating'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(alphaTicket, 'recentOpponentIds'), false)

  const acceptedOne = service.accept('alpha', proposal.proposalId, 'accept-alpha')
  assert.equal(acceptedOne.code, 'MATCH_ACCEPT_RECORDED')
  const replay = service.accept('alpha', proposal.proposalId, 'accept-alpha')
  assert.equal(replay.duplicate, true)
  const acceptedBoth = service.accept('beta', proposal.proposalId, 'accept-beta')
  assert.equal(acceptedBoth.code, 'MATCH_ACCEPTED')
  assert.equal(service.snapshot().acceptedMatches.length, 1)
  assert.deepEqual(service.snapshot().acceptedMatches[0]?.players.map((player) => player.side), ['A', 'B'])
  assert.deepEqual(service.snapshot().acceptedMatches[0]?.players.map((player) => player.loadoutVersion), [1, 1])
}

function validateRatingExpansionAndPlacementProtection(): void {
  const clock = new FakeClock()
  const service = new InMemoryPvpMatchmakingService(clock, new FakeIds())
  join(service, 'low', 1500)
  join(service, 'high', 1750)
  assert.equal(service.snapshot().proposals.length, 0)
  clock.advance(30_000)
  service.advance()
  assert.equal(service.snapshot().proposals.length, 1)

  const protectedClock = new FakeClock()
  const protectedService = new InMemoryPvpMatchmakingService(protectedClock, new FakeIds())
  join(protectedService, 'placement', 1500, { isPlacement: true })
  join(protectedService, 'top-200', 1500, { rank: 100 })
  protectedClock.advance(100_000)
  protectedService.advance()
  assert.equal(protectedService.snapshot().proposals.length, 0)
}

function validateTimeoutPriorityAndHumanBoundary(): void {
  const clock = new FakeClock()
  const service = new InMemoryPvpMatchmakingService(clock, new FakeIds())
  join(service, 'confirmed', 1500)
  join(service, 'ignored', 1500)
  const proposal = service.snapshot().proposals[0]!
  service.accept('confirmed', proposal.proposalId, 'accept-confirmed')
  clock.advance(10_000)
  service.advance()
  assert.equal(service.getTicket(proposal.players.find((player) => player.playerId === 'confirmed')!.ticketId)?.state, 'searching')
  assert.equal(service.getTicket(proposal.players.find((player) => player.playerId === 'confirmed')!.ticketId)?.priorityReturn, true)
  assert.equal(service.getTicket(proposal.players.find((player) => player.playerId === 'ignored')!.ticketId)?.state, 'expired')
  assert.equal(service.getPlayerCooldownUntil('ignored'), 0)

  const forged = service.join({
    principal: { kind: 'agent', playerId: 'agent', playerName: 'agent' } as unknown as HumanPvpPrincipal,
    request: request('agent-join'),
    profile: { rating: 1500, isPlacement: false, leaderboardRank: null, recentOpponentIds: [] },
  })
  assert.equal(forged.code, 'HUMAN_ACCOUNT_REQUIRED')

  const cancelClock = new FakeClock()
  const cancelService = new InMemoryPvpMatchmakingService(cancelClock, new FakeIds())
  join(cancelService, 'canceller', 1500)
  join(cancelService, 'innocent', 1500)
  const cancelProposal = cancelService.snapshot().proposals[0]!
  const cancellerTicket = cancelProposal.players.find((player) => player.playerId === 'canceller')!.ticketId
  const innocentTicket = cancelProposal.players.find((player) => player.playerId === 'innocent')!.ticketId
  assert.equal(cancelService.cancel('canceller', cancellerTicket, 'cancel-found').ok, true)
  assert.equal(cancelService.getTicket(cancellerTicket)?.state, 'cancelled')
  assert.equal(cancelService.getTicket(innocentTicket)?.state, 'searching')
  assert.equal(cancelService.getTicket(innocentTicket)?.priorityReturn, true)
}

export function runMatchmakingV1SmokeChecks(): void {
  validateConfirmation()
  validateRatingExpansionAndPlacementProtection()
  validateTimeoutPriorityAndHumanBoundary()
}

if (require.main === module) {
  runMatchmakingV1SmokeChecks()
  console.log('matchmaking-v1 smoke checks passed')
}
