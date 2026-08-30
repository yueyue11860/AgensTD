import { useMemo, useState } from 'react'
import { ArrowLeft, BookOpen, LockKeyhole, Search, Shield, Skull, Swords } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { usePlayerAccount, type GeneralArchetype } from '../hooks/use-player-account'
import { cx } from '../lib/cx'

type CodexTab = 'generals' | 'items' | 'monsters' | 'bosses'

const ARCHETYPE_LABEL: Record<GeneralArchetype, string> = { physical: '物理', magic: '魔法', summon: '召唤', control: '控制' }
const QUALITY_LABEL: Record<string, string> = { green: '绿', blue: '蓝', purple: '紫', orange: '橙', red: '红' }

const MONSTERS = [
  ['Grunt', '机械杂兵', '基础血量，中等移速，无护甲。', '低'], ['Speedster', '猎犬/刺客', '极低血量，极快移速。', '中'],
  ['Tank', '重装行者', '高血量，高护甲，慢移速。', '高'], ['Shielded', '能量护盾兵', '自带高额护盾。', '中'],
  ['Cleanser', '净化者', '周期性清空 Debuff。', '高'], ['Grunt-Armored', '装甲杂兵', '高护甲普通单位。', '中'],
  ['Tank-Fortress', '堡垒重装', '极高护甲慢速单位。', '高'], ['Swarm-Drone', '虫群无人机', '低血量群体单位。', '低'],
  ['Swarm-Runner', '虫群突进体', '高速群体单位。', '中'], ['Cleanser-Pro', '净化者 Pro', '死亡后分裂的净化精英。', '高'],
  ['runner', 'Runner', '兼容旧版波次配置的标准单位。', '低'], ['swift', 'Swift', '兼容旧版波次配置的高速单位。', '中'],
  ['brute', 'Brute', '兼容旧版波次配置的重装单位。', '高'], ['Lord-01', '矩阵领主 I', '高血量首领。', 'Boss'],
  ['Lord-02', '矩阵领主 II', '高护甲高护盾首领。', 'Boss'], ['Lord-03', '矩阵领主 III', '虫群首领。', 'Boss'],
] as const

const BOSSES = [
  ['山魈先锋', 1, 5, '压力'], ['水帘魔猿', 1, 10, '生存'], ['花果魔帅', 1, 15, '支援'], ['混世魔王', 1, 20, '混合'],
  ['黑风熊先锋', 2, 5, '压力'], ['白花蛇怪', 2, 10, '生存'], ['凌虚子', 2, 15, '混合'], ['黑熊精', 2, 20, '生存'],
  ['虎先锋', 3, 5, '压力'], ['黄风妖将', 3, 10, '支援'], ['黄毛貂鼠', 3, 15, '混合'], ['黄风大圣', 3, 20, '压力'],
  ['河底怨魂', 4, 5, '生存'], ['九骷髅妖', 4, 10, '支援'], ['流沙妖将', 4, 15, '混合'], ['卷帘大将', 4, 20, '生存'],
  ['骨灵侍女', 5, 5, '支援'], ['白骨化身', 5, 10, '生存'], ['白骨夫人', 5, 15, '混合'], ['白骨精', 5, 20, '生存'],
  ['精细鬼', 6, 5, '压力'], ['伶俐虫', 6, 10, '混合'], ['银角大王', 6, 15, '生存'], ['金角大王', 6, 20, '混合'],
  ['蛛丝侍女', 7, 5, '支援'], ['蛛女长姐', 7, 10, '生存'], ['七蛛女', 7, 15, '支援'], ['百眼魔君', 7, 20, '混合'],
  ['毒花娘子', 8, 5, '支援'], ['琵琶洞主', 8, 10, '生存'], ['倒马毒后', 8, 15, '压力'], ['蝎子精', 8, 20, '混合'],
  ['青狮先锋', 9, 5, '压力'], ['白象大王', 9, 10, '生存'], ['金翅大鹏', 9, 15, '压力'], ['狮驼三圣', 9, 20, '混合'],
  ['火云先锋', 10, 5, '压力'], ['铁扇公主', 10, 10, '支援'], ['牛魔王', 10, 15, '生存'], ['平天大圣', 10, 20, '混合'],
] as const

const TABS: Array<{ id: CodexTab; label: string; icon: typeof BookOpen }> = [
  { id: 'generals', label: '神将', icon: Swords }, { id: 'items', label: '图鉴 / 道具', icon: BookOpen },
  { id: 'monsters', label: '怪物', icon: Shield }, { id: 'bosses', label: 'Boss', icon: Skull },
]

