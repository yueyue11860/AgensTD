import assert from 'node:assert/strict'
import type {
  PvpMapCatalogEntry,
  PvpMatchmakingTicket,
  PvpModeDefinition,
  PvpModeId,
  PvpReplayManifest,
  PvpSeason,
} from '../../../shared/contracts/pvp-competition'
import { MemoryPvpStore } from '../data/memory-pvp-store'
import { PvpStoreError } from '../data/pvp-store'
import {
  createInitialPvpRating,
  PVP_INITIAL_LEAGUE_POINTS,
  PVP_INITIAL_RATING,
  PVP_PLACEMENT_GAME_COUNT,
  PVP_RANK_POLICY_VERSION,
  projectLeaderboardRank,
  resolveVisibleRank,
} from './policy'
import { PvpRankService, type SettlePvpMatchInput } from './service'

const START = '2026-08-01T00:00:00.000Z'
const LOCK = '2026-09-01T00:00:00.000Z'
const END = '2026-09-02T00:00:00.000Z'

function mode(modeId: PvpModeId, ranked: boolean, rewardScaleBps: number): PvpModeDefinition {
  return {
    modeId, version: '1', name: modeId, teamSize: 1, ranked, rewardScaleBps,
    rulesetVersion: 'rules-1', mapPoolVersion: 'maps-1', enabled: true, createdAt: START, updatedAt: START,
  }
}

function season(modeId: PvpModeId): PvpSeason {
  return {
    seasonId: `season-${modeId}`, modeId, modeVersion: '1', region: 'cn', name: `${modeId} S1`, status: 'active',
    startsAt: START, locksAt: LOCK, endsAt: END, rankPolicyVersion: PVP_RANK_POLICY_VERSION,
    rewardPolicyVersion: 'reward-1', createdAt: START, updatedAt: START,
  }
}

const arena: PvpMapCatalogEntry = {
  mapId: 'mirror-arena', version: '1', name: '镜像斗场', config: { width: 29, height: 29 }, checksum: 'map-sha',
  status: 'active', createdAt: START, updatedAt: START,
}

function matchInput(input: {
  matchId: string
  requestId?: string
  modeId?: PvpModeId
  left?: string
  right?: string
  winner?: 'A' | 'B' | null
  endReason?: SettlePvpMatchInput['endReason']
  integrityStatus?: SettlePvpMatchInput['integrityStatus']
  endedOffsetMinutes?: number
}): SettlePvpMatchInput {
  const modeId = input.modeId ?? 'ranked_1v1'
  const left = input.left ?? 'alice'
  const right = input.right ?? 'bob'
  const endedAt = new Date(Date.parse(START) + (input.endedOffsetMinutes ?? 1) * 60_000).toISOString()
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
  }
}

