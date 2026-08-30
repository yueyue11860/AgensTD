/** Shared account and match contracts for the unlockable general roster. */

/**
 * Durable out-of-match unlock state.  `version` is a subsystem version (it is
 * intentionally independent from the outer player-account CAS version).
 */
export interface GeneralUnlockState {
  version: number
  unlockedGeneralIds: string[]
  /** True once the starter grant has been materialized for this account. */
  starterClaimed: boolean
}

/**
 * Server-authoritative in-match general pool snapshot.  Character tokens are
 * finite for a match; minions remain a separate, sustainable result branch.
 */
export interface GeneralPool {
  schemaVersion: 1
  characterRollChanceBps: number
  remainingCharacterTokens: Readonly<Record<string, number>>
  /** The account-unlocked roster participating in this match. */
  unlockedGeneralIds: readonly string[]
  /** Optional deterministic selection supplied when the match is created. */
  selectedGeneralIds?: readonly string[]
}

