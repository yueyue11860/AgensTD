import { BookOpen, CheckCircle2, Flag, LockKeyhole, Skull, Sparkles } from 'lucide-react'
import { LEVEL_DEFS, type LevelDef } from '../lib/level-defs'
import type { PveDifficulty, PveStageAccess } from '../hooks/use-player-account'
import { useModalFocus } from '../hooks/use-modal-focus'

export interface PveStageChoice {
  levelId: number
  difficulty: PveDifficulty
}

interface MissionBriefingModalProps {
  isHost: boolean
  playerKind: 'human' | 'agent'
  stageAccess: readonly PveStageAccess[]
  progressionLoading: boolean
  onSelectLevel: (selection: PveStageChoice) => void
  engineError: string | null
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
  onSelectLevel,
  engineError,
}: MissionBriefingModalProps) {
  const dialogRef = useModalFocus()
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
        </div>

        {engineError && <div className="mission-briefing-error" role="alert"><span className="mission-briefing-error-code">军情</span>{engineError}</div>}

        {isHost && (
          <div className="mission-level-list" aria-busy={progressionLoading}>
            {LEVEL_DEFS.map(def => <ChapterCard key={def.levelId} def={def} stageAccess={stageAccess} disabled={progressionLoading} onSelect={onSelectLevel} />)}
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
