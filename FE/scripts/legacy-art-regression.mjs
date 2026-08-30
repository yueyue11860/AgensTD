import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'

const frontendRoot = resolve(import.meta.dirname, '..')
const battlefieldAssetName = 'huaguoshan-celestial-arena-v1.webp'
const battlefieldPublicAsset = join(frontendRoot, 'public', 'art', 'backgrounds', battlefieldAssetName)
const legacySpriteRoot = join(frontendRoot, 'public', 'sprites')
const codexSource = join(frontendRoot, 'pages', 'codex-page.tsx')
const retiredUiSources = ['components/game-map.tsx', 'components/game-sidebar.tsx']
const runtimeRoots = ['app', 'components', 'game', 'pages']
const runtimeExtensions = new Set(['.css', '.js', '.jsx', '.ts', '.tsx'])
const violations = []
const runtimeReferences = []

function scanDirectory(directory) {
  if (!existsSync(directory)) return
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name)
    if (entry.isDirectory()) {
      scanDirectory(target)
      continue
    }
    if (!runtimeExtensions.has(extname(entry.name))) continue
    if (readFileSync(target, 'utf8').includes(battlefieldAssetName)) {
      runtimeReferences.push(relative(frontendRoot, target))
    }
  }
}

if (!existsSync(battlefieldPublicAsset) || statSync(battlefieldPublicAsset).size === 0) {
  violations.push(relative(frontendRoot, battlefieldPublicAsset))
}

if (existsSync(legacySpriteRoot)) {
  violations.push(`${relative(frontendRoot, legacySpriteRoot)} (legacy sprite archive must not ship)`)
}

if (existsSync(codexSource)) {
  const codex = readFileSync(codexSource, 'utf8')
  for (const marker of ['const MONSTERS', 'const BOSSES', 'MONSTERS.filter', 'BOSSES.filter']) {
    if (codex.includes(marker)) violations.push(`pages/codex-page.tsx (${marker} legacy fallback)`)
  }
  // PVE V2 monster/Boss entries must consume the account unlock flag so an
  // unencountered entry can render as the grey silhouette instead of exposing
  // the full definition immediately.
  if (!codex.includes('entry.unlocked')) {
    violations.push('pages/codex-page.tsx (monster/Boss cards ignore account unlock state)')
  }
}

for (const retiredUiSource of retiredUiSources) {
  if (existsSync(join(frontendRoot, retiredUiSource))) {
    violations.push(`${retiredUiSource} (retired tower UI must not ship)`)
  }
}

for (const runtimeRoot of runtimeRoots) {
  scanDirectory(join(frontendRoot, runtimeRoot))
}

if (runtimeReferences.length === 0) {
  violations.push('app/globals.css (missing battlefield background reference)')
}

if (violations.length > 0) {
  console.error(`Battlefield art asset is missing or invalid:\n${[...new Set(violations)].map(path => `- ${path}`).join('\n')}`)
  process.exit(1)
}

console.log('Battlefield art asset regression check passed.')
