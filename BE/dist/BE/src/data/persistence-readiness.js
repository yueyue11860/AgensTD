"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PersistenceReadinessTracker = void 0;
exports.isPersistenceReadyForTraffic = isPersistenceReadyForTraffic;
exports.probeSupabaseWrite = probeSupabaseWrite;
const crypto_1 = __importDefault(require("crypto"));
const supabase_js_1 = require("@supabase/supabase-js");
class PersistenceReadinessTracker {
    snapshotValue;
    constructor(mode) {
        this.snapshotValue = { status: 'checking', writable: false, mode, checkedAt: null, code: null };
    }
    mark(result) {
        this.snapshotValue = { ...result, mode: this.snapshotValue.mode };
    }
    snapshot() { return { ...this.snapshotValue }; }
}
exports.PersistenceReadinessTracker = PersistenceReadinessTracker;
function isPersistenceReadyForTraffic(snapshot, requiresWritablePersistence) {
    return snapshot.status === 'ready' && (!requiresWritablePersistence || snapshot.writable);
}
async function probeSupabaseWrite(config) {
    const checkedAt = new Date().toISOString();
    if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
        return { status: 'not_ready', writable: false, checkedAt, code: 'SUPABASE_NOT_CONFIGURED' };
    }
    const client = (0, supabase_js_1.createClient)(config.supabaseUrl, config.supabaseServiceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const probeId = `boot-${crypto_1.default.randomUUID()}`;
    try {
        const { error: insertError } = await client.from('service_persistence_probes').insert({
            probe_id: probeId,
            service_name: 'agenstd-houduan',
            checked_at: checkedAt,
        });
        if (insertError)
            return { status: 'not_ready', writable: false, checkedAt, code: 'SUPABASE_WRITE_FAILED' };
        const { error: deleteError } = await client.from('service_persistence_probes').delete().eq('probe_id', probeId);
        if (deleteError)
            return { status: 'not_ready', writable: false, checkedAt, code: 'SUPABASE_CLEANUP_FAILED' };
        return { status: 'ready', writable: true, checkedAt, code: null };
    }
    catch {
        return { status: 'not_ready', writable: false, checkedAt, code: 'SUPABASE_UNREACHABLE' };
    }
}
