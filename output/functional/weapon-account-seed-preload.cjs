/*
 * Functional QA-only preload. It alters the source text handed to ts-node in memory;
 * no product source file is changed. The real REST/account/runtime stack still runs.
 */
const fs = require('node:fs')
const path = require('node:path')

const originalReadFileSync = fs.readFileSync
const target = path.resolve(process.cwd(), 'src/server.ts')

fs.readFileSync = function seededReadFileSync(filename, options) {
  const value = originalReadFileSync.apply(this, arguments)
  if (path.resolve(String(filename)) !== target) return value

  const text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value)
  const needle = 'new ResilientPlayerAccountStore(supabaseAccountStore, new MemoryPlayerAccountStore())'
  const replacement = `new ResilientPlayerAccountStore(supabaseAccountStore, new (class extends MemoryPlayerAccountStore {
    async createIfAbsent(account: import('./account-v1/types').PlayerAccountRecord) {
      if (account.playerId === 'human-dev') {
        account.weapon.fragmentBalances = {
          qinggang_blade: 1,
          armor_breaking_halberd: 2,
          battle_sky_axe: 0,
        }
        account.weapon.unlockedWeaponIds = [
          'chasing_wind_bow',
          'houyi_sun_shooting_bow',
          'peachwood_staff',
        ]
      }
      return super.createIfAbsent(account)
    }
  })())`
  if (!text.includes(needle)) throw new Error('Functional seed target was not found in server.ts')
  const patched = text.replace(needle, replacement)
  return Buffer.isBuffer(value) ? Buffer.from(patched) : patched
}
