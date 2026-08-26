import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'

const frontendRoot = resolve(import.meta.dirname, '..')
const legacyAssetName = 'huaguoshan-celestial-arena-v1.webp'
const legacyPublicAsset = join(frontendRoot, 'public', 'art', 'backgrounds', legacyAssetName)
const runtimeRoots = ['app', 'components', 'game', 'pages']
const runtimeExtensions = new Set(['.css', '.js', '.jsx', '.ts', '.tsx'])
const violations = []

function scanDirectory(directory) {
  if (!existsSync(directory)) return
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name)
    if (entry.isDirectory()) {
      scanDirectory(target)
      continue
    }
    if (!runtimeExtensions.has(extname(entry.name))) continue
    if (readFileSync(target, 'utf8').includes(legacyAssetName)) {
      violations.push(relative(frontendRoot, target))
    }
  }
}

if (existsSync(legacyPublicAsset)) {
  violations.push(relative(frontendRoot, legacyPublicAsset))
}

for (const runtimeRoot of runtimeRoots) {
  scanDirectory(join(frontendRoot, runtimeRoot))
}

const distRoot = join(frontendRoot, 'dist')
if (existsSync(distRoot)) {
  scanDirectory(distRoot)
  const builtLegacyAsset = join(distRoot, 'art', 'backgrounds', legacyAssetName)
  if (existsSync(builtLegacyAsset)) {
    violations.push(relative(frontendRoot, builtLegacyAsset))
  }
}

if (violations.length > 0) {
  console.error(`Legacy battlefield art must not ship:\n${[...new Set(violations)].map(path => `- ${path}`).join('\n')}`)
  process.exit(1)
}

console.log('Legacy battlefield art regression check passed.')
