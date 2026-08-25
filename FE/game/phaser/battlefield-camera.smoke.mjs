import assert from 'node:assert/strict'
import {
  battlefieldScreenToWorld,
  clampBattlefieldCamera,
  phaserCameraScreenToWorld,
  phaserCameraWorldViewOrigin,
  zoomBattlefieldAroundPoint,
} from './battlefield-camera.ts'

const worldSize = 928
const viewportSize = 928

assert.deepEqual(
  clampBattlefieldCamera({ zoom: 0.5, scrollX: -40, scrollY: 900 }, viewportSize, worldSize),
  { zoom: 1, scrollX: 0, scrollY: 0 },
  'full-board view must expose the complete world and reject stray pan',
)

const before = { zoom: 1.2, scrollX: 70, scrollY: 55 }
const anchor = { x: 220, y: 310 }
const anchoredWorld = battlefieldScreenToWorld(before, anchor)
const after = zoomBattlefieldAroundPoint(before, 1.8, anchor, viewportSize, worldSize)
const worldAfterZoom = battlefieldScreenToWorld(after, anchor)
assert.ok(Math.abs(anchoredWorld.x - worldAfterZoom.x) < 0.001)
assert.ok(Math.abs(anchoredWorld.y - worldAfterZoom.y) < 0.001)

const edge = clampBattlefieldCamera({ zoom: 2, scrollX: 9999, scrollY: -20 }, viewportSize, worldSize)
assert.deepEqual(edge, { zoom: 2, scrollX: 464, scrollY: 0 })

assert.equal(phaserCameraWorldViewOrigin(-160, 1.53, viewportSize).toFixed(2), '0.73')
assert.equal(phaserCameraScreenToWorld(-160, 1.53, viewportSize / 2, viewportSize), 304)

console.log('battlefield camera smoke passed')
