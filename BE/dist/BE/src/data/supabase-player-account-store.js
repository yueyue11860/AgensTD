"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupabasePlayerAccountStore = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
/**
 * player_accounts 只用 player_id(text) 作业务主键，不依赖 users 外键，
 * 所以本地开发身份和静态 Agent 身份也能持久化。
 */
class SupabasePlayerAccountStore {
    client;
    constructor(config) {
        if (config.supabaseUrl && config.supabaseServiceRoleKey) {
            this.client = (0, supabase_js_1.createClient)(config.supabaseUrl, config.supabaseServiceRoleKey, {
                auth: { persistSession: false, autoRefreshToken: false },
            });
        }
        else {
            this.client = null;
        }
    }
    isEnabled() {
        return this.client !== null;
    }
    async get(playerId) {
        const client = this.requireClient();
        const { data, error } = await client
            .from('player_accounts')
            .select('account_json')
            .eq('player_id', playerId)
            .maybeSingle();
        if (error)
            throw new Error(`player account read failed: ${error.message}`);
        return data ? structuredClone(data.account_json) : null;
    }
    async createIfAbsent(account) {
        const client = this.requireClient();
        const { error } = await client
            .from('player_accounts')
            .upsert({
            player_id: account.playerId,
            version: account.version,
            account_json: account,
            updated_at: account.updatedAt,
        }, {
            onConflict: 'player_id',
            ignoreDuplicates: true,
        });
        if (error)
            throw new Error(`player account create failed: ${error.message}`);
        const stored = await this.get(account.playerId);
        if (!stored)
            throw new Error('player account disappeared after create');
        return stored;
    }
    async compareAndSwap(playerId, expectedVersion, next) {
        if (next.playerId !== playerId || next.version !== expectedVersion + 1)
            return false;
        const client = this.requireClient();
        const { data, error } = await client.rpc('cas_player_account', {
            p_player_id: playerId,
            p_expected_version: expectedVersion,
            p_next_account: next,
        });
        if (error)
            throw new Error(`player account CAS failed: ${error.message}`);
        return data === true;
    }
    requireClient() {
        if (!this.client)
            throw new Error('Supabase player account store is disabled');
        return this.client;
    }
}
exports.SupabasePlayerAccountStore = SupabasePlayerAccountStore;
