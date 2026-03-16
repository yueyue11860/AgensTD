import { Enemy } from './entities/enemy'
import { enemyCatalog } from '../domain/enemy-catalog'
import type { EnemyKind, Position } from '../domain/game-state'

export interface EnemyFactoryCreateInput {
  id: string
  code: EnemyKind
  spawn: Position
  path: Position[]
}

export class EnemyFactory {
  createByCode(input: EnemyFactoryCreateInput) {
    const config = enemyCatalog[input.code]
    if (!config) {
      return null
    }

    return new Enemy({
      id: input.id,
      kind: config.kind,
      x: input.spawn.x,
      y: input.spawn.y,
      hp: config.maxHp,
      maxHp: config.maxHp,
      shield: config.maxShield,
      maxShield: config.maxShield,
      baseSpeed: config.speed,
      speed: config.speed,
      baseArmor: config.armor,
      armor: config.armor,
      baseDefense: config.armor,
      defense: config.armor,
      rewardGold: config.rewardGold,
      baseDamage: config.baseDamage,
      path: input.path,
      pathIndex: 0,
      lastDamagedByPlayerId: null,
      activeEffects: [],
      traits: config.traits.map((trait) => ({ ...trait })),
    })
  }
}
