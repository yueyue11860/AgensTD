import { useCallback, useEffect, useMemo, useState } from 'react'
import { resolveApiBaseUrl, resolveGatewayToken } from '../lib/runtime-config'

export type ItemKind = 'active' | 'passive'
export type WeaponQuality = 'green' | 'blue' | 'purple' | 'orange' | 'red'
export type GeneralArchetype = 'physical' | 'magic' | 'summon' | 'control'
export type PveDifficulty = 'easy' | 'normal' | 'hard'

export interface PveStageAccess {
  levelId: number
  difficulty: PveDifficulty
  stageKey: string
  cleared: boolean
  unlocked: boolean
  lockedReason: string | null
}

export interface ItemCatalogEntry {
  itemId: string
  name: string
  itemKind: ItemKind
  iconKey: string
  shortDescription: string
  detailDescription: string
  targetingKind: string
  maxChargesPerMatch: number
  cooldownMs: number
}

export interface WeaponCatalogEntry {
  weaponId: string
  name: string
  quality: WeaponQuality
  iconKey: string
  fragmentRequirement: number
  shortDescription: string
  detailDescription: string
  allowedArchetypes: GeneralArchetype[]
  allowedGeneralIds: string[]
  excludedGeneralIds: string[]
  exclusiveGeneralId: string | null
  uniqueGroup: string | null
}

export interface GeneralCatalogEntry {
  generalId: string
  name: string
  archetype: GeneralArchetype
  quality?: string
  /** Optional server-authoritative unlock state. Omitted by legacy servers. */
  unlocked?: boolean
}

export interface GeneralSelectionConfig {
  /** Maximum generals that may be selected for a single match. */
  maxPerMatch: number
  /** Whether the server sent an authoritative unlock matrix. */
  unlockStateKnown: boolean
  unlockedGeneralIds: string[]
}

export interface PurchaseEntitlement {
  entitlementId: string
  kind: string
  consumed: boolean
  label: string
}

export interface ShopOffer {
  offerId: string
  kind: string
  itemId?: string
  weaponId?: string
  name: string
  quality?: WeaponQuality
  priceGold: number
  description: string
}

export interface PlayerMetaAccount {
  playerId: string
  version: number
  gold: number
  honor: number
  item: {
    unlockedActiveItemIds: string[]
    unlockedPassiveItemIds: string[]
    loadout: {
      activeSlots: [string | null, string | null]
      passiveSlots: [string | null, string | null, string | null, string | null, string | null, string | null]
      version: number
    }
  }
  weapon: {
    fragmentBalances: Record<string, number>
    unlockedWeaponIds: string[]
    loadoutsByGeneralId: Record<string, { slots: [string | null, string | null]; version: number }>
    version: number
  }
  entitlements: PurchaseEntitlement[]
}

export interface PlayerAccountData {
  account: PlayerMetaAccount
  pveProgression: {
    clearedStageKeys: string[]
    stages: PveStageAccess[]
  }
  catalogs: {
    items: ItemCatalogEntry[]
    weapons: WeaponCatalogEntry[]
    generals: GeneralCatalogEntry[]
  }
  generalSelection: GeneralSelectionConfig
  /** Account-scoped full encyclopedia projection (newer servers). */
  encyclopedia?: EncyclopediaCatalogData
}

export interface EncyclopediaCatalogData {
  generals: Array<GeneralCatalogEntry & { unlocked: boolean }>
  items: Array<ItemCatalogEntry & { unlocked: boolean }>
  weapons: Array<WeaponCatalogEntry & { unlocked: boolean }>
  minions: Array<Record<string, unknown> & { unlocked: boolean }>
  bosses: Array<Record<string, unknown> & { unlocked: boolean }>
}

interface MutationResult {
  ok: boolean
  message: string | null
}

