import { readFile, readdir, stat } from 'node:fs/promises'
import { extname, join, relative, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { collectConcreteImageReferences, isDynamicImageReference } from './build-budget-image-references.mjs'

const DIST_DIR = resolve('dist')
const MANIFEST_PATH = join(DIST_DIR, '.vite', 'manifest.json')
const KB = 1024
const LIMITS = {
  mainEntryGzip: 180 * KB,
  nonPhaserHomeGzip: 350 * KB,
  phaserGzip: 400 * KB,
  imageBytes: 500 * KB,
}

const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'))
const records = Object.entries(manifest)
const entryRecord = records.find(([, record]) => record.isEntry)
const homeRecord = records.find(([key]) => key.endsWith('pages/tower-defense-frontend-page.tsx'))
if (!entryRecord || !homeRecord) throw new Error('Build manifest is missing the main entry or home route chunk.')

const gzipCache = new Map()
async function gzipBytes(relativePath) {
  if (gzipCache.has(relativePath)) return gzipCache.get(relativePath)
  const bytes = gzipSync(await readFile(join(DIST_DIR, relativePath))).byteLength
  gzipCache.set(relativePath, bytes)
  return bytes
}

function collectStaticFiles(recordKey, output = new Set()) {
  const record = manifest[recordKey]
  if (!record) return output
  if (record.file) output.add(record.file)
  for (const css of record.css ?? []) output.add(css)
  for (const importedKey of record.imports ?? []) collectStaticFiles(importedKey, output)
  return output
}

const failures = []
const [, mainEntry] = entryRecord
const mainEntryGzip = await gzipBytes(mainEntry.file)
if (mainEntryGzip > LIMITS.mainEntryGzip) failures.push(`main entry gzip ${mainEntryGzip} > ${LIMITS.mainEntryGzip}`)

const homeFiles = collectStaticFiles(entryRecord[0])
collectStaticFiles(homeRecord[0], homeFiles)
const nonPhaserHomeFiles = [...homeFiles].filter(file => !file.toLowerCase().includes('phaser'))
const nonPhaserHomeGzip = (await Promise.all(nonPhaserHomeFiles.map(gzipBytes))).reduce((sum, bytes) => sum + bytes, 0)
if (nonPhaserHomeGzip > LIMITS.nonPhaserHomeGzip) failures.push(`non-Phaser home gzip ${nonPhaserHomeGzip} > ${LIMITS.nonPhaserHomeGzip}`)

const phaserFiles = [...new Set(records.map(([, record]) => record.file).filter(file => file?.toLowerCase().includes('phaser')))]
const phaserGzip = (await Promise.all(phaserFiles.map(gzipBytes))).reduce((sum, bytes) => sum + bytes, 0)
if (phaserGzip > LIMITS.phaserGzip) failures.push(`Phaser chunks gzip ${phaserGzip} > ${LIMITS.phaserGzip}`)

const imageExtensions = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp'])
const checkedImages = new Set()
const imageSizes = new Map()

async function walkFiles(directory) {
  const files = []
  try {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolutePath = join(directory, entry.name)
      if (entry.isDirectory()) files.push(...await walkFiles(absolutePath))
      else if (entry.isFile()) files.push(absolutePath)
    }
  }
  catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  return files
}

async function checkImage(relativePath) {
  const normalized = relativePath.replace(/^\.\//, '').replace(/^\//, '')
  // Runtime template references (for example `art/equipment/${iconKey}.webp`)
  // are resolved against the catalog at runtime and are not literal files that
  // can be checked by the static scanner. Keep the reference in the emitted
  // bundle while validating concrete paths discovered from the build output.
  if (isDynamicImageReference(normalized)) return
  if (!imageExtensions.has(extname(normalized).toLowerCase()) || checkedImages.has(normalized)) return
  checkedImages.add(normalized)
  try {
    const imageStat = await stat(join(DIST_DIR, normalized))
    imageSizes.set(normalized, imageStat.size)
    if (imageStat.size > LIMITS.imageBytes) failures.push(`image ${normalized} ${imageStat.size} > ${LIMITS.imageBytes}`)
  }
  catch {
    failures.push(`referenced image is missing from dist: ${normalized}`)
  }
}

// Vite emits imported assets under assets/. Public art is copied outside the
// manifest, so the shipped battle-art directory is deliberately gated too.
for (const criticalDirectory of ['assets', join('art', 'backgrounds')]) {
  for (const absolutePath of await walkFiles(join(DIST_DIR, criticalDirectory))) {
    await checkImage(relative(DIST_DIR, absolutePath))
  }
}

// Public sprites include a legacy, unreferenced source archive. Do not make that
// archive a false-positive build blocker, but gate every public image path that
// the emitted JS/CSS can actually request (including /sprites/**).
const emittedCodeFiles = (await walkFiles(DIST_DIR)).filter(file => ['.css', '.js'].includes(extname(file)))
for (const emittedFile of emittedCodeFiles) {
  const code = await readFile(emittedFile, 'utf8')
  for (const reference of collectConcreteImageReferences(code)) await checkImage(reference)
}

const largestImages = [...imageSizes]
  .sort((left, right) => right[1] - left[1])
  .slice(0, 5)
  .map(([file, bytes]) => ({ file, bytes }))

const report = {
  ok: failures.length === 0,
  mainEntryGzip,
  mainEntryLimit: LIMITS.mainEntryGzip,
  nonPhaserHomeGzip,
  nonPhaserHomeLimit: LIMITS.nonPhaserHomeGzip,
  phaserGzip,
  phaserLimit: LIMITS.phaserGzip,
  checkedImages: checkedImages.size,
  largestImages,
  imageLimit: LIMITS.imageBytes,
  failures,
}
console.log(JSON.stringify(report))
if (failures.length > 0) process.exitCode = 1
