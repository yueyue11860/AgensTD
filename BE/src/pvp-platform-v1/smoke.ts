import assert from 'node:assert/strict'
import type { PvpMatchDetail } from '../../../shared/contracts/pvp-competition'
import { MemoryPvpStore } from '../data/memory-pvp-store'
import { PvpPlatformService } from './service'
import type { HumanGatewayPrincipal } from './types'

function human(playerId: string): HumanGatewayPrincipal {
  return {
    token: `token-${playerId}`,
    playerId,
    playerName: playerId.toUpperCase(),
    playerKind: 'human',
  }
}

function load(platform: PvpPlatformService, principal: HumanGatewayPrincipal, matchId: string, requestId: string) {
  const state = platform.matchState(principal, matchId)
  return platform.acknowledgeLoad(principal, matchId, {
    requestId, status: 'loaded', rulesetVersion: state.loading.rulesetVersion, mapId: state.loading.mapId,
    mapVersion: state.loading.mapVersion, routeHash: state.loading.routeHash, assetsVersion: state.loading.assetsVersion,
  })
}

async function main(): Promise<void> {
  let retentionClock = 0
  const platform = new PvpPlatformService({
    store: new MemoryPvpStore(), autoTick: false, terminalRetentionMs: 1_000,
    maxRetainedTerminalMatches: 1, nowMs: () => retentionClock,
  })
  const alice = human('alice')
  const bob = human('bob')
  const outsider = human('outsider')
  try {
    await platform.ready
    const season = await platform.currentSeason()
    assert.equal(season.rulesetVersion, 'pvp_rules_v1')
    assert.deepEqual(season.mapIds, ['pvp_dual_realm_v1'])
    assert.equal((await platform.profile(alice)).playerId, 'alice')

    const aliceQueue = await platform.joinQueue(alice, {
      requestId: 'queue-alice', mode: 'ranked_1v1', region: 'forged-region', rulesetVersion: 'current', loadoutVersion: 0,
    })
    const bobQueue = await platform.joinQueue(bob, {
      requestId: 'queue-bob', mode: 'ranked_1v1', region: 'forged-region', rulesetVersion: 'pvp_rules_v1', loadoutVersion: 0,
    })
    assert.equal(aliceQueue.ticket.playerId, 'alice')
    assert.equal(aliceQueue.ticket.region, 'auto')
    const proposal = bobQueue.proposal
    assert.ok(proposal)
    assert.deepEqual(new Set(proposal.players.map(player => player.playerId)), new Set(['alice', 'bob']))

    const aliceAccepted = await platform.acceptProposal(alice, proposal.proposalId, 'accept-alice')
    assert.equal(aliceAccepted.match, null)
    const bobAccepted = await platform.acceptProposal(bob, proposal.proposalId, 'accept-bob')
    assert.ok(bobAccepted.match)
    const matchId = bobAccepted.match!.matchId
    assert.equal(platform.matchState(alice, matchId).phase, 'loading')
    const aliceRealtime: number[] = []
    const unsubscribeAlice = platform.subscribeMatchState(alice, matchId, envelope => {
      aliceRealtime.push(envelope.seq)
      assert.equal(envelope.state.sides.B?.privateState, null, 'realtime projection must not leak opponent private state')
    })
    const unsubscribeBobOnce = platform.subscribeMatchState(bob, matchId, () => {})
    unsubscribeBobOnce()
    assert.equal(platform.matchState(alice, matchId).sides.B?.connected, false)
    const unsubscribeBob = platform.subscribeMatchState(bob, matchId, () => {})
    assert.equal(platform.matchState(alice, matchId).sides.B?.connected, true)
    assert.equal(load(platform, alice, matchId, 'load-alice').ok, true)
    assert.equal(platform.matchState(alice, matchId).phase, 'loading')
    assert.equal(load(platform, bob, matchId, 'load-bob').ok, true)
    assert.equal(platform.matchState(alice, matchId).phase, 'countdown')
    assert.ok(aliceRealtime.length >= 2)
    assert.throws(() => platform.matchState(outsider, matchId), /participants|MATCH_ACCESS_DENIED|参与者/)

    for (let tick = 0; tick < 49; tick += 1) platform.tick()
    assert.equal(platform.matchState(alice, matchId).phase, 'countdown')
    platform.tick()
    const playing = platform.matchState(alice, matchId)
    assert.equal(playing.phase, 'playing')
    assert.equal(playing.round.number, 1)
    assert.equal(playing.sides.A?.rations, 15)
    assert.equal(platform.sendPressure(alice, matchId, 'pressure-too-early').code, 'INSUFFICIENT_SCRIPTURE')

    for (const principal of [alice, bob]) {
      for (let index = 0; index < 5; index += 1) {
        const state = platform.matchState(principal, matchId)
        const own = state.sides[state.sides.A?.playerId === principal.playerId ? 'A' : 'B']!
        const recruited = platform.recruit(principal, matchId, { requestId: `recruit-${principal.playerId}-${index}`, expectedTrayRevision: own.privateState!.trayRevision })
        assert.equal(recruited.ok, true)
        const next = platform.matchState(principal, matchId)
        const nextOwn = next.sides[next.sides.A?.playerId === principal.playerId ? 'A' : 'B']!
        const unit = nextOwn.privateState!.tray.find((candidate) => candidate?.unitId === recruited.details?.unitId)
          ?? nextOwn.privateState!.reserve.find((candidate) => candidate?.unitId === recruited.details?.unitId)
        assert.ok(unit)
        const slot = next.rulesSnapshot.deploymentSlots[nextOwn.side][index]!
        assert.equal(platform.deploy(principal, matchId, {
          requestId: `deploy-${principal.playerId}-${index}`, unitId: unit.unitId, ...slot,
          expectedTrayRevision: nextOwn.privateState!.trayRevision, expectedBoardRevision: nextOwn.privateState!.boardRevision,
        }).ok, true)
      }
    }
    assert.equal(platform.matchState(bob, matchId).sides.A?.privateState, null)
    assert.equal(platform.matchState(bob, matchId).sides.A?.boardPieces.length, 5)

    for (let attempts = 0; attempts < 1_500 && platform.matchState(alice, matchId).sides.A!.stats.baseKills < 5; attempts += 1) {
      platform.tick()
    }
    assert.ok(platform.matchState(alice, matchId).sides.A!.stats.baseKills >= 5)
    assert.equal(platform.sendPressure(alice, matchId, 'pressure-success').code, 'PRESSURE_QUEUED')

    const surrender = await platform.surrender(bob, matchId, 'surrender-bob')
    assert.equal(surrender.ok, true)
    assert.equal(platform.matchState(alice, matchId).phase, 'completed')
    const detail = await platform.matchDetail(alice, matchId) as PvpMatchDetail
    assert.equal(detail.match.endReason, 'surrendered')
    const history = await platform.history(alice, 20)
    assert.equal(history.entries.length, 1)
    assert.equal(history.entries[0]?.self.outcome, 'win')
    const aliceProfile = await platform.profile(alice)
    assert.equal(aliceProfile.rating.games, 1)
    assert.equal(aliceProfile.rating.wins, 1)

    const room = platform.createRoom(alice, { roomName: '真人约战', password: 'secret', spectatorsAllowed: true })
    await assert.rejects(() => platform.joinRoom(bob, room.roomId), /密码房必须提供/)
    await assert.rejects(() => platform.joinRoom(bob, room.roomId, 'wrong'), /WRONG_PASSWORD|密码/)
    await assert.rejects(() => platform.joinRoom(bob, room.roomId, 'wrong-2'), /WRONG_PASSWORD|密码/)
    await assert.rejects(() => platform.joinRoom(bob, room.roomId, 'wrong-3'), /WRONG_PASSWORD|密码/)
    assert.equal((await platform.listRooms()).find(candidate => candidate.roomId === room.roomId)?.playerCount, 1)
    const joined = await platform.joinRoom(bob, room.roomId, 'secret')
    assert.equal(joined.playerCount, 2)
    await platform.setRoomReady(alice, room.roomId, true)
    const readyRoom = await platform.setRoomReady(bob, room.roomId, true)
    assert.ok(readyRoom.matchId)
    assert.equal(platform.matchState(alice, readyRoom.matchId!).phase, 'loading')
    load(platform, alice, readyRoom.matchId!, 'custom-load-alice')
    load(platform, bob, readyRoom.matchId!, 'custom-load-bob')
    assert.equal(platform.matchState(alice, readyRoom.matchId!).phase, 'countdown')

    unsubscribeAlice()
    unsubscribeBob()

    for (let tick = 0; tick < 50; tick += 1) platform.tick()
    assert.equal(platform.matchState(alice, readyRoom.matchId!).phase, 'playing')
    assert.equal((await platform.surrender(bob, readyRoom.matchId!, 'custom-surrender')).ok, true)
    platform.tick()
    assert.equal(platform.diagnostics().liveMatches, 1, 'capacity must evict the oldest disconnected terminal match')
    assert.equal((await platform.matchDetail(alice, matchId) as PvpMatchDetail).match.matchId, matchId, 'evicted detail must remain persisted')
    assert.throws(() => platform.matchState(alice, matchId), /MATCH_NOT_FOUND|PVP 对局不存在/)
    retentionClock = 1_001
    platform.tick()
    assert.deepEqual({
      liveMatches: platform.diagnostics().liveMatches,
      customRooms: platform.diagnostics().customRooms,
      retainedTerminalMatches: platform.diagnostics().retainedTerminalMatches,
    }, { liveMatches: 0, customRooms: 0, retainedTerminalMatches: 0 }, 'TTL must reap persisted terminal match and associated room')
    assert.equal((await platform.matchDetail(alice, readyRoom.matchId!) as PvpMatchDetail).match.matchId, readyRoom.matchId)

    console.log('pvp-platform-v1 smoke passed')
  }
  finally {
    platform.shutdown()
    assert.equal(platform.diagnostics().tickTimerActive, 0)
  }

  const timerProbe = new PvpPlatformService({ store: new MemoryPvpStore() })
  await timerProbe.ready
  assert.equal(timerProbe.diagnostics().tickTimerActive, 1)
  timerProbe.shutdown()
  assert.equal(timerProbe.diagnostics().tickTimerActive, 0, 'shutdown must clear the host tick timer')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
