import { getActiveItemDefinition, getItemDefinition, getPassiveItemDefinition } from './catalog'
import {
  ActiveItemSlots,
  ITEM_CATALOG_VERSION,
  ItemErrorCode,
  ItemResult,
  MatchItemLoadoutSnapshot,
  PassiveItemSlots,
  PlayerItemAccount,
} from './types'

export const FREE_ACTIVE_ITEM_IDS = [
  'change_character_brush',
  'cultivation_pill',
] as const

export const FREE_PASSIVE_ITEM_IDS = [
  'traveling_kitchen',
  'talent_registry',
  'reserve_expansion_talisman',
] as const

export function createPlayerItemAccount(playerId: string, nowIso: string): PlayerItemAccount {
  if (!playerId) throw new Error('playerId is required')
  return {
    playerId,
    unlockedActiveItemIds: [...FREE_ACTIVE_ITEM_IDS],
    unlockedPassiveItemIds: [...FREE_PASSIVE_ITEM_IDS],
    loadout: {
      activeSlots: [...FREE_ACTIVE_ITEM_IDS],
      passiveSlots: [...FREE_PASSIVE_ITEM_IDS, null, null, null],
      version: 1,
      updatedAt: nowIso,
    },
    version: 1,
  }
}

export interface SaveItemLoadoutCommand {
  playerId: string
  activeSlots: ActiveItemSlots
  passiveSlots: PassiveItemSlots
  expectedLoadoutVersion: number
  expectedAccountVersion: number
  expectedCatalogVersion: number
  nowIso: string
}

export function validateItemLoadout(
  account: PlayerItemAccount,
  activeSlots: ActiveItemSlots,
  passiveSlots: PassiveItemSlots,
): ItemErrorCode | undefined {
  if (activeSlots.length !== 2 || passiveSlots.length !== 6) return 'INVALID_ITEM_LOADOUT'

  const allIds = [...activeSlots, ...passiveSlots].filter((id): id is string => id !== null)
  if (new Set(allIds).size !== allIds.length) return 'DUPLICATE_ITEM_IN_LOADOUT'

  const unlockedActive = new Set(account.unlockedActiveItemIds)
  const unlockedPassive = new Set(account.unlockedPassiveItemIds)
  for (const id of activeSlots) {
    if (id === null) continue
    const definition = getItemDefinition(id)
    if (!definition) return 'ITEM_NOT_FOUND'
    if (definition.itemKind !== 'active') return 'ITEM_KIND_MISMATCH'
    if (!unlockedActive.has(id)) return 'ITEM_NOT_UNLOCKED'
  }
  for (const id of passiveSlots) {
    if (id === null) continue
    const definition = getItemDefinition(id)
    if (!definition) return 'ITEM_NOT_FOUND'
    if (definition.itemKind !== 'passive') return 'ITEM_KIND_MISMATCH'
    if (!unlockedPassive.has(id)) return 'ITEM_NOT_UNLOCKED'
  }

  const exclusiveGroups = new Set<string>()
  for (const id of allIds) {
    const group = getItemDefinition(id)?.exclusiveGroup
    if (!group) continue
    if (exclusiveGroups.has(group)) return 'ITEM_EXCLUSIVE_GROUP_CONFLICT'
    exclusiveGroups.add(group)
  }
  return undefined
}

export function saveItemLoadout(
  account: PlayerItemAccount,
  command: SaveItemLoadoutCommand,
): ItemResult<PlayerItemAccount> {
  if (command.playerId !== account.playerId) return { ok: false, error: 'ITEM_NOT_UNLOCKED' }
  if (command.expectedCatalogVersion !== ITEM_CATALOG_VERSION) {
    return { ok: false, error: 'ITEM_CATALOG_VERSION_MISMATCH' }
  }
  if (command.expectedAccountVersion !== account.version || command.expectedLoadoutVersion !== account.loadout.version) {
    return { ok: false, error: 'ITEM_ACCOUNT_VERSION_MISMATCH' }
  }
  const validationError = validateItemLoadout(account, command.activeSlots, command.passiveSlots)
  if (validationError) return { ok: false, error: validationError }

  return {
    ok: true,
    value: {
      ...account,
      loadout: {
        activeSlots: [...command.activeSlots],
        passiveSlots: [...command.passiveSlots],
        version: account.loadout.version + 1,
        updatedAt: command.nowIso,
      },
      version: account.version + 1,
    },
  }
}

export function createMatchItemLoadoutSnapshot(account: PlayerItemAccount): MatchItemLoadoutSnapshot {
  const validationError = validateItemLoadout(
    account,
    account.loadout.activeSlots,
    account.loadout.passiveSlots,
  )
  if (validationError) throw new Error(`Cannot snapshot invalid item loadout: ${validationError}`)

  const activeItems = account.loadout.activeSlots
    .filter((id): id is string => id !== null)
    .map((id) => {
      const definition = getActiveItemDefinition(id)
      if (!definition) throw new Error(`Missing active item definition: ${id}`)
      return definition
    })
  const passiveItems = account.loadout.passiveSlots
    .filter((id): id is string => id !== null)
    .map((id) => {
      const definition = getPassiveItemDefinition(id)
      if (!definition) throw new Error(`Missing passive item definition: ${id}`)
      return definition
    })

  return deepFreeze({
    snapshotVersion: 1,
    catalogVersion: ITEM_CATALOG_VERSION,
    playerId: account.playerId,
    accountVersion: account.version,
    activeItems: activeItems.map(cloneDefinition),
    passiveItems: passiveItems.map(cloneDefinition),
    activeSlots: [...account.loadout.activeSlots] as ActiveItemSlots,
    passiveSlots: [...account.loadout.passiveSlots] as PassiveItemSlots,
  })
}

function cloneDefinition<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  }
  return value
}
