"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnemyFactory = void 0;
const enemy_1 = require("./entities/enemy");
const enemy_catalog_1 = require("../domain/enemy-catalog");
class EnemyFactory {
    createByCode(input) {
        const config = enemy_catalog_1.enemyCatalog[input.code];
        if (!config) {
            return null;
        }
        return new enemy_1.Enemy({
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
        });
    }
}
exports.EnemyFactory = EnemyFactory;
