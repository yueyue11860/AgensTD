import { useEffect, useRef, useState } from 'react'
import { Flag, ShieldAlert, Swords } from 'lucide-react'
import {
  deriveBattleAnnouncementCandidates,
  type AccessibleBattleEvent,
  type AccessibleBossState,
  type BattleAnnouncement,
} from '../game/accessibility/battlefield-accessibility'
import { cx } from '../lib/cx'

interface BattlefieldDomSummaryProps {
  id: string
  wave: number
  maxWaves: number
  enemyCount: number
  bossNames: readonly string[]
  cursor: { x: number; y: number } | null
  selectedObject: string
  executableActions: string
}

export function BattlefieldDomSummary({ id, wave, maxWaves, enemyCount, bossNames, cursor, selectedObject, executableActions }: BattlefieldDomSummaryProps) {
  return (
    <aside id={id} className="battlefield-dom-summary" aria-label="战场文字摘要">
      <h2>战场摘要</h2>
      <p>第 {wave} / {maxWaves || '—'} 波，当前敌军 {enemyCount}。</p>
      <p>{bossNames.length > 0 ? `首领：${bossNames.join('、')}。` : '当前没有已现身首领。'}</p>
      <p>{cursor ? `格游标位于第 ${cursor.x + 1} 列、第 ${cursor.y + 1} 行。` : '战场尚未聚焦。'}</p>
      <p>当前选择：{selectedObject}。</p>
      <p>可执行动作：{executableActions}</p>
    </aside>
  )
}

interface BattleChapterDirectorProps {
  matchId: string | null
  chapterLabel: string
  currentWave: number
  maxWaves: number
  prepCountdownSec: number
  enemyCount: number
  recentEvents: readonly AccessibleBattleEvent[]
  bosses: readonly AccessibleBossState[]
}

export function BattleChapterDirector(props: BattleChapterDirectorProps) {
  const [active, setActive] = useState<BattleAnnouncement | null>(null)
  const [reducedMotion, setReducedMotion] = useState(false)
  const matchRef = useRef<string | null>(null)
  const seenRef = useRef(new Set<string>())
  const queueRef = useRef<BattleAnnouncement[]>([])

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (matchRef.current !== props.matchId) {
      matchRef.current = props.matchId
      seenRef.current.clear()
      queueRef.current = []
      setActive(null)
    }

    const newAnnouncements = deriveBattleAnnouncementCandidates(props)
      .filter(announcement => !seenRef.current.has(announcement.key))
    if (newAnnouncements.length === 0) return
    for (const announcement of newAnnouncements) seenRef.current.add(announcement.key)
    const bossAnnouncement = newAnnouncements.find(announcement => announcement.kind === 'boss')
    if (bossAnnouncement) {
      queueRef.current = []
      setActive(bossAnnouncement)
      return
    }
    queueRef.current.push(...newAnnouncements)
    setActive(current => current ?? queueRef.current.shift() ?? null)
  }, [props])

  useEffect(() => {
    if (!active) return
    const timer = window.setTimeout(() => {
      setActive(queueRef.current.shift() ?? null)
    }, active.kind === 'boss' ? 4_800 : 3_400)
    return () => window.clearTimeout(timer)
  }, [active])

  return (
    <>
      <div className="battle-chapter-live" aria-live={active?.kind === 'boss' ? 'assertive' : 'polite'} aria-atomic="true">
        {active ? `${active.title}。目标：${active.objective} 威胁：${active.threat}` : ''}
      </div>
      {active ? (
        <section
          className={cx('battle-chapter-notice', `battle-chapter-notice-${active.kind}`, reducedMotion && 'battle-chapter-notice-reduced')}
          aria-hidden="true"
          data-testid="battle-chapter-notice"
        >
          <span className="battle-chapter-notice-mark">
            {active.kind === 'boss' ? <ShieldAlert /> : active.kind === 'wave' ? <Swords /> : <Flag />}
          </span>
          <div>
            <small>章回题签</small>
            <h2>{active.title}</h2>
            <p><b>目标</b>{active.objective}</p>
            <p><b>威胁</b>{active.threat}</p>
          </div>
        </section>
      ) : null}
    </>
  )
}