const ACTIVE_EMPTY: [null, null] = [null, null]
const PASSIVE_EMPTY: [null, null, null, null, null, null] = [null, null, null, null, null, null]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function stringOrNull(value: unknown) {
  return typeof value === 'string' ? value : null
}

function fixedSlots(value: unknown, length: number): Array<string | null> {
  const values = Array.isArray(value) ? value.slice(0, length).map(stringOrNull) : []
  while (values.length < length) values.push(null)
  return values
}

function readUi(record: Record<string, unknown>) {
  const ui = isRecord(record.ui) ? record.ui : null
  return {
    iconKey: typeof ui?.iconKey === 'string' ? ui.iconKey : '',
    shortDescription: typeof ui?.shortDescription === 'string' ? ui.shortDescription : '',
    detailDescription: typeof ui?.detailDescription === 'string' ? ui.detailDescription : '',
  }
}

function normalizeItem(value: unknown): ItemCatalogEntry | null {
  if (!isRecord(value) || typeof value.itemId !== 'string' || typeof value.name !== 'string') return null
  if (value.itemKind !== 'active' && value.itemKind !== 'passive') return null
  const ui = readUi(value)
  const targeting = isRecord(value.targeting) ? value.targeting : null
  return {
    itemId: value.itemId,
    name: value.name,
    itemKind: value.itemKind,
    ...ui,
    targetingKind: typeof targeting?.kind === 'string' ? targeting.kind : 'none',
    maxChargesPerMatch: typeof value.maxChargesPerMatch === 'number' ? value.maxChargesPerMatch : 0,
    cooldownMs: typeof value.cooldownMs === 'number' ? value.cooldownMs : 0,
  }
}

function normalizeArchetype(value: unknown): GeneralArchetype | null {
  return value === 'physical' || value === 'magic' || value === 'summon' || value === 'control' ? value : null
}

function normalizeWeapon(value: unknown): WeaponCatalogEntry | null {
  if (!isRecord(value) || typeof value.weaponId !== 'string' || typeof value.name !== 'string') return null
  if (value.quality !== 'green' && value.quality !== 'blue' && value.quality !== 'purple' && value.quality !== 'orange' && value.quality !== 'red') return null
  const compatibility = isRecord(value.compatibility) ? value.compatibility : {}
  const ui = readUi(value)
  return {
    weaponId: value.weaponId,
    name: value.name,
    quality: value.quality,
    fragmentRequirement: typeof value.fragmentRequirement === 'number' ? value.fragmentRequirement : 0,
    ...ui,
    allowedArchetypes: (Array.isArray(compatibility.allowedArchetypes) ? compatibility.allowedArchetypes : []).flatMap((entry) => {
      const archetype = normalizeArchetype(entry)
      return archetype ? [archetype] : []
    }),
    allowedGeneralIds: stringArray(compatibility.allowedGeneralIds),
    excludedGeneralIds: stringArray(compatibility.excludedGeneralIds),
    exclusiveGeneralId: stringOrNull(compatibility.exclusiveGeneralId),
    uniqueGroup: stringOrNull(value.uniqueGroup),
  }
}

function normalizeGeneral(value: unknown): GeneralCatalogEntry | null {
  if (!isRecord(value)) return null
  const generalId = typeof value.generalId === 'string' ? value.generalId : typeof value.id === 'string' ? value.id : null
  const name = typeof value.name === 'string' ? value.name : typeof value.displayName === 'string' ? value.displayName : null
  const archetype = normalizeArchetype(value.archetype ?? value.profession)
  if (!generalId || !name || !archetype) return null
  return {
    generalId,
    name,
    archetype,
    quality: typeof value.quality === 'string' ? value.quality : undefined,
    unlocked: typeof value.unlocked === 'boolean' ? value.unlocked : undefined,
  }
}

