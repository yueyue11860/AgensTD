import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

export const PASSWORD_ALGORITHM = 'scrypt' as const
export const PASSWORD_ALGORITHM_VERSION = 1 as const

/**
 * Password material is deliberately kept as structured server-only state. Public room
 * projections must expose only `hasPassword`; this object must never be serialized to clients.
 */
export interface PasswordCredential {
  algorithm: typeof PASSWORD_ALGORITHM
  version: typeof PASSWORD_ALGORITHM_VERSION
  saltHex: string
  hashHex: string
  updatedAt: string
}

export function createPasswordCredential(password: string, updatedAt = new Date().toISOString()): PasswordCredential {
  const salt = randomBytes(16)
  return {
    algorithm: PASSWORD_ALGORITHM,
    version: PASSWORD_ALGORITHM_VERSION,
    saltHex: salt.toString('hex'),
    hashHex: scryptSync(password, salt, 32).toString('hex'),
    updatedAt,
  }
}

export function verifyPassword(password: string, credential: PasswordCredential): boolean {
  if (credential.algorithm !== PASSWORD_ALGORITHM || credential.version !== PASSWORD_ALGORITHM_VERSION) return false
  try {
    const salt = Buffer.from(credential.saltHex, 'hex')
    const expected = Buffer.from(credential.hashHex, 'hex')
    if (salt.length !== 16 || expected.length !== 32) return false
    const actual = scryptSync(password, salt, expected.length)
    return timingSafeEqual(actual, expected)
  }
  catch {
    return false
  }
}