function CodexCard({ locked, glyph, title, subtitle, description, tags }: { locked?: boolean; glyph: string; title: string; subtitle?: string; description: string; tags?: string[] }) {
  return <article className={cx('codex-card', locked && 'codex-card-locked')}>
    <div className="codex-glyph">{glyph}</div><div className="codex-card-copy"><div className="codex-card-title"><h3>{locked ? '???' : title}</h3>{locked ? <LockKeyhole className="h-4 w-4" /> : null}</div>
      <small>{locked ? '尚未解锁' : subtitle}</small><p>{locked ? '完成关卡或收集足够碎片后解锁该条目。' : description}</p>
      {tags?.length ? <div className="codex-tags">{tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : null}
    </div>
  </article>
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
  const counts = { generals: generals.length, items: items.length + weapons.length, monsters: minions?.length ?? MONSTERS.length, bosses: bosses?.length ?? BOSSES.length }

  return <main className="meta-page codex-page"><div className="cyber-background" /><div className="cyber-grid" /><div className="cyber-noise" /><div className="meta-shell codex-shell">
    <header className="meta-header"><button type="button" className="meta-back-button" onClick={() => navigate('/home')}><ArrowLeft className="h-4 w-4" />返回主页</button>
      <div className="meta-title-row"><div className="meta-title-icon"><BookOpen className="h-7 w-7" /></div><div><span>COLLECTION ARCHIVE</span><h1>全量图鉴</h1><p>神将、道具、怪物与 Boss 的完整档案。未解锁内容会以灰色剪影展示。</p></div></div>
    </header>
    {service.isLoading && !data ? <section className="meta-empty-state"><BookOpen className="h-7 w-7 text-cyan-300" /><div><strong>正在同步图鉴目录</strong><p>正在获取账户解锁状态……</p></div></section> : !data ? <section className="meta-empty-state meta-empty-state-error"><div><strong>图鉴服务暂不可用</strong><p>{service.error ?? '请稍后重试。'}</p></div></section> : <>
      <div className="codex-toolbar"><nav className="codex-tabs" aria-label="图鉴分类">{TABS.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={cx('codex-tab', tab === id && 'codex-tab-active')} onClick={() => setTab(id)}><Icon className="h-4 w-4" />{label}<span>{counts[id]}</span></button>)}</nav><label className="codex-search"><Search className="h-4 w-4" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称…" /></label></div>
      <section className="codex-grid">
        {tab === 'generals' && generals.filter((entry) => match(entry.name)).map((entry) => <CodexCard key={entry.generalId} locked={!isGeneralUnlocked(entry.generalId, entry.unlocked)} glyph={entry.name.slice(0, 1)} title={entry.name} subtitle={`${ARCHETYPE_LABEL[entry.archetype]} · ${entry.quality ?? '神将'}`} description="可在对局中选用的神将，拥有独特技能与成长曲线。" tags={[entry.generalId]} />)}
        {tab === 'items' && <>{items.filter((entry) => match(entry.name)).map((entry) => <CodexCard key={entry.itemId} locked={encyclopedia ? !('unlocked' in entry && entry.unlocked === true) : !itemUnlocked.has(entry.itemId)} glyph={entry.name.slice(0, 1)} title={entry.name} subtitle={`${entry.itemKind === 'active' ? '主动道具' : '被动道具'} · ${entry.itemId}`} description={entry.shortDescription || entry.detailDescription || '暂无效果说明'} tags={[entry.itemKind === 'active' ? '主动' : '被动']} />)}{weapons.filter((entry) => match(entry.name)).map((entry) => <CodexCard key={entry.weaponId} locked={encyclopedia ? !('unlocked' in entry && entry.unlocked === true) : !weaponUnlocked.has(entry.weaponId)} glyph={entry.name.slice(0, 1)} title={entry.name} subtitle={`${QUALITY_LABEL[entry.quality] ?? entry.quality}品武器 · ${entry.weaponId}`} description={entry.shortDescription || entry.detailDescription || '暂无效果说明'} tags={[entry.exclusiveGeneralId ? '神将专属' : '通用武器']} />)}</>}
        {tab === 'monsters' && (minions ? minions.filter((entry) => match(String(entry.displayName ?? entry.label ?? entry.entryId ?? ''))).map((entry) => { const name = String(entry.displayName ?? entry.label ?? entry.entryId ?? '未命名怪物'); return <CodexCard key={String(entry.entryId ?? name)} glyph={name.slice(0, 1)} title={name} subtitle={String(entry.kind ?? '敌对单位')} description={String(entry.description ?? '战场敌对单位。')} tags={['敌对单位']} /> }) : MONSTERS.filter((entry) => match(entry[1])).map(([id, name, description, threat]) => <CodexCard key={id} glyph={name.slice(0, 1)} title={name} subtitle={`${id} · 威胁${threat}`} description={description} tags={['敌对单位']} />))}
        {tab === 'bosses' && (bosses ? bosses.filter((entry) => match(String(entry.displayName ?? entry.entryId ?? ''))).map((entry) => { const name = String(entry.displayName ?? entry.entryId ?? '未命名 Boss'); return <CodexCard key={String(entry.entryId ?? name)} glyph={name.slice(0, 1)} title={name} subtitle={`第 ${String(entry.levelId ?? '?')} 关 · 第 ${String(entry.waveNumber ?? '?')} 波 · ${String(entry.role ?? 'Boss')}`} description="关卡节点 Boss，拥有独特技能组合与阶段性战斗机制。" tags={['Boss', `L${String(entry.levelId ?? '?')}`]} /> }) : BOSSES.filter((entry) => match(entry[0])).map(([name, level, wave, role]) => <CodexCard key={`${level}-${wave}`} glyph={name.slice(0, 1)} title={name} subtitle={`第 ${level} 关 · 第 ${wave} 波 · ${role}`} description="关卡节点 Boss，拥有独特技能组合与阶段性战斗机制。" tags={['Boss', `L${level}`]} />))}
        {((tab === 'generals' && !generals.some((e) => match(e.name))) || (tab === 'items' && ![...items, ...weapons].some((e) => match(e.name))) || (tab === 'monsters' && !(minions ? minions.some((e) => match(String(e.displayName ?? e.label ?? e.entryId ?? ''))) : MONSTERS.some((e) => match(e[1])))) || (tab === 'bosses' && !(bosses ? bosses.some((e) => match(String(e.displayName ?? e.entryId ?? ''))) : BOSSES.some((e) => match(e[0]))))) ? <p className="meta-inline-empty">没有匹配的图鉴条目。</p> : null}
      </section>
    </>}
  </div></main>
}
