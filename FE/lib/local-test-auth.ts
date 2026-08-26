import type { RuntimeAuthIdentity } from './auth-session-bridge'

export interface LocalTestAccount {
  email: string
  password: string
  token: string
  identity: RuntimeAuthIdentity
}

/**
 * 仅供 `vite dev` 使用的单机测试身份。Vite 生产构建中 `DEV` 恒为 false，
 * 即使误配了 VITE_LOCAL_TEST_AUTH 也不会开启。
 */
export function getLocalTestAccount(): LocalTestAccount | null {
  if (!import.meta.env.DEV || import.meta.env.VITE_LOCAL_TEST_AUTH === 'false') return null

  const email = import.meta.env.VITE_LOCAL_TEST_EMAIL?.trim() || 'dev@agenstd.local'
  return {
    email,
    password: import.meta.env.VITE_LOCAL_TEST_PASSWORD || 'dev123456',
    token: import.meta.env.VITE_GATEWAY_TOKEN?.trim() || 'human-dev-token',
    identity: {
      userId: import.meta.env.VITE_PLAYER_ID?.trim() || 'human-dev',
      name: import.meta.env.VITE_PLAYER_NAME?.trim() || '本地测试玩家',
      avatar: '',
      email,
    },
  }
}

export function isLocalTestSession(
  account: LocalTestAccount,
  token: string | null,
  identity: RuntimeAuthIdentity | null,
) {
  return token === account.token && identity?.userId === account.identity.userId
}