function normalizeEncyclopedia(payload: unknown): EncyclopediaCatalogData | undefined {
  if (!isRecord(payload)) return undefined
  const normalizeRows = (value: unknown) => Array.isArray(value) ? value.filter(isRecord) : []
  const generals = normalizeRows(payload.generals).flatMap((row) => {
    const entry = normalizeGeneral(row)
    return entry ? [{ ...entry, unlocked: row.unlocked === true }] : []
  })
  const items = normalizeRows(payload.items).flatMap((row) => {
    const entry = normalizeItem(row)
    return entry ? [{ ...entry, unlocked: row.unlocked === true }] : []
  })
  const weapons = normalizeRows(payload.weapons).flatMap((row) => {
    const entry = normalizeWeapon(row)
    return entry ? [{ ...entry, unlocked: row.unlocked === true }] : []
  })
  const rows = (key: string) => normalizeRows(payload[key]).map((row) => ({ ...row, unlocked: row.unlocked === true }))
  return { generals, items, weapons, minions: rows('minions'), bosses: rows('bosses') }
}

function normalizeEntitlement(value: unknown): PurchaseEntitlement | null {
  if (!isRecord(value)) return null
  const entitlementId = typeof value.entitlementId === 'string' ? value.entitlementId : typeof value.id === 'string' ? value.id : null
  const kind = typeof value.kind === 'string' ? value.kind : typeof value.type === 'string' ? value.type : ''
  if (!entitlementId) return null
  return {
    entitlementId,
    kind,
    consumed: value.consumed === true || value.status === 'consumed',
    label: typeof value.label === 'string' ? value.label : kind || '购买权',
  }
}

function normalizeLoadouts(value: unknown) {
  if (!isRecord(value)) return {}
  const result: PlayerMetaAccount['weapon']['loadoutsByGeneralId'] = {}
  for (const [generalId, raw] of Object.entries(value)) {
    if (!isRecord(raw)) continue
    result[generalId] = {
      slots: fixedSlots(raw.slots, 2) as [string | null, string | null],
      version: typeof raw.version === 'number' ? raw.version : 0,
    }
  }
  return result
}

