export type TowerFireRate = number | 'infinite'

export type TowerBehaviorKind = 'single-target' | 'aoe' | 'beam' | 'aura' | 'economy'

interface TowerBehaviorBaseDefinition {
  kind: TowerBehaviorKind
}

export interface SingleTargetTowerBehaviorDefinition extends TowerBehaviorBaseDefinition {
  kind: 'single-target'
}

export interface AoeTowerBehaviorDefinition extends TowerBehaviorBaseDefinition {
  kind: 'aoe'
  splashRadius: number
  splashDamageRatio: number
}

export interface BeamTowerBehaviorDefinition extends TowerBehaviorBaseDefinition {
  kind: 'beam'
  lockBonusPerTick: number
  maxLockBonus: number
}

export interface AuraTowerBehaviorDefinition extends TowerBehaviorBaseDefinition {
  kind: 'aura'
  fireRateBoostRatio: number
}

export interface EconomyTowerBehaviorDefinition extends TowerBehaviorBaseDefinition {
  kind: 'economy'
  intervalMs: number
  goldPerCycle: number
}

export type TowerBehaviorDefinition =
  | SingleTargetTowerBehaviorDefinition
  | AoeTowerBehaviorDefinition
  | BeamTowerBehaviorDefinition
  | AuraTowerBehaviorDefinition
  | EconomyTowerBehaviorDefinition