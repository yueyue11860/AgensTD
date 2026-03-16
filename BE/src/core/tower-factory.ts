import type { TowerState } from '../domain/game-state'
import { Tower } from './entities/tower'
import { createTowerBehavior } from './tower-behaviors'

export class TowerFactory {
  static create(state: TowerState) {
    return new Tower(state, createTowerBehavior(state.behavior))
  }
}