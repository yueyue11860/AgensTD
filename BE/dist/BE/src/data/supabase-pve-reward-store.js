"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupabasePveRewardStore = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
const store_1 = require("../pve-reward-v1/store");
const clone = (value) => structuredClone(value);
function batchFromRow(row) {
    return {
        batchKey: row.batch_key, fingerprint: row.fingerprint, matchId: row.match_id,
        playerId: row.player_id, combatRulesetVersion: row.combat_ruleset_version,
        configSnapshot: clone(row.config_snapshot), kind: row.batch_kind,
        events: clone(row.events_json), createdAt: row.created_at,
    };
}
function settlementFromRow(row) {
    return {
        settlementId: row.settlement_id, fingerprint: row.fingerprint,
        combatRulesetVersion: row.combat_ruleset_version, configSnapshot: clone(row.config_snapshot),
        rewardTableRevision: row.reward_table_revision, input: clone(row.input_json),
        ...(row.detail_json ? { detail: clone(row.detail_json) } : {}), status: row.status,
        attempts: row.attempts, lastError: row.last_error, settlement: clone(row.settlement_json),
        createdAt: row.created_at, updatedAt: row.updated_at,
    };
}
/** Service-role-only durable reward ledger and settlement outbox. */
class SupabasePveRewardStore {
    client;
    constructor(config) {
        this.client = config.supabaseUrl && config.supabaseServiceRoleKey
            ? (0, supabase_js_1.createClient)(config.supabaseUrl, config.supabaseServiceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
            : null;
    }
    isEnabled() { return this.client !== null; }
    async getBatch(batchKey) {
        const { data, error } = await this.requireClient().from('pve_reward_batches').select('*').eq('batch_key', batchKey).maybeSingle();
        if (error)
            throw new Error(`PVE reward batch read failed: ${error.message}`);
        return data ? batchFromRow(data) : null;
    }
    async recordBatch(batch) {
        const { error } = await this.requireClient().from('pve_reward_batches').insert({
            batch_key: batch.batchKey, fingerprint: batch.fingerprint, match_id: batch.matchId,
            player_id: batch.playerId, combat_ruleset_version: batch.combatRulesetVersion,
            config_snapshot: batch.configSnapshot, batch_kind: batch.kind,
            events_json: batch.events, created_at: batch.createdAt,
        });
        if (!error)
            return { duplicate: false, batch: clone(batch) };
        if (error.code !== '23505')
            throw new Error(`PVE reward batch write failed: ${error.message}`);
        const existing = await this.getBatch(batch.batchKey);
        if (!existing)
            throw new Error(`PVE reward batch ${batch.batchKey} disappeared after conflict`);
        if (existing.fingerprint !== batch.fingerprint) {
            throw new store_1.PveRewardStoreConflictError('REWARD_BATCH_CONFLICT', `Reward batch ${batch.batchKey} conflicts with stored facts`);
        }
        return { duplicate: true, batch: existing };
    }
    async listPlayerBatches(matchId, playerId) {
        const { data, error } = await this.requireClient().from('pve_reward_batches').select('*')
            .eq('match_id', matchId).eq('player_id', playerId).order('batch_key');
        if (error)
            throw new Error(`PVE reward batches read failed: ${error.message}`);
        return data.map(batchFromRow);
    }
    async prepareSettlement(command, fingerprint) {
        const at = new Date().toISOString();
        const { error } = await this.requireClient().from('pve_settlement_outbox').insert({
            settlement_id: command.settlementId, fingerprint, match_id: command.input.matchId,
            player_id: command.input.playerId, combat_ruleset_version: command.combatRulesetVersion,
            config_snapshot: command.configSnapshot, reward_table_revision: command.rewardTableRevision,
            input_json: command.input, detail_json: command.detail, status: 'pending', attempts: 1, created_at: at, updated_at: at,
        });
        if (error && error.code !== '23505')
            throw new Error(`PVE settlement prepare failed: ${error.message}`);
        const existing = await this.getSettlement(command.settlementId);
        if (!existing)
            throw new Error(`PVE settlement ${command.settlementId} disappeared after prepare`);
        if (existing.fingerprint !== fingerprint) {
            throw new store_1.PveRewardStoreConflictError('SETTLEMENT_CONFLICT', `Settlement ${command.settlementId} conflicts with stored facts`);
        }
        if (existing.status === 'committed' || !error)
            return existing;
        const { data, error: updateError } = await this.requireClient().from('pve_settlement_outbox')
            .update({ status: 'pending', attempts: existing.attempts + 1, updated_at: at })
            .eq('settlement_id', command.settlementId).neq('status', 'committed').select('*').maybeSingle();
        if (updateError)
            throw new Error(`PVE settlement retry prepare failed: ${updateError.message}`);
        return data ? settlementFromRow(data) : (await this.requireSettlement(command.settlementId));
    }
    async markSettlementCommitted(settlementId, settlement, detail) {
        const { data, error } = await this.requireClient().from('pve_settlement_outbox')
            .update({ status: 'committed', settlement_json: settlement, ...(detail ? { detail_json: detail } : {}), last_error: null, updated_at: new Date().toISOString() })
            .eq('settlement_id', settlementId).select('*').single();
        if (error)
            throw new Error(`PVE settlement commit marker failed: ${error.message}`);
        return settlementFromRow(data);
    }
    async markSettlementFailed(settlementId, errorMessage) {
        const current = await this.requireSettlement(settlementId);
        if (current.status === 'committed')
            return current;
        const { data, error } = await this.requireClient().from('pve_settlement_outbox')
            .update({ status: 'failed', last_error: errorMessage.slice(0, 2000), updated_at: new Date().toISOString() })
            .eq('settlement_id', settlementId).neq('status', 'committed').select('*').maybeSingle();
        if (error)
            throw new Error(`PVE settlement failure marker failed: ${error.message}`);
        return data ? settlementFromRow(data) : this.requireSettlement(settlementId);
    }
    async getSettlement(settlementId) {
        const { data, error } = await this.requireClient().from('pve_settlement_outbox').select('*')
            .eq('settlement_id', settlementId).maybeSingle();
        if (error)
            throw new Error(`PVE settlement read failed: ${error.message}`);
        return data ? settlementFromRow(data) : null;
    }
    async listRecoverableSettlements(limit = 100) {
        const { data, error } = await this.requireClient().from('pve_settlement_outbox').select('*')
            .in('status', ['pending', 'failed']).order('updated_at').limit(limit);
        if (error)
            throw new Error(`PVE settlement recovery scan failed: ${error.message}`);
        return data.map(settlementFromRow);
    }
    requireClient() {
        if (!this.client)
            throw new Error('Supabase PVE reward store is disabled');
        return this.client;
    }
    async requireSettlement(settlementId) {
        const settlement = await this.getSettlement(settlementId);
        if (!settlement)
            throw new Error(`PVE settlement ${settlementId} is missing`);
        return settlement;
    }
}
exports.SupabasePveRewardStore = SupabasePveRewardStore;
