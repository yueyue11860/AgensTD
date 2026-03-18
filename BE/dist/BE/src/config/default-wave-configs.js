"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultWaveConfigs = void 0;
exports.defaultWaveConfigs = [
    {
        waveNumber: 1,
        prepTime: 20,
        groups: [
            { enemyType: 'Grunt', count: 6, interval: 3, delay: 0 },
            { enemyType: 'Speedster', count: 4, interval: 2, delay: 4 },
        ],
    },
    {
        waveNumber: 2,
        prepTime: 25,
        groups: [
            { enemyType: 'Tank', count: 3, interval: 7, delay: 0 },
            { enemyType: 'Speedster', count: 8, interval: 2, delay: 2 },
            { enemyType: 'Grunt', count: 4, interval: 3, delay: 6 },
        ],
    },
    {
        waveNumber: 3,
        prepTime: 30,
        groups: [
            { enemyType: 'Tank', count: 4, interval: 6, delay: 0 },
            { enemyType: 'Grunt', count: 10, interval: 2, delay: 3 },
            { enemyType: 'Speedster', count: 10, interval: 1, delay: 5 },
        ],
    },
];
