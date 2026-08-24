import { LEVEL_DEFS, type LevelDef } from '../lib/level-defs'

interface MissionBriefingModalProps {
  isHost: boolean
  playerKind: 'human' | 'agent'
  onSelectLevel: (levelId: number) => void
  engineError: string | null
}

function LevelRow({ def, onClick }: { def: LevelDef; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="mission-level-row mission-level-row-active">
      <span className="mission-level-badge">{`PVE-${def.levelId}`}</span>
      <span className="mission-row-info">
        <span className="mission-row-name">{def.label}</span>
        <span className="mission-row-sub">{def.subtitle}</span>
      </span>
      <span className="mission-row-right">
        <span className="mission-row-rate">20 波</span>
      </span>
    </button>
  )
}

export function MissionBriefingModal({ isHost, onSelectLevel, engineError }: MissionBriefingModalProps) {
  return (
    <div className="mission-briefing-backdrop">
      <div className="mission-briefing-panel">
        <div className="mission-briefing-header">
          <p className="mission-briefing-eyebrow">SELECT PVE STAGE</p>
          <h2 className="mission-briefing-title">
            {isHost ? '选择关卡' : '等待房主选择关卡'}
          </h2>
        </div>

        {engineError && (
          <div className="mission-briefing-error">
            <span className="mission-briefing-error-code">ERR</span>
            {engineError}
          </div>
        )}

        {isHost && (
          <div className="mission-level-list">
            {LEVEL_DEFS.map((def) => (
              <LevelRow key={def.levelId} def={def} onClick={() => onSelectLevel(def.levelId)} />
            ))}
          </div>
        )}

        {!isHost && (
          <p className="mission-waiting-hint mt-3">
            <span className="mission-waiting-cursor">&gt;_ </span>
            等待房主选择关卡…
          </p>
        )}
      </div>
    </div>
  )
}
