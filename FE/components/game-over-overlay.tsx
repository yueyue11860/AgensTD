import { Trophy, XCircle } from 'lucide-react'
import { cx } from '../lib/cx'

interface GameOverOverlayProps {
  outcome: 'victory' | 'defeat'
  currentLevelId: number | null
  onLeave: () => void
}

export function GameOverOverlay({ outcome, currentLevelId, onLeave }: GameOverOverlayProps) {
  const isVictory = outcome === 'victory'
  return (
    <div className={cx('game-over-backdrop', isVictory ? 'game-over-backdrop-victory' : 'game-over-backdrop-defeat')}>
      <div className={cx('game-over-panel', isVictory ? 'game-over-panel-victory' : 'game-over-panel-defeat')}>
        <div className={cx('game-over-icon-wrap', isVictory ? 'game-over-icon-victory' : 'game-over-icon-defeat')}>
          {isVictory ? <Trophy className="h-10 w-10" /> : <XCircle className="h-10 w-10" />}
        </div>
        <p className={cx('game-over-eyebrow', isVictory ? 'game-over-eyebrow-victory' : 'game-over-eyebrow-defeat')}>
          {isVictory ? 'MISSION COMPLETE' : 'NODE COMPROMISED'}
        </p>
        <h1 className={cx('game-over-title', isVictory ? 'game-over-title-victory' : 'game-over-title-defeat')}>
          {isVictory ? '任务完成' : '节点沦陷'}
        </h1>
        <p className="game-over-subtitle">
          {isVictory ? `PVE-${currentLevelId ?? '?'} 防线稳固，抵御成功` : '防线被突破，返回节点重新部署'}
        </p>
        <div className="game-over-upload game-over-upload-done">通关、碎片和局外奖励由服务端权威结算。</div>
        <div className="game-over-actions">
          <button type="button" onClick={onLeave} className={cx('game-over-btn', isVictory ? 'game-over-btn-victory' : 'game-over-btn-defeat')}>返回节点</button>
        </div>
      </div>
    </div>
  )
}