function normalizeResponse(payload: unknown): PlayerAccountData | null {
  if (!isRecord(payload)) return null
  const account = isRecord(payload.account) ? payload.account : null
  if (!account) return null
  const wallet = isRecord(account.wallet) ? account.wallet : null
  const item = isRecord(account.item) ? account.item : isRecord(account.items) ? account.items : {}
  const itemLoadout = isRecord(item.loadout) ? item.loadout : {}
  const weapon = isRecord(account.weapon) ? account.weapon : isRecord(account.weapons) ? account.weapons : {}
  const catalogs = isRecord(payload.catalogs) ? payload.catalogs : {}
  const encyclopedia = normalizeEncyclopedia(payload.encyclopedia)
  const rawGeneralCatalog = Array.isArray(catalogs.generals)
    ? catalogs.generals
    : Array.isArray(payload.generals)
      ? payload.generals
      : []
  const generalAccount = isRecord(account.general) ? account.general : null
  const generalUnlock = isRecord(account.generalUnlock)
    ? account.generalUnlock
    : isRecord(payload.generalUnlock)
      ? payload.generalUnlock
      : null
  // Some deployments project unlock state directly onto catalog entries
  // instead of returning a separate ID list. Normalize that projection into
  // the same authoritative set consumed by the arsenal UI.
  const catalogUnlockedGeneralIds = rawGeneralCatalog.flatMap((entry) => {
    if (!isRecord(entry) || entry.unlocked !== true) return []
    const id = typeof entry.generalId === 'string' ? entry.generalId : typeof entry.id === 'string' ? entry.id : null
    return id ? [id] : []
  })
  const rawUnlockedGenerals = generalAccount?.unlockedGeneralIds
    ?? generalUnlock?.unlockedGeneralIds
    ?? account.unlockedGeneralIds
    ?? catalogUnlockedGeneralIds
  const hasExplicitUnlockIds = Array.isArray(rawUnlockedGenerals)
  const unlockedGeneralIds = stringArray(rawUnlockedGenerals)
  const rawMaxPerMatch = generalAccount?.maxPerMatch ?? payload.generalSelectionMaxPerMatch
  const catalogGeneralCount = rawGeneralCatalog.length
  const maxPerMatch = typeof rawMaxPerMatch === 'number' && Number.isFinite(rawMaxPerMatch)
    ? Math.max(1, Math.min(12, Math.floor(rawMaxPerMatch)))
    : Math.max(1, catalogGeneralCount || 21)
  const pveProgression = isRecord(payload.pveProgression) ? payload.pveProgression : {}
  const progressionStages = Array.isArray(pveProgression.stages) ? pveProgression.stages.flatMap((value): PveStageAccess[] => {
    if (!isRecord(value) || typeof value.levelId !== 'number') return []
    const difficulty = value.difficulty === 'easy' || value.difficulty === 'normal' || value.difficulty === 'hard'
      ? value.difficulty
      : null
    if (!difficulty) return []
    return [{
      levelId: value.levelId,
      difficulty,
      stageKey: typeof value.stageKey === 'string' ? value.stageKey : `${difficulty}:${value.levelId}`,
      cleared: value.cleared === true,
      unlocked: value.unlocked === true,
      lockedReason: typeof value.lockedReason === 'string' ? value.lockedReason : null,
    }]
  }) : []
  const rawEntitlements = Array.isArray(account.entitlements)
    ? account.entitlements
    : isRecord(account.entitlements)
      ? Object.entries(account.entitlements).map(([entitlementId, value]) => isRecord(value) ? { entitlementId, ...value } : value)
      : []
  const entitlements = rawEntitlements.map(normalizeEntitlement).filter((entry): entry is PurchaseEntitlement => entry !== null)

  return {
    pveProgression: {
      clearedStageKeys: stringArray(pveProgression.clearedStageKeys),
      stages: progressionStages,
    },
    account: {
      playerId: typeof account.playerId === 'string' ? account.playerId : '',
      version: typeof account.version === 'number' ? account.version : 0,
      gold: typeof wallet?.gold === 'number' ? wallet.gold : typeof account.gold === 'number' ? account.gold : 0,
      honor: typeof wallet?.honor === 'number' ? wallet.honor : typeof account.honor === 'number' ? account.honor : 0,
      item: {
        unlockedActiveItemIds: stringArray(item.unlockedActiveItemIds),
        unlockedPassiveItemIds: stringArray(item.unlockedPassiveItemIds),
        loadout: {
          activeSlots: fixedSlots(itemLoadout.activeSlots, 2) as [string | null, string | null],
          passiveSlots: fixedSlots(itemLoadout.passiveSlots, 6) as PlayerMetaAccount['item']['loadout']['passiveSlots'],
          version: typeof itemLoadout.version === 'number' ? itemLoadout.version : 0,
        },
      },
      weapon: {
        fragmentBalances: isRecord(weapon.fragmentBalances)
          ? Object.fromEntries(Object.entries(weapon.fragmentBalances).filter((entry): entry is [string, number] => typeof entry[1] === 'number'))
          : {},
        unlockedWeaponIds: stringArray(weapon.unlockedWeaponIds),
        loadoutsByGeneralId: normalizeLoadouts(weapon.loadoutsByGeneralId),
        version: typeof weapon.version === 'number' ? weapon.version : 0,
      },
      entitlements,
    },
    catalogs: {
      items: (Array.isArray(catalogs.items) ? catalogs.items : []).map(normalizeItem).filter((entry): entry is ItemCatalogEntry => entry !== null),
      weapons: (Array.isArray(catalogs.weapons) ? catalogs.weapons : []).map(normalizeWeapon).filter((entry): entry is WeaponCatalogEntry => entry !== null),
      generals: rawGeneralCatalog.map(normalizeGeneral).filter((entry): entry is GeneralCatalogEntry => entry !== null),
    },
    generalSelection: {
      maxPerMatch,
      unlockStateKnown: hasExplicitUnlockIds || rawGeneralCatalog.some((entry) => isRecord(entry) && typeof entry.unlocked === 'boolean'),
      unlockedGeneralIds,
    },
    encyclopedia,
  }
}

