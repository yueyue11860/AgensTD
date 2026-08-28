import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  Backpack,
  Check,
  ChevronRight,
  Coins,
  Hammer,
  LockKeyhole,
  RefreshCw,
  Save,
  ShieldQuestion,
  ShoppingBag,
  Sparkles,
  Swords,
  X,
} from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { cx } from '../lib/cx'
import {
  usePlayerAccount,
  type GeneralArchetype,
  type GeneralCatalogEntry,
  type ItemCatalogEntry,
  type PlayerMetaAccount,
  type PurchaseEntitlement,
  type WeaponCatalogEntry,
  type WeaponQuality,
} from '../hooks/use-player-account'

export type MetaSystemMode = 'build' | 'arsenal' | 'shop'

const MODE_INFO: Record<MetaSystemMode, { path: string; title: string; subtitle: string; icon: typeof Backpack }> = {
  build: { path: '/build', title: '道具构筑', subtitle: '2 个主动槽与 6 个被动槽，对局开始时锁定', icon: Backpack },
  arsenal: { path: '/arsenal', title: '神将武库', subtitle: '每名神将最多佩戴 2 件永久解锁的兼容武器', icon: Swords },
  shop: { path: '/shop', title: '金币商店', subtitle: '每张购买权产生 3 个固定候选，购买后消耗', icon: ShoppingBag },
}

const ARCHETYPE_LABEL: Record<GeneralArchetype, string> = {
  physical: '物理',
  magic: '魔法',
  summon: '召唤',
  control: '控制',
}

const QUALITY_LABEL: Record<WeaponQuality, string> = {
  green: '绿',
  blue: '蓝',
  purple: '紫',
  orange: '橙',
  red: '红',
}

const ENTITLEMENT_LABELS: Record<string, string> = {
  active_item: '主动道具购买权',
  passive_item: '被动道具购买权',
  low_tier_weapon_fragment: '低等级武器碎片购买权',
  high_tier_weapon_fragment: '高等级武器碎片购买权',
}

function isCompatible(weapon: WeaponCatalogEntry, general: GeneralCatalogEntry) {
  if (weapon.exclusiveGeneralId) return weapon.exclusiveGeneralId === general.generalId
  if (weapon.excludedGeneralIds.includes(general.generalId)) return false
  if (weapon.allowedGeneralIds.length > 0 && !weapon.allowedGeneralIds.includes(general.generalId)) return false
  return weapon.allowedArchetypes.length === 0 || weapon.allowedArchetypes.includes(general.archetype)
}

function itemTargetLabel(targetingKind: string) {
  if (targetingKind === 'none') return '无需选择目标'
  if (targetingKind === 'active_general') return '选择已激活神将'
  if (targetingKind === 'battlefield_point') return '选择战场位置'
  if (targetingKind === 'character_token') return '选择神将字符'
  if (targetingKind === 'discarded_character_to_empty_slot') return '选择弃置字符与空位'
  return targetingKind
}

function MetaNav({ mode }: { mode: MetaSystemMode }) {
  return (
    <nav className="meta-nav" aria-label="局外系统导航">
      {(Object.keys(MODE_INFO) as MetaSystemMode[]).map((key) => {
        const entry = MODE_INFO[key]
        const Icon = entry.icon
        return (
          <Link key={key} to={entry.path} className={cx('meta-nav-link', key === mode && 'meta-nav-link-active')}>
            <Icon className="h-4 w-4" />
            <span>{entry.title}</span>
          </Link>
        )
      })}
    </nav>
  )
}

function LoadingState() {
  return (
    <section className="meta-empty-state" aria-busy="true">
      <RefreshCw className="h-7 w-7 animate-spin text-cyan-300" />
      <div><strong>正在同步局外账户</strong><p>正在获取解锁、碎片和构筑版本……</p></div>
    </section>
  )
}

function ApiEmptyState({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <section className="meta-empty-state meta-empty-state-error">
      <ShieldQuestion className="h-8 w-8 text-orange-300" />
      <div>
        <strong>账户服务尚未就绪</strong>
        <p>{error ?? '暂时没有可展示的局外数据。'} 页面不会伪造本地库存或预先修改账户。</p>
      </div>
      <button type="button" className="meta-action-button" onClick={onRetry}><RefreshCw className="h-4 w-4" />重试</button>
    </section>
  )
}

