import assert from 'node:assert/strict'
import { collectConcreteImageReferences, isDynamicImageReference } from './build-budget-image-references.mjs'

assert.equal(isDynamicImageReference('art/equipment/${iconKey}.webp'), true)
assert.equal(isDynamicImageReference('art/equipment/static-sword.webp'), false)

assert.deepEqual(
  collectConcreteImageReferences('const src = `/art/equipment/${iconKey}.webp`'),
  [],
)
assert.deepEqual(
  collectConcreteImageReferences('const src = "/art/equipment/missing-static.webp"'),
  ['/art/equipment/missing-static.webp'],
)
assert.deepEqual(
  collectConcreteImageReferences('.hero{background-image:url(/art/backgrounds/hero.webp)}'),
  ['/art/backgrounds/hero.webp'],
)
assert.deepEqual(
  collectConcreteImageReferences('const portrait = new URL("./assets/general.png", import.meta.url)'),
  ['./assets/general.png'],
)

console.log('build budget image references smoke: ok')
