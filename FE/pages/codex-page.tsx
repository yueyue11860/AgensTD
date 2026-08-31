import { useMemo, useState } from 'react'
import { ArrowLeft, BookOpen, LockKeyhole, Search, Shield, Skull, Swords } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { usePlayerAccount, type GeneralArchetype } from '../hooks/use-player-account'
import { cx } from '../lib/cx'

type CodexTab = 'generals' | 'items' | 'monsters' | 'bosses'

const ARCHETYPE_LABEL: Record<GeneralArchetype, string> = { physical: '物理', magic: '魔法', summon: '召唤', control: '控制' }
const QUALITY_LABEL: Record<string, string> = { green: '绿', blue: '蓝', purple: '紫', orange: '橙', red: '红' }

const TABS: Array<{ id: CodexTab; label: string; icon: typeof BookOpen }> = [
  { id: 'generals', label: '神将', icon: Swords }, { id: 'items', label: '图鉴 / 道具', icon: BookOpen },
  { id: 'monsters', label: '怪物', icon: Shield }, { id: 'bosses', label: 'Boss', icon: Skull },
]

function CodexCard({ locked, glyph, title, subtitle, description, lockedDescription, tags }: { locked?: boolean; glyph: string; title: string; subtitle?: string; description: string; lockedDescription?: string; tags?: string[] }) {
  return <article className={cx('codex-card', locked && 'codex-card-locked')}>
    <div className="codex-glyph">{glyph}</div><div className="codex-card-copy"><div className="codex-card-title"><h3>{locked ? '???' : title}</h3>{locked ? <LockKeyhole className="h-4 w-4" /> : null}</div>
      <small>{locked ? '尚未解锁' : subtitle}</small><p>{locked ? (lockedDescription ?? '完成关卡或收集足够碎片后解锁该条目。') : description}</p>
      {tags?.length ? <div className="codex-tags">{tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : null}
    </div>
  </article>
}

function PveCatalogEmpty({ category, hasEncyclopedia, hasQuery }: { category: '怪物' | 'Boss'; hasEncyclopedia: boolean; hasQuery: boolean }) {
  if (!hasEncyclopedia) {
    return <p className="meta-inline-empty">{category}图鉴尚未显现。</p>
  }
  return <p className="meta-inline-empty">{hasQuery ? `没有匹配的${category}。` : `${category}图鉴尚未显现。`}</p>
}

export function CodexPage() {
  const navigate = useNavigate(); const service = usePlayerAccount(); const [tab, setTab] = useState<CodexTab>('generals'); const [query, setQuery] = useState('')
  const data = service.data; const normalizedQuery = query.trim().toLowerCase(); const encyclopedia = data?.encyclopedia
  const generals = encyclopedia?.generals ?? data?.catalogs.generals ?? []
  const items = encyclopedia?.items ?? data?.catalogs.items ?? []
  const weapons = encyclopedia?.weapons ?? data?.catalogs.weapons ?? []
  const minions = encyclopedia?.minions
  const bosses = encyclopedia?.bosses
  // The codex is allowed to show the full catalog, but an entry must still be
  // visibly locked unless the account supplied an explicit unlock signal.
  const isGeneralUnlocked = (id: string, unlocked?: boolean) => data?.generalSelection.unlockStateKnown
    ? data.generalSelection.unlockedGeneralIds.includes(id)
    : unlocked === true
  const itemUnlocked = useMemo(() => new Set([...(data?.account.item.unlockedActiveItemIds ?? []), ...(data?.account.item.unlockedPassiveItemIds ?? [])]), [data])
  const weaponUnlocked = useMemo(() => new Set(data?.account.weapon.unlockedWeaponIds ?? []), [data])
  const match = (name: string) => !normalizedQuery || name.toLowerCase().includes(normalizedQuery)
  const matchedMinions = minions?.filter((entry) => match(String(entry.displayName ?? entry.label ?? entry.entryId ?? ''))) ?? []
  const matchedBosses = bosses?.filter((entry) => match(String(entry.displayName ?? entry.entryId ?? ''))) ?? []
  const counts = { generals: generals.length, items: items.length + weapons.length, monsters: minions?.length ?? 0, bosses: bosses?.length ?? 0 }

  return <main className="meta-page codex-page"><div className="cyber-background" /><div className="cyber-grid" /><div className="cyber-noise" /><div className="meta-shell codex-shell">
    <header className="meta-header"><button type="button" className="meta-back-button" onClick={() => navigate('/home')}><ArrowLeft className="h-4 w-4" />返回主页</button>
      <div className="meta-title-row"><div className="meta-title-icon"><BookOpen className="h-7 w-7" /></div><div><span>COLLECTION ARCHIVE</span><h1>全量图鉴</h1><p>神将、道具、怪物与 Boss 的完整档案。未解锁内容会以灰色剪影展示。</p></div></div>
    </header>
    {service.isLoading && !data ? <section className="meta-empty-state"><BookOpen className="h-7 w-7 text-cyan-300" /><div><strong>正在展开图鉴</strong><p>请稍候……</p></div></section> : !data ? <section className="meta-empty-state meta-empty-state-error"><div><strong>图鉴暂时闭合</strong><p>{service.error ?? '请稍后再来。'}</p></div></section> : <>
      <div className="codex-toolbar"><nav className="codex-tabs" aria-label="图鉴分类">{TABS.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={cx('codex-tab', tab === id && 'codex-tab-active')} onClick={() => setTab(id)}><Icon className="h-4 w-4" />{label}<span>{counts[id]}</span></button>)}</nav><label className="codex-search"><Search className="h-4 w-4" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称…" /></label></div>
      <section className="codex-grid">
        {tab === 'generals' && generals.filter((entry) => match(entry.name)).map((entry) => <CodexCard key={entry.generalId} locked={!isGeneralUnlocked(entry.generalId, entry.unlocked)} glyph={entry.name.slice(0, 1)} title={entry.name} subtitle={`${ARCHETYPE_LABEL[entry.archetype]} · ${entry.quality ?? '神将'}`} description="可在对局中选用的神将，拥有独特技能与成长曲线。" tags={[entry.generalId]} />)}
        {tab === 'items' && <>{items.filter((entry) => match(entry.name)).map((entry) => <CodexCard key={entry.itemId} locked={encyclopedia ? !('unlocked' in entry && entry.unlocked === true) : !itemUnlocked.has(entry.itemId)} glyph={entry.name.slice(0, 1)} title={entry.name} subtitle={`${entry.itemKind === 'active' ? '主动道具' : '被动道具'} · ${entry.itemId}`} description={entry.shortDescription || entry.detailDescription || '暂无效果说明'} tags={[entry.itemKind === 'active' ? '主动' : '被动']} />)}{weapons.filter((entry) => match(entry.name)).map((entry) => <CodexCard key={entry.weaponId} locked={encyclopedia ? !('unlocked' in entry && entry.unlocked === true) : !weaponUnlocked.has(entry.weaponId)} glyph={entry.name.slice(0, 1)} title={entry.name} subtitle={`${QUALITY_LABEL[entry.quality] ?? entry.quality}品武器 · ${entry.weaponId}`} description={entry.shortDescription || entry.detailDescription || '暂无效果说明'} tags={[entry.exclusiveGeneralId ? '神将专属' : '通用武器']} />)}</>}
        {tab === 'monsters' && matchedMinions.map((entry) => {
          const name = String(entry.displayName ?? entry.label ?? entry.entryId ?? '未命名怪物')
          const waveNumber = typeof entry.waveNumber === 'number' ? entry.waveNumber : null
          const glyphs = Array.isArray(entry.glyphPool)
            ? entry.glyphPool.filter((glyph): glyph is string => typeof glyph === 'string').slice(0, 2).join('·')
            : ''
          const glyph = glyphs || name.slice(0, 1)
          const stats = [
            typeof entry.maxHp === 'number' ? `生命 ${entry.maxHp}` : null,
            typeof entry.armor === 'number' ? `护甲 ${entry.armor}` : null,
            typeof entry.magicResistance === 'number' ? `法抗 ${entry.magicResistance}` : null,
          ].filter((value): value is string => Boolean(value)).join(' · ')
          return <CodexCard key={String(entry.entryId ?? name)} locked={entry.unlocked !== true} glyph={glyph} title={name} subtitle={`第 ${waveNumber ?? '?'} 波 · 新版字妖`} description={stats || String(entry.description ?? '战场敌对字妖。')} lockedDescription="在关卡中实际遇到该字妖后解锁图鉴。" tags={['敌对单位', ...(waveNumber ? [`W${waveNumber}`] : [])]} />
        })}
        {tab === 'bosses' && matchedBosses.map((entry) => { const name = String(entry.displayName ?? entry.entryId ?? '未命名 Boss'); return <CodexCard key={String(entry.entryId ?? name)} locked={entry.unlocked !== true} glyph={name.slice(0, 1)} title={name} subtitle={`第 ${String(entry.levelId ?? '?')} 关 · 第 ${String(entry.waveNumber ?? '?')} 波 · ${String(entry.role ?? 'Boss')}`} description="关卡节点 Boss，拥有独特技能组合与阶段性战斗机制。" lockedDescription="在关卡中实际遇到该 Boss 后解锁图鉴。" tags={['Boss', `L${String(entry.levelId ?? '?')}`]} /> })}
        {tab === 'monsters' && matchedMinions.length === 0 ? <PveCatalogEmpty category="怪物" hasEncyclopedia={Boolean(encyclopedia)} hasQuery={Boolean(normalizedQuery)} /> : null}
        {tab === 'bosses' && matchedBosses.length === 0 ? <PveCatalogEmpty category="Boss" hasEncyclopedia={Boolean(encyclopedia)} hasQuery={Boolean(normalizedQuery)} /> : null}
        {((tab === 'generals' && !generals.some((e) => match(e.name))) || (tab === 'items' && ![...items, ...weapons].some((e) => match(e.name)))) ? <p className="meta-inline-empty">没有匹配的图鉴条目。</p> : null}
      </section>
    </>}
  </div></main>
}
