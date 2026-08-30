import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'

const frontendRoot = resolve(import.meta.dirname, '..')
const battlefieldAssetName = 'huaguoshan-celestial-arena-v1.webp'
const battlefieldPublicAsset = join(frontendRoot, 'public', 'art', 'backgrounds', battlefieldAssetName)
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
