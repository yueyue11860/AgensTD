"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupabasePveCheckpointStore = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
const store_1 = require("../pve-checkpoint-v1/store");
const clone = (value) => structuredClone(value);
function requiredString(row, key) {
    const value = row[key];
    if (typeof value !== 'string')
        throw new Error(`Invalid PVE checkpoint field ${key}`);
    return value;
}
function requiredNumber(row, key) {
    const value = row[key];
    if (typeof value !== 'number' || !Number.isSafeInteger(value))
        throw new Error(`Invalid PVE checkpoint field ${key}`);
    return value;
}
function leaseFromRow(row) {
    return {
        matchId: requiredString(row, 'match_id'), roomId: requiredString(row, 'room_id'),
        holderId: requiredString(row, 'holder_id'), generation: requiredNumber(row, 'generation'),
        leaseExpiresAt: requiredString(row, 'lease_expires_at'),
    };
}
function checkpointFromRow(row) {
    return {
        schemaVersion: 1,
        matchId: requiredString(row, 'match_id'), roomId: requiredString(row, 'room_id'),
        generation: requiredNumber(row, 'generation'), checkpointTick: requiredNumber(row, 'checkpoint_tick'),
        lastActionSequence: requiredNumber(row, 'last_action_sequence'),
        combatRulesetVersion: requiredString(row, 'combat_ruleset_version'),
        configSnapshot: clone(row.config_snapshot),
        stateHash: requiredString(row, 'state_hash'), payload: clone(row.payload_json),
        createdAt: requiredString(row, 'created_at'),
    };
}
function actionFromRow(row) {
    return {
        matchId: requiredString(row, 'match_id'), roomId: requiredString(row, 'room_id'),
        generation: requiredNumber(row, 'generation'), actionSequence: requiredNumber(row, 'action_sequence'),
        playerId: requiredString(row, 'player_id'), requestId: requiredString(row, 'request_id'),
        actionId: requiredString(row, 'action_id'), fingerprint: requiredString(row, 'fingerprint'),
        payload: clone(row.payload_json), serverTick: requiredNumber(row, 'server_tick'),
        rateLimitRemaining: requiredNumber(row, 'rate_limit_remaining'), createdAt: requiredString(row, 'created_at'),
    };
}
function storeError(error, fallback) {
    if (error.message?.includes('PVE_LEASE_FENCED'))
        return new store_1.PveCheckpointStoreError('LEASE_FENCED', 'PVE lease was fenced');
    if (error.message?.includes('PVE_LEASE_HELD'))
        return new store_1.PveCheckpointStoreError('LEASE_FENCED', 'PVE lease is still held by another process');
    if (error.message?.includes('PVE_CHECKPOINT_CONFLICT'))
        return new store_1.PveCheckpointStoreError('CHECKPOINT_CONFLICT', 'PVE checkpoint moved backwards');
    return new Error(`${fallback}: ${error.message ?? 'UNKNOWN'}`);
}
/** Service-role-only adapter. Lease/action/checkpoint mutations use fenced Postgres RPCs. */
class SupabasePveCheckpointStore {
    client;
    constructor(config) {
        this.client = config.supabaseUrl && config.supabaseServiceRoleKey
            ? (0, supabase_js_1.createClient)(config.supabaseUrl, config.supabaseServiceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
            : null;
    }
    isEnabled() { return this.client !== null; }
    async claimLease(input) {
        const { data, error } = await this.requireClient().rpc('claim_pve_match_lease', {
            p_match_id: input.matchId, p_room_id: input.roomId, p_holder_id: input.holderId, p_ttl_ms: input.ttlMs,
        }).single();
        if (error)
            throw storeError(error, 'PVE lease claim failed');
        return leaseFromRow(data);
    }
    async renewLease(lease, ttlMs) {
        const { data, error } = await this.requireClient().rpc('renew_pve_match_lease', {
            p_match_id: lease.matchId, p_holder_id: lease.holderId, p_generation: lease.generation, p_ttl_ms: ttlMs,
        }).maybeSingle();
        if (error)
            throw storeError(error, 'PVE lease renewal failed');
        if (!data)
            throw new store_1.PveCheckpointStoreError('LEASE_FENCED', 'PVE lease expired or was superseded');
        return leaseFromRow(data);
    }
    async loadCheckpoint(matchId) {
        const { data, error } = await this.requireClient().from('pve_match_checkpoints').select('*')
            .eq('match_id', matchId).maybeSingle();
        if (error)
            throw new Error(`PVE checkpoint read failed: ${error.message}`);
        return data ? checkpointFromRow(data) : null;
    }
    async loadLatestCheckpointForRoom(roomId) {
        const { data, error } = await this.requireClient().from('pve_match_checkpoints').select('*')
            .eq('room_id', roomId).order('updated_at', { ascending: false }).limit(1).maybeSingle();
        if (error)
            throw new Error(`PVE room checkpoint read failed: ${error.message}`);
        return data ? checkpointFromRow(data) : null;
    }
    async listLatestCheckpoints(limit = 1000) {
        const latestByRoom = new Map();
        const pageSize = 1000;
        for (let offset = 0; latestByRoom.size < limit; offset += pageSize) {
            const { data, error } = await this.requireClient().from('pve_match_checkpoints').select('*')
                .order('updated_at', { ascending: false }).range(offset, offset + pageSize - 1);
            if (error)
                throw new Error(`PVE checkpoint discovery failed: ${error.message}`);
            const rows = data;
            for (const row of rows) {
                const checkpoint = checkpointFromRow(row);
                if (!latestByRoom.has(checkpoint.roomId))
                    latestByRoom.set(checkpoint.roomId, checkpoint);
                if (latestByRoom.size >= limit)
                    break;
            }
            if (rows.length < pageSize)
                break;
        }
        return [...latestByRoom.values()].slice(0, limit);
    }
    async saveCheckpoint(lease, checkpoint) {
        const { error } = await this.requireClient().rpc('save_pve_match_checkpoint', {
            p_match_id: checkpoint.matchId, p_room_id: checkpoint.roomId, p_holder_id: lease.holderId,
            p_generation: lease.generation, p_schema_version: checkpoint.schemaVersion,
            p_checkpoint_tick: checkpoint.checkpointTick, p_last_action_sequence: checkpoint.lastActionSequence,
            p_combat_ruleset_version: checkpoint.combatRulesetVersion, p_config_snapshot: checkpoint.configSnapshot,
            p_state_hash: checkpoint.stateHash, p_payload_json: checkpoint.payload, p_created_at: checkpoint.createdAt,
        });
        if (error)
            throw storeError(error, 'PVE checkpoint write failed');
        const stored = await this.loadCheckpoint(checkpoint.matchId);
        if (!stored || stored.generation !== lease.generation || stored.stateHash !== checkpoint.stateHash) {
            throw new store_1.PveCheckpointStoreError('CHECKPOINT_CONFLICT', 'PVE checkpoint write verification failed');
        }
        return stored;
    }
    async getAction(matchId, playerId, requestId) {
        const { data, error } = await this.requireClient().from('pve_match_actions').select('*')
            .eq('match_id', matchId).eq('player_id', playerId).eq('request_id', requestId).maybeSingle();
        if (error)
            throw new Error(`PVE durable action read failed: ${error.message}`);
        return data ? actionFromRow(data) : null;
    }
    async reserveAction(lease, command, leaseTtlMs) {
        const { data, error } = await this.requireClient().rpc('reserve_pve_match_action', {
            p_match_id: command.matchId, p_room_id: command.roomId, p_holder_id: lease.holderId,
            p_generation: lease.generation, p_player_id: command.playerId, p_request_id: command.requestId,
            p_action_id: command.actionId, p_fingerprint: command.fingerprint, p_payload_json: command.payload,
            p_server_tick: command.serverTick, p_rate_limit_remaining: command.rateLimitRemaining, p_ttl_ms: leaseTtlMs,
        }).single();
        if (error)
            throw storeError(error, 'PVE action reservation failed');
        const disposition = requiredString(data, 'disposition');
        const record = actionFromRow(data.record_json);
        if (!['reserved', 'duplicate', 'conflict'].includes(disposition))
            throw new Error('PVE action reservation returned invalid data');
        return { status: disposition, record };
    }
    async listActionsAfter(matchId, actionSequence, limit = 1000) {
        const { data, error } = await this.requireClient().from('pve_match_actions').select('*')
            .eq('match_id', matchId).gt('action_sequence', actionSequence).order('action_sequence').limit(limit);
        if (error)
            throw new Error(`PVE durable action replay read failed: ${error.message}`);
        return data.map(actionFromRow);
    }
    requireClient() {
        if (!this.client)
            throw new Error('Supabase PVE checkpoint persistence is disabled');
        return this.client;
    }
}
exports.SupabasePveCheckpointStore = SupabasePveCheckpointStore;