function normalizeOffers(payload: unknown): ShopOffer[] {
  if (!isRecord(payload)) return []
  const rawOffers = Array.isArray(payload.offers) ? payload.offers : isRecord(payload.offerSet) && Array.isArray(payload.offerSet.offers) ? payload.offerSet.offers : []
  return rawOffers.flatMap((value): ShopOffer[] => {
    if (!isRecord(value)) return []
    const offerId = typeof value.offerId === 'string' ? value.offerId : typeof value.id === 'string' ? value.id : null
    if (!offerId) return []
    const reward = isRecord(value.reward) ? value.reward : value
    const metadata = isRecord(value.metadata) ? value.metadata : null
    const itemId = typeof reward.itemId === 'string' ? reward.itemId : typeof value.itemId === 'string' ? value.itemId : undefined
    const weaponId = typeof reward.weaponId === 'string' ? reward.weaponId : typeof value.weaponId === 'string' ? value.weaponId : undefined
    const rawQuality = reward.quality ?? value.quality
    const quality = rawQuality === 'green' || rawQuality === 'blue' || rawQuality === 'purple' || rawQuality === 'orange' || rawQuality === 'red' ? rawQuality : undefined
    return [{
      offerId,
      kind: typeof reward.kind === 'string' ? reward.kind : typeof value.kind === 'string' ? value.kind : itemId ? 'item' : weaponId ? 'weapon_fragment' : 'unknown',
      itemId,
      weaponId,
      name: typeof metadata?.name === 'string' ? metadata.name : typeof value.name === 'string' ? value.name : itemId ?? weaponId ?? '未命名候选',
      quality,
      priceGold: typeof value.priceGold === 'number' ? value.priceGold : typeof value.price === 'number' ? value.price : 0,
      description: typeof metadata?.description === 'string' ? metadata.description : typeof value.description === 'string' ? value.description : '',
    }]
  })
}

function requestId(prefix: string) {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? `${prefix}-${crypto.randomUUID()}` : `${prefix}-${Date.now()}`
}

