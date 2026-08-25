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

async function main(): Promise<void> {
  const platform = new PvpPlatformService({ store: new MemoryPvpStore(), autoTick: false })
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
    assert.equal(platform.matchState(alice, matchId).phase, 'countdown')
    assert.throws(() => platform.matchState(outsider, matchId), /participants|MATCH_ACCESS_DENIED|参与者/)

    for (let tick = 0; tick < 49; tick += 1) platform.tick()
    assert.equal(platform.matchState(alice, matchId).phase, 'countdown')
    platform.tick()
    const playing = platform.matchState(alice, matchId)
    assert.equal(playing.phase, 'playing')
    assert.equal(playing.round.number, 1)
    assert.equal(playing.sides.A?.rations, 15)
    assert.equal(platform.sendPressure(alice, matchId, 'pressure-too-early').code, 'INSUFFICIENT_SCRIPTURE')

    let killed = 0
    for (let attempts = 0; attempts < 400 && killed < 5; attempts += 1) {
      platform.tick()
      const target = platform.matchState(alice, matchId).sides.A?.enemies.find(enemy => !enemy.spawnProtected)
      if (!target) continue
      const damage = platform.applyAuthoritativeDamage(matchId, {
        eventId: `trusted-damage-${killed}`,
        sourcePlayerId: alice.playerId,
        enemyId: target.enemyId,
        rawDamage: 1_000_000,
        resolvedDamage: 1_000_000,
      })
      assert.equal(damage.ok, true)
      killed += 1
    }
    assert.equal(killed, 5)
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
    await assert.rejects(() => platform.joinRoom(bob, room.roomId, 'wrong'), /WRONG_PASSWORD|密码/)
    const joined = await platform.joinRoom(bob, room.roomId, 'secret')
    assert.equal(joined.playerCount, 2)
    await platform.setRoomReady(alice, room.roomId, true)
    const readyRoom = await platform.setRoomReady(bob, room.roomId, true)
    assert.ok(readyRoom.matchId)
    assert.equal(platform.matchState(alice, readyRoom.matchId!).phase, 'countdown')

    console.log('pvp-platform-v1 smoke passed')
  }
  finally {
    platform.shutdown()
  }
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
