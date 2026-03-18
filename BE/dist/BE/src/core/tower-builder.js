"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TowerBuilder = void 0;
const tower_catalog_1 = require("../domain/tower-catalog");
const tower_factory_1 = require("./tower-factory");
class TowerBuilder {
    static getConfig(kind, level) {
        return (0, tower_catalog_1.getTowerCatalogEntry)(kind, level);
    }
    static getConfigBySelection(selection) {
        return (0, tower_catalog_1.parseTowerCatalogSelection)(selection);
    }
    static getNextConfigBySelection(selection) {
        return (0, tower_catalog_1.getNextTowerCatalogEntryById)(selection);
    }
    static createState(kind, level, options) {
        const config = this.getConfig(kind, level);
        if (!config) {
            return null;
        }
        return this.createStateFromConfig(config, options);
    }
    static createFromSelection(selection, options) {
        const config = this.getConfigBySelection(selection);
        if (!config) {
            return null;
        }
        const state = this.createStateFromConfig(config, options);
        return {
            config,
            state,
            tower: tower_factory_1.TowerFactory.create(state),
        };
    }
    static upgradeTower(currentTower, nextConfig) {
        const currentState = currentTower.toState();
        const nextState = {
            ...currentState,
            type: nextConfig.type,
            width: nextConfig.width,
            height: nextConfig.height,
            behaviorKind: nextConfig.behavior.kind,
            behavior: nextConfig.behavior,
            attackEffects: nextConfig.attackEffects.map((effect) => ({ ...effect })),
            damage: nextConfig.damage,
            range: nextConfig.range,
            fireRateTicks: nextConfig.fireRateTicks,
            cooldownTicks: typeof nextConfig.fireRateTicks === 'number'
                ? Math.min(currentState.cooldownTicks, nextConfig.fireRateTicks)
                : 0,
            targetingStrategy: nextConfig.targetingStrategy,
            currentTargetId: nextConfig.behavior.kind === 'beam' ? currentState.currentTargetId : null,
            lockTimeMs: nextConfig.behavior.kind === 'beam' ? currentState.lockTimeMs : 0,
            incomeProgressMs: nextConfig.behavior.kind === 'economy' ? currentState.incomeProgressMs : 0,
        };
        return {
            config: nextConfig,
            state: nextState,
            tower: tower_factory_1.TowerFactory.create(nextState),
        };
    }
    static createStateFromConfig(config, options) {
        return {
            id: `tower-${options.tick}-${options.sequence}`,
            ownerId: options.ownerId,
            type: config.type,
            x: options.x,
            y: options.y,
            width: config.width,
            height: config.height,
            behaviorKind: config.behavior.kind,
            behavior: config.behavior,
            attackEffects: config.attackEffects.map((effect) => ({ ...effect })),
            damage: config.damage,
            range: config.range,
            fireRateTicks: config.fireRateTicks,
            cooldownTicks: 0,
            targetingStrategy: config.targetingStrategy,
            currentTargetId: null,
            lockTimeMs: 0,
            incomeProgressMs: 0,
        };
    }
}
exports.TowerBuilder = TowerBuilder;
