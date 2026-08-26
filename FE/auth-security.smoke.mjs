import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const requireAuth = readFileSync(new URL('./components/require-auth.tsx', import.meta.url), 'utf8')
const authHook = readFileSync(new URL('./hooks/use-auth.ts', import.meta.url), 'utf8')
const supabaseClient = readFileSync(new URL('./lib/supabase-browser.ts', import.meta.url), 'utf8')
const main = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8')
const login = readFileSync(new URL('./pages/login-page.tsx', import.meta.url), 'utf8')
const localTestAuth = readFileSync(new URL('./lib/local-test-auth.ts', import.meta.url), 'utf8')
const serverAuthRoute = readFileSync(new URL('../BE/src/network/supabase-auth-routes.ts', import.meta.url), 'utf8')

assert.match(requireAuth, /import\.meta\.env\.DEV\s*&&\s*import\.meta\.env\.VITE_AUTH_BYPASS\s*===\s*'true'/,
  'auth bypass must be jointly guarded by Vite development mode and an explicit flag')
assert.doesNotMatch(requireAuth, /export function RequireAuth[^]*?\{\s*return\s*<>{children}<\/>/,
  'RequireAuth must not return children unconditionally')
assert.match(localTestAuth, /!import\.meta\.env\.DEV/,
  'the local test account must be disabled outside Vite development mode')
assert.match(serverAuthRoute, /process\.env\.NODE_ENV\s*!==\s*'production'[^]*?principal\?\.authSource\s*===\s*'static'/,
  'the server must accept static human identity only outside production')

for (const marker of ['getSession()', 'onAuthStateChange', 'signInWithPassword', 'signUp', 'signOut']) {
  assert.ok(authHook.includes(marker), `Supabase auth hook must use ${marker}`)
}
assert.match(authHook, /fetch\(`\$\{apiBase\}\/auth\/me`[^]*?Authorization:\s*`Bearer \$\{accessToken\}`/,
  'the game server must verify the Supabase access token')
assert.match(supabaseClient, /persistSession:\s*true/)
assert.match(supabaseClient, /autoRefreshToken:\s*true/)
assert.match(supabaseClient, /isLocalTestSession[^]*?return null/,
  'local test sessions must not open a Supabase Realtime connection')
assert.doesNotMatch(main, /auth\/callback|AuthCallbackPage/)
assert.equal(existsSync(new URL('./pages/auth-callback-page.tsx', import.meta.url)), false)

for (const legacy of ['SecondMe', 'agenstd_session_token', 'agenstd_oauth_state', '/auth/exchange', '/auth/login']) {
  assert.doesNotMatch(authHook + main + login, new RegExp(legacy.replace('/', '\\/'), 'i'), `legacy auth marker must be removed: ${legacy}`)
}

console.log(JSON.stringify({
  ok: true,
  productionBypassGuarded: true,
  supabaseSessionPersistence: true,
  serverJwtVerification: true,
  legacyOAuthCallbackRemoved: true,
}))
