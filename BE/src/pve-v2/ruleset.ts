import { getPveStageDefinition, type PveDifficulty } from '../../../shared/contracts/pve-stage-config'
import type { PveBalanceProfile } from './balance-catalog'

/**
 * 新版 PVE 的稳定规则身份。任何破坏确定性回放/结算口径的规则变更都必须升级此值。
 * 旧版波次调度器没有这个身份，因此不能伪装成新版对局。
 */
export const PVE_COMBAT_RULESET_VERSION = 'pve-v2.3.0' as const
export const PVE_MATCH_CONFIG_SNAPSHOT_SCHEMA_VERSION = 1 as const
export const PVE_BALANCE_CATALOG_REVISION = 'pve-balance-2026-08-25-v3' as const
export const PVE_STAGE_CATALOG_REVISION = 'pve-stage-2026-08-25-v1' as const

export interface PveMatchConfigSnapshot {
  schemaVersion: typeof PVE_MATCH_CONFIG_SNAPSHOT_SCHEMA_VERSION
  runtimeKind: 'pve-v2'
  combatRulesetVersion: typeof PVE_COMBAT_RULESET_VERSION
  stageCatalogRevision: typeof PVE_STAGE_CATALOG_REVISION
  balanceCatalogRevision: typeof PVE_BALANCE_CATALOG_REVISION
  stageId: string
  levelId: number
  difficulty: PveDifficulty
  balanceProfileId: string
  tickRateMs: number
  prepDurationMs: number
  maxWaves: number
  initialWaveNumber: number
}

export function createPveMatchConfigSnapshot(input: {
  levelId: number
  difficulty: PveDifficulty
  balanceProfile: Pick<PveBalanceProfile, 'profileId'>
  tickRateMs: number
  prepDurationMs: number
  maxWaves: number
  initialWaveNumber: number
}): Readonly<PveMatchConfigSnapshot> {
  const stage = getPveStageDefinition(input.levelId)
  if (!stage) throw new Error(`PVE_V2_STAGE_NOT_FOUND:${input.levelId}`)
  return Object.freeze({
    schemaVersion: PVE_MATCH_CONFIG_SNAPSHOT_SCHEMA_VERSION,
    runtimeKind: 'pve-v2',
    combatRulesetVersion: PVE_COMBAT_RULESET_VERSION,
    stageCatalogRevision: PVE_STAGE_CATALOG_REVISION,
    balanceCatalogRevision: PVE_BALANCE_CATALOG_REVISION,
    stageId: stage.stageId,
    levelId: input.levelId,
    difficulty: input.difficulty,
    balanceProfileId: input.balanceProfile.profileId,
    tickRateMs: input.tickRateMs,
    prepDurationMs: input.prepDurationMs,
    maxWaves: input.maxWaves,
    initialWaveNumber: input.initialWaveNumber,
  })
}
