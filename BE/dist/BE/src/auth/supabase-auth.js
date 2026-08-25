"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupabaseAuthVerifier = void 0;
exports.configureSupabaseAuthVerifier = configureSupabaseAuthVerifier;
exports.getSupabaseAuthVerifier = getSupabaseAuthVerifier;
const supabase_js_1 = require("@supabase/supabase-js");
function mapUser(user) {
    const metadata = user.user_metadata ?? {};
    const email = user.email ?? '';
    return {
        userId: user.id,
        name: String(metadata.display_name ?? metadata.full_name ?? metadata.name ?? email.split('@')[0] ?? user.id),
        email,
        avatar: String(metadata.avatar_url ?? metadata.picture ?? ''),
    };
}
class SupabaseAuthVerifier {
    client;
    constructor(config, client) {
        this.client = client ?? (config.supabaseUrl && config.supabaseServiceRoleKey
            ? (0, supabase_js_1.createClient)(config.supabaseUrl, config.supabaseServiceRoleKey, {
                auth: { persistSession: false, autoRefreshToken: false },
            })
            : null);
    }
    isEnabled() {
        return this.client !== null;
    }
    async verify(accessToken) {
        if (!this.client || accessToken.split('.').length !== 3)
            return null;
        const { data, error } = await this.client.auth.getUser(accessToken);
        if (error || !data.user)
            return null;
        return mapUser(data.user);
    }
}
exports.SupabaseAuthVerifier = SupabaseAuthVerifier;
let defaultVerifier = null;
function configureSupabaseAuthVerifier(verifier) {
    defaultVerifier = verifier;
}
function getSupabaseAuthVerifier() {
    return defaultVerifier;
}
