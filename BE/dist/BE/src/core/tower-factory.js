"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TowerFactory = void 0;
const tower_1 = require("./entities/tower");
const tower_behaviors_1 = require("./tower-behaviors");
class TowerFactory {
    static create(state) {
        return new tower_1.Tower(state, (0, tower_behaviors_1.createTowerBehavior)(state.behavior));
    }
}
exports.TowerFactory = TowerFactory;
