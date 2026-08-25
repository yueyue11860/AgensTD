import { CheckCircle2, LockKeyhole } from 'lucide-react'
import { LEVEL_DEFS, type LevelDef } from '../lib/level-defs'
import type { PveDifficulty, PveStageAccess } from '../hooks/use-player-account'

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

const DIFFICULTIES: ReadonlyArray<{ id: PveDifficulty; label: string; cap: string }> = [
  { id: 'easy', label: '简单', cap: '最高紫碎片' },
  { id: 'normal', label: '普通', cap: '最高橙碎片' },
  { id: 'hard', label: '困难', cap: '最高红碎片 · 专武保底' },
]

function LevelRow({
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
  return (
    <div className="mission-level-row mission-level-row-active">
      <span className="mission-level-badge">{`PVE-${def.levelId}`}</span>
      <span className="mission-row-info">
        <span className="mission-row-name">{def.label}</span>
        <span className="mission-row-sub">{def.subtitle}</span>
        <span className="mission-row-sub">{`小怪：${def.minionGlyphs.join('·')}`}</span>
      </span>
      <span className="mission-difficulty-actions">
        {DIFFICULTIES.map((difficulty) => {
          const access = stageAccess.find(entry => entry.levelId === def.levelId && entry.difficulty === difficulty.id)
          const unlocked = access?.unlocked ?? (difficulty.id === 'easy' && def.levelId === 1)
          const locked = disabled || !unlocked
          return (
            <button
              type="button"
              key={difficulty.id}
              disabled={locked}
              title={access?.lockedReason ?? difficulty.cap}
              className={`mission-difficulty-button mission-difficulty-${difficulty.id}${access?.cleared ? ' mission-difficulty-cleared' : ''}`}
              onClick={() => onSelect({ levelId: def.levelId, difficulty: difficulty.id })}
            >
              {access?.cleared ? <CheckCircle2 className="h-3.5 w-3.5" /> : locked ? <LockKeyhole className="h-3.5 w-3.5" /> : null}
              <span>{difficulty.label}</span>
              <small>{difficulty.cap}</small>
            </button>
          )
        })}
      </span>
    </div>
  )
}

export function MissionBriefingModal({
  isHost,
  stageAccess,
  progressionLoading,
  onSelectLevel,
  engineError,
}: MissionBriefingModalProps) {
  return (
    <div className="mission-briefing-backdrop">
      <div className="mission-briefing-panel">
        <div className="mission-briefing-header">
          <p className="mission-briefing-eyebrow">SELECT PVE STAGE &amp; DIFFICULTY</p>
          <h2 className="mission-briefing-title">{isHost ? '选择关卡与难度' : '等待房主选择关卡'}</h2>
          <p className="mission-briefing-desc">多人房间只能选择所有参战玩家都已解锁的关卡。</p>
        </div>

        {engineError && <div className="mission-briefing-error"><span className="mission-briefing-error-code">ERR</span>{engineError}</div>}

        {isHost && (
          <div className="mission-level-list" aria-busy={progressionLoading}>
            {LEVEL_DEFS.map(def => <LevelRow key={def.levelId} def={def} stageAccess={stageAccess} disabled={progressionLoading} onSelect={onSelectLevel} />)}
          </div>
        )}

        {!isHost && <p className="mission-waiting-hint mt-3"><span className="mission-waiting-cursor">&gt;_ </span>等待房主选择关卡…</p>}
      </div>
    </div>
  )
}
