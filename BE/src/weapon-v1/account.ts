import { getGeneralRosterEntry } from '../core/hero-v1/roster'
import { getWeaponDefinition, isWeaponCompatible } from './catalog'
import {
  type GeneralWeaponLoadoutState,
  type MatchWeaponLoadoutSnapshot,
  type PlayerWeaponAccount,
  WeaponDomainError,
  type WeaponDefinition,
  type WeaponEventBudget,
  type WeaponProjectionSource,
} from './types'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const deepFreeze = <T>(value: T): Readonly<T> => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  }
  return value
}

interface Receipt<T> { fingerprint: string, result: T }

export interface CraftWeaponRequest {
  requestId: string
  playerId: string
  weaponId: string
  expectedAccountVersion: number
}

export interface CraftWeaponResult {
  status: 'unlocked'
  weaponId: string
  spentFragments: number
  fragmentBalance: number
  accountVersion: number
}

export interface SaveWeaponLoadoutRequest {
  requestId: string
  playerId: string
  generalId: string
  slots: readonly [string | null, string | null]
  expectedLoadoutVersion: number
}

export interface SaveWeaponLoadoutResult {
  generalId: string
  loadout: GeneralWeaponLoadoutState
  accountVersion: number
}

export interface CreditWeaponFragmentsRequest {
  requestId: string
  playerId: string
  fragments: Readonly<Record<string, number>>
  expectedAccountVersion?: number
}

/**
 * 供 REST/持久化适配层复用的纯校验函数。不修改账户，失败时抛出稳定的 WeaponDomainError。
 */
export function validateWeaponLoadout(
  account: Pick<PlayerWeaponAccount, 'unlockedWeaponIds'>,
  generalId: string,
  slots: readonly [string | null, string | null],
): void {
  if (!getGeneralRosterEntry(generalId)) {
    throw new WeaponDomainError('WEAPON_INCOMPATIBLE', `Unknown general ${generalId}`)
  }
  if (slots[0] && slots[0] === slots[1]) {
    throw new WeaponDomainError('DUPLICATE_WEAPON_IN_LOADOUT', `Cannot equip ${slots[0]} twice`)
  }
  const resolved = slots.map((weaponId) => {
    if (!weaponId) return null
    const weapon = getWeaponDefinition(weaponId)
    if (!weapon) throw new WeaponDomainError('WEAPON_NOT_FOUND', `Unknown weapon ${weaponId}`)
    if (!account.unlockedWeaponIds.includes(weaponId)) {
      throw new WeaponDomainError('WEAPON_NOT_UNLOCKED', `Weapon ${weaponId} is not unlocked`)
    }
    if (weapon.compatibility.exclusiveGeneralId && weapon.compatibility.exclusiveGeneralId !== generalId) {
      throw new WeaponDomainError('EXCLUSIVE_GENERAL_MISMATCH', `${weaponId} is exclusive to ${weapon.compatibility.exclusiveGeneralId}`)
    }
    if (!isWeaponCompatible(weapon, generalId)) {
      throw new WeaponDomainError('WEAPON_INCOMPATIBLE', `${weaponId} is incompatible with ${generalId}`)
    }
    return weapon
  })
  if (resolved[0]?.uniqueGroup && resolved[0].uniqueGroup === resolved[1]?.uniqueGroup) {
    throw new WeaponDomainError('UNIQUE_GROUP_CONFLICT', `Weapons share unique group ${resolved[0].uniqueGroup}`)
  }
}

export class InMemoryWeaponAccountService {
  private readonly accounts = new Map<string, PlayerWeaponAccount>()
  private readonly receipts = new Map<string, Receipt<unknown>>()

  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  getAccount(playerId: string): PlayerWeaponAccount {
    return clone(this.ensureAccount(playerId))
  }

  creditFragments(request: CreditWeaponFragmentsRequest): PlayerWeaponAccount {
    const fingerprint = JSON.stringify({ type: 'credit', playerId: request.playerId, fragments: request.fragments, expectedAccountVersion: request.expectedAccountVersion })
    return this.idempotent(request.playerId, request.requestId, fingerprint, () => {
      const account = this.ensureAccount(request.playerId)
      if (request.expectedAccountVersion !== undefined && request.expectedAccountVersion !== account.version) {
        throw new WeaponDomainError('STALE_WEAPON_ACCOUNT_VERSION', `Expected account version ${request.expectedAccountVersion}, received ${account.version}`)
      }
      const entries = Object.entries(request.fragments)
      for (const [weaponId, amount] of entries) {
        if (!getWeaponDefinition(weaponId)) throw new WeaponDomainError('WEAPON_NOT_FOUND', `Unknown weapon ${weaponId}`)
        if (!Number.isSafeInteger(amount) || amount <= 0) throw new WeaponDomainError('INVALID_FRAGMENT_AMOUNT', `Invalid fragment amount for ${weaponId}`)
      }
      for (const [weaponId, amount] of entries) account.fragmentBalances[weaponId] = (account.fragmentBalances[weaponId] ?? 0) + amount
      if (entries.length) account.version += 1
      return clone(account)
    })
  }

