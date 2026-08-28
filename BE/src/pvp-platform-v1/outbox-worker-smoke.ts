import assert from 'node:assert/strict'
import type { PvpRewardOutboxEvent } from '../../../shared/contracts/pvp-competition'
import { PlayerAccountService } from '../account-v1/service'
import { MemoryPlayerAccountStore } from '../account-v1/memory-store'
import type { PvpStore } from '../data/pvp-store'
import { PvpRewardOutboxWorker } from './outbox-worker'

const event: PvpRewardOutboxEvent = {
  eventId: 'reward:worker-smoke:alpha',
  matchId: 'worker-smoke-match',
  playerId: 'worker-smoke-player',
  eventType: 'pvp_match_reward',
  payload: { honor: 20, gold: 10, rewardScaleBps: 10_000 },
  status: 'pending',
  attempts: 0,
  availableAt: '2026-01-01T00:00:00.000Z',
  leaseOwner: null,
  leaseExpiresAt: null,
  lastError: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

async function main(): Promise<void> {
  let claimCount = 0
  let completeCount = 0
  const fakeStore = {
    async claimRewardOutbox() {
      // Simulate a worker crash after account CAS: the same event is reclaimed.
      if (claimCount >= 2) return []
      claimCount += 1
      return [structuredClone(event)]
    },
    async completeRewardOutbox() {
      completeCount += 1
      return completeCount >= 2
    },
    async failRewardOutbox() { return true },
  } as unknown as PvpStore
  const accounts = new PlayerAccountService(new MemoryPlayerAccountStore())
  const worker = new PvpRewardOutboxWorker(fakeStore, {
    workerId: 'worker-smoke',
    accountService: accounts,
  })

  const first = await worker.drain()
  assert.deepEqual(first, { claimed: 1, completed: 0, failed: 0 })
  const second = await worker.drain()
  assert.deepEqual(second, { claimed: 1, completed: 1, failed: 0 })
  const account = await accounts.getOrCreate(event.playerId)
  assert.equal(account.wallet.gold, 10)
  assert.equal(account.wallet.honor, 20)
  assert.equal(claimCount, 2)
  console.log('pvp reward outbox worker smoke passed')
}

void main()
