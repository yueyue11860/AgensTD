import type { ClientAction, PlayerIdentity } from './actions'
import type { FrontendGameState } from './frontend-game-state'

export interface ReplayActionRecord {
  id: string
  receivedAt: number
  player: PlayerIdentity
  action: ClientAction
}

export interface ReplayFrame {
  tick: number
  recordedAt: string
  gameState: FrontendGameState
}

export interface MatchReplay {
  matchId: string
  createdAt: string
  updatedAt: string
  actions: ReplayActionRecord[]
  frames: ReplayFrame[]
}

export interface MatchReplayEnvelope {
  replay: MatchReplay
}