  craftWeapon(request: CraftWeaponRequest): CraftWeaponResult {
    const fingerprint = JSON.stringify({ type: 'craft', playerId: request.playerId, weaponId: request.weaponId, expectedAccountVersion: request.expectedAccountVersion })
    return this.idempotent(request.playerId, request.requestId, fingerprint, () => {
      const weapon = getWeaponDefinition(request.weaponId)
      if (!weapon) throw new WeaponDomainError('WEAPON_NOT_FOUND', `Unknown weapon ${request.weaponId}`)
      const account = this.ensureAccount(request.playerId)
      if (account.version !== request.expectedAccountVersion) throw new WeaponDomainError('STALE_WEAPON_ACCOUNT_VERSION', `Expected account version ${request.expectedAccountVersion}, received ${account.version}`)
      if (account.unlockedWeaponIds.includes(request.weaponId)) throw new WeaponDomainError('WEAPON_ALREADY_UNLOCKED', `Weapon ${request.weaponId} is already unlocked`)
      const balance = account.fragmentBalances[request.weaponId] ?? 0
      if (balance < weapon.fragmentRequirement) throw new WeaponDomainError('INSUFFICIENT_FRAGMENTS', `Weapon ${request.weaponId} requires ${weapon.fragmentRequirement} fragments`)
      account.fragmentBalances[request.weaponId] = balance - weapon.fragmentRequirement
      account.unlockedWeaponIds.push(request.weaponId)
      account.unlockedWeaponIds.sort()
      account.version += 1
      return {
        status: 'unlocked',
        weaponId: request.weaponId,
        spentFragments: weapon.fragmentRequirement,
        fragmentBalance: account.fragmentBalances[request.weaponId],
        accountVersion: account.version,
      }
    })
  }

  saveLoadout(request: SaveWeaponLoadoutRequest): SaveWeaponLoadoutResult {
    const fingerprint = JSON.stringify({ type: 'loadout', ...request })
    return this.idempotent(request.playerId, request.requestId, fingerprint, () => {
      if (!getGeneralRosterEntry(request.generalId)) throw new WeaponDomainError('WEAPON_INCOMPATIBLE', `Unknown general ${request.generalId}`)
      const account = this.ensureAccount(request.playerId)
      const current = account.loadoutsByGeneralId[request.generalId]
      const currentVersion = current?.version ?? 0
      if (currentVersion !== request.expectedLoadoutVersion) throw new WeaponDomainError('STALE_WEAPON_LOADOUT_VERSION', `Expected loadout version ${request.expectedLoadoutVersion}, received ${currentVersion}`)
      validateWeaponLoadout(account, request.generalId, request.slots)
      const loadout: GeneralWeaponLoadoutState = {
        slots: [request.slots[0], request.slots[1]],
        version: currentVersion + 1,
        updatedAt: this.now(),
      }
      account.loadoutsByGeneralId[request.generalId] = loadout
      account.version += 1
      return { generalId: request.generalId, loadout: clone(loadout), accountVersion: account.version }
    })
  }

  createMatchSnapshot(playerId: string, generalIds?: readonly string[]): MatchWeaponLoadoutSnapshot {
    const account = this.ensureAccount(playerId)
    const included = generalIds ?? Object.keys(account.loadoutsByGeneralId)
    const byGeneralId: Record<string, { slots: [string | null, string | null], resolvedDefinitions: WeaponDefinition[] }> = {}
    for (const generalId of included) {
      const loadout = account.loadoutsByGeneralId[generalId]
      if (!loadout) continue
      validateWeaponLoadout(account, generalId, loadout.slots)
      byGeneralId[generalId] = {
        slots: [loadout.slots[0], loadout.slots[1]],
        resolvedDefinitions: loadout.slots.flatMap((weaponId) => {
          if (!weaponId) return []
          const definition = getWeaponDefinition(weaponId)
          if (!definition) throw new WeaponDomainError('WEAPON_NOT_FOUND', `Unknown weapon ${weaponId}`)
          return [clone(definition)]
        }),
      }
    }
    return deepFreeze({ snapshotVersion: 1, playerId, accountVersion: account.version, byGeneralId }) as MatchWeaponLoadoutSnapshot
  }

