"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolvePveRewardStoreMode = resolvePveRewardStoreMode;
exports.resolvePveCheckpointStoreMode = resolvePveCheckpointStoreMode;
exports.resolvePersistencePolicy = resolvePersistencePolicy;
function resolvePveRewardStoreMode(nodeEnv, configured) {
    const production = nodeEnv === 'production';
    const rewardStoreMode = mode(configured, production ? 'supabase' : 'memory', 'PVE_REWARD_STORE');
    if (production && rewardStoreMode !== 'supabase') {
        throw new Error('Production forbids PVE_REWARD_STORE=memory');
    }
    return rewardStoreMode;
}
function resolvePveCheckpointStoreMode(nodeEnv, configured) {
    const production = nodeEnv === 'production';
    const checkpointStoreMode = mode(configured, production ? 'supabase' : 'memory', 'PVE_CHECKPOINT_STORE');
    if (production && checkpointStoreMode !== 'supabase') {
        throw new Error('Production forbids PVE_CHECKPOINT_STORE=memory');
    }
    return checkpointStoreMode;
}
function mode(value, fallback, name) {
    const normalized = (value ?? fallback).trim().toLowerCase();
    if (normalized !== 'memory' && normalized !== 'supabase')
        throw new Error(`Unsupported ${name}; expected memory or supabase`);
    return normalized;
}
function resolvePersistencePolicy(input) {
    const production = input.nodeEnv === 'production';
    const pvpStoreMode = mode(input.pvpStore, production ? 'supabase' : 'memory', 'PVP_STORE');
    if (production && pvpStoreMode !== 'supabase')
        throw new Error('Production forbids PVP_STORE=memory');
    if (pvpStoreMode === 'supabase' && !input.hasSupabaseCredentials) {
        throw new Error('Supabase persistence requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    }
    return { production, pvpStoreMode, requiresWritablePersistence: production };
}