async function main(): Promise<void> {
  assert.equal(PVP_INITIAL_RATING, 1500)
  assert.equal(PVP_INITIAL_LEAGUE_POINTS, 0)
  assert.equal(PVP_PLACEMENT_GAME_COUNT, 5)
  assert.deepEqual(resolveVisibleRank(299, 5), { tier: 'black_iron', division: 1 })
  assert.deepEqual(resolveVisibleRank(300, 5), { tier: 'bronze', division: 3 })
  assert.deepEqual(resolveVisibleRank(1499, 5), { tier: 'amethyst', division: 1 })
  assert.deepEqual(resolveVisibleRank(1500, 5), { tier: 'great_sage', division: null })
  const candidate = { ...createInitialPvpRating({ seasonId: 's', modeId: 'ranked_1v1', playerId: 'p', at: START }), tier: 'great_sage' as const, leaguePoints: 1800, provisionalGames: 5 }
  assert.equal(projectLeaderboardRank(candidate, 500).tier, 'victorious_fighting_buddha')
  assert.equal(projectLeaderboardRank(candidate, 501).tier, 'great_sage')

  const store = new MemoryPvpStore()
  const service = new PvpRankService(store)
  for (const definition of [mode('ranked_1v1', true, 10_000), mode('casual_1v1', false, 5_000), mode('custom_1v1', false, 0)]) {
    await store.upsertMode(definition)
    await store.upsertSeason(season(definition.modeId))
  }
  assert.equal((await store.listModes(true)).length, 3)
  await store.upsertMap(arena)
  assert.equal((await store.listMaps('active')).length, 1)

  const ticket: PvpMatchmakingTicket = {
    ticketId: 'ticket-1', requestId: 'queue-1', playerId: 'alice', seasonId: 'season-ranked_1v1', modeId: 'ranked_1v1',
    modeVersion: '1', region: 'cn', ratingSnapshot: 1500, state: 'searching', enqueuedAt: START,
    expiresAt: new Date(Date.parse(START) + 60_000).toISOString(), matchedMatchId: null, updatedAt: START,
  }
  assert.deepEqual(await store.createMatchmakingTicket(ticket), ticket)
  assert.deepEqual(await store.createMatchmakingTicket(ticket), ticket)
  await assert.rejects(() => store.createMatchmakingTicket({ ...ticket, ticketId: 'ticket-2', requestId: 'queue-2' }), PvpStoreError)
  assert.equal((await store.transitionMatchmakingTicket({ ticketId: ticket.ticketId, expectedState: 'searching', nextState: 'match_found', matchedMatchId: 'ranked-1', updatedAt: START }))?.state, 'match_found')
  assert.equal(await store.transitionMatchmakingTicket({ ticketId: ticket.ticketId, expectedState: 'searching', nextState: 'cancelled', updatedAt: START }), null)

  const firstInput = matchInput({ matchId: 'ranked-1', endedOffsetMinutes: 1 })
  const first = await service.settleMatch(firstInput)
  assert.equal(first.match.status, 'finished')
  assert.equal(first.match.settlementStatus, 'rating_committed_reward_pending')
  assert.deepEqual(first.participants.map(participant => participant.outcome), ['win', 'loss'])
  assert.ok(first.participants[0].ratingDelta > 0)
  assert.ok(first.participants[1].ratingDelta < 0)
  assert.ok(first.settlements.every(settlement => settlement.rewardStatus === 'pending'))

  const duplicate = await service.settleMatch({ ...firstInput, requestId: 'retry-with-new-transport-id' })
  assert.deepEqual(duplicate, first)
  assert.equal((await store.listRatingLedger('alice', 'season-ranked_1v1', 'ranked_1v1', 100)).length, 1)
  await assert.rejects(() => service.settleMatch(matchInput({ matchId: 'ranked-conflict', requestId: firstInput.requestId, endedOffsetMinutes: 2 })), PvpStoreError)

  for (let game = 2; game <= 5; game += 1) {
    await service.settleMatch(matchInput({ matchId: `ranked-${game}`, winner: game <= 3 ? 'A' : 'B', endedOffsetMinutes: game }))
  }
  const aliceAfterPlacement = await store.getRating('season-ranked_1v1', 'ranked_1v1', 'alice')
  assert.equal(aliceAfterPlacement?.games, 5)
  assert.equal(aliceAfterPlacement?.provisionalGames, 5)
  assert.notEqual(aliceAfterPlacement?.tier, 'unranked')
  assert.ok(aliceAfterPlacement?.division === null || [1, 2, 3].includes(aliceAfterPlacement.division))

  const pageOne = await store.getLeaderboard({ seasonId: 'season-ranked_1v1', modeId: 'ranked_1v1', limit: 1 })
  assert.equal(pageOne.entries.length, 1)
  assert.ok(pageOne.nextCursor)
  const pageTwo = await store.getLeaderboard({ seasonId: 'season-ranked_1v1', modeId: 'ranked_1v1', limit: 1, cursor: pageOne.nextCursor })
  assert.equal(pageTwo.entries.length, 1)
  assert.notEqual(pageOne.entries[0].playerId, pageTwo.entries[0].playerId)

  const historyOne = await store.listMatchHistory({ playerId: 'alice', limit: 2 })
  assert.equal(historyOne.entries.length, 2)
  assert.ok(historyOne.nextCursor)
  const historyTwo = await store.listMatchHistory({ playerId: 'alice', limit: 2, cursor: historyOne.nextCursor })
  assert.equal(historyTwo.entries.length, 2)
  assert.ok(historyOne.entries.every(entry => entry.self.playerId === 'alice' && entry.opponents.length === 1))

  const beforeNoContest = await store.getRating('season-ranked_1v1', 'ranked_1v1', 'alice')
  const noContest = await service.settleMatch(matchInput({
    matchId: 'ranked-void', winner: null, endReason: 'server_void', integrityStatus: 'invalid', endedOffsetMinutes: 6,
  }))
  assert.equal(noContest.match.status, 'no_contest')
  assert.equal(noContest.match.settlementStatus, 'committed')
  assert.ok(noContest.settlements.every(settlement => settlement.rewardStatus === 'not_applicable'))
  assert.deepEqual(await store.getRating('season-ranked_1v1', 'ranked_1v1', 'alice'), beforeNoContest)

  const casual = await service.settleMatch(matchInput({ matchId: 'casual-1', modeId: 'casual_1v1', left: 'casual-a', right: 'casual-b' }))
  assert.equal(casual.participants[0].ratingDelta, 0)
  assert.equal(casual.settlements[0].reward.rewardScaleBps, 5000)
  assert.equal(casual.match.settlementStatus, 'rating_committed_reward_pending')
  assert.equal(await store.getRating('season-casual_1v1', 'casual_1v1', 'casual-a'), null)
  assert.equal((await store.listRatingLedger('casual-a', 'season-casual_1v1', 'casual_1v1', 10)).length, 0)

  const custom = await service.settleMatch(matchInput({ matchId: 'custom-1', modeId: 'custom_1v1', left: 'custom-a', right: 'custom-b' }))
  assert.equal(custom.match.settlementStatus, 'committed')
  assert.ok(custom.settlements.every(settlement => settlement.rewardStatus === 'not_applicable'))
  assert.equal(await store.getRating('season-custom_1v1', 'custom_1v1', 'custom-a'), null)

  const claimed = await store.claimRewardOutbox('worker-1', 100, new Date(Date.parse(START) + 10 * 60_000).toISOString(), 30_000)
  assert.equal(claimed.length, 12)
  assert.ok(claimed.every(event => event.status === 'processing' && event.attempts === 1))
  for (const event of claimed) assert.equal(await store.completeRewardOutbox(event.eventId, 'worker-1', END), true)
  assert.equal((await store.getMatchDetail('ranked-1'))?.match.settlementStatus, 'committed')
  assert.equal(await store.completeRewardOutbox(claimed[0].eventId, 'worker-1', END), false)

  const manifest: PvpReplayManifest = {
    matchId: 'ranked-1', rulesetVersion: 'rules-1', catalogVersion: 'catalog-1', effectSystemVersion: 'effects-1',
    mapId: arena.mapId, mapVersion: arena.version, seed: 'seed:ranked-1', initialSnapshot: { tick: 0 }, initialSnapshotUri: null,
    actionCount: 0, chunkCount: 0, finalStateHash: null, visibility: 'participants', status: 'recording', createdAt: START, updatedAt: START,
  }
  assert.deepEqual(await service.createReplayManifest(manifest), manifest)
  const chunk = { matchId: 'ranked-1', chunkIndex: 0, firstTick: 0, lastTick: 100, payload: { actions: [] }, objectUri: null, sha256: 'chunk-sha', createdAt: START }
  await service.appendReplayChunk(chunk)
  await service.appendReplayChunk(chunk)
  await assert.rejects(() => service.appendReplayChunk({ ...chunk, chunkIndex: 2 }), PvpStoreError)
  const finalized = await store.finalizeReplay('ranked-1', 1, 12, 'final-sha', END)
  assert.equal(finalized.status, 'complete')
  assert.equal((await store.getReplay('ranked-1'))?.chunks.length, 1)

  console.log('rank-v1 smoke passed')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