  private ensureAccount(playerId: string): PlayerWeaponAccount {
    let account = this.accounts.get(playerId)
    if (!account) {
      account = { playerId, fragmentBalances: {}, unlockedWeaponIds: [], loadoutsByGeneralId: {}, version: 0 }
      this.accounts.set(playerId, account)
    }
    return account
  }

  private idempotent<T>(playerId: string, requestId: string, fingerprint: string, operation: () => T): T {
    if (!requestId) throw new WeaponDomainError('REQUEST_ID_CONFLICT', 'requestId is required')
    const key = `${playerId}:${requestId}`
    const existing = this.receipts.get(key)
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new WeaponDomainError('REQUEST_ID_CONFLICT', `requestId ${requestId} was reused with another payload`)
      return clone(existing.result as T)
    }
    const result = operation()
    this.receipts.set(key, { fingerprint, result: clone(result) })
    return clone(result)
  }
}

export function projectWeaponLoadout(
  matchId: string,
  snapshot: MatchWeaponLoadoutSnapshot,
  generalId: string,
): readonly WeaponProjectionSource[] {
  const loadout = snapshot.byGeneralId[generalId]
  if (!loadout) return []
  return loadout.slots.flatMap((weaponId, slotIndex): WeaponProjectionSource[] => {
    if (!weaponId) return []
    const weapon = loadout.resolvedDefinitions.find((candidate) => candidate.weaponId === weaponId)
    if (!weapon) throw new WeaponDomainError('WEAPON_NOT_FOUND', `Snapshot definition missing for ${weaponId}`)
    return [{
      sourceKey: `weapon:${matchId}:${snapshot.playerId}:${generalId}:${slotIndex}:${weaponId}`,
      slotIndex: slotIndex as 0 | 1,
      weaponId,
      generalId,
      statModifiers: weapon.statModifiers,
      triggers: weapon.triggers,
      parameterPatches: weapon.parameterPatches,
      resolvedEffects: [
        ...weapon.statModifiers.map((definition) => ({ kind: 'stat_modifier' as const, sourceKey: `weapon:${matchId}:${snapshot.playerId}:${generalId}:${slotIndex}:${weaponId}:${definition.effectId}`, definition })),
        ...weapon.triggers.map((definition) => ({ kind: 'trigger' as const, sourceKey: `weapon:${matchId}:${snapshot.playerId}:${generalId}:${slotIndex}:${weaponId}:${definition.triggerId}`, definition })),
        ...weapon.parameterPatches.map((definition) => ({ kind: 'parameter_patch' as const, sourceKey: `weapon:${matchId}:${snapshot.playerId}:${generalId}:${slotIndex}:${weaponId}:${definition.patchId}`, definition })),
      ],
      eventBudget: weapon.eventBudget,
    }]
  })
}

export const DEFAULT_GENERAL_WEAPON_EVENT_BUDGET = {
  maxExtraDamageEventsPerSecond: 12,
  maxExtraTargetsPerCast: 8,
  maxOwnedZones: 3,
  maxExtraSummons: 2,
} as const

export function aggregateWeaponEventBudget(
  sources: readonly WeaponProjectionSource[],
  caps: WeaponEventBudget = DEFAULT_GENERAL_WEAPON_EVENT_BUDGET,
): WeaponProjectionSource['eventBudget'] {
  const sum = sources.reduce((budget, source) => ({
    maxExtraDamageEventsPerSecond: budget.maxExtraDamageEventsPerSecond + source.eventBudget.maxExtraDamageEventsPerSecond,
    maxExtraTargetsPerCast: budget.maxExtraTargetsPerCast + source.eventBudget.maxExtraTargetsPerCast,
    maxOwnedZones: budget.maxOwnedZones + source.eventBudget.maxOwnedZones,
    maxExtraSummons: budget.maxExtraSummons + source.eventBudget.maxExtraSummons,
  }), { maxExtraDamageEventsPerSecond: 0, maxExtraTargetsPerCast: 0, maxOwnedZones: 0, maxExtraSummons: 0 })
  return {
    maxExtraDamageEventsPerSecond: Math.min(sum.maxExtraDamageEventsPerSecond, caps.maxExtraDamageEventsPerSecond),
    maxExtraTargetsPerCast: Math.min(sum.maxExtraTargetsPerCast, caps.maxExtraTargetsPerCast),
    maxOwnedZones: Math.min(sum.maxOwnedZones, caps.maxOwnedZones),
    maxExtraSummons: Math.min(sum.maxExtraSummons, caps.maxExtraSummons),
  }
}
