export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error'

export type {
  ActionDescriptor,
  BuildTowerAction,
  CellKind,
  EnemyState,
  EnemyThreat,
  GameOutcome,
  GameAction,
  GameCell,
  GameState,
  GridPosition,
  ResourceState,
  SellTowerAction,
  SpawnGroup,
  TickEnvelope,
  TowerBlueprint,
  TowerFootprint,
  TowerState,
  TowerStatus,
  UpgradeTowerAction,
  WaveConfig,
} from '../../shared/contracts/game'