import type { PlayerAccountService } from '../account-v1/service'
import type { PveSettlementCommand, PveSettlementRecord } from './types'
import type { PveRewardStore } from './store'
import { finalizePveSettlementDetail } from './settlement-detail'

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
    .join(',')}}`
}

/**
 * Durable settlement outbox. The pending command is persisted before account CAS;
 * retries and process restarts reuse the same settlement/request ids, so award commit is exactly-once.
 */
export class PveSettlementCoordinator {
  constructor(
    readonly store: PveRewardStore,
    private readonly accountService: PlayerAccountService,
  ) {}

  async settle(command: PveSettlementCommand): Promise<PveSettlementRecord> {
    const fingerprint = stableStringify(command)
    const prepared = await this.store.prepareSettlement(command, fingerprint)
    if (prepared.status === 'committed') return prepared
    try {
      const settlement = await this.accountService.settleMatch(command.input)
      return await this.store.markSettlementCommitted(command.settlementId, settlement,
        command.detail ? finalizePveSettlementDetail(command.detail, settlement) : undefined)
    }
    catch (error) {
      const details = error instanceof Error ? error.message : String(error)
      await this.store.markSettlementFailed(command.settlementId, details)
      throw error
    }
  }

  async recover(limit = 100): Promise<{ recovered: number; failed: number }> {
    const recoverable = await this.store.listRecoverableSettlements(limit)
    let recovered = 0
    let failed = 0
    for (const record of recoverable) {
      try {
        await this.settle({
          settlementId: record.settlementId,
          combatRulesetVersion: record.combatRulesetVersion,
          configSnapshot: record.configSnapshot,
          rewardTableRevision: record.rewardTableRevision,
          ...(record.detail ? { detail: record.detail } : {}),
          input: record.input,
        })
        recovered += 1
      }
      catch {
        failed += 1
      }
    }
    return { recovered, failed }
  }
}
