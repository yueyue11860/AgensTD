import assert from 'node:assert/strict'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { createServerConfig } from '../config/server-config'
import { authenticateGatewayTokenAsync } from '../network/gateway-auth'
import { configureSupabaseAuthVerifier, SupabaseAuthVerifier } from './supabase-auth'

const verifiedUser = {
  id: '2d930650-2ad3-4d5b-b4bd-4abf513f4928',
  email: 'commander@example.com',
  user_metadata: { display_name: 'Commander', avatar_url: 'https://example.com/avatar.png' },
} as unknown as User

const fakeClient = {
  auth: {
    getUser: async (token: string) => token === 'header.payload.signature'
      ? { data: { user: verifiedUser }, error: null }
      : { data: { user: null }, error: new Error('invalid token') },
  },
} as unknown as Pick<SupabaseClient, 'auth'>

async function main() {
  const verifier = new SupabaseAuthVerifier({ supabaseUrl: null, supabaseServiceRoleKey: null }, fakeClient)
  configureSupabaseAuthVerifier(verifier)

  const config = { ...createServerConfig(), authRequired: true, authTokens: [] }
  const principal = await authenticateGatewayTokenAsync(config, 'header.payload.signature')
  assert.deepEqual(principal, {
    token: 'header.payload.signature',
    playerId: verifiedUser.id,
    playerName: 'Commander',
    playerKind: 'human',
    email: verifiedUser.email,
    avatar: verifiedUser.user_metadata.avatar_url,
    authSource: 'supabase',
  })
  assert.equal(await authenticateGatewayTokenAsync(config, 'not-a-jwt'), null)

  console.log(JSON.stringify({ ok: true, serverVerifiedJwt: true, identityDerivedFromSupabase: true }))
}

void main()
