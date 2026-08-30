export const BATTLEFIELD_MIN_ZOOM = 1
export const BATTLEFIELD_MAX_ZOOM = 2

export interface BattlefieldCameraTransform {
  zoom: number
  scrollX: number
  scrollY: number
}

export interface BattlefieldCameraPoint {
  x: number
  y: number
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

export function clampBattlefieldCamera(
  transform: BattlefieldCameraTransform,
  viewportSize: number,
  worldSize: number,
): BattlefieldCameraTransform {
  const zoom = clamp(transform.zoom, BATTLEFIELD_MIN_ZOOM, BATTLEFIELD_MAX_ZOOM)
  const visibleWorldSize = viewportSize / zoom
  const maxScroll = Math.max(0, worldSize - visibleWorldSize)
  return {
    zoom,
    scrollX: clamp(transform.scrollX, 0, maxScroll),
    scrollY: clamp(transform.scrollY, 0, maxScroll),
  }
}

export function zoomBattlefieldAroundPoint(
  transform: BattlefieldCameraTransform,
  nextZoom: number,
  screenPoint: BattlefieldCameraPoint,
  viewportSize: number,
  worldSize: number,
): BattlefieldCameraTransform {
  const zoom = clamp(nextZoom, BATTLEFIELD_MIN_ZOOM, BATTLEFIELD_MAX_ZOOM)
  const worldX = transform.scrollX + screenPoint.x / transform.zoom
  const worldY = transform.scrollY + screenPoint.y / transform.zoom
  return clampBattlefieldCamera({
    zoom,
    scrollX: worldX - screenPoint.x / zoom,
    scrollY: worldY - screenPoint.y / zoom,
  }, viewportSize, worldSize)
}

export function battlefieldScreenToWorld(
  transform: BattlefieldCameraTransform,
  screenPoint: BattlefieldCameraPoint,
): BattlefieldCameraPoint {
  return {
    x: transform.scrollX + screenPoint.x / transform.zoom,
    y: transform.scrollY + screenPoint.y / transform.zoom,
  }
}

/** Phaser's scroll is expressed against the unzoomed viewport midpoint. */
export function phaserCameraScreenToWorld(
  scroll: number,
  zoom: number,
  screenCoordinate: number,
  viewportSize: number,
) {
  const midpoint = viewportSize / 2
  return scroll + midpoint + (screenCoordinate - midpoint) / zoom
}

export function phaserCameraWorldViewOrigin(scroll: number, zoom: number, viewportSize: number) {
  return phaserCameraScreenToWorld(scroll, zoom, 0, viewportSize)
}
