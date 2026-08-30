/** Shared wire contract for the account-scoped encyclopedia projection. */

export const ENCYCLOPEDIA_SCHEMA_VERSION = 1 as const
export const ENCYCLOPEDIA_CATALOG_VERSION = 'encyclopedia-v1' as const

export type EncyclopediaEntryKind = 'general' | 'item' | 'weapon' | 'minion' | 'boss'

/**
 * Catalog entries intentionally retain the authoritative server definition shape
 * and add only an account-scoped unlock marker.  This keeps the contract forward
 * compatible when a definition gains fields while allowing old clients to ignore
 * the extra `encyclopedia` envelope entirely.
 */
export type EncyclopediaEntry<TDefinition extends Record<string, unknown> = Record<string, unknown>> =
  TDefinition & {
    unlocked: boolean
  }

export interface EncyclopediaCatalogPayload {
  schemaVersion: typeof ENCYCLOPEDIA_SCHEMA_VERSION
  catalogVersion: typeof ENCYCLOPEDIA_CATALOG_VERSION
  generals: readonly EncyclopediaEntry[]
  items: readonly EncyclopediaEntry[]
  weapons: readonly EncyclopediaEntry[]
  /** Wave minion variants and soldier archetypes, each with a stable `entryId`. */
  minions: readonly EncyclopediaEntry[]
  bosses: readonly EncyclopediaEntry[]
}

