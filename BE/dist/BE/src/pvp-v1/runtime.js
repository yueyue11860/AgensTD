"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PvpMatchRuntime = void 0;
const node_crypto_1 = require("node:crypto");
const prng_1 = require("../pve-v2/prng");
const map_1 = require("./map");
const SIDES = ['A', 'B'];
const CORE_HP = 10;
const INITIAL_RATIONS = 10;
const POPULATION_CAP = 10;
const TRAY_SIZE = 5;
const RESERVE_SIZE = 2;
const ROUND_BASE_COUNT = 10;
const ROUND_RATIONS = 5;
const PRESSURE_COST = 5;
const PRESSURE_QUEUE_LIMIT = 6;
const PRESSURE_COOLDOWN_MS = 1000;
const DISCONNECT_FORFEIT_MS = 60_000;
const TRIBULATION_START_MS = 6 * 60_000;
const CORE_DAMAGE_BONUS_START_MS = 8 * 60_000;
const ONE_LEAK_DEFEAT_START_MS = 10 * 60_000;
const HARD_TIMEOUT_MS = 12 * 60_000;
function oppositeSide(side) {
    return side === 'A' ? 'B' : 'A';
}
function stableJson(value) {
    if (Array.isArray(value))
        return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        const record = value;
        return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}
class PvpMatchRuntime {
    matchId;
    mode;
    seed;
    rulesetVersion;
    tickRateMs;
    countdownTicks;
    roundIntervalTicks;
    eventHistoryLimit;
    prng;
    sides = { A: null, B: null };
    commandReceipts = new Map();
    recentEvents = [];
    phase = 'created';
    currentTick = 0;
    countdownRemainingTicks = 0;
    roundNumber = 0;
    nextRoundAtTick = null;
    playingStartedAtTick = null;
    result = null;
    eventSequence = 0;
    enemySequence = 0;
    pressureSequence = 0;
    spawnSequence = 0;
    constructor(options) {
        if (!options.matchId.trim())
            throw new Error('PVP_MATCH_ID_REQUIRED');
        if (!options.rulesetVersion.trim())
            throw new Error('PVP_RULESET_VERSION_REQUIRED');
        this.matchId = options.matchId;
        this.mode = options.mode;
        this.seed = String(options.seed);
        this.rulesetVersion = options.rulesetVersion;
        this.tickRateMs = Math.max(10, Math.floor(options.tickRateMs ?? 100));
        this.countdownTicks = Math.max(0, Math.ceil((options.countdownMs ?? 5000) / this.tickRateMs));
        this.roundIntervalTicks = Math.max(1, Math.ceil((options.roundIntervalMs ?? 20_000) / this.tickRateMs));
        this.eventHistoryLimit = Math.max(20, Math.floor(options.eventHistoryLimit ?? 500));
        this.prng = new prng_1.DeterministicPrng(`${this.seed}:pvp-runtime`);
        this.transitionTo('waiting_players');
    }
    registerParticipant(side, participant) {
        if (this.phase !== 'waiting_players')
            return this.command(false, 'WRONG_PHASE');
        if (!participant.playerId.trim() || !participant.playerName.trim())
            return this.command(false, 'INVALID_PARTICIPANT');
        if (this.findSideByPlayerId(participant.playerId))
            return this.command(false, 'PLAYER_ALREADY_REGISTERED');
        if (this.sides[side])
            return this.command(false, 'SIDE_OCCUPIED');
        const stats = {
            playerId: participant.playerId,
            side,
            result: null,
            coreHpRemaining: CORE_HP,
            baseKills: 0,
            pressureKills: 0,
            leaks: 0,
            scriptureEarned: 0,
            scriptureSpent: 0,
            pressureSent: 0,
            pressureLeaked: 0,
            coreDamageDealt: 0,
            rationsEarned: 0,
            rationsSpent: 0,
            paidRecruitCount: 0,
            activeGeneralIds: [],
            peakPopulation: 0,
            highestSoldierLevel: 0,
            damageDealt: 0,
            controlDurationMs: 0,
        };
        this.sides[side] = {
            state: {
                side,
                playerId: participant.playerId,
                playerName: participant.playerName,
                connected: true,
                disconnectedAtTick: null,
                ready: false,
                loaded: false,
                coreHp: CORE_HP,
                coreMaxHp: CORE_HP,
                rations: INITIAL_RATIONS,
                scripture: 0,
                populationUsed: 0,
                populationCap: POPULATION_CAP,
                boardPieces: [],
                enemies: [],
                stats,
                privateState: {
                    tray: Array(TRAY_SIZE).fill(null),
                    reserve: Array(RESERVE_SIZE).fill(null),
                    pendingPressure: [],
                    trayRevision: 0,
                    reserveRevision: 0,
                    boardRevision: 0,
                },
            },
            spawnQueue: [],
            lastSpawnedEnemyId: null,
            lastPressureAtTick: null,
        };
        if (this.sides.A && this.sides.B)
            this.transitionTo('ready_check');
        return this.command(true, 'PARTICIPANT_REGISTERED');
    }
    setReady(playerId, ready = true) {
        if (this.phase !== 'ready_check')
            return this.command(false, 'WRONG_PHASE');
        const side = this.requirePlayerSide(playerId);
        if (!side)
            return this.command(false, 'PLAYER_NOT_FOUND');
        this.sides[side].state.ready = ready;
        if (this.sides.A?.state.ready && this.sides.B?.state.ready)
            this.transitionTo('loading');
        return this.command(true, 'READY_STATE_UPDATED');
    }
    markLoaded(playerId) {
        if (this.phase !== 'loading')
            return this.command(false, 'WRONG_PHASE');
        const side = this.requirePlayerSide(playerId);
        if (!side)
            return this.command(false, 'PLAYER_NOT_FOUND');
        this.sides[side].state.loaded = true;
        if (this.sides.A?.state.loaded && this.sides.B?.state.loaded) {
            this.countdownRemainingTicks = this.countdownTicks;
            this.transitionTo('countdown');
            if (this.countdownRemainingTicks === 0)
                this.beginPlaying();
        }
        return this.command(true, 'PLAYER_LOADED');
    }
    tick() {
        if (this.phase === 'completed' || this.phase === 'voided' || this.phase === 'settling')
            return this.snapshot();
        this.currentTick += 1;
        if (this.phase === 'countdown') {
            this.countdownRemainingTicks = Math.max(0, this.countdownRemainingTicks - 1);
            if (this.countdownRemainingTicks === 0)
                this.beginPlaying();
            return this.snapshot();
        }
        if (this.phase !== 'playing')
            return this.snapshot();
        this.updateTribulation();
        this.evaluateDisconnectForfeits();
        if (this.phase !== 'playing')
            return this.snapshot();
        while (this.nextRoundAtTick !== null && this.currentTick >= this.nextRoundAtTick)
            this.beginRound();
        this.spawnSafeEnemies();
        const leaks = this.moveEnemiesAndCollectLeaks();
        this.applyLeaks(leaks);
        if (this.phase === 'playing')
            this.evaluateHardTimeout();
        return this.snapshot();
    }
    sendPressure(playerId, requestId) {
        return this.idempotent(playerId, requestId, 'send_pressure', {}, () => {
            if (this.phase !== 'playing')
                return this.command(false, 'WRONG_PHASE', requestId);
            const senderSide = this.requirePlayerSide(playerId);
            if (!senderSide)
                return this.command(false, 'PLAYER_NOT_FOUND', requestId);
            const sender = this.sides[senderSide];
            const defenderSide = oppositeSide(senderSide);
            const defender = this.sides[defenderSide];
            if (!defender)
                return this.command(false, 'OPPONENT_NOT_FOUND', requestId);
            if (sender.state.scripture < PRESSURE_COST)
                return this.rejectPressure(senderSide, requestId, 'INSUFFICIENT_SCRIPTURE');
            const cooldownTicks = Math.ceil(PRESSURE_COOLDOWN_MS / this.tickRateMs);
            if (sender.lastPressureAtTick !== null && this.currentTick - sender.lastPressureAtTick < cooldownTicks) {
                return this.rejectPressure(senderSide, requestId, 'PRESSURE_COOLDOWN');
            }
            if (defender.state.privateState.pendingPressure.length >= PRESSURE_QUEUE_LIMIT) {
                return this.rejectPressure(senderSide, requestId, 'PRESSURE_QUEUE_FULL');
            }
            sender.state.scripture -= PRESSURE_COST;
            sender.state.stats.scriptureSpent += PRESSURE_COST;
            sender.state.stats.pressureSent += 1;
            sender.lastPressureAtTick = this.currentTick;
            this.pressureSequence += 1;
            const roundNumber = Math.max(1, this.roundNumber);
            const pressure = {
                pressureId: `pressure-${this.pressureSequence}`,
                senderPlayerId: playerId,
                senderSide,
                defenderSide,
                requestId,
                queuedAtTick: this.currentTick,
                roundNumber,
                maxHp: Math.round(this.baseHpForRound(roundNumber) * 1.5),
            };
            defender.state.privateState.pendingPressure.push(pressure);
            defender.spawnQueue.push({
                spawnId: pressure.pressureId,
                kind: 'pressure',
                glyph: '妖',
                roundNumber,
                maxHp: pressure.maxHp,
                armor: this.baseDefenseForRound(roundNumber),
                magicResistance: this.baseDefenseForRound(roundNumber),
                moveSpeedMilliCellsPerSecond: this.speedForElapsed(),
                coreDamage: 1,
                queuedAtTick: this.currentTick,
                pressure,
            });
            this.emit('PRESSURE_QUEUED', {
                pressureId: pressure.pressureId,
                senderPlayerId: playerId,
                senderSide,
                defenderSide,
                requestId,
            });
            return this.command(true, 'PRESSURE_QUEUED', requestId, { pressureId: pressure.pressureId });
        });
    }
    applyAuthoritativeDamage(input) {
        return this.idempotent(input.sourcePlayerId, input.eventId, 'authoritative_damage', {
            enemyId: input.enemyId,
            rawDamage: input.rawDamage,
            resolvedDamage: input.resolvedDamage,
        }, () => {
            if (this.phase !== 'playing')
                return this.command(false, 'WRONG_PHASE', input.eventId);
            const side = this.requirePlayerSide(input.sourcePlayerId);
            if (!side)
                return this.command(false, 'PLAYER_NOT_FOUND', input.eventId);
            if (!Number.isSafeInteger(input.rawDamage) || input.rawDamage <= 0
                || !Number.isSafeInteger(input.resolvedDamage) || input.resolvedDamage <= 0) {
                return this.command(false, 'INVALID_AUTHORITATIVE_DAMAGE', input.eventId);
            }
            const runtime = this.sides[side];
            const enemyIndex = runtime.state.enemies.findIndex((enemy) => enemy.enemyId === input.enemyId);
            if (enemyIndex < 0)
                return this.command(false, 'ENEMY_NOT_FOUND', input.eventId);
            const enemy = runtime.state.enemies[enemyIndex];
            if (enemy.spawnProtected)
                return this.command(false, 'ENEMY_SPAWN_PROTECTED', input.eventId);
            const hpBefore = enemy.hp;
            const appliedDamage = Math.min(hpBefore, input.resolvedDamage);
            enemy.hp -= appliedDamage;
            runtime.state.stats.damageDealt += appliedDamage;
            this.emit('ENEMY_DAMAGED', {
                playerId: input.sourcePlayerId,
                side,
                enemyId: input.enemyId,
                rawDamage: input.rawDamage,
                damage: appliedDamage,
                hpBefore,
                hpAfter: enemy.hp,
            });
            if (enemy.hp <= 0)
                this.settleEnemyKill(runtime, enemyIndex);
            return this.command(true, 'ENEMY_DAMAGED', input.eventId, { appliedDamage, hpAfter: Math.max(0, enemy.hp) });
        });
    }
    surrender(playerId, requestId) {
        return this.idempotent(playerId, requestId, 'surrender', {}, () => {
            if (this.phase !== 'playing')
                return this.command(false, 'WRONG_PHASE', requestId);
            const side = this.requirePlayerSide(playerId);
            if (!side)
                return this.command(false, 'PLAYER_NOT_FOUND', requestId);
            this.emit('PLAYER_SURRENDERED', { playerId, side });
            this.finishWithWinner(oppositeSide(side), 'surrendered');
            return this.command(true, 'PLAYER_SURRENDERED', requestId);
        });
    }
    markDisconnected(playerId) {
        const side = this.requirePlayerSide(playerId);
        if (!side)
            return this.command(false, 'PLAYER_NOT_FOUND');
        const state = this.sides[side].state;
        if (!state.connected)
            return this.command(true, 'PLAYER_ALREADY_DISCONNECTED');
        state.connected = false;
        state.disconnectedAtTick = this.currentTick;
        this.emit('PLAYER_CONNECTION_CHANGED', { playerId, side, connected: false });
        return this.command(true, 'PLAYER_DISCONNECTED');
    }
    markReconnected(playerId) {
        const side = this.requirePlayerSide(playerId);
        if (!side)
            return this.command(false, 'PLAYER_NOT_FOUND');
        const state = this.sides[side].state;
        state.connected = true;
        state.disconnectedAtTick = null;
        this.emit('PLAYER_CONNECTION_CHANGED', { playerId, side, connected: true });
        return this.command(true, 'PLAYER_RECONNECTED');
    }
    voidMatch(reason) {
        if (this.result || this.phase === 'completed' || this.phase === 'voided')
            return this.command(false, 'MATCH_ALREADY_DECIDED');
        const participants = { A: 'void', B: 'void' };
        for (const side of SIDES)
            if (this.sides[side])
                this.sides[side].state.stats.result = 'void';
        this.result = {
            reason,
            winnerPlayerId: null,
            loserPlayerId: null,
            decidedAtTick: this.currentTick,
            finalStateHash: this.computeStateHash(),
            participants,
        };
        this.phase = 'voided';
        this.emit('PVP_MATCH_VOIDED', { reason });
        return this.command(true, 'MATCH_VOIDED');
    }
    completeSettlement() {
        if (this.phase !== 'settling' || !this.result)
            return this.command(false, 'WRONG_PHASE');
        this.transitionTo('completed');
        return this.command(true, 'SETTLEMENT_COMPLETED');
    }
    snapshot() {
        return structuredClone({
            schemaVersion: 1,
            matchId: this.matchId,
            mode: this.mode,
            phase: this.phase,
            tick: this.currentTick,
            tickRateMs: this.tickRateMs,
            seed: this.seed,
            rulesetVersion: this.rulesetVersion,
            mapId: map_1.DUAL_REALM_MAP.mapId,
            mapVersion: map_1.DUAL_REALM_MAP.mapVersion,
            routeHash: map_1.DUAL_REALM_MAP.routeHash,
            countdownRemainingTicks: this.countdownRemainingTicks,
            round: {
                number: this.roundNumber,
                nextRoundAtTick: this.nextRoundAtTick,
                intervalTicks: this.roundIntervalTicks,
                baseCountPerSide: ROUND_BASE_COUNT,
            },
            tribulation: this.tribulationSnapshot(),
            sides: {
                A: this.sides.A?.state ?? null,
                B: this.sides.B?.state ?? null,
            },
            result: this.result,
            recentEvents: this.recentEvents,
        });
    }
    projectForViewer(viewerPlayerId) {
        const authority = this.snapshot();
        const viewerSide = SIDES.find((side) => authority.sides[side]?.playerId === viewerPlayerId) ?? null;
        const projectSide = (state) => {
            if (!state)
                return null;
            const isOwner = viewerPlayerId === state.playerId;
            return {
                ...state,
                rations: isOwner ? state.rations : null,
                scripture: isOwner ? state.scripture : null,
                privateState: isOwner ? { ...state.privateState, pendingPressure: [] } : null,
            };
        };
        const { seed: _hiddenSeed, sides: _authoritySides, ...publicState } = authority;
        const recentEvents = publicState.recentEvents.filter((event) => {
            if (event.type !== 'PRESSURE_QUEUED' && event.type !== 'PRESSURE_REJECTED')
                return true;
            return viewerSide !== null && event.data.senderSide === viewerSide;
        });
        return {
            ...publicState,
            recentEvents,
            viewerPlayerId,
            sides: { A: projectSide(authority.sides.A), B: projectSide(authority.sides.B) },
        };
    }
    beginPlaying() {
        this.playingStartedAtTick = this.currentTick;
        this.transitionTo('playing');
        this.emit('MATCH_STARTED', { matchId: this.matchId, rulesetVersion: this.rulesetVersion });
        this.beginRound();
    }
    beginRound() {
        this.roundNumber += 1;
        this.nextRoundAtTick = this.currentTick + this.roundIntervalTicks;
        for (const side of SIDES) {
            const runtime = this.sides[side];
            runtime.state.rations += ROUND_RATIONS;
            runtime.state.stats.rationsEarned += ROUND_RATIONS;
            this.emit('ROUND_RATIONS_GRANTED', { side, playerId: runtime.state.playerId, roundNumber: this.roundNumber, amount: ROUND_RATIONS });
            for (let index = 0; index < ROUND_BASE_COUNT; index += 1) {
                const kind = this.roundNumber % 10 === 0 && index === ROUND_BASE_COUNT - 1
                    ? 'boss'
                    : this.roundNumber % 10 !== 0 && this.roundNumber % 5 === 0 && index === ROUND_BASE_COUNT - 1
                        ? 'elite'
                        : 'base';
                const multiplier = kind === 'boss' ? 4 : kind === 'elite' ? 2 : 1;
                this.spawnSequence += 1;
                runtime.spawnQueue.push({
                    spawnId: `round-${this.roundNumber}-${side}-${this.spawnSequence}`,
                    kind,
                    glyph: kind === 'boss' ? '魔' : kind === 'elite' ? '怪' : '妖',
                    roundNumber: this.roundNumber,
                    maxHp: this.baseHpForRound(this.roundNumber) * multiplier,
                    armor: this.baseDefenseForRound(this.roundNumber),
                    magicResistance: this.baseDefenseForRound(this.roundNumber),
                    moveSpeedMilliCellsPerSecond: this.speedForElapsed(),
                    coreDamage: kind === 'boss' ? 4 : kind === 'elite' ? 2 : 1,
                    queuedAtTick: this.currentTick,
                    pressure: null,
                });
            }
        }
        this.emit('ROUND_STARTED', { roundNumber: this.roundNumber, countPerSide: ROUND_BASE_COUNT });
    }
    spawnSafeEnemies() {
        for (const side of SIDES) {
            const runtime = this.sides[side];
            if (runtime.spawnQueue.length === 0 || !this.previousSpawnExited(runtime))
                continue;
            const pending = runtime.spawnQueue.shift();
            this.enemySequence += 1;
            const start = map_1.DUAL_REALM_MAP.sides[side].routeCells[0];
            const enemy = {
                enemyId: `pvp-enemy-${this.enemySequence}`,
                side,
                kind: pending.kind,
                glyph: pending.glyph,
                roundNumber: pending.roundNumber,
                xMilli: start.x * 1000,
                yMilli: start.y * 1000,
                routeCellIndex: 0,
                routeProgressMilli: 0,
                hp: pending.maxHp,
                maxHp: pending.maxHp,
                armor: pending.armor,
                magicResistance: pending.magicResistance,
                moveSpeedMilliCellsPerSecond: pending.moveSpeedMilliCellsPerSecond,
                coreDamage: pending.coreDamage,
                spawnProtected: true,
                pressureSourcePlayerId: pending.pressure?.senderPlayerId ?? null,
                pressureRequestId: pending.pressure?.requestId ?? null,
            };
            runtime.state.enemies.push(enemy);
            runtime.lastSpawnedEnemyId = enemy.enemyId;
            if (pending.pressure) {
                const pressureIndex = runtime.state.privateState.pendingPressure
                    .findIndex((entry) => entry.pressureId === pending.pressure.pressureId);
                if (pressureIndex >= 0)
                    runtime.state.privateState.pendingPressure.splice(pressureIndex, 1);
            }
            this.emit('ENEMY_SPAWNED', {
                enemyId: enemy.enemyId,
                side,
                kind: enemy.kind,
                roundNumber: enemy.roundNumber,
                pressureSourcePlayerId: enemy.pressureSourcePlayerId,
            });
        }
    }
    previousSpawnExited(runtime) {
        if (!runtime.lastSpawnedEnemyId)
            return true;
        const enemy = runtime.state.enemies.find((candidate) => candidate.enemyId === runtime.lastSpawnedEnemyId);
        return !enemy || !enemy.spawnProtected;
    }
    moveEnemiesAndCollectLeaks() {
        const leaks = [];
        for (const side of SIDES) {
            const runtime = this.sides[side];
            const survivors = [];
            for (const enemy of runtime.state.enemies) {
                if (this.moveEnemy(enemy))
                    leaks.push({ side, enemy });
                else
                    survivors.push(enemy);
            }
            runtime.state.enemies = survivors;
        }
        return leaks;
    }
    moveEnemy(enemy) {
        const route = map_1.DUAL_REALM_MAP.sides[enemy.side].routeCells;
        let remaining = Math.max(0, Math.floor(enemy.moveSpeedMilliCellsPerSecond * this.tickRateMs / 1000));
        while (remaining > 0) {
            const next = route[enemy.routeCellIndex + 1];
            if (!next)
                return true;
            const distanceToNext = 1000 - enemy.routeProgressMilli;
            const travel = Math.min(remaining, distanceToNext);
            const current = route[enemy.routeCellIndex];
            enemy.routeProgressMilli += travel;
            remaining -= travel;
            const ratio = enemy.routeProgressMilli / 1000;
            enemy.xMilli = Math.round((current.x + (next.x - current.x) * ratio) * 1000);
            enemy.yMilli = Math.round((current.y + (next.y - current.y) * ratio) * 1000);
            if (enemy.routeProgressMilli >= 1000) {
                enemy.routeCellIndex += 1;
                enemy.routeProgressMilli = 0;
                enemy.xMilli = next.x * 1000;
                enemy.yMilli = next.y * 1000;
            }
        }
        if (enemy.spawnProtected && (0, map_1.hasEnemyBodyFullyExitedPvpSpawnGate)(enemy.side, enemy.xMilli, enemy.yMilli)) {
            enemy.spawnProtected = false;
            this.emit('ENEMY_ENTERED_BATTLEFIELD', { enemyId: enemy.enemyId, side: enemy.side });
        }
        return false;
    }
    applyLeaks(leaks) {
        if (leaks.length === 0 || this.phase !== 'playing')
            return;
        const damageBySide = { A: 0, B: 0 };
        const remainingCoreHp = {
            A: this.sides.A.state.coreHp,
            B: this.sides.B.state.coreHp,
        };
        const tribulation = this.tribulationSnapshot();
        for (const { side, enemy } of leaks) {
            const defender = this.sides[side];
            defender.state.stats.leaks += 1;
            if (enemy.kind === 'pressure' && enemy.pressureSourcePlayerId) {
                const senderSide = this.findSideByPlayerId(enemy.pressureSourcePlayerId);
                if (senderSide)
                    this.sides[senderSide].state.stats.pressureLeaked += 1;
                this.emit('PRESSURE_RESOLVED', { enemyId: enemy.enemyId, result: 'leaked', defenderSide: side });
            }
            const requestedDamage = tribulation.oneLeakDefeat
                ? CORE_HP
                : enemy.coreDamage + tribulation.coreDamageBonus;
            const appliedDamage = Math.min(remainingCoreHp[side], requestedDamage);
            remainingCoreHp[side] -= appliedDamage;
            damageBySide[side] += appliedDamage;
            if (enemy.kind === 'pressure' && enemy.pressureSourcePlayerId) {
                const senderSide = this.findSideByPlayerId(enemy.pressureSourcePlayerId);
                if (senderSide)
                    this.sides[senderSide].state.stats.coreDamageDealt += appliedDamage;
            }
        }
        for (const side of SIDES) {
            if (damageBySide[side] <= 0)
                continue;
            const state = this.sides[side].state;
            const before = state.coreHp;
            state.coreHp = Math.max(0, state.coreHp - damageBySide[side]);
            state.stats.coreHpRemaining = state.coreHp;
            this.emit('CORE_DAMAGED', { side, damage: damageBySide[side], coreHpBefore: before, coreHpAfter: state.coreHp });
        }
        const aDefeated = this.sides.A.state.coreHp <= 0;
        const bDefeated = this.sides.B.state.coreHp <= 0;
        if (aDefeated && bDefeated)
            this.finishDraw('simultaneous_draw');
        else if (aDefeated)
            this.finishWithWinner('B', 'core_destroyed');
        else if (bDefeated)
            this.finishWithWinner('A', 'core_destroyed');
    }
    settleEnemyKill(runtime, enemyIndex) {
        const [enemy] = runtime.state.enemies.splice(enemyIndex, 1);
        if (!enemy)
            return;
        if (enemy.kind === 'pressure') {
            runtime.state.rations += 2;
            runtime.state.stats.rationsEarned += 2;
            runtime.state.stats.pressureKills += 1;
            this.emit('PRESSURE_RESOLVED', { enemyId: enemy.enemyId, result: 'killed', defenderSide: runtime.state.side });
        }
        else {
            runtime.state.rations += 1;
            runtime.state.scripture += 1;
            runtime.state.stats.rationsEarned += 1;
            runtime.state.stats.scriptureEarned += 1;
            runtime.state.stats.baseKills += 1;
        }
        this.emit('ENEMY_KILLED', { enemyId: enemy.enemyId, side: runtime.state.side, kind: enemy.kind });
    }
    evaluateDisconnectForfeits() {
        const limitTicks = Math.ceil(DISCONNECT_FORFEIT_MS / this.tickRateMs);
        const timedOut = SIDES.filter((side) => {
            const state = this.sides[side].state;
            return !state.connected && state.disconnectedAtTick !== null
                && this.currentTick - state.disconnectedAtTick >= limitTicks;
        });
        if (timedOut.length === 2)
            this.finishDraw('simultaneous_draw');
        else if (timedOut.length === 1)
            this.finishWithWinner(oppositeSide(timedOut[0]), 'disconnect_forfeit');
    }
    evaluateHardTimeout() {
        const elapsed = this.elapsedPlayingTicks();
        if (elapsed < Math.ceil(HARD_TIMEOUT_MS / this.tickRateMs))
            return;
        const a = this.sides.A.state;
        const b = this.sides.B.state;
        if (a.coreHp !== b.coreHp)
            this.finishWithWinner(a.coreHp > b.coreHp ? 'A' : 'B', 'hard_timeout');
        else {
            const aRemainingEnemyHp = a.enemies.reduce((total, enemy) => total + enemy.hp, 0);
            const bRemainingEnemyHp = b.enemies.reduce((total, enemy) => total + enemy.hp, 0);
            if (aRemainingEnemyHp !== bRemainingEnemyHp) {
                this.finishWithWinner(aRemainingEnemyHp < bRemainingEnemyHp ? 'A' : 'B', 'hard_timeout');
            }
            else if (a.stats.coreDamageDealt !== b.stats.coreDamageDealt) {
                this.finishWithWinner(a.stats.coreDamageDealt > b.stats.coreDamageDealt ? 'A' : 'B', 'hard_timeout');
            }
            else
                this.finishDraw('hard_timeout');
        }
    }
    updateTribulation() {
        // 数值由 tribulationSnapshot 按权威对局时长计算；此方法保留为明确 Tick 阶段。
    }
    tribulationSnapshot() {
        const elapsedMs = this.elapsedPlayingTicks() * this.tickRateMs;
        const tier = elapsedMs < TRIBULATION_START_MS
            ? 0
            : Math.floor((elapsedMs - TRIBULATION_START_MS) / 20_000) + 1;
        return {
            active: tier > 0,
            tier,
            hpBonusBps: tier * 2000,
            moveSpeedBonusBps: tier * 500,
            coreDamageBonus: elapsedMs >= CORE_DAMAGE_BONUS_START_MS ? 1 : 0,
            oneLeakDefeat: elapsedMs >= ONE_LEAK_DEFEAT_START_MS,
            hardTimeoutAtTick: (this.playingStartedAtTick ?? 0) + Math.ceil(HARD_TIMEOUT_MS / this.tickRateMs),
        };
    }
    baseHpForRound(roundNumber) {
        const base = Math.round(28 * 1.16 ** Math.max(0, roundNumber - 1));
        return Math.round(base * (10_000 + this.tribulationSnapshot().hpBonusBps) / 10_000);
    }
    baseDefenseForRound(roundNumber) {
        return Math.max(0, 2 * (roundNumber - 1));
    }
    speedForElapsed() {
        return Math.round(1000 * (10_000 + this.tribulationSnapshot().moveSpeedBonusBps) / 10_000);
    }
    elapsedPlayingTicks() {
        return this.playingStartedAtTick === null ? 0 : Math.max(0, this.currentTick - this.playingStartedAtTick);
    }
    rejectPressure(senderSide, requestId, code) {
        this.emit('PRESSURE_REJECTED', { senderSide, requestId, code });
        return this.command(false, code, requestId);
    }
    finishWithWinner(winnerSide, reason) {
        const loserSide = oppositeSide(winnerSide);
        this.finish(reason, winnerSide, {
            [winnerSide]: 'win',
            [loserSide]: 'loss',
        });
    }
    finishDraw(reason) {
        this.finish(reason, null, { A: 'draw', B: 'draw' });
    }
    finish(reason, winnerSide, participants) {
        if (this.phase !== 'playing' || this.result)
            return;
        for (const side of SIDES)
            this.sides[side].state.stats.result = participants[side];
        const loserSide = winnerSide ? oppositeSide(winnerSide) : null;
        this.result = {
            reason,
            winnerPlayerId: winnerSide ? this.sides[winnerSide].state.playerId : null,
            loserPlayerId: loserSide ? this.sides[loserSide].state.playerId : null,
            decidedAtTick: this.currentTick,
            finalStateHash: this.computeStateHash(),
            participants,
        };
        this.transitionTo('settling');
        this.emit('PVP_MATCH_FINISHED', {
            reason,
            winnerPlayerId: this.result.winnerPlayerId,
            loserPlayerId: this.result.loserPlayerId,
            finalStateHash: this.result.finalStateHash,
        });
    }
    computeStateHash() {
        const state = {
            matchId: this.matchId,
            tick: this.currentTick,
            roundNumber: this.roundNumber,
            rngState: this.prng.snapshot(),
            sides: SIDES.map((side) => {
                const runtime = this.sides[side];
                return runtime ? {
                    side,
                    playerId: runtime.state.playerId,
                    coreHp: runtime.state.coreHp,
                    rations: runtime.state.rations,
                    scripture: runtime.state.scripture,
                    enemies: runtime.state.enemies,
                    spawnQueue: runtime.spawnQueue,
                    stats: runtime.state.stats,
                } : null;
            }),
        };
        return (0, node_crypto_1.createHash)('sha256').update(stableJson(state)).digest('hex');
    }
    transitionTo(phase) {
        if (this.phase === phase)
            return;
        const previous = this.phase;
        this.phase = phase;
        this.emit('PHASE_CHANGED', { previousPhase: previous, phase });
    }
    emit(type, data) {
        this.eventSequence += 1;
        this.recentEvents.push({ eventId: `pvp-event-${this.eventSequence}`, tick: this.currentTick, type, data });
        if (this.recentEvents.length > this.eventHistoryLimit)
            this.recentEvents.splice(0, this.recentEvents.length - this.eventHistoryLimit);
    }
    requirePlayerSide(playerId) {
        return this.findSideByPlayerId(playerId);
    }
    findSideByPlayerId(playerId) {
        return SIDES.find((side) => this.sides[side]?.state.playerId === playerId) ?? null;
    }
    command(ok, code, requestId, details) {
        return { ok, code, tick: this.currentTick, ...(requestId ? { requestId } : {}), ...(details ? { details } : {}) };
    }
    idempotent(playerId, requestId, operation, payload, apply) {
        if (!requestId.trim())
            return this.command(false, 'REQUEST_ID_REQUIRED');
        const key = `${playerId}:${requestId}`;
        const fingerprint = stableJson({ operation, payload });
        const previous = this.commandReceipts.get(key);
        if (previous) {
            if (previous.fingerprint !== fingerprint)
                return this.command(false, 'REQUEST_ID_CONFLICT', requestId);
            return { ...structuredClone(previous.result), duplicate: true };
        }
        const result = apply();
        this.commandReceipts.set(key, { fingerprint, result: structuredClone(result) });
        return result;
    }
}
exports.PvpMatchRuntime = PvpMatchRuntime;
