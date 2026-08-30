import { useEffect, useState } from 'react'
import { BookOpen, Check, CheckCircle2, Flag, LockKeyhole, Skull, Sparkles } from 'lucide-react'
import { LEVEL_DEFS, type LevelDef } from '../lib/level-defs'
import type { GeneralCatalogEntry, GeneralSelectionConfig, PveDifficulty, PveStageAccess } from '../hooks/use-player-account'
import { useModalFocus } from '../hooks/use-modal-focus'

export interface PveStageChoice {
  levelId: number
  difficulty: PveDifficulty
  /** Optional pre-match general pool; ignored by legacy servers. */
  selectedGeneralIds?: string[]
}

interface MissionBriefingModalProps {
  isHost: boolean
  playerKind: 'human' | 'agent'
  stageAccess: readonly PveStageAccess[]
  progressionLoading: boolean
  generals?: readonly GeneralCatalogEntry[]
  generalSelection?: GeneralSelectionConfig
  onSelectGenerals?: (generalIds: string[]) => void
  onSelectLevel: (selection: PveStageChoice) => void
  engineError: string | null
}

function GeneralSelectionPanel({
  generals,
  config,
  selectedIds,
  onToggle,
}: {
  generals: readonly GeneralCatalogEntry[]
  config: GeneralSelectionConfig
  selectedIds: readonly string[]
  onToggle: (generalId: string) => void
}) {
  if (generals.length === 0) return null
  const selected = new Set(selectedIds)
  const canSelect = selected.size < config.maxPerMatch
  return (
    <section className="mission-general-selection" aria-label="本局神将预选池">
      <div className="mission-general-selection-heading">
        <div><span>GENERAL POOL</span><strong>本局神将预选</strong></div>
        <small>{selected.size}/{config.maxPerMatch}</small>
      </div>
      <p>{config.unlockStateKnown ? '仅可选择已解锁神将；开局后预选池锁定。' : '正在等待账户解锁矩阵；未确认解锁状态的神将暂不可选。'}</p>
      <div className="mission-general-grid">
        {generals.map((general) => {
          const explicitlyLocked = config.unlockStateKnown
            ? general.unlocked === false || !config.unlockedGeneralIds.includes(general.generalId)
            : general.unlocked !== true
          const disabled = explicitlyLocked || (!selected.has(general.generalId) && !canSelect)
          return (
            <button
              type="button"
              key={general.generalId}
              disabled={disabled}
              aria-pressed={selected.has(general.generalId)}
              title={explicitlyLocked ? '尚未解锁' : disabled ? `最多选择 ${config.maxPerMatch} 名神将` : undefined}
              className={`mission-general-chip${selected.has(general.generalId) ? ' mission-general-chip-selected' : ''}${explicitlyLocked ? ' mission-general-chip-locked' : ''}`}
              onClick={() => onToggle(general.generalId)}
            >
              <span>{general.name.slice(0, 1)}</span>
              <div><strong>{general.name}</strong><small>{general.quality ?? general.archetype}</small></div>
              {explicitlyLocked ? <LockKeyhole className="h-3.5 w-3.5" /> : selected.has(general.generalId) ? <Check className="h-3.5 w-3.5" /> : null}
            </button>
          )
        })}
      </div>
    </section>
  )
}

const CHAPTER_NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'] as const

const DIFFICULTIES: ReadonlyArray<{ id: PveDifficulty; label: string; cap: string; hint: string }> = [
  { id: 'easy', label: '试炼', cap: '最高紫碎片', hint: '熟悉路线与合字' },
  { id: 'normal', label: '劫难', cap: '最高橙碎片', hint: '敌军更强，重视羁绊' },
  { id: 'hard', label: '天命', cap: '红碎片 · 专武保底', hint: '终局构筑挑战' },
]

function ChapterCard({
  def,
  stageAccess,
  disabled,
  onSelect,
}: {
  def: LevelDef
  stageAccess: readonly PveStageAccess[]
  disabled: boolean
  onSelect: (selection: PveStageChoice) => void
}) {
  const chapter = CHAPTER_NUMERALS[def.levelId - 1] ?? String(def.levelId)
  return (
    <article className="mission-chapter-card">
      <div className="mission-chapter-seal" aria-hidden>{String(def.levelId).padStart(2, '0')}</div>
      <header className="mission-chapter-heading">
        <div>
          <span className="mission-chapter-number">第 {chapter} 回</span>
          <h3>{def.label}</h3>
        </div>
        <span className="mission-chapter-glyphs" aria-label={`本关敌军：${def.minionGlyphs.join('、')}`}>
          {def.minionGlyphs.map(glyph => <i key={glyph}>{glyph}</i>)}
        </span>
      </header>
      <p className="mission-chapter-subtitle">{def.subtitle}</p>
      <p className="mission-chapter-description">{def.description}</p>
      <div className="mission-chapter-omens">
        <span><Skull className="h-3.5 w-3.5" />首领伏笔：{def.bossTheme}</span>
        {def.levelId === 1
          ? <span className="mission-opening-objective"><Flag className="h-3.5 w-3.5" />开场目标：召唤天兵，落子守住第一波</span>
          : <span><Sparkles className="h-3.5 w-3.5" />二十波守关 · 每五波首领来袭</span>}
      </div>
      <div className="mission-difficulty-actions" aria-label={`${def.label}难度与奖励`}>
        {DIFFICULTIES.map((difficulty) => {
          const access = stageAccess.find(entry => entry.levelId === def.levelId && entry.difficulty === difficulty.id)
          const unlocked = access?.unlocked ?? (difficulty.id === 'easy' && def.levelId === 1)
          const locked = disabled || !unlocked
          return (
            <button
              type="button"
              key={difficulty.id}
              disabled={locked}
              title={access?.lockedReason ?? difficulty.hint}
              className={`mission-difficulty-button mission-difficulty-${difficulty.id}${access?.cleared ? ' mission-difficulty-cleared' : ''}`}
              onClick={() => onSelect({ levelId: def.levelId, difficulty: difficulty.id })}
            >
              {access?.cleared ? <CheckCircle2 className="h-3.5 w-3.5" /> : locked ? <LockKeyhole className="h-3.5 w-3.5" /> : null}
              <span>{difficulty.label}</span>
              <small>{difficulty.cap}</small>
            </button>
          )
        })}
      </div>
    </article>
  )
}