function CatalogArt({ iconKey, label }: { iconKey: string; label: string }) {
  const [failed, setFailed] = useState(false)

  useEffect(() => setFailed(false), [iconKey])

  return (
    <div className="meta-catalog-art" aria-hidden="true">
      <span>{label.slice(0, 1)}</span>
      {!failed && iconKey ? (
        <img
          src={`/art/equipment/${iconKey}.webp`}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : null}
    </div>
  )
}

function ItemCard({ item, unlocked, selected, onSelect }: { item: ItemCatalogEntry; unlocked: boolean; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" disabled={!unlocked} onClick={onSelect} className={cx('meta-catalog-card', selected && 'meta-catalog-card-selected', !unlocked && 'meta-catalog-card-locked')}>
      <CatalogArt iconKey={item.iconKey} label={item.name} />
      <div className="meta-card-title"><span>{item.name}</span>{unlocked ? selected ? <Check className="h-4 w-4" /> : null : <LockKeyhole className="h-4 w-4" />}</div>
      <p>{item.shortDescription || item.detailDescription || '暂无效果说明'}</p>
      <div className="meta-card-tags">
        <span>{item.itemKind === 'active' ? '主动' : '被动'}</span>
        {item.itemKind === 'active' ? <><span>{item.maxChargesPerMatch} 次/局</span><span>{itemTargetLabel(item.targetingKind)}</span></> : <span>开局全局生效</span>}
      </div>
    </button>
  )
}

function ItemBuildView({ account, items, busy, onSave }: {
  account: PlayerMetaAccount
  items: ItemCatalogEntry[]
  busy: boolean
  onSave: (active: [string | null, string | null], passive: PlayerMetaAccount['item']['loadout']['passiveSlots']) => Promise<unknown>
}) {
  const [activeSlots, setActiveSlots] = useState<[string | null, string | null]>(account.item.loadout.activeSlots)
  const [passiveSlots, setPassiveSlots] = useState<PlayerMetaAccount['item']['loadout']['passiveSlots']>(account.item.loadout.passiveSlots)
  const [editing, setEditing] = useState<{ kind: 'active' | 'passive'; index: number }>({ kind: 'active', index: 0 })

  useEffect(() => {
    setActiveSlots(account.item.loadout.activeSlots)
    setPassiveSlots(account.item.loadout.passiveSlots)
  }, [account.item.loadout.version, account.item.loadout.activeSlots, account.item.loadout.passiveSlots])

  const unlocked = useMemo(() => new Set([...account.item.unlockedActiveItemIds, ...account.item.unlockedPassiveItemIds]), [account])
  const candidates = items.filter((item) => item.itemKind === editing.kind)
  const selectedIds = new Set([...activeSlots, ...passiveSlots].filter((id): id is string => Boolean(id)))

  function choose(itemId: string | null) {
    if (editing.kind === 'active') {
      const next = [...activeSlots] as [string | null, string | null]
      next[editing.index] = itemId
      setActiveSlots(next)
    } else {
      const next = [...passiveSlots] as PlayerMetaAccount['item']['loadout']['passiveSlots']
      next[editing.index] = itemId
      setPassiveSlots(next)
    }
  }

  return (
    <div className="meta-workspace-grid">
      <section className="meta-panel">
        <div className="meta-panel-heading"><div><span>LOADOUT</span><h2>对局构筑</h2></div><small>v{account.item.loadout.version}</small></div>
        <div className="meta-slot-group">
          <p>主动道具 · 2</p>
          <div className="meta-slots meta-slots-active">
            {activeSlots.map((itemId, index) => (
              <button type="button" key={index} onClick={() => setEditing({ kind: 'active', index })} className={cx('meta-slot', editing.kind === 'active' && editing.index === index && 'meta-slot-editing')}>
                <span>{index + 1}</span><strong>{items.find((item) => item.itemId === itemId)?.name ?? '空槽位'}</strong><small>{itemId ? '点击替换' : '点击装配'}</small>
              </button>
            ))}
          </div>
        </div>
        <div className="meta-slot-group">
          <p>被动道具 · 6</p>
          <div className="meta-slots meta-slots-passive">
            {passiveSlots.map((itemId, index) => (
              <button type="button" key={index} onClick={() => setEditing({ kind: 'passive', index })} className={cx('meta-slot', editing.kind === 'passive' && editing.index === index && 'meta-slot-editing')}>
                <span>{index + 1}</span><strong>{items.find((item) => item.itemId === itemId)?.name ?? '空槽位'}</strong><small>{itemId ? '点击替换' : '点击装配'}</small>
              </button>
            ))}
          </div>
        </div>
        <button type="button" disabled={busy} className="meta-primary-button" onClick={() => void onSave(activeSlots, passiveSlots)}><Save className="h-4 w-4" />{busy ? '保存中……' : '保存构筑'}</button>
      </section>
      <section className="meta-panel meta-catalog-panel">
        <div className="meta-panel-heading"><div><span>INVENTORY</span><h2>{editing.kind === 'active' ? `主动槽 ${editing.index + 1}` : `被动槽 ${editing.index + 1}`}</h2></div><button type="button" className="meta-clear-button" onClick={() => choose(null)}><X className="h-4 w-4" />卸下</button></div>
        {candidates.length > 0 ? <div className="meta-catalog-grid">{candidates.map((item) => (
          <ItemCard
            key={item.itemId}
            item={item}
            unlocked={unlocked.has(item.itemId)}
            selected={(editing.kind === 'active' ? activeSlots[editing.index] : passiveSlots[editing.index]) === item.itemId}
            onSelect={() => {
              if (selectedIds.has(item.itemId) && (editing.kind === 'active' ? activeSlots[editing.index] : passiveSlots[editing.index]) !== item.itemId) return
              choose(item.itemId)
            }}
          />
        ))}</div> : <p className="meta-inline-empty">服务端尚未下发道具目录。</p>}
      </section>
    </div>
  )
}

function WeaponCard({ weapon, account, general, equipped, busy, onEquip, onCraft }: {
  weapon: WeaponCatalogEntry
  account: PlayerMetaAccount
  general: GeneralCatalogEntry
  equipped: boolean
  busy: boolean
  onEquip: () => void
  onCraft: () => void
}) {
  const unlocked = account.weapon.unlockedWeaponIds.includes(weapon.weaponId)
  const fragments = account.weapon.fragmentBalances[weapon.weaponId] ?? 0
  const compatible = isCompatible(weapon, general)
  const canCraft = !unlocked && fragments >= weapon.fragmentRequirement
  return (
    <article className={cx('meta-weapon-card', `meta-quality-${weapon.quality}`, equipped && 'meta-weapon-card-equipped', !compatible && 'meta-weapon-card-incompatible')}>
      <div className="meta-weapon-quality"><span>{QUALITY_LABEL[weapon.quality]}品</span>{weapon.exclusiveGeneralId ? <strong>专属</strong> : <strong>{weapon.allowedArchetypes.map((entry) => ARCHETYPE_LABEL[entry]).join('/') || '通用'}</strong>}</div>
      <CatalogArt iconKey={weapon.iconKey} label={weapon.name} />
      <h3>{weapon.name}</h3>
      <p>{weapon.shortDescription || weapon.detailDescription || '暂无效果说明'}</p>
      <div className="meta-fragment-row"><span>碎片</span><strong>{fragments}/{weapon.fragmentRequirement}</strong><i><b style={{ width: `${Math.min(100, fragments / Math.max(1, weapon.fragmentRequirement) * 100)}%` }} /></i></div>
      <div className="meta-card-actions">
        {unlocked ? <button type="button" disabled={!compatible || busy} onClick={onEquip}>{equipped ? '已装备' : compatible ? '装入当前槽' : '不适配'}</button>
          : <button type="button" disabled={!canCraft || busy} onClick={onCraft}><Hammer className="h-3.5 w-3.5" />{canCraft ? '合成解锁' : '碎片不足'}</button>}
      </div>
    </article>
  )
}

function ArsenalView({ account, weapons, generals, busy, onSave, onCraft }: {
  account: PlayerMetaAccount
  weapons: WeaponCatalogEntry[]
  generals: GeneralCatalogEntry[]
  busy: boolean
  onSave: (generalId: string, slots: [string | null, string | null]) => Promise<unknown>
  onCraft: (weaponId: string) => Promise<unknown>
}) {
  const [generalId, setGeneralId] = useState(generals[0]?.generalId ?? '')
  const [editingSlot, setEditingSlot] = useState<0 | 1>(0)
  const general = generals.find((entry) => entry.generalId === generalId) ?? generals[0]
  const persisted = general ? account.weapon.loadoutsByGeneralId[general.generalId]?.slots ?? [null, null] : [null, null]
  const [slots, setSlots] = useState<[string | null, string | null]>(persisted as [string | null, string | null])

  useEffect(() => {
    if (!general) return
    setSlots(account.weapon.loadoutsByGeneralId[general.generalId]?.slots ?? [null, null])
  }, [general, account.weapon.loadoutsByGeneralId, account.version])

  if (!general) return <p className="meta-inline-empty">服务端尚未下发 21 名神将目录，无法编辑武器方案。</p>

  function equip(weapon: WeaponCatalogEntry) {
    const otherSlot = editingSlot === 0 ? 1 : 0
    if (slots[otherSlot] === weapon.weaponId) return
    const next = [...slots] as [string | null, string | null]
    next[editingSlot] = weapon.weaponId
    setSlots(next)
  }

  const orderedWeapons = [...weapons].sort((left, right) => {
    const leftCompatible = isCompatible(left, general) ? 0 : 1
    const rightCompatible = isCompatible(right, general) ? 0 : 1
    const qualityOrder: WeaponQuality[] = ['red', 'orange', 'purple', 'blue', 'green']
    return leftCompatible - rightCompatible || qualityOrder.indexOf(left.quality) - qualityOrder.indexOf(right.quality) || left.name.localeCompare(right.name)
  })

  return (
    <div className="meta-arsenal-layout">
      <aside className="meta-panel meta-general-list">
        <div className="meta-panel-heading"><div><span>GENERAL ROSTER</span><h2>21 名神将</h2></div><small>{generals.length}/21</small></div>
        <div>{generals.map((entry) => (
          <button type="button" key={entry.generalId} onClick={() => setGeneralId(entry.generalId)} className={cx('meta-general-row', entry.generalId === general.generalId && 'meta-general-row-active')}>
            <span>{entry.name.slice(0, 1)}</span><div><strong>{entry.name}</strong><small>{ARCHETYPE_LABEL[entry.archetype]} · {entry.quality ?? '神将'}</small></div><ChevronRight className="h-4 w-4" />
          </button>
        ))}</div>
      </aside>
      <section className="meta-panel meta-arsenal-main">
        <div className="meta-panel-heading"><div><span>{ARCHETYPE_LABEL[general.archetype].toUpperCase()} BUILD</span><h2>{general.name}</h2></div><small>账户 v{account.weapon.version}</small></div>
        <div className="meta-weapon-slots">
          {slots.map((weaponId, index) => (
            <button type="button" key={index} onClick={() => setEditingSlot(index as 0 | 1)} className={cx('meta-weapon-slot', editingSlot === index && 'meta-weapon-slot-editing')}>
              <span>武器 {index + 1}</span><strong>{weapons.find((weapon) => weapon.weaponId === weaponId)?.name ?? '空槽位'}</strong><small>{weaponId ? '点击选择后可替换' : '从下方选择已解锁武器'}</small>
              {weaponId ? <i role="button" tabIndex={0} onClick={(event) => { event.stopPropagation(); const next = [...slots] as [string | null, string | null]; next[index] = null; setSlots(next) }}><X className="h-4 w-4" /></i> : null}
            </button>
          ))}
          <button type="button" className="meta-primary-button" disabled={busy} onClick={() => void onSave(general.generalId, slots)}><Save className="h-4 w-4" />保存双武器</button>
        </div>
        <div className="meta-compatibility-hint"><Sparkles className="h-4 w-4" /><span>已优先展示{ARCHETYPE_LABEL[general.archetype]}适配武器；红色专武只能由对应神将佩戴。已解锁通用武器可被多名神将同时配置。</span></div>
        {orderedWeapons.length > 0 ? <div className="meta-weapon-grid">{orderedWeapons.map((weapon) => (
          <WeaponCard key={weapon.weaponId} weapon={weapon} account={account} general={general} equipped={slots[editingSlot] === weapon.weaponId} busy={busy} onEquip={() => equip(weapon)} onCraft={() => void onCraft(weapon.weaponId)} />
        ))}</div> : <p className="meta-inline-empty">服务端尚未下发武器目录。</p>}
      </section>
    </div>
  )
}

function ShopView({ account, entitlements, offers, busy, onLoadOffers, onPurchase }: {
  account: PlayerMetaAccount
  entitlements: PurchaseEntitlement[]
  offers: ReturnType<typeof usePlayerAccount>['offers']
  busy: boolean
  onLoadOffers: (id: string) => Promise<unknown>
  onPurchase: (entitlementId: string, offerId: string) => Promise<unknown>
}) {
  const available = entitlements.filter((entry) => !entry.consumed)
  const [selectedId, setSelectedId] = useState(available[0]?.entitlementId ?? '')
  const selected = available.find((entry) => entry.entitlementId === selectedId) ?? available[0]

  useEffect(() => {
    if (!selectedId && available[0]) setSelectedId(available[0].entitlementId)
  }, [available, selectedId])

  return (
    <div className="meta-shop-layout">
      <section className="meta-panel">
        <div className="meta-panel-heading"><div><span>PURCHASE RIGHTS</span><h2>可用购买权</h2></div><small>{available.length} 张</small></div>
        {available.length > 0 ? <div className="meta-entitlement-list">{available.map((entry) => (
          <button type="button" key={entry.entitlementId} onClick={() => { setSelectedId(entry.entitlementId); void onLoadOffers(entry.entitlementId) }} className={cx('meta-entitlement-card', selected?.entitlementId === entry.entitlementId && 'meta-entitlement-card-active')}>
            <ShoppingBag className="h-5 w-5" /><div><strong>{ENTITLEMENT_LABELS[entry.kind] ?? entry.label}</strong><small>{entry.entitlementId}</small></div><ChevronRight className="h-4 w-4" />
          </button>
        ))}</div> : <p className="meta-inline-empty">当前没有未消耗的购买权。通过第 5/10/15 波与通关结算获得新购买权。</p>}
      </section>
      <section className="meta-panel meta-shop-offers">
        <div className="meta-panel-heading"><div><span>FIXED OFFERS</span><h2>三选一</h2></div><div className="meta-gold-badge"><Coins className="h-4 w-4" />{account.gold}</div></div>
        {selected && offers.length === 0 ? (
          <div className="meta-inline-empty meta-shop-empty">
            <ShoppingBag className="h-8 w-8" /><p>选中购买权后请加载候选。候选由服务端按购买权 ID 固定，重复打开不会刷新。</p><button type="button" disabled={busy} className="meta-action-button" onClick={() => void onLoadOffers(selected.entitlementId)}><RefreshCw className="h-4 w-4" />加载 3 个候选</button>
          </div>
        ) : offers.length > 0 && selected ? <div className="meta-offer-grid">{offers.map((offer) => (
          <article key={offer.offerId} className={cx('meta-offer-card', offer.quality && `meta-quality-${offer.quality}`)}>
            <span>{offer.kind === 'weapon_fragment' ? '武器碎片' : offer.kind === 'item' ? '永久道具' : offer.kind}</span>
            <h3>{offer.name}</h3><p>{offer.description || '服务端候选，购买成功后永久写入账户。'}</p>
            <button type="button" disabled={busy || account.gold < offer.priceGold} onClick={() => void onPurchase(selected.entitlementId, offer.offerId)}><Coins className="h-4 w-4" />{account.gold < offer.priceGold ? `需要 ${offer.priceGold} 金币` : `${offer.priceGold} 金币购买`}</button>
          </article>
        ))}</div> : <p className="meta-inline-empty">请先获得一张购买权。</p>}
      </section>
    </div>
  )
}

export function MetaSystemPage({ mode }: { mode: MetaSystemMode }) {
  const navigate = useNavigate()
  const service = usePlayerAccount()
  const info = MODE_INFO[mode]
  const Icon = info.icon

  return (
    <main className="meta-page">
      <div className="cyber-background" /><div className="cyber-grid" /><div className="cyber-noise" />
      <div className="meta-shell">
        <header className="meta-header">
          <button type="button" className="meta-back-button" onClick={() => navigate('/home')}><ArrowLeft className="h-4 w-4" />返回主页</button>
          <MetaNav mode={mode} />
          <div className="meta-title-row"><div className="meta-title-icon"><Icon className="h-7 w-7" /></div><div><span>OUT-OF-MATCH SYSTEM</span><h1>{info.title}</h1><p>{info.subtitle}</p></div>{service.data ? <div className="meta-account-summary"><Coins className="h-4 w-4" /><strong>{service.data.account.gold}</strong><span>局外金币</span></div> : null}</div>
        </header>

        {service.error && service.data ? <div className="meta-feedback meta-feedback-error">{service.error}</div> : null}
        {service.notice ? <div className="meta-feedback meta-feedback-success">{service.notice}</div> : null}

        {service.isLoading ? <LoadingState /> : !service.data ? <ApiEmptyState error={service.error} onRetry={() => void service.refresh()} /> : (
          <>
            {mode === 'build' ? <ItemBuildView account={service.data.account} items={service.data.catalogs.items} busy={service.isMutating} onSave={service.saveItemLoadout} /> : null}
            {mode === 'arsenal' ? <ArsenalView account={service.data.account} weapons={service.data.catalogs.weapons} generals={service.data.catalogs.generals} busy={service.isMutating} onSave={service.saveWeaponLoadout} onCraft={service.craftWeapon} /> : null}
            {mode === 'shop' ? <ShopView account={service.data.account} entitlements={service.data.account.entitlements} offers={service.offers} busy={service.isMutating} onLoadOffers={service.loadOffers} onPurchase={service.purchaseOffer} /> : null}
          </>
        )}
      </div>
    </main>
  )
}
