import assert from 'node:assert/strict'
import {
  deriveBattleAnnouncementCandidates,
  moveBattlefieldCursor,
} from './battlefield-accessibility.ts'

assert.deepEqual(moveBattlefieldCursor(null, 'right'), { x: 15, y: 14 })
assert.deepEqual(moveBattlefieldCursor({ x: 0, y: 0 }, 'up'), { x: 0, y: 0 })
assert.deepEqual(moveBattlefieldCursor({ x: 28, y: 28 }, 'right'), { x: 28, y: 28 })
assert.deepEqual(moveBattlefieldCursor({ x: 12, y: 8 }, 'down'), { x: 12, y: 9 })

const authoritative = {
  matchId: 'match-1',
  chapterLabel: '第一回 · 花果山',
  currentWave: 5,
  maxWaves: 20,
  prepCountdownSec: 3,
  enemyCount: 7,
  recentEvents: [
    { id: 'wave-5', tick: 100, type: 'WAVE_STARTED', data: { waveNumber: 5, countPerLane: 8, bossPerLane: 1 } },
    { id: 'boss-5', tick: 105, type: 'BOSS_SPAWNED', data: { waveNumber: 5, enemyId: 'boss-enemy-1', bossName: '山魈先锋' } },
    { id: 'boss-5', tick: 105, type: 'BOSS_SPAWNED', data: { waveNumber: 5, enemyId: 'boss-enemy-1', bossName: '山魈先锋' } },
    { id: 'old-wave', tick: 20, type: 'WAVE_STARTED', data: { waveNumber: 1, countPerLane: 3, bossPerLane: 0 } },
  ],
  bosses: [{ entityId: 'boss-enemy-1', bossName: '山魈先锋', glyph: '魈', hp: 900, maxHp: 1000 }],
}

const announcements = deriveBattleAnnouncementCandidates(authoritative)
assert.deepEqual(announcements.map(item => item.kind), ['opening', 'boss'], 'Boss start suppresses lower-priority prep and wave notices')
assert.equal(announcements.filter(item => item.kind === 'boss').length, 1, 'replayed event ids must be idempotent')
assert.match(announcements.find(item => item.kind === 'boss')?.title ?? '', /第 5 波.*山魈先锋/)
assert.match(announcements.find(item => item.kind === 'boss')?.threat ?? '', /900.*1,000/)
assert.equal(announcements.some(item => item.key.includes('old-wave')), false, 'stale wave events must not be announced')

const firstWave = deriveBattleAnnouncementCandidates({
  ...authoritative,
  currentWave: 1,
  prepCountdownSec: 4,
  bosses: [],
  recentEvents: [{ id: 'wave-1', tick: 1, type: 'WAVE_STARTED', data: { waveNumber: 1, countPerLane: 5, bossPerLane: 0 } }],
})
assert.deepEqual(firstWave.map(item => item.kind), ['opening'], 'opening, prep, and first wave must merge into one notice')

const normalWave = deriveBattleAnnouncementCandidates({
  ...authoritative,
  currentWave: 2,
  prepCountdownSec: 4,
  bosses: [],
  recentEvents: [{ id: 'wave-2', tick: 20, type: 'WAVE_STARTED', data: { waveNumber: 2, countPerLane: 6, bossPerLane: 0 } }],
})
assert.deepEqual(normalWave.map(item => item.kind), ['opening', 'wave'], 'WAVE_STARTED suppresses the same wave prep notice')

assert.deepEqual(deriveBattleAnnouncementCandidates({ ...authoritative, matchId: null }), [])
assert.deepEqual(deriveBattleAnnouncementCandidates({ ...authoritative, currentWave: 0 }), [])

console.log(JSON.stringify({
  ok: true,
  cursorBounds: true,
  authoritativeAnnouncements: announcements.map(item => item.kind),
  firstWaveMerged: true,
  duplicateEventsSuppressed: true,
  staleEventsSuppressed: true,
}))