export function MissionBriefingModal({
  isHost,
  stageAccess,
  progressionLoading,
  generals = [],
  generalSelection = { maxPerMatch: 6, unlockStateKnown: false, unlockedGeneralIds: [] },
  onSelectGenerals,
  onSelectLevel,
  engineError,
}: MissionBriefingModalProps) {
  const dialogRef = useModalFocus()
  // Fail closed when the account unlock matrix is unavailable.  A plain
  // catalog entry is not evidence that a locked general may enter this match;
  // the server will also enforce the same rule at the snapshot boundary.
  const availableGeneralIds = generals.filter((general) => (
    generalSelection.unlockStateKnown
      ? general.unlocked !== false && generalSelection.unlockedGeneralIds.includes(general.generalId)
      : general.unlocked === true
  )).map((general) => general.generalId)
  const [selectedGeneralIds, setSelectedGeneralIds] = useState<string[]>(() => availableGeneralIds.slice(0, generalSelection.maxPerMatch))

  useEffect(() => {
    setSelectedGeneralIds((current) => {
      const retained = current.filter((id) => availableGeneralIds.includes(id)).slice(0, generalSelection.maxPerMatch)
      // Account data arrives asynchronously. Seed the same deterministic
      // default the server will use instead of leaving the panel at 0/N.
      return retained.length > 0 || availableGeneralIds.length === 0
        ? retained
        : availableGeneralIds.slice(0, generalSelection.maxPerMatch)
    })
  }, [generalSelection.maxPerMatch, availableGeneralIds.join('|')])

  function handleSelectLevel(selection: PveStageChoice) {
    onSelectLevel({ ...selection, selectedGeneralIds: selectedGeneralIds.length > 0 ? selectedGeneralIds : undefined })
  }

  return (
    <div className="mission-briefing-backdrop">
      <div
        ref={dialogRef}
        className="mission-briefing-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mission-briefing-title"
        tabIndex={-1}
      >
        <div className="mission-briefing-header">
          <span className="mission-briefing-mark"><BookOpen className="h-5 w-5" /></span>
          <p className="mission-briefing-eyebrow">天庭守关簿 · 西行卷</p>
          <h2 id="mission-briefing-title" className="mission-briefing-title">{isHost ? '请房主下守关军令' : '静候房主择定章回'}</h2>
          <p className="mission-briefing-desc">选择一回西游劫难与试炼强度。多人队伍仅能前往全员均已解锁的章节。</p>
          <div className="mission-briefing-legend">
            <span><i>试炼</i>熟悉路线</span>
            <span><i>劫难</i>考验羁绊</span>
            <span><i>天命</i>专武保底</span>
          </div>
          <GeneralSelectionPanel generals={generals} config={generalSelection} selectedIds={selectedGeneralIds} onToggle={(generalId) => {
            if (selectedGeneralIds.includes(generalId) && selectedGeneralIds.length === 1) return
            setSelectedGeneralIds((current) => {
              const next = current.includes(generalId)
                ? current.filter((id) => id !== generalId)
                : current.length < generalSelection.maxPerMatch ? [...current, generalId] : current
              if (next.length > 0) onSelectGenerals?.(next)
              return next
            })
          }} />
        </div>

        {engineError && <div className="mission-briefing-error" role="alert"><span className="mission-briefing-error-code">军情</span>{engineError}</div>}

        {isHost && (
          <div className="mission-level-list" aria-busy={progressionLoading}>
            {LEVEL_DEFS.map(def => <ChapterCard key={def.levelId} def={def} stageAccess={stageAccess} disabled={progressionLoading} onSelect={handleSelectLevel} />)}
          </div>
        )}

        {!isHost && (
          <div className="mission-waiting-hint">
            <span className="mission-waiting-seal">候</span>
            <div><strong>队伍已列阵</strong><p>房主选定章回后，将共同进入守关战场。</p></div>
          </div>
        )}
      </div>
    </div>
  )
}