export function usePlayerAccount() {
  const apiBase = useMemo(() => resolveApiBaseUrl(), [])
  const token = useMemo(() => resolveGatewayToken(), [])
  const [data, setData] = useState<PlayerAccountData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isMutating, setIsMutating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [offers, setOffers] = useState<ShopOffer[]>([])

  const call = useCallback(async (path: string, init?: RequestInit) => {
    if (!apiBase) throw new Error('未配置 API 地址。')
    let response: Response
    try {
      response = await fetch(`${apiBase}${path}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...init?.headers,
        },
      })
    } catch {
      throw new Error(`无法连接账户服务（${apiBase}）。本地开发请在项目根目录运行 ./dev-stack.sh start。`)
    }
    const payload = await response.json().catch(() => null) as unknown
    if (!response.ok || (isRecord(payload) && payload.ok === false)) {
      const message = isRecord(payload) && typeof payload.message === 'string'
        ? payload.message
        : isRecord(payload) && typeof payload.error === 'string'
          ? payload.error
          : isRecord(payload) && typeof payload.code === 'string'
            ? `${payload.code}（${response.status}）`
          : `请求失败（${response.status}）`
      throw new Error(message)
    }
    return payload
  }, [apiBase, token])

  const refresh = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const payload = await call('/account')
      const normalized = normalizeResponse(payload)
      if (!normalized) throw new Error('账户服务返回了不可识别的数据。')
      setData(normalized)
    } catch (caught) {
      setData(null)
      setError(caught instanceof Error ? caught.message : '账户服务暂不可用。')
    } finally {
      setIsLoading(false)
    }
  }, [call])

  useEffect(() => { void refresh() }, [refresh])

  const mutate = useCallback(async (path: string, body: Record<string, unknown>, successMessage: string): Promise<MutationResult> => {
    setIsMutating(true)
    setError(null)
    setNotice(null)
    try {
      await call(path, { method: path.startsWith('/loadouts/') ? 'PUT' : 'POST', body: JSON.stringify(body) })
      setNotice(successMessage)
      await refresh()
      return { ok: true, message: null }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '操作失败。'
      setError(message)
      return { ok: false, message }
    } finally {
      setIsMutating(false)
    }
  }, [call, refresh])

  const saveItemLoadout = useCallback((activeSlots: [string | null, string | null], passiveSlots: PlayerMetaAccount['item']['loadout']['passiveSlots']) => {
    if (!data) return Promise.resolve({ ok: false, message: '账户尚未加载。' })
    return mutate('/loadouts/items', {
      requestId: requestId('items'),
      expectedAccountVersion: data.account.version,
      expectedLoadoutVersion: data.account.item.loadout.version,
      activeSlots,
      passiveSlots,
    }, '道具构筑已保存，将从下一局开始生效。')
  }, [data, mutate])

  const saveWeaponLoadout = useCallback((generalId: string, slots: [string | null, string | null]) => {
    if (!data) return Promise.resolve({ ok: false, message: '账户尚未加载。' })
    return mutate(`/loadouts/weapons/${encodeURIComponent(generalId)}`, {
      requestId: requestId('weapons'),
      expectedAccountVersion: data.account.version,
      expectedLoadoutVersion: data.account.weapon.loadoutsByGeneralId[generalId]?.version ?? 0,
      slots,
    }, '武器配置已保存，将从下一局开始生效。')
  }, [data, mutate])

  const craftWeapon = useCallback((weaponId: string) => {
    if (!data) return Promise.resolve({ ok: false, message: '账户尚未加载。' })
    return mutate(`/weapons/${encodeURIComponent(weaponId)}/craft`, {
      requestId: requestId('craft'),
      expectedAccountVersion: data.account.version,
    }, '武器已合成并永久解锁。')
  }, [data, mutate])

  const loadOffers = useCallback(async (entitlementId: string) => {
    setIsMutating(true)
    setOffers([])
    setError(null)
    setNotice(null)
    try {
      const payload = await call('/shop/offers', { method: 'POST', body: JSON.stringify({ entitlementId }) })
      const normalized = normalizeOffers(payload)
      setOffers(normalized)
      // 首次生成固定候选会提升服务端账户版本，购买前必须静默同步新 CAS 版本。
      const accountPayload = await call('/account')
      const nextData = normalizeResponse(accountPayload)
      if (nextData) setData(nextData)
      if (normalized.length === 0) setNotice('该购买权暂无可用候选。')
      return normalized
    } catch (caught) {
      setOffers([])
      setError(caught instanceof Error ? caught.message : '加载商店候选失败。')
      return []
    } finally {
      setIsMutating(false)
    }
  }, [call])

  const purchaseOffer = useCallback(async (entitlementId: string, offerId: string) => {
    if (!data) return { ok: false, message: '账户尚未加载。' }
    const result = await mutate('/shop/purchase', {
      requestId: requestId('purchase'),
      entitlementId,
      offerId,
      expectedAccountVersion: data.account.version,
    }, '购买成功，购买权已消耗。')
    if (result.ok) setOffers([])
    return result
  }, [data, mutate])

  return {
    data,
    isLoading,
    isMutating,
    error,
    notice,
    offers,
    refresh,
    saveItemLoadout,
    saveWeaponLoadout,
    craftWeapon,
    loadOffers,
    purchaseOffer,
    emptyItemLoadout: { activeSlots: ACTIVE_EMPTY, passiveSlots: PASSIVE_EMPTY },
  }
}
