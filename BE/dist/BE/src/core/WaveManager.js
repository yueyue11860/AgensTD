"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WaveManager = void 0;
class WaveManager {
    state = 'PREP';
    currentWaveIndex = 0;
    timer = 0;
    waves;
    callbacks;
    groupRuntime = [];
    currentWaveTick = 0;
    currentWaveElapsedTicks = 0;
    victoryTriggered = false;
    spawnMultiplier = 1;
    constructor(waves, callbacks, options) {
        this.waves = waves;
        this.callbacks = callbacks;
        this.spawnMultiplier = this.normalizeSpawnMultiplier(options?.spawnMultiplier ?? 1);
        if (this.waves.length === 0) {
            this.state = 'CLEARING';
            this.currentWaveIndex = -1;
            this.timer = 0;
            return;
        }
        this.enterPrepStateForCurrentWave();
    }
    update() {
        if (this.victoryTriggered) {
            return;
        }
        if (this.waves.length === 0) {
            this.triggerVictoryOnce();
            return;
        }
        switch (this.state) {
            case 'PREP':
                this.updatePrepState();
                return;
            case 'SPAWNING':
                this.updateSpawningState();
                return;
            case 'CLEARING':
                this.updateClearingState();
                return;
        }
    }
    getCurrentWave() {
        if (this.currentWaveIndex < 0 || this.currentWaveIndex >= this.waves.length) {
            return null;
        }
        return this.waves[this.currentWaveIndex];
    }
    getCurrentWaveElapsedTicks() {
        return this.currentWaveElapsedTicks;
    }
    getRemainingSpawns() {
        const wave = this.getCurrentWave();
        if (!wave) {
            return 0;
        }
        return wave.groups.reduce((total, group, groupIndex) => {
            const runtime = this.groupRuntime[groupIndex];
            const spawnedCount = runtime?.spawnedCount ?? 0;
            return total + Math.max(0, this.getTargetSpawnCount(group.count) - spawnedCount);
        }, 0);
    }
    setSpawnMultiplier(spawnMultiplier) {
        this.spawnMultiplier = this.normalizeSpawnMultiplier(spawnMultiplier);
    }
    getSnapshot() {
        return {
            state: this.state,
            currentWaveIndex: this.currentWaveIndex,
            currentWave: this.getCurrentWave(),
            timer: this.timer,
            remainingSpawns: this.getRemainingSpawns(),
            victoryTriggered: this.victoryTriggered,
            spawnMultiplier: this.spawnMultiplier,
        };
    }
    updatePrepState() {
        if (this.timer > 0) {
            this.timer -= 1;
        }
        this.currentWaveElapsedTicks += 1;
        if (this.timer <= 0) {
            this.enterSpawningState();
        }
    }
    updateSpawningState() {
        const wave = this.getCurrentWave();
        if (!wave) {
            this.triggerVictoryOnce();
            return;
        }
        for (let groupIndex = 0; groupIndex < wave.groups.length; groupIndex += 1) {
            const group = wave.groups[groupIndex];
            const runtime = this.groupRuntime[groupIndex];
            const targetSpawnCount = this.getTargetSpawnCount(group.count);
            if (runtime.spawnedCount >= targetSpawnCount) {
                continue;
            }
            if (this.currentWaveTick < group.delay) {
                continue;
            }
            const canSpawnNext = runtime.lastSpawnTick === null || this.currentWaveTick - runtime.lastSpawnTick >= group.interval;
            if (!canSpawnNext) {
                continue;
            }
            this.callbacks.onSpawn(group.enemyType);
            runtime.spawnedCount += 1;
            runtime.lastSpawnTick = this.currentWaveTick;
        }
        this.currentWaveElapsedTicks += 1;
        if (this.areAllGroupsCompleted(wave)) {
            this.state = 'CLEARING';
            this.timer = 0;
            return;
        }
        this.currentWaveTick += 1;
    }
    updateClearingState() {
        if (!this.callbacks.isMapClear()) {
            this.currentWaveElapsedTicks += 1;
            return;
        }
        const hasNextWave = this.currentWaveIndex + 1 < this.waves.length;
        if (!hasNextWave) {
            this.triggerVictoryOnce();
            return;
        }
        this.currentWaveIndex += 1;
        this.enterPrepStateForCurrentWave();
    }
    areAllGroupsCompleted(wave) {
        for (let groupIndex = 0; groupIndex < wave.groups.length; groupIndex += 1) {
            const runtime = this.groupRuntime[groupIndex];
            const group = wave.groups[groupIndex];
            if (runtime.spawnedCount < this.getTargetSpawnCount(group.count)) {
                return false;
            }
        }
        return true;
    }
    enterPrepStateForCurrentWave() {
        const wave = this.getCurrentWave();
        this.state = 'PREP';
        this.timer = wave?.prepTime ?? 0;
        this.currentWaveTick = 0;
        this.currentWaveElapsedTicks = 0;
        this.groupRuntime = [];
    }
    enterSpawningState() {
        const wave = this.getCurrentWave();
        this.state = 'SPAWNING';
        this.timer = 0;
        this.currentWaveTick = 0;
        this.groupRuntime = (wave?.groups ?? []).map(() => ({
            spawnedCount: 0,
            lastSpawnTick: null,
        }));
    }
    triggerVictoryOnce() {
        if (this.victoryTriggered) {
            return;
        }
        this.victoryTriggered = true;
        this.callbacks.onVictory?.();
    }
    getTargetSpawnCount(baseCount) {
        return Math.max(1, Math.ceil(baseCount * this.spawnMultiplier));
    }
    normalizeSpawnMultiplier(spawnMultiplier) {
        if (!Number.isFinite(spawnMultiplier) || spawnMultiplier <= 0) {
            return 1;
        }
        return spawnMultiplier;
    }
}
exports.WaveManager = WaveManager;
