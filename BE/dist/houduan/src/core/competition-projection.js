"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWaveIndexForTick = getWaveIndexForTick;
exports.buildMatchResults = buildMatchResults;
exports.buildLiveLeaderboards = buildLiveLeaderboards;
exports.buildReplaySummary = buildReplaySummary;
const state_projection_1 = require("./state-projection");
function getWaveIndexForTick(tick) {
    return Math.floor(tick / 10) + 1;
}
function buildMatchResults(state, config) {
    const projected = (0, state_projection_1.projectFrontendGameState)(state, config);
    const now = new Date().toISOString();
    return state.players.map((player) => ({
        matchId: state.matchId,
        playerId: player.id,
        playerName: player.name,
        playerKind: player.kind,
        survivedWaves: getWaveIndexForTick(state.tick),
        score: player.score,
        fortress: projected.resources.fortress,
        updatedAt: now,
    }));
}
function buildLiveLeaderboards(state) {
    const entries = state.players
        .map((player) => ({
        playerId: player.id,
        playerName: player.name,
        playerKind: player.kind,
        bestSurvivedWaves: getWaveIndexForTick(state.tick),
        bestScore: player.score,
        lastMatchId: state.matchId,
        updatedAt: new Date().toISOString(),
    }))
        .sort((left, right) => right.bestScore - left.bestScore || right.bestSurvivedWaves - left.bestSurvivedWaves);
    return {
        human: entries.filter((entry) => entry.playerKind === 'human'),
        agent: entries.filter((entry) => entry.playerKind === 'agent'),
        all: entries,
    };
}
function buildReplaySummary(replay) {
    const latestFrame = replay.frames[replay.frames.length - 1];
    const topScore = replay.frames.reduce((winner, frame) => Math.max(winner, frame.gameState.score ?? 0), 0);
    const uniquePlayers = new Set(replay.actions.map((action) => action.player.playerId));
    return {
        matchId: replay.matchId,
        createdAt: replay.createdAt,
        updatedAt: replay.updatedAt,
        latestTick: latestFrame?.tick ?? 0,
        frameCount: replay.frames.length,
        actionCount: replay.actions.length,
        playerCount: uniquePlayers.size,
        topWave: latestFrame?.gameState.wave?.index ?? 0,
        topScore,
    };
}
