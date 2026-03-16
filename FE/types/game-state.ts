export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error'

export type {
  ActionDescriptor,
  BuildTowerAction,
  CellKind,
  EnemyState,
  EnemyThreat,
  GameAction,
  GameCell,
  GameState,
  GridPosition,
  ResourceState,
  SellTowerAction,
  TickEnvelope,
  TowerBlueprint,
  TowerFootprint,
  TowerState,
  TowerStatus,
  UpgradeTowerAction,
} from '../../shared/contracts/game'