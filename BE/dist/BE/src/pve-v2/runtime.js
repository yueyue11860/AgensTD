"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PveGameRuntime = void 0;
const catalogs_1 = require("./catalogs");
const arena_1 = require("./arena");
const prng_1 = require("./prng");
const TRAY_SIZE = 5;
const RESERVE_SIZE = 2;
const POPULATION_CAP = 10;
const CHARACTER_BRANCH_BPS = 1000;
const ENEMY_CAPACITY_PER_PLAYER = 10;
const OVERLOAD_DURATION_MS = 10000;
const XP_REWARD_POINTS = 1000;
function boardKey(x, y) {
    return `${x},${y}`;
}
function isSoldier(piece) {
    return piece?.kind === 'soldier';
}
function clonePiece(piece) {
    return { ...piece };
}
function slotOrder(slot) {
    return arena_1.PVE_LANE_SLOTS.indexOf(slot);
}
function sanitizeCharacterTokens(tokens) {
    const result = new Map();
    for (const [glyph, count] of Object.entries(tokens ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
        if ([...glyph].length !== 1 || !Number.isSafeInteger(count) || count < 0) {
            throw new Error(`Invalid character token config: ${glyph}`);
        }
        if (count > 0) {
            result.set(glyph, count);
        }
    }
    return result;
}
function validateRuntimeOptions(options) {
    if (!Number.isInteger(options.tickRateMs ?? 100) || (options.tickRateMs ?? 100) <= 0) {
        throw new Error('tickRateMs must be a positive integer');
    }
    if (!Number.isInteger(options.prepDurationMs ?? 5000) || (options.prepDurationMs ?? 5000) < 0) {
        throw new Error('prepDurationMs must be a non-negative integer');
    }
    if (!Number.isInteger(options.maxWaves ?? 20) || (options.maxWaves ?? 20) < 1 || (options.maxWaves ?? 20) > 20) {
        throw new Error('maxWaves must be an integer between 1 and 20');
    }
}
class PveGameRuntime {
    tickRateMs;
    seed;
    prng;
    prepDurationTicks;
    maxWaves;
    laneRoutes;
    isDeployableCell;
    initialCharacterTokens;
    eventHistoryLimit;
    players = new Map();
    slotAssignments = new Map();
    processedActions = new Map();
    recentEvents = [];
    enemies = [];
    laneWaves = [];
    currentTick = 0;
    status = 'waiting';
    result = null;
    currentWaveNumber = 0;
    pendingWaveNumber = null;
    wavePhase = 'idle';
    prepRemainingTicks = 0;
    playerCountAtStart = 0;
    enemyCapacity = 0;
    overloadTicks = 0;
    pieceSequence = 0;
    enemySequence = 0;
    eventSequence = 0;
    constructor(options) {
        (0, catalogs_1.validatePveV2Catalogs)();
        validateRuntimeOptions(options);
        this.tickRateMs = options.tickRateMs ?? 100;
        this.seed = String(options.seed);
        this.prng = new prng_1.DeterministicPrng(options.seed);
        this.prepDurationTicks = Math.ceil((options.prepDurationMs ?? 5000) / this.tickRateMs);
        this.maxWaves = options.maxWaves ?? 20;
        this.laneRoutes = (0, arena_1.createPveLaneRoutes)(options.laneRoutes);
        this.isDeployableCell = options.isDeployableCell ?? arena_1.isDefaultDeployableCell;
        this.initialCharacterTokens = sanitizeCharacterTokens(options.characterTokens);
        this.eventHistoryLimit = Math.max(20, options.eventHistoryLimit ?? 300);
    }
    registerPlayer(playerId, slot) {
        if (this.status !== 'waiting') {
            return this.commandResult(false, 'MATCH_ALREADY_STARTED');
        }
        if (!playerId.trim() || !arena_1.PVE_LANE_SLOTS.includes(slot)) {
            return this.commandResult(false, 'INVALID_PLAYER_OR_SLOT');
        }
        if (this.players.has(playerId)) {
            return this.commandResult(false, 'PLAYER_ALREADY_REGISTERED');
        }
        if (this.slotAssignments.has(slot)) {
            return this.commandResult(false, 'SLOT_OCCUPIED');
        }
        const player = {
            playerId,
            slot,
            rice: 10,
            recruitCount: 0,
            populationCap: POPULATION_CAP,
            trayRevision: 0,
            reserveRevision: 0,
            boardRevision: 0,
            tray: Array(TRAY_SIZE).fill(null),
            reserve: Array(RESERVE_SIZE).fill(null),
            board: new Map(),
            remainingCharacterTokens: new Map(this.initialCharacterTokens),
            clearedWaves: new Set(),
        };
        this.players.set(playerId, player);
        this.slotAssignments.set(slot, playerId);
        return this.commandResult(true, 'PLAYER_REGISTERED');
    }
    unregister(playerId) {
        const player = this.players.get(playerId);
        if (!player) {
            return this.commandResult(false, 'PLAYER_NOT_FOUND');
        }
        if (this.status === 'running') {
            const currentLane = this.laneWaves.find((lane) => (lane.waveNumber === this.currentWaveNumber
                && lane.playerId === playerId
                && lane.slot === player.slot));
            if (currentLane) {
                currentLane.totalCount = currentLane.spawnedCount;
                currentLane.retired = true;
            }
        }
        this.players.delete(playerId);
        this.slotAssignments.delete(player.slot);
        return this.commandResult(true, 'PLAYER_UNREGISTERED');
    }
    start() {
        if (this.status !== 'waiting') {
            return this.commandResult(false, 'MATCH_ALREADY_STARTED');
        }
        if (this.players.size === 0) {
            return this.commandResult(false, 'NO_PLAYERS');
        }
        this.status = 'running';
        this.playerCountAtStart = this.players.size;
        this.enemyCapacity = this.playerCountAtStart * ENEMY_CAPACITY_PER_PLAYER;
        this.prepareWave(1);
        this.emit('MATCH_STARTED', {
            playerCount: this.playerCountAtStart,
            enemyCapacity: this.enemyCapacity,
            seed: this.seed,
        });
        if (this.prepRemainingTicks === 0) {
            this.beginPreparedWave();
        }
        return this.commandResult(true, 'MATCH_STARTED');
    }
    handleAction(playerId, action) {
        const actionKey = `${playerId}:${action.actionId}`;
        const existing = this.processedActions.get(actionKey);
        if (existing) {
            return { ...existing, details: existing.details ? { ...existing.details } : undefined };
        }
        let result;
        if (!action.actionId.trim()) {
            result = this.actionResult(action, false, 'INVALID_ACTION_ID');
        }
        else if (this.status === 'finished') {
            result = this.actionResult(action, false, 'MATCH_FINISHED');
        }
        else {
            const player = this.players.get(playerId);
            if (!player) {
                result = this.actionResult(action, false, 'PLAYER_NOT_FOUND');
            }
            else {
                switch (action.type) {
                    case 'RECRUIT_BATCH':
                        result = this.handleRecruit(player, action);
                        break;
                    case 'SWAP_TRAY_BOARD':
                        result = this.handleSwapTrayBoard(player, action);
                        break;
                    case 'MOVE_BOARD_PIECE':
                        result = this.handleMoveBoardPiece(player, action);
                        break;
                    case 'MERGE_SOLDIERS':
                        result = this.handleMergeSoldiers(player, action);
                        break;
                    case 'SWAP_RESERVE_BOARD':
                        result = this.handleSwapReserveBoard(player, action);
                        break;
                    case 'EXILE_RESERVE':
                        result = this.handleExileReserve(player, action);
                        break;
                    case 'SWAP_STORAGE_PIECES':
                        result = this.handleSwapStoragePieces(player, action);
                        break;
                }
            }
        }
        this.processedActions.set(actionKey, result);
        return { ...result, details: result.details ? { ...result.details } : undefined };
    }
    tick() {
        if (this.status !== 'running') {
            return this.snapshot();
        }
        this.currentTick += 1;
        if (this.wavePhase === 'prep') {
            this.prepRemainingTicks = Math.max(0, this.prepRemainingTicks - 1);
            if (this.prepRemainingTicks === 0) {
                this.beginPreparedWave();
            }
        }
        this.spawnDueEnemies();
        this.moveEnemies();
        this.resolveSoldierAttacks();
        this.enemies = this.enemies.filter((enemy) => enemy.lifecycle === 'alive');
        this.updateLaneClearRewards();
        this.updateWavePhaseAndProgression();
        this.evaluateOverload();
        return this.snapshot();
    }
    snapshot() {
        const overloadLimitTicks = Math.ceil(OVERLOAD_DURATION_MS / this.tickRateMs);
        const players = [...this.players.values()]
            .sort((left, right) => slotOrder(left.slot) - slotOrder(right.slot))
            .map((player) => this.playerSnapshot(player));
        return {
            schemaVersion: 2,
            tick: this.currentTick,
            tickRateMs: this.tickRateMs,
            seed: this.seed,
            rngState: this.prng.snapshot(),
            status: this.status,
            result: this.result ? { ...this.result } : null,
            playerCountAtStart: this.playerCountAtStart,
            enemyCapacity: this.enemyCapacity,
            overloadTicks: this.overloadTicks,
            overloadCountdownMs: this.overloadTicks > 0
                ? Math.max(0, overloadLimitTicks - this.overloadTicks) * this.tickRateMs
                : 0,
            wave: {
                number: this.currentWaveNumber,
                maxWaves: this.maxWaves,
                phase: this.wavePhase,
                prepRemainingTicks: this.prepRemainingTicks,
                lanes: this.currentLaneWaves()
                    .slice()
                    .sort((left, right) => slotOrder(left.slot) - slotOrder(right.slot))
                    .map((lane) => ({
                    playerId: lane.playerId,
                    slot: lane.slot,
                    spawnedCount: lane.spawnedCount,
                    totalCount: lane.totalCount,
                    cleared: lane.spawnedCount >= lane.totalCount && !this.hasAliveLaneEnemy(lane),
                    clearRewardGranted: lane.clearRewardGranted,
                    retired: lane.retired,
                })),
            },
            players,
            enemies: this.enemies
                .filter((enemy) => enemy.lifecycle === 'alive')
                .slice()
                .sort((left, right) => left.spawnSequence - right.spawnSequence)
                .map(({ lifecycle: _lifecycle, ...enemy }) => ({ ...enemy })),
            recentEvents: this.recentEvents.map((event) => ({
                ...event,
                data: structuredClone(event.data),
            })),
        };
    }
    handleRecruit(player, action) {
        if (!this.revisionMatches(action.expectedTrayRevision, player.trayRevision)) {
            return this.actionResult(action, false, 'STALE_TRAY_REVISION');
        }
        const cost = this.nextRecruitCost(player);
        if (player.rice < cost) {
            return this.actionResult(action, false, 'INSUFFICIENT_RICE', { required: cost, available: player.rice });
        }
        const nextTray = Array.from({ length: TRAY_SIZE }, () => this.drawRecruitPiece(player));
        let firstBatchSoldierForced = false;
        if (player.recruitCount === 0 && nextTray.filter((piece) => piece.kind === 'soldier').length === 0) {
            const replacementIndex = this.prng.pickIndex(TRAY_SIZE);
            const replaced = nextTray[replacementIndex];
            if (replaced.kind === 'character') {
                player.remainingCharacterTokens.set(replaced.glyph, (player.remainingCharacterTokens.get(replaced.glyph) ?? 0) + 1);
            }
            nextTray[replacementIndex] = this.createSoldierPiece(player.playerId, this.drawSoldierType(), 1, 0);
            firstBatchSoldierForced = true;
        }
        player.rice -= cost;
        player.recruitCount += 1;
        player.tray = nextTray;
        player.trayRevision += 1;
        this.emit('RECRUITED', {
            playerId: player.playerId,
            cost,
            recruitCount: player.recruitCount,
            nextRecruitCost: this.nextRecruitCost(player),
            firstBatchSoldierForced,
            pieceIds: nextTray.map((piece) => piece.id),
        });
        return this.actionResult(action, true, 'RECRUITED', {
            cost,
            nextRecruitCost: this.nextRecruitCost(player),
            firstBatchSoldierForced,
        });
    }
    handleSwapTrayBoard(player, action) {
        const revisionError = this.validateRevisions(player, action.expectedTrayRevision, action.expectedBoardRevision);
        if (revisionError) {
            return this.actionResult(action, false, revisionError);
        }
        if (!Number.isInteger(action.trayIndex) || action.trayIndex < 0 || action.trayIndex >= TRAY_SIZE) {
            return this.actionResult(action, false, 'INVALID_TRAY_INDEX');
        }
        if (!this.canDeployAt(player.slot, action.boardX, action.boardY)) {
            return this.actionResult(action, false, 'CELL_NOT_DEPLOYABLE');
        }
        const key = boardKey(action.boardX, action.boardY);
        const trayPiece = player.tray[action.trayIndex];
        const boardEntry = player.board.get(key);
        const boardPiece = boardEntry?.piece ?? null;
        if (!trayPiece && !boardPiece) {
            return this.actionResult(action, false, 'EMPTY_TO_EMPTY');
        }
        const nextPopulation = this.populationUsed(player)
            - (isSoldier(boardPiece) ? 1 : 0)
            + (isSoldier(trayPiece) ? 1 : 0);
        if (nextPopulation > player.populationCap) {
            return this.actionResult(action, false, 'POPULATION_LIMIT');
        }
        player.tray[action.trayIndex] = boardPiece;
        if (trayPiece) {
            if (isSoldier(trayPiece)) {
                trayPiece.nextAttackTick = this.currentTick + this.attackIntervalTicks(trayPiece);
            }
            player.board.set(key, { x: action.boardX, y: action.boardY, piece: trayPiece });
        }
        else {
            player.board.delete(key);
        }
        player.trayRevision += 1;
        player.boardRevision += 1;
        this.emit('TRAY_BOARD_SWAPPED', {
            playerId: player.playerId,
            trayIndex: action.trayIndex,
            boardX: action.boardX,
            boardY: action.boardY,
            trayPieceId: trayPiece?.id ?? null,
            boardPieceId: boardPiece?.id ?? null,
        });
        return this.actionResult(action, true, 'TRAY_BOARD_SWAPPED');
    }
    handleSwapReserveBoard(player, action) {
        if (!this.revisionMatches(action.expectedReserveRevision, player.reserveRevision)) {
            return this.actionResult(action, false, 'STALE_RESERVE_REVISION');
        }
        if (!this.revisionMatches(action.expectedBoardRevision, player.boardRevision)) {
            return this.actionResult(action, false, 'STALE_BOARD_REVISION');
        }
        if (!Number.isInteger(action.reserveIndex) || action.reserveIndex < 0 || action.reserveIndex >= RESERVE_SIZE) {
            return this.actionResult(action, false, 'INVALID_RESERVE_INDEX');
        }
        if (!this.canDeployAt(player.slot, action.boardX, action.boardY)) {
            return this.actionResult(action, false, 'CELL_NOT_DEPLOYABLE');
        }
        const key = boardKey(action.boardX, action.boardY);
        const reservePiece = player.reserve[action.reserveIndex];
        const boardEntry = player.board.get(key);
        const boardPiece = boardEntry?.piece ?? null;
        if (!reservePiece && !boardPiece) {
            return this.actionResult(action, false, 'EMPTY_TO_EMPTY');
        }
        const nextPopulation = this.populationUsed(player)
            - (isSoldier(boardPiece) ? 1 : 0)
            + (isSoldier(reservePiece) ? 1 : 0);
        if (nextPopulation > player.populationCap) {
            return this.actionResult(action, false, 'POPULATION_LIMIT');
        }
        player.reserve[action.reserveIndex] = boardPiece;
        if (reservePiece) {
            this.resetAttackCooldown(reservePiece);
            player.board.set(key, { x: action.boardX, y: action.boardY, piece: reservePiece });
        }
        else {
            player.board.delete(key);
        }
        player.reserveRevision += 1;
        player.boardRevision += 1;
        this.emit('RESERVE_BOARD_SWAPPED', {
            playerId: player.playerId,
            reserveIndex: action.reserveIndex,
            boardX: action.boardX,
            boardY: action.boardY,
            reservePieceId: reservePiece?.id ?? null,
            boardPieceId: boardPiece?.id ?? null,
        });
        return this.actionResult(action, true, 'RESERVE_BOARD_SWAPPED');
    }
    handleExileReserve(player, action) {
        if (!this.revisionMatches(action.expectedReserveRevision, player.reserveRevision)) {
            return this.actionResult(action, false, 'STALE_RESERVE_REVISION');
        }
        const exiledPieceIds = player.reserve.flatMap((piece) => piece ? [piece.id] : []);
        player.reserve = Array(RESERVE_SIZE).fill(null);
        player.reserveRevision += 1;
        this.emit('RESERVE_EXILED', {
            playerId: player.playerId,
            exiledPieceIds,
            exiledCount: exiledPieceIds.length,
        });
        return this.actionResult(action, true, 'RESERVE_EXILED', { exiledCount: exiledPieceIds.length });
    }
    handleSwapStoragePieces(player, action) {
        if (!this.revisionMatches(action.expectedTrayRevision, player.trayRevision)) {
            return this.actionResult(action, false, 'STALE_TRAY_REVISION');
        }
        if (!this.revisionMatches(action.expectedReserveRevision, player.reserveRevision)) {
            return this.actionResult(action, false, 'STALE_RESERVE_REVISION');
        }
        if (!this.isStorageIndexValid(action.sourceZone, action.sourceIndex)
            || !this.isStorageIndexValid(action.targetZone, action.targetIndex)) {
            return this.actionResult(action, false, 'INVALID_STORAGE_INDEX');
        }
        if (action.sourceZone === action.targetZone && action.sourceIndex === action.targetIndex) {
            return this.actionResult(action, false, 'SAME_LOCATION');
        }
        const sourceStorage = action.sourceZone === 'tray' ? player.tray : player.reserve;
        const targetStorage = action.targetZone === 'tray' ? player.tray : player.reserve;
        const sourcePiece = sourceStorage[action.sourceIndex];
        const targetPiece = targetStorage[action.targetIndex];
        if (!sourcePiece && !targetPiece) {
            return this.actionResult(action, false, 'EMPTY_TO_EMPTY');
        }
        sourceStorage[action.sourceIndex] = targetPiece;
        targetStorage[action.targetIndex] = sourcePiece;
        if (action.sourceZone === 'tray' || action.targetZone === 'tray') {
            player.trayRevision += 1;
        }
        if (action.sourceZone === 'reserve' || action.targetZone === 'reserve') {
            player.reserveRevision += 1;
        }
        this.emit('STORAGE_PIECES_SWAPPED', {
            playerId: player.playerId,
            sourceZone: action.sourceZone,
            sourceIndex: action.sourceIndex,
            targetZone: action.targetZone,
            targetIndex: action.targetIndex,
            sourcePieceId: sourcePiece?.id ?? null,
            targetPieceId: targetPiece?.id ?? null,
        });
        return this.actionResult(action, true, 'STORAGE_PIECES_SWAPPED');
    }
    handleMoveBoardPiece(player, action) {
        if (!this.revisionMatches(action.expectedBoardRevision, player.boardRevision)) {
            return this.actionResult(action, false, 'STALE_BOARD_REVISION');
        }
        if (!this.canDeployAt(player.slot, action.targetX, action.targetY)) {
            return this.actionResult(action, false, 'CELL_NOT_DEPLOYABLE');
        }
        const source = this.findBoardEntryByPieceId(player, action.pieceId);
        if (!source) {
            return this.actionResult(action, false, 'PIECE_NOT_FOUND');
        }
        const sourceKey = boardKey(source.x, source.y);
        const targetKey = boardKey(action.targetX, action.targetY);
        if (sourceKey === targetKey) {
            return this.actionResult(action, false, 'SAME_LOCATION');
        }
        const target = player.board.get(targetKey);
        player.board.set(targetKey, { x: action.targetX, y: action.targetY, piece: source.piece });
        if (target) {
            player.board.set(sourceKey, { x: source.x, y: source.y, piece: target.piece });
        }
        else {
            player.board.delete(sourceKey);
        }
        this.resetAttackCooldown(source.piece);
        if (target) {
            this.resetAttackCooldown(target.piece);
        }
        player.boardRevision += 1;
        this.emit('BOARD_PIECE_MOVED', {
            playerId: player.playerId,
            pieceId: action.pieceId,
            sourceX: source.x,
            sourceY: source.y,
            targetX: action.targetX,
            targetY: action.targetY,
            swappedPieceId: target?.piece.id ?? null,
        });
        return this.actionResult(action, true, 'BOARD_PIECE_MOVED');
    }
    handleMergeSoldiers(player, action) {
        const revisionError = this.validateRevisions(player, action.expectedTrayRevision, action.expectedBoardRevision, action.expectedReserveRevision);
        if (revisionError) {
            return this.actionResult(action, false, revisionError);
        }
        if (action.sourcePieceId === action.targetPieceId) {
            return this.actionResult(action, false, 'SAME_PIECE');
        }
        const source = this.findPiece(player, action.sourcePieceId);
        const target = this.findPiece(player, action.targetPieceId);
        if (!source || !target) {
            return this.actionResult(action, false, 'PIECE_NOT_FOUND');
        }
        if (!isSoldier(source.piece) || !isSoldier(target.piece)) {
            return this.actionResult(action, false, 'NOT_SOLDIER');
        }
        if (source.piece.soldierType !== target.piece.soldierType) {
            return this.actionResult(action, false, 'TYPE_MISMATCH');
        }
        if (source.piece.level !== target.piece.level) {
            return this.actionResult(action, false, 'LEVEL_MISMATCH');
        }
        if (source.piece.level >= 5) {
            return this.actionResult(action, false, 'MAX_LEVEL');
        }
        const nextLevel = (source.piece.level + 1);
        const merged = this.createSoldierPiece(player.playerId, source.piece.soldierType, nextLevel, 0);
        this.removePieceAt(player, source.location);
        this.removePieceAt(player, target.location);
        this.putPieceAt(player, target.location, merged);
        if (target.location.kind === 'board') {
            merged.nextAttackTick = this.currentTick + this.attackIntervalTicks(merged);
        }
        if (source.location.kind === 'tray' || target.location.kind === 'tray') {
            player.trayRevision += 1;
        }
        if (source.location.kind === 'board' || target.location.kind === 'board') {
            player.boardRevision += 1;
        }
        if (source.location.kind === 'reserve' || target.location.kind === 'reserve') {
            player.reserveRevision += 1;
        }
        this.emit('SOLDIER_MERGED', {
            playerId: player.playerId,
            sourcePieceId: action.sourcePieceId,
            targetPieceId: action.targetPieceId,
            mergedPieceId: merged.id,
            soldierType: merged.soldierType,
            level: merged.level,
            targetLocation: target.location.kind,
        });
        return this.actionResult(action, true, 'SOLDIER_MERGED', {
            mergedPieceId: merged.id,
            level: merged.level,
        });
    }
    drawRecruitPiece(player) {
        const eligibleGlyphs = [...player.remainingCharacterTokens.entries()]
            .filter(([, count]) => count > 0)
            .map(([glyph]) => glyph)
            .sort((left, right) => left.localeCompare(right));
        if (eligibleGlyphs.length > 0 && this.prng.rollBps(CHARACTER_BRANCH_BPS)) {
            const glyph = eligibleGlyphs[this.prng.pickIndex(eligibleGlyphs.length)];
            const nextCount = (player.remainingCharacterTokens.get(glyph) ?? 0) - 1;
            if (nextCount > 0) {
                player.remainingCharacterTokens.set(glyph, nextCount);
            }
            else {
                player.remainingCharacterTokens.delete(glyph);
            }
            return this.createCharacterPiece(player.playerId, glyph);
        }
        return this.createSoldierPiece(player.playerId, this.drawSoldierType(), 1, 0);
    }
    drawSoldierType() {
        return catalogs_1.SOLDIER_TYPES[this.prng.pickIndex(catalogs_1.SOLDIER_TYPES.length)];
    }
    createSoldierPiece(ownerPlayerId, soldierType, level, nextAttackTick) {
        this.pieceSequence += 1;
        return {
            id: `piece-${this.pieceSequence}`,
            kind: 'soldier',
            ownerPlayerId,
            soldierType,
            level,
            nextAttackTick,
            createdSequence: this.pieceSequence,
        };
    }
    createCharacterPiece(ownerPlayerId, glyph) {
        this.pieceSequence += 1;
        return {
            id: `piece-${this.pieceSequence}`,
            kind: 'character',
            ownerPlayerId,
            glyph,
            createdSequence: this.pieceSequence,
        };
    }
    prepareWave(waveNumber) {
        if (this.currentWaveNumber === 0) {
            this.currentWaveNumber = waveNumber;
        }
        else {
            this.pendingWaveNumber = waveNumber;
        }
        this.wavePhase = 'prep';
        this.prepRemainingTicks = this.prepDurationTicks;
    }
    beginPreparedWave() {
        if (this.pendingWaveNumber !== null) {
            this.currentWaveNumber = this.pendingWaveNumber;
            this.pendingWaveNumber = null;
        }
        this.beginWaveSpawning();
    }
    beginWaveSpawning() {
        const definition = (0, catalogs_1.getWaveMinionCatalogEntry)(this.currentWaveNumber);
        if (!definition || this.currentWaveNumber > this.maxWaves) {
            this.finishMatch('victory', 'All configured waves cleared');
            return;
        }
        const activePlayers = [...this.players.values()].sort((left, right) => slotOrder(left.slot) - slotOrder(right.slot));
        if (activePlayers.length === 0) {
            this.finishMatch('defeat', 'No active players');
            return;
        }
        this.wavePhase = 'spawning';
        const nextLaneWaves = activePlayers.map((player) => ({
            waveNumber: this.currentWaveNumber,
            playerId: player.playerId,
            slot: player.slot,
            spawnedCount: 0,
            totalCount: definition.countPerPlayer,
            nextSpawnTick: this.currentTick,
            clearRewardGranted: false,
            retired: false,
        }));
        this.laneWaves.push(...nextLaneWaves);
        this.emit('WAVE_STARTED', {
            waveNumber: this.currentWaveNumber,
            laneCount: nextLaneWaves.length,
            countPerLane: definition.countPerPlayer,
        });
    }
    spawnDueEnemies() {
        if (this.wavePhase !== 'spawning') {
            return;
        }
        const definition = (0, catalogs_1.getWaveMinionCatalogEntry)(this.currentWaveNumber);
        if (!definition) {
            return;
        }
        const intervalTicks = Math.max(1, Math.ceil(definition.spawnIntervalMs / this.tickRateMs));
        const currentLanes = this.currentLaneWaves();
        for (const lane of currentLanes) {
            while (lane.spawnedCount < lane.totalCount && this.currentTick >= lane.nextSpawnTick) {
                this.spawnEnemy(lane, definition);
                lane.spawnedCount += 1;
                lane.nextSpawnTick += intervalTicks;
            }
        }
    }
    spawnEnemy(lane, definition) {
        const route = this.laneRoutes[lane.slot];
        const spawn = route.waypoints[0];
        const glyph = definition.glyphPool[this.prng.pickIndex(definition.glyphPool.length)];
        this.enemySequence += 1;
        const enemy = {
            id: `enemy-${this.enemySequence}`,
            glyph,
            waveNumber: definition.waveNumber,
            laneOwnerPlayerId: lane.playerId,
            laneSlot: lane.slot,
            spawnSequence: this.enemySequence,
            xMilli: spawn.x * 1000,
            yMilli: spawn.y * 1000,
            routeWaypointIndex: 0,
            lapCount: 0,
            pathProgressMilli: 0,
            currentHp: definition.maxHp,
            maxHp: definition.maxHp,
            armor: definition.armor,
            magicResistance: definition.magicResistance,
            moveSpeedMilliCellsPerSecond: definition.moveSpeedMilliCellsPerSecond,
            lastDamagePlayerId: null,
            lifecycle: 'alive',
        };
        this.enemies.push(enemy);
        this.emit('ENEMY_SPAWNED', {
            enemyId: enemy.id,
            glyph,
            waveNumber: definition.waveNumber,
            laneOwnerPlayerId: lane.playerId,
            laneSlot: lane.slot,
        });
    }
    moveEnemies() {
        const distancePerTick = Math.floor(1000 * this.tickRateMs / 1000);
        for (const enemy of this.enemies) {
            if (enemy.lifecycle !== 'alive') {
                continue;
            }
            this.moveEnemy(enemy, distancePerTick);
        }
    }
    moveEnemy(enemy, requestedDistance) {
        const route = this.laneRoutes[enemy.laneSlot];
        let remaining = Math.floor(requestedDistance * enemy.moveSpeedMilliCellsPerSecond / 1000);
        let traversed = 0;
        const traversalGuard = route.waypoints.length * 2 + 4;
        while (remaining > 0 && traversed < traversalGuard) {
            traversed += 1;
            let nextIndex = enemy.routeWaypointIndex + 1;
            if (nextIndex >= route.waypoints.length) {
                nextIndex = route.loopStartIndex;
                enemy.lapCount += 1;
            }
            const target = route.waypoints[nextIndex];
            const targetX = target.x * 1000;
            const targetY = target.y * 1000;
            const deltaX = targetX - enemy.xMilli;
            const deltaY = targetY - enemy.yMilli;
            const distance = Math.abs(deltaX) + Math.abs(deltaY);
            if (distance === 0) {
                enemy.routeWaypointIndex = nextIndex;
                continue;
            }
            const travel = Math.min(remaining, distance);
            enemy.xMilli += Math.sign(deltaX) * Math.min(Math.abs(deltaX), travel);
            const consumedX = Math.min(Math.abs(deltaX), travel);
            const remainingForY = travel - consumedX;
            enemy.yMilli += Math.sign(deltaY) * Math.min(Math.abs(deltaY), remainingForY);
            enemy.pathProgressMilli += travel;
            remaining -= travel;
            if (travel === distance) {
                enemy.routeWaypointIndex = nextIndex;
            }
        }
    }
    resolveSoldierAttacks() {
        const attackers = [...this.players.values()]
            .flatMap((player) => [...player.board.values()].map((entry) => ({ player, entry })))
            .filter((candidate) => isSoldier(candidate.entry.piece))
            .sort((left, right) => {
            return slotOrder(left.player.slot) - slotOrder(right.player.slot)
                || left.entry.y - right.entry.y
                || left.entry.x - right.entry.x
                || left.entry.piece.id.localeCompare(right.entry.piece.id);
        });
        for (const { player, entry } of attackers) {
            const soldier = entry.piece;
            if (this.currentTick < soldier.nextAttackTick) {
                continue;
            }
            const definition = (0, catalogs_1.getSoldierCatalogEntry)(soldier.soldierType);
            const primary = this.selectPrimaryTarget(entry, soldier, definition);
            if (!primary) {
                continue;
            }
            const targets = this.freezeAttackTargets(entry, soldier, definition, primary);
            soldier.nextAttackTick = this.currentTick + this.attackIntervalTicks(soldier);
            this.emit('BASIC_ATTACK_STARTED', {
                attackerId: soldier.id,
                playerId: player.playerId,
                targetIds: targets.map((target) => target.id),
            });
            for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
                const target = targets[targetIndex];
                if (target.lifecycle !== 'alive') {
                    continue;
                }
                this.applySoldierDamage(player, soldier, definition, target, targetIndex > 0);
            }
        }
    }
    selectPrimaryTarget(entry, soldier, definition) {
        const range = (0, catalogs_1.getSoldierLevelValue)(definition.attackRangeMilliCellsByLevel, soldier.level);
        const candidates = this.enemies.filter((enemy) => {
            if (enemy.lifecycle !== 'alive' || (0, arena_1.isInsidePveProtectedZoneMilli)(enemy.xMilli, enemy.yMilli)) {
                return false;
            }
            return this.distanceSquared(entry.x * 1000, entry.y * 1000, enemy.xMilli, enemy.yMilli) <= range * range;
        });
        candidates.sort((left, right) => this.compareEnemyPriority(left, right));
        return candidates[0] ?? null;
    }
    freezeAttackTargets(entry, soldier, definition, primary) {
        const level = soldier.level;
        const maxTargets = (0, catalogs_1.getSoldierLevelValue)(definition.maxTargetsByLevel, level);
        if (definition.attackShape === 'single' || maxTargets <= 1) {
            return [primary];
        }
        const range = (0, catalogs_1.getSoldierLevelValue)(definition.attackRangeMilliCellsByLevel, level);
        const attackerX = entry.x * 1000;
        const attackerY = entry.y * 1000;
        const candidates = this.enemies.filter((enemy) => {
            if (enemy.lifecycle !== 'alive'
                || enemy.id === primary.id
                || (0, arena_1.isInsidePveProtectedZoneMilli)(enemy.xMilli, enemy.yMilli)) {
                return false;
            }
            if (this.distanceSquared(attackerX, attackerY, enemy.xMilli, enemy.yMilli) > range * range) {
                return false;
            }
            if (definition.attackShape === 'radius') {
                const radius = (0, catalogs_1.getSoldierLevelValue)(definition.radiusMilliCellsByLevel, level);
                return this.distanceSquared(primary.xMilli, primary.yMilli, enemy.xMilli, enemy.yMilli) <= radius * radius;
            }
            return this.isOnPierceLine(attackerX, attackerY, primary, enemy);
        });
        candidates.sort((left, right) => this.compareEnemyPriority(left, right));
        return [primary, ...candidates.slice(0, maxTargets - 1)];
    }
    isOnPierceLine(attackerX, attackerY, primary, candidate) {
        const lineX = primary.xMilli - attackerX;
        const lineY = primary.yMilli - attackerY;
        const candidateX = candidate.xMilli - attackerX;
        const candidateY = candidate.yMilli - attackerY;
        const lineLengthSquared = lineX * lineX + lineY * lineY;
        if (lineLengthSquared === 0) {
            return false;
        }
        const dot = candidateX * lineX + candidateY * lineY;
        if (dot < 0) {
            return false;
        }
        const cross = candidateX * lineY - candidateY * lineX;
        const toleranceMilli = 500;
        return cross * cross <= toleranceMilli * toleranceMilli * lineLengthSquared;
    }
    applySoldierDamage(player, soldier, definition, target, isSecondary) {
        if ((0, arena_1.isInsidePveProtectedZoneMilli)(target.xMilli, target.yMilli)) {
            return;
        }
        let rawDamage = (0, catalogs_1.getSoldierLevelValue)(definition.attackByLevel, soldier.level);
        if (isSecondary) {
            const ratio = (0, catalogs_1.getSoldierLevelValue)(definition.secondaryDamageBpsByLevel, soldier.level);
            rawDamage = Math.floor(rawDamage * ratio / 10000);
        }
        const isCritical = this.prng.rollBps((0, catalogs_1.getSoldierLevelValue)(definition.critChanceBpsByLevel, soldier.level));
        if (isCritical) {
            rawDamage = Math.floor(rawDamage * (0, catalogs_1.getSoldierLevelValue)(definition.critDamageBpsByLevel, soldier.level) / 10000);
        }
        const finalDamage = Math.max(1, Math.floor(rawDamage * 100 / (100 + Math.max(0, target.armor))));
        const hpBefore = target.currentHp;
        target.currentHp = Math.max(0, target.currentHp - finalDamage);
        target.lastDamagePlayerId = player.playerId;
        this.emit('DAMAGE_APPLIED', {
            attackerId: soldier.id,
            playerId: player.playerId,
            enemyId: target.id,
            rawDamage,
            finalDamage,
            hpBefore,
            hpAfter: target.currentHp,
            isCritical,
            isSecondary,
        });
        if (target.currentHp <= 0) {
            this.settleEnemyDeath(target);
        }
    }
    settleEnemyDeath(enemy) {
        if (enemy.lifecycle !== 'alive') {
            return;
        }
        enemy.lifecycle = 'dead';
        this.emit('ENEMY_DIED', {
            enemyId: enemy.id,
            waveNumber: enemy.waveNumber,
            laneOwnerPlayerId: enemy.laneOwnerPlayerId,
            lastDamagePlayerId: enemy.lastDamagePlayerId,
        });
        if (!enemy.lastDamagePlayerId) {
            return;
        }
        const killer = this.players.get(enemy.lastDamagePlayerId);
        if (killer) {
            killer.rice += 1;
            this.emit('RICE_GRANTED', {
                playerId: killer.playerId,
                enemyId: enemy.id,
                amount: 1,
                reason: 'LAST_DAMAGE_KILL',
            });
            this.emit('GENERAL_XP_SETTLEMENT_AVAILABLE', {
                playerId: killer.playerId,
                enemyId: enemy.id,
                xpPoints: XP_REWARD_POINTS,
            });
        }
    }
    updateLaneClearRewards() {
        for (const lane of this.laneWaves) {
            if (lane.retired || lane.clearRewardGranted || lane.spawnedCount < lane.totalCount || this.hasAliveLaneEnemy(lane)) {
                continue;
            }
            lane.clearRewardGranted = true;
            const owner = this.players.get(lane.playerId);
            if (!owner) {
                continue;
            }
            const reward = 5 * lane.waveNumber;
            owner.rice += reward;
            owner.clearedWaves.add(lane.waveNumber);
            this.emit('LANE_WAVE_CLEARED', {
                playerId: owner.playerId,
                slot: owner.slot,
                waveNumber: lane.waveNumber,
                riceReward: reward,
            });
            this.emit('RICE_GRANTED', {
                playerId: owner.playerId,
                enemyId: null,
                amount: reward,
                reason: 'LANE_WAVE_CLEAR',
            });
        }
    }
    updateWavePhaseAndProgression() {
        const currentLanes = this.currentLaneWaves();
        if (currentLanes.length === 0 || this.wavePhase === 'prep') {
            return;
        }
        const allSpawned = currentLanes.every((lane) => lane.spawnedCount >= lane.totalCount);
        if (!allSpawned) {
            return;
        }
        if (this.currentWaveNumber >= this.maxWaves) {
            this.wavePhase = 'clearing';
            if (this.enemies.every((enemy) => enemy.lifecycle !== 'alive')) {
                this.wavePhase = 'complete';
                this.finishMatch('victory', 'All configured waves cleared');
            }
            return;
        }
        this.prepareWave(this.currentWaveNumber + 1);
        if (this.prepRemainingTicks === 0) {
            this.beginPreparedWave();
        }
    }
    evaluateOverload() {
        if (this.status !== 'running' || this.enemyCapacity <= 0) {
            return;
        }
        const aliveCount = this.enemies.filter((enemy) => enemy.lifecycle === 'alive').length;
        this.overloadTicks = aliveCount >= this.enemyCapacity ? this.overloadTicks + 1 : 0;
        if (this.overloadTicks >= Math.ceil(OVERLOAD_DURATION_MS / this.tickRateMs)) {
            this.finishMatch('defeat', 'Enemy capacity remained full for 10 seconds');
        }
    }
    finishMatch(outcome, reason) {
        if (this.status === 'finished') {
            return;
        }
        this.status = 'finished';
        this.result = { outcome, reason, decidedAtTick: this.currentTick };
        this.emit('MATCH_FINISHED', { outcome, reason });
    }
    hasAliveLaneEnemy(lane) {
        return this.enemies.some((enemy) => {
            return enemy.lifecycle === 'alive'
                && enemy.waveNumber === lane.waveNumber
                && enemy.laneOwnerPlayerId === lane.playerId
                && enemy.laneSlot === lane.slot;
        });
    }
    currentLaneWaves() {
        return this.laneWaves.filter((lane) => lane.waveNumber === this.currentWaveNumber);
    }
    playerSnapshot(player) {
        const remainingCharacterTokens = {};
        for (const [glyph, count] of [...player.remainingCharacterTokens.entries()].sort(([left], [right]) => left.localeCompare(right))) {
            remainingCharacterTokens[glyph] = count;
        }
        const boardPieces = [...player.board.values()]
            .sort((left, right) => left.y - right.y || left.x - right.x || left.piece.id.localeCompare(right.piece.id))
            .map((entry) => ({ x: entry.x, y: entry.y, piece: clonePiece(entry.piece) }));
        return {
            playerId: player.playerId,
            slot: player.slot,
            rice: player.rice,
            recruitCount: player.recruitCount,
            nextRecruitCost: this.nextRecruitCost(player),
            populationUsed: this.populationUsed(player),
            populationCap: player.populationCap,
            trayRevision: player.trayRevision,
            reserveRevision: player.reserveRevision,
            boardRevision: player.boardRevision,
            tray: player.tray.map((piece) => piece ? clonePiece(piece) : null),
            reserve: player.reserve.map((piece) => piece ? clonePiece(piece) : null),
            boardPieces,
            remainingCharacterTokens,
            clearedWaves: [...player.clearedWaves].sort((left, right) => left - right),
        };
    }
    nextRecruitCost(player) {
        return 5 + 2 * player.recruitCount;
    }
    populationUsed(player) {
        let used = 0;
        for (const entry of player.board.values()) {
            if (isSoldier(entry.piece)) {
                used += 1;
            }
        }
        return used;
    }
    findBoardEntryByPieceId(player, pieceId) {
        for (const entry of player.board.values()) {
            if (entry.piece.id === pieceId) {
                return entry;
            }
        }
        return null;
    }
    findPiece(player, pieceId) {
        const trayIndex = player.tray.findIndex((piece) => piece?.id === pieceId);
        if (trayIndex >= 0) {
            const piece = player.tray[trayIndex];
            return piece ? { piece, location: { kind: 'tray', trayIndex } } : null;
        }
        const reserveIndex = player.reserve.findIndex((piece) => piece?.id === pieceId);
        if (reserveIndex >= 0) {
            const piece = player.reserve[reserveIndex];
            return piece ? { piece, location: { kind: 'reserve', reserveIndex } } : null;
        }
        for (const [key, entry] of player.board.entries()) {
            if (entry.piece.id === pieceId) {
                return {
                    piece: entry.piece,
                    location: { kind: 'board', boardKey: key, boardX: entry.x, boardY: entry.y },
                };
            }
        }
        return null;
    }
    removePieceAt(player, location) {
        if (location.kind === 'tray' && location.trayIndex !== undefined) {
            player.tray[location.trayIndex] = null;
        }
        else if (location.kind === 'reserve' && location.reserveIndex !== undefined) {
            player.reserve[location.reserveIndex] = null;
        }
        else if (location.kind === 'board' && location.boardKey) {
            player.board.delete(location.boardKey);
        }
    }
    putPieceAt(player, location, piece) {
        if (location.kind === 'tray' && location.trayIndex !== undefined) {
            player.tray[location.trayIndex] = piece;
        }
        else if (location.kind === 'reserve' && location.reserveIndex !== undefined) {
            player.reserve[location.reserveIndex] = piece;
        }
        else if (location.kind === 'board'
            && location.boardKey
            && location.boardX !== undefined
            && location.boardY !== undefined) {
            player.board.set(location.boardKey, { x: location.boardX, y: location.boardY, piece });
        }
        else {
            throw new Error('Invalid piece target location');
        }
    }
    resetAttackCooldown(piece) {
        if (isSoldier(piece)) {
            piece.nextAttackTick = this.currentTick + this.attackIntervalTicks(piece);
        }
    }
    attackIntervalTicks(piece) {
        const definition = (0, catalogs_1.getSoldierCatalogEntry)(piece.soldierType);
        return Math.ceil((0, catalogs_1.getSoldierLevelValue)(definition.attackIntervalMsByLevel, piece.level) / this.tickRateMs);
    }
    compareEnemyPriority(left, right) {
        return right.lapCount - left.lapCount
            || right.pathProgressMilli - left.pathProgressMilli
            || left.spawnSequence - right.spawnSequence
            || left.id.localeCompare(right.id);
    }
    distanceSquared(leftX, leftY, rightX, rightY) {
        const deltaX = rightX - leftX;
        const deltaY = rightY - leftY;
        return deltaX * deltaX + deltaY * deltaY;
    }
    validateRevisions(player, expectedTrayRevision, expectedBoardRevision, expectedReserveRevision) {
        if (!this.revisionMatches(expectedTrayRevision, player.trayRevision)) {
            return 'STALE_TRAY_REVISION';
        }
        if (!this.revisionMatches(expectedBoardRevision, player.boardRevision)) {
            return 'STALE_BOARD_REVISION';
        }
        if (!this.revisionMatches(expectedReserveRevision, player.reserveRevision)) {
            return 'STALE_RESERVE_REVISION';
        }
        return null;
    }
    revisionMatches(expected, actual) {
        return expected === undefined || expected === actual;
    }
    isStorageIndexValid(zone, index) {
        const size = zone === 'tray' ? TRAY_SIZE : RESERVE_SIZE;
        return Number.isInteger(index) && index >= 0 && index < size;
    }
    canDeployAt(slot, x, y) {
        return Number.isInteger(x) && Number.isInteger(y) && this.isDeployableCell(slot, x, y);
    }
    commandResult(ok, code) {
        return { ok, code, tick: this.currentTick };
    }
    actionResult(action, ok, code, details) {
        return { ok, code, tick: this.currentTick, actionId: action.actionId, details };
    }
    emit(type, data) {
        this.eventSequence += 1;
        this.recentEvents.push({
            id: `event-${this.eventSequence}`,
            tick: this.currentTick,
            type,
            data,
        });
        while (this.recentEvents.length > this.eventHistoryLimit) {
            this.recentEvents.shift();
        }
    }
}
exports.PveGameRuntime = PveGameRuntime;
