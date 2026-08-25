import Phaser from 'phaser'
import type { PveSceneTheme } from '../../../shared/contracts/pve-stage-config'
import { BattlefieldCombatAudio } from '../audio/combat-audio'
import {
  consumeCombatPresentation,
  createCombatPresentationState,
  synchronizeCombatPresentation,
  activeSynergyPresentationLinks,
} from '../presentation/combat-presentation-adapter'
import {
  BattlefieldPresentationDirector,
  type BattlefieldPresentationPreferences,
} from './battlefield-presentation'
import {
  enemyMoveProfile,
  enemyVisualStyle,
  type EnemyVisualRole,
} from '../presentation/enemy-visual-language'
import type {
  BattlefieldEffectZoneState,
  BattlefieldEnemyState,
  BattlefieldEnemyStatusState,
  BattlefieldGridPosition,
  BattlefieldInteractionBridge,
  BattlefieldPieceState,
  BattlefieldSnapshot,
  BattlefieldSummonedUnitState,
} from './battlefield-model'
import {
  BATTLEFIELD_MAX_ZOOM,
  BATTLEFIELD_MIN_ZOOM,
  phaserCameraScreenToWorld,
  phaserCameraWorldViewOrigin,
  type BattlefieldCameraTransform,
} from './battlefield-camera'
import {
  compactEnemyHealthPixels,
  interpolateEnemyPosition,
  shouldUseCompactEnemyRendering,
} from './enemy-render-budget'

export const BATTLEFIELD_DIMENSION = 29
export const BATTLEFIELD_CELL_SIZE = 32
export const BATTLEFIELD_SIZE = BATTLEFIELD_DIMENSION * BATTLEFIELD_CELL_SIZE

const CELL_GAP = 1
const ENTITY_INSET = 3
const ENEMY_BODY_RADIUS_PX = 13
const BOSS_BODY_RADIUS_PX = 20
const ENEMY_TWEEN_MS = 220
const HAN_FONT = '"Noto Serif SC", "Songti SC", "STSong", serif'
const HUAGUOSHAN_BACKGROUND_KEY = 'huaguoshan-celestial-arena-v1'
const HUAGUOSHAN_BACKGROUND_URL = '/art/backgrounds/huaguoshan-celestial-arena-v1.webp'

const GATE_LABELS = new Map<string, string>([
  ['13:15', 'P1'],
  ['15:15', 'P2'],
  ['15:13', 'P3'],
  ['13:13', 'P4'],
])

interface PieceView {
  container: Phaser.GameObjects.Container
  body: Phaser.GameObjects.Graphics
  selection: Phaser.GameObjects.Graphics
  glyph: Phaser.GameObjects.Text
  level: Phaser.GameObjects.Text
  kind: string
  glyphValue: string
  levelValue: number
  generalIdValue: string
  generalQualityValue: string
  fixedValue: boolean
}

interface DetailedEnemyView {
  mode: 'detailed'
  container: Phaser.GameObjects.Container
  body: Phaser.GameObjects.Graphics
  defense: Phaser.GameObjects.Graphics
  statusAura: Phaser.GameObjects.Graphics
  glyph: Phaser.GameObjects.Text
  health: Phaser.GameObjects.Graphics
  status: Phaser.GameObjects.Text
  bossBadge: Phaser.GameObjects.Text
  roleBadge: Phaser.GameObjects.Text
  glyphValue: string
  entityKind: 'ordinary_minion' | 'boss'
  visualRole: EnemyVisualRole
  visualSignature: string
  hp: number
  maxHp: number
  spawnProtected: boolean
  invulnerable: boolean
  statusSignature: string
}

interface CompactEnemyView {
  mode: 'compact'
  container: Phaser.GameObjects.Container
  sprite: Phaser.GameObjects.Image
  textureSignature: string
  visualSignature: string
  statusSignature: string
  hp: number
  maxHp: number
  spawnProtected: boolean
  targetX: number
  targetY: number
  movementFromX: number
  movementFromY: number
  movementStartedAt: number
  movementDurationMs: number
}

type EnemyView = DetailedEnemyView | CompactEnemyView

interface SummonedUnitView {
  container: Phaser.GameObjects.Container
  body: Phaser.GameObjects.Graphics
  glyph: Phaser.GameObjects.Text
  level: Phaser.GameObjects.Text
  glyphValue: string
  levelValue: number
}

export interface BattlefieldSceneUiState {
  hoveredCell: BattlefieldGridPosition | null
  selectedPieceId: string | null
  placementMode: boolean
  canPreviewAtHoveredCell: boolean
}

export interface BattlefieldAudioPreferences {
  muted: boolean
  masterVolume: number
}

export type BattlefieldViewMode = 'full' | 'focus'

export interface BattlefieldCameraViewState extends BattlefieldCameraTransform {
  mode: BattlefieldViewMode
}

function coordKey(x: number, y: number) {
  return `${x}:${y}`
}

function isCoreCell(x: number, y: number) {
  return x >= 13 && x <= 15 && y >= 13 && y <= 15
}

function isProtectedZoneCell(x: number, y: number) {
  return x >= 10 && x <= 18 && y >= 10 && y <= 18
}

function gridToPixel(value: number) {
  return value * BATTLEFIELD_CELL_SIZE
}

function canvasColor(value: number, alpha = 1) {
  const red = value >> 16 & 0xff
  const green = value >> 8 & 0xff
  const blue = value & 0xff
  return `rgba(${red},${green},${blue},${alpha})`
}

const SOLDIER_BLUE = 0x60a5fa
const GENERAL_QUALITY_COLORS = {
  purple: 0xa78bfa,
  orange: 0xfb923c,
  red: 0xf87171,
} as const

const STATUS_LABELS: Record<string, string> = {
  slow: '缓',
  stun: '晕',
  root: '定',
  suppress: '封',
  vulnerable: '易',
  armor_break: '破',
}

export class BattlefieldScene extends Phaser.Scene {
  private readonly terrainMatrix: readonly (readonly number[])[]
  private readonly bridge: BattlefieldInteractionBridge
  private readonly sceneTheme: PveSceneTheme | null
  private latestSnapshot: BattlefieldSnapshot | null = null
  private latestUiState: BattlefieldSceneUiState = { hoveredCell: null, selectedPieceId: null, placementMode: false, canPreviewAtHoveredCell: false }
  private presentationPreferences: BattlefieldPresentationPreferences = { reducedMotion: false, lowEffects: false }
  private readonly presentationState = createCombatPresentationState()
  private readonly combatAudio = new BattlefieldCombatAudio()
  private presentationDirector: BattlefieldPresentationDirector | null = null
  private backgroundImage: Phaser.GameObjects.Image | null = null
  private terrainLayer!: Phaser.GameObjects.Graphics
  private previewLayer!: Phaser.GameObjects.Graphics
  private zoneLayer!: Phaser.GameObjects.Graphics
  private pieceLayer!: Phaser.GameObjects.Container
  private summonLayer!: Phaser.GameObjects.Container
  private enemyLayer!: Phaser.GameObjects.Container
  private inputZone!: Phaser.GameObjects.Zone
  private readonly pieceViews = new Map<string, PieceView>()
  private readonly enemyViews = new Map<string, EnemyView>()
  private readonly compactEnemyTextures = new Map<string, string>()
  private compactEnemyTextureSequence = 0
  private compactEnemyMode = false
  private readonly seenEnemyIds = new Set<string>()
  private readonly summonedUnitViews = new Map<string, SummonedUnitView>()
  private lastHoveredCellKey: string | null = null
  private pointerDownCell: BattlefieldGridPosition | null = null
  private pointerDownScreen: BattlefieldGridPosition | null = null
  private cameraViewMode: BattlefieldViewMode = 'full'
  private readonly activeGesturePointers = new Map<number, { x: number, y: number }>()
  private readonly gestureConsumedPointers = new Set<number>()
  private panPointerId: number | null = null
  private lastPinchDistance = 0
  private lastPinchCenter: { x: number, y: number } | null = null
  private readonly onCameraViewChange?: (state: BattlefieldCameraViewState) => void

  constructor(
    terrainMatrix: readonly (readonly number[])[],
    bridge: BattlefieldInteractionBridge,
    sceneTheme?: PveSceneTheme | null,
    onCameraViewChange?: (state: BattlefieldCameraViewState) => void,
  ) {
    super({ key: 'BattlefieldScene' })
    this.terrainMatrix = terrainMatrix
    this.bridge = bridge
    this.sceneTheme = sceneTheme ?? null
    this.onCameraViewChange = onCameraViewChange
  }

  preload() {
    if (this.isHuaguoshanTheme() && !this.textures.exists(HUAGUOSHAN_BACKGROUND_KEY)) {
      this.load.image(HUAGUOSHAN_BACKGROUND_KEY, HUAGUOSHAN_BACKGROUND_URL)
    }
  }

  create() {
    this.cameras.main.setBackgroundColor('#0b1121')
    this.cameras.main.setBounds(0, 0, BATTLEFIELD_SIZE, BATTLEFIELD_SIZE)
    if (this.isHuaguoshanTheme() && this.textures.exists(HUAGUOSHAN_BACKGROUND_KEY)) {
      this.backgroundImage = this.add.image(BATTLEFIELD_SIZE / 2, BATTLEFIELD_SIZE / 2, HUAGUOSHAN_BACKGROUND_KEY)
        .setDisplaySize(BATTLEFIELD_SIZE, BATTLEFIELD_SIZE)
        .setDepth(-5)
    }
    this.terrainLayer = this.add.graphics()
    this.previewLayer = this.add.graphics().setDepth(10)
    this.zoneLayer = this.add.graphics().setDepth(15)
    this.pieceLayer = this.add.container(0, 0).setDepth(20)
    this.summonLayer = this.add.container(0, 0).setDepth(25)
    this.enemyLayer = this.add.container(0, 0).setDepth(30)
    this.presentationDirector = new BattlefieldPresentationDirector(this, {
      flashEnemy: (entityId, durationMs) => this.flashEnemy(entityId, durationMs),
    })
    this.presentationDirector.setPreferences(this.presentationPreferences)
    this.inputZone = this.add.zone(0, 0, BATTLEFIELD_SIZE, BATTLEFIELD_SIZE).setOrigin(0).setDepth(100).setInteractive()
    this.drawTerrain()
    this.bindPointerInput()
    this.setViewMode('full')
    if (this.latestSnapshot) this.renderSnapshot(this.latestSnapshot)
    if (this.isEnemyPresentationFixtureEnabled()) this.drawEnemyPresentationFixture()
    if (this.isGeneralManifestationFixtureEnabled()) this.drawGeneralManifestationFixture()
    this.renderUiState()
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.presentationDirector?.destroy()
      this.presentationDirector = null
      this.combatAudio.destroy()
      this.clearCompactEnemyTextures()
    })
  }

  update(time: number) {
    if (!this.compactEnemyMode) return
    for (const view of this.enemyViews.values()) {
      if (view.mode !== 'compact') continue
      if (this.presentationPreferences.reducedMotion || view.movementDurationMs <= 0) {
        view.container.setPosition(view.targetX, view.targetY)
        continue
      }
      const position = interpolateEnemyPosition({
        fromX: view.movementFromX, fromY: view.movementFromY, targetX: view.targetX, targetY: view.targetY,
        startedAt: view.movementStartedAt, durationMs: view.movementDurationMs, now: time, reducedMotion: false,
      })
      view.container.setPosition(position.x, position.y)
    }
  }

  setSnapshot(snapshot: BattlefieldSnapshot | null) {
    this.latestSnapshot = snapshot
    if (this.sys.isActive() && snapshot) this.renderSnapshot(snapshot)
  }

  synchronizeSnapshot(snapshot: BattlefieldSnapshot | null) {
    this.latestSnapshot = snapshot
    if (!snapshot) return
    synchronizeCombatPresentation(snapshot, this.presentationState, this.presentationPreferences)
    if (this.sys.isActive()) this.renderSnapshot(snapshot, false)
  }

  setUiState(uiState: BattlefieldSceneUiState) {
    this.latestUiState = uiState
    if (this.sys.isActive()) this.renderUiState()
  }

  setPresentationPreferences(preferences: BattlefieldPresentationPreferences) {
    this.presentationPreferences = preferences
    this.presentationDirector?.setPreferences(preferences)
    this.combatAudio.setLowEffects(preferences.lowEffects)
  }

  diagnostics() {
    const presentation = this.presentationDirector?.diagnostics() ?? { activeVfxObjects: 0, pooledVfxObjects: 0, telegraphLabels: 0 }
    return {
      ...presentation,
      pieceViews: this.pieceViews.size,
      enemyViews: this.enemyViews.size,
      seenEnemyCount: this.seenEnemyIds.size,
      summonedUnitViews: this.summonedUnitViews.size,
      displayObjects: this.children?.list?.length ?? 0,
    }
  }

  setAudioPreferences(preferences: BattlefieldAudioPreferences) {
    this.combatAudio.setMuted(preferences.muted)
    this.combatAudio.setMasterVolume(preferences.masterVolume)
  }

  unlockAudio(): Promise<boolean> {
    return this.combatAudio.unlock()
  }

  setAudioSuspended(suspended: boolean) {
    this.combatAudio.setSuspendedForVisibility(suspended)
  }

  getCameraViewState(): BattlefieldCameraViewState {
    const camera = this.cameras?.main
    const zoom = camera?.zoom ?? 1
    const scrollX = camera?.scrollX ?? 0
    const scrollY = camera?.scrollY ?? 0
    return {
      mode: this.cameraViewMode,
      zoom,
      // UI consumers need the visible world's top-left, not Phaser's unzoomed camera scroll.
      scrollX: phaserCameraWorldViewOrigin(scrollX, zoom, BATTLEFIELD_SIZE),
      scrollY: phaserCameraWorldViewOrigin(scrollY, zoom, BATTLEFIELD_SIZE),
    }
  }

  setViewMode(mode: BattlefieldViewMode, requestedFocus?: BattlefieldGridPosition | null) {
    if (!this.sys.isActive()) return this.getCameraViewState()
    const camera = this.cameras.main
    this.cameraViewMode = mode
    if (mode === 'full') {
      camera.setZoom(1).centerOn(BATTLEFIELD_SIZE / 2, BATTLEFIELD_SIZE / 2)
    }
    else {
      const focus = requestedFocus
        ? { x: gridToPixel(requestedFocus.x) + BATTLEFIELD_CELL_SIZE / 2, y: gridToPixel(requestedFocus.y) + BATTLEFIELD_CELL_SIZE / 2 }
        : this.resolveFocusPoint()
      const zoom = Math.max(1.35, camera.zoom)
      camera.setZoom(zoom).centerOn(focus.x, focus.y)
    }
    this.notifyCameraViewChange()
    return this.getCameraViewState()
  }

  zoomBy(delta: number, screenPoint = { x: BATTLEFIELD_SIZE / 2, y: BATTLEFIELD_SIZE / 2 }) {
    if (!this.sys.isActive()) return this.getCameraViewState()
    const camera = this.cameras.main
    const anchoredWorldPoint = {
      x: phaserCameraScreenToWorld(camera.scrollX, camera.zoom, screenPoint.x, BATTLEFIELD_SIZE),
      y: phaserCameraScreenToWorld(camera.scrollY, camera.zoom, screenPoint.y, BATTLEFIELD_SIZE),
    }
    const nextZoom = Phaser.Math.Clamp(camera.zoom + delta, BATTLEFIELD_MIN_ZOOM, BATTLEFIELD_MAX_ZOOM)
    camera.setZoom(nextZoom)
    camera.setScroll(
      camera.clampX(anchoredWorldPoint.x - BATTLEFIELD_SIZE / 2 - (screenPoint.x - BATTLEFIELD_SIZE / 2) / nextZoom),
      camera.clampY(anchoredWorldPoint.y - BATTLEFIELD_SIZE / 2 - (screenPoint.y - BATTLEFIELD_SIZE / 2) / nextZoom),
    )
    this.cameraViewMode = nextZoom <= BATTLEFIELD_MIN_ZOOM ? 'full' : 'focus'
    this.notifyCameraViewChange()
    return this.getCameraViewState()
  }

  panBy(screenDeltaX: number, screenDeltaY: number) {
    if (!this.sys.isActive()) return this.getCameraViewState()
    const camera = this.cameras.main
    if (camera.zoom <= BATTLEFIELD_MIN_ZOOM) return this.getCameraViewState()
    camera.setScroll(
      camera.clampX(camera.scrollX + screenDeltaX / camera.zoom),
      camera.clampY(camera.scrollY + screenDeltaY / camera.zoom),
    )
    this.cameraViewMode = 'focus'
    this.notifyCameraViewChange()
    return this.getCameraViewState()
  }

  viewportPointToCell(screenX: number, screenY: number): BattlefieldGridPosition | null {
    const camera = this.cameras?.main
    const world = camera
      ? camera.getWorldPoint(screenX, screenY)
      : { x: screenX, y: screenY }
    return this.positionToCell(world.x, world.y)
  }

  private resolveFocusPoint() {
    const selected = this.latestSnapshot?.pieces.find(piece => piece.entityId === this.latestUiState.selectedPieceId)
    const cell = selected ?? this.latestUiState.hoveredCell
    return cell
      ? { x: gridToPixel(cell.x) + BATTLEFIELD_CELL_SIZE / 2, y: gridToPixel(cell.y) + BATTLEFIELD_CELL_SIZE / 2 }
      : { x: BATTLEFIELD_SIZE / 2, y: BATTLEFIELD_SIZE / 2 }
  }

  private notifyCameraViewChange() {
    this.onCameraViewChange?.(this.getCameraViewState())
  }

  private isHuaguoshanTheme(): boolean {
    return Boolean(this.sceneTheme?.environment.includes('桃林') || this.sceneTheme?.landmark.includes('水帘'))
  }

  private isEnemyPresentationFixtureEnabled(): boolean {
    if (!import.meta.env.DEV || typeof window === 'undefined') return false
    return new URLSearchParams(window.location.search).get('presentationFixture') === 'enemy-language'
  }

  private isGeneralManifestationFixtureEnabled(): boolean {
    if (!import.meta.env.DEV || typeof window === 'undefined') return false
    return new URLSearchParams(window.location.search).get('presentationFixture') === 'general-manifestation'
  }

  /** Dev-only, read-only review plate. It neither mutates latestSnapshot nor emits gameplay input. */
  private drawGeneralManifestationFixture() {
    const layer = this.add.container(0, 0).setDepth(96)
    const panel = this.add.graphics()
    panel.fillStyle(0x07111f, 0.94)
    panel.fillRoundedRect(28, 24, BATTLEFIELD_SIZE - 56, BATTLEFIELD_SIZE - 48, 18)
    panel.lineStyle(2, 0xd8ad54, 0.82)
    panel.strokeRoundedRect(28, 24, BATTLEFIELD_SIZE - 56, BATTLEFIELD_SIZE - 48, 18)
    layer.add(panel)
    layer.add(this.add.text(54, 42, '神将显圣 · 权威编舞协议样板', { color: '#f3ead5', fontFamily: HAN_FONT, fontSize: '25px', fontStyle: 'bold' }))
    layer.add(this.add.text(BATTLEFIELD_SIZE - 54, 48, 'DEV只读 · 不写状态 / 伤害', { color: '#8ee3cf', fontFamily: HAN_FONT, fontSize: '13px', fontStyle: 'bold' }).setOrigin(1, 0))

    const drawFormation = (centerX: number, centerY: number, glyphs: readonly string[], name: string, color: number) => {
      const graphics = this.add.graphics()
      graphics.lineStyle(3, color, 0.9)
      graphics.lineBetween(centerX - 58, centerY, centerX + 58, centerY)
      graphics.fillStyle(color, 0.14); graphics.fillCircle(centerX, centerY, 42)
      graphics.lineStyle(3, color, 0.94); graphics.strokeCircle(centerX, centerY, 39)
      layer.add(graphics)
      glyphs.forEach((glyph, index) => layer.add(this.add.text(centerX + (index - 0.5) * 68, centerY, glyph, { color: '#fff8df', fontFamily: HAN_FONT, fontSize: '38px', fontStyle: 'bold', backgroundColor: '#17213ce6', padding: { x: 11, y: 5 }, stroke: '#4a3210', strokeThickness: 3 }).setOrigin(0.5)))
      layer.add(this.add.text(centerX, centerY + 64, `${name} · 显圣`, { color: Phaser.Display.Color.IntegerToColor(color).rgba, fontFamily: HAN_FONT, fontSize: '18px', fontStyle: 'bold' }).setOrigin(0.5))
    }
    drawFormation(250, 205, ['后', '羿'], '后羿', 0xf6c453)
    drawFormation(678, 205, ['杨', '戬'], '杨戬', 0x8bd3dd)

    const action = this.add.graphics()
    action.fillStyle(0xffc928, 0.2); action.fillCircle(178, 405, 28)
    action.lineStyle(5, 0xffd76a, 0.96); action.lineBetween(195, 405, 390, 355); action.lineBetween(195, 405, 430, 420)
    action.lineStyle(2, 0xfff3b0, 0.85); action.strokeCircle(178, 405, 31)
    action.lineStyle(5, 0xa5f3fc, 0.96); action.lineBetween(554, 410, 752, 360)
    action.fillStyle(0x70a5d8, 0.12); action.fillPoints([
      new Phaser.Math.Vector2(550, 392), new Phaser.Math.Vector2(748, 342),
      new Phaser.Math.Vector2(758, 378), new Phaser.Math.Vector2(560, 428),
    ], true)
    action.lineStyle(2, 0xe6fbff, 0.75); action.lineBetween(551, 399, 749, 349); action.lineBetween(557, 421, 755, 371)
    action.lineStyle(2, 0x8bd3dd, 0.95); action.strokeRect(742, 342, 28, 28)
    layer.add(action)
    layer.add(this.add.text(284, 457, '蓄弦 · 金乌日轮 · 权威目标箭路', { color: '#fff3b0', fontFamily: HAN_FONT, fontSize: '15px', fontStyle: 'bold' }).setOrigin(0.5))
    layer.add(this.add.text(663, 457, '三尖蓄锋 · 斩迹 · 破甲印', { color: '#e6fbff', fontFamily: HAN_FONT, fontSize: '15px', fontStyle: 'bold' }).setOrigin(0.5))
    layer.add(this.add.text(464, 505, 'actionId 幂等 · targetIds 有序 · 服务器毫格几何', { color: '#8ee3cf', fontFamily: HAN_FONT, fontSize: '14px', fontStyle: 'bold', backgroundColor: '#0b1725dd', padding: { x: 8, y: 4 } }).setOrigin(0.5))

    const moon = this.add.graphics()
    moon.lineStyle(3, 0xd8ecff, 0.76); moon.lineBetween(280, 635, 648, 635)
    moon.fillStyle(0xeaf6ff, 0.16); moon.fillCircle(280, 635, 24); moon.fillCircle(648, 635, 24)
    moon.lineStyle(2, 0xf5f3ff, 0.88); moon.strokeCircle(280, 635, 27); moon.strokeCircle(648, 635, 27)
    layer.add(moon)
    layer.add(this.add.text(280, 635, '羿', { color: '#fff3b0', fontFamily: HAN_FONT, fontSize: '26px', fontStyle: 'bold' }).setOrigin(0.5))
    layer.add(this.add.text(648, 635, '娥', { color: '#eaf6ff', fontFamily: HAN_FONT, fontSize: '26px', fontStyle: 'bold' }).setOrigin(0.5))
    layer.add(this.add.text(464, 635, '月宫旧侣 · 月银共鸣', { color: '#eaf6ff', fontFamily: HAN_FONT, fontSize: '17px', fontStyle: 'bold', backgroundColor: '#17213cdd', padding: { x: 8, y: 4 } }).setOrigin(0.5))

    const bossWarning = this.add.graphics()
    bossWarning.fillStyle(0x8f2f2a, 0.15); bossWarning.fillCircle(464, 770, 52)
    bossWarning.lineStyle(3, 0xf2c45c, 0.9); bossWarning.strokeCircle(464, 770, 52)
    bossWarning.lineStyle(4, 0xef6b55, 0.95); bossWarning.beginPath(); bossWarning.arc(464, 770, 60, -Math.PI / 2, Math.PI * 0.85); bossWarning.strokePath()
    layer.add(bossWarning)
    layer.add(this.add.text(464, 770, '王', { color: '#fff7ed', fontFamily: HAN_FONT, fontSize: '38px', fontStyle: 'bold', stroke: '#020617', strokeThickness: 4 }).setOrigin(0.5))
    layer.add(this.add.text(464, 842, 'Boss · 权威圆域 · 目标 王 · 1.0秒', { color: '#f4a28c', fontFamily: HAN_FONT, fontSize: '15px', fontStyle: 'bold' }).setOrigin(0.5))
  }

  /** Dev-only visual review plate. It never enters latestSnapshot or emits an action. */
  private drawEnemyPresentationFixture() {
    const panel = this.add.graphics()
    panel.fillStyle(0x07111f, 0.96)
    panel.fillRoundedRect(20, 18, BATTLEFIELD_SIZE - 40, 248, 14)
    panel.lineStyle(2, 0xd8ad54, 0.78)
    panel.strokeRoundedRect(20, 18, BATTLEFIELD_SIZE - 40, 248, 14)
    const title = this.add.text(40, 32, '字灵妖潮 · 视觉验收图例', { color: '#f3ead5', fontFamily: HAN_FONT, fontSize: '25px', fontStyle: 'bold' })
    const notice = this.add.text(BATTLEFIELD_SIZE - 40, 37, '仅视觉 · 不改战斗状态', { color: '#8ee3cf', fontFamily: HAN_FONT, fontSize: '14px', fontStyle: 'bold' }).setOrigin(1, 0)
    const fixtureEnemies: BattlefieldEnemyState[] = [
      { entityId: 'fixture-basic', entityKind: 'ordinary_minion', bossDefinitionId: null, bossName: null, controlResistanceBps: 0, bossPhase: 0, activeCast: null, glyph: '鬼', hp: 1, maxHp: 1, x: 0, y: 0, armor: 0, magicResistance: 0, moveSpeedMilliCellsPerSecond: 1000 },
      { entityId: 'fixture-fast', entityKind: 'ordinary_minion', bossDefinitionId: null, bossName: null, controlResistanceBps: 0, bossPhase: 0, activeCast: null, glyph: '妖', hp: 1, maxHp: 1, x: 0, y: 0, armor: 0, magicResistance: 0, moveSpeedMilliCellsPerSecond: 1000 },
      { entityId: 'fixture-armored', entityKind: 'ordinary_minion', bossDefinitionId: null, bossName: null, controlResistanceBps: 0, bossPhase: 0, activeCast: null, glyph: '魔', hp: 1, maxHp: 1, x: 0, y: 0, armor: 8, magicResistance: 2, moveSpeedMilliCellsPerSecond: 1000 },
      { entityId: 'fixture-mystic', entityKind: 'ordinary_minion', bossDefinitionId: null, bossName: null, controlResistanceBps: 0, bossPhase: 0, activeCast: null, glyph: '魅', hp: 1, maxHp: 1, x: 0, y: 0, armor: 2, magicResistance: 8, moveSpeedMilliCellsPerSecond: 1000 },
      { entityId: 'fixture-swarm', entityKind: 'ordinary_minion', bossDefinitionId: null, bossName: null, controlResistanceBps: 0, bossPhase: 0, activeCast: null, glyph: '怪', hp: 1, maxHp: 1, x: 0, y: 0, armor: 0, magicResistance: 0, moveSpeedMilliCellsPerSecond: 1000 },
      { entityId: 'fixture-boss', entityKind: 'boss', bossDefinitionId: 'fixture', bossName: '妖王', controlResistanceBps: 5000, bossPhase: 3, activeCast: null, glyph: '王', hp: 1, maxHp: 1, x: 0, y: 0, armor: 10, magicResistance: 10, moveSpeedMilliCellsPerSecond: 800 },
    ]
    const objects: Phaser.GameObjects.GameObject[] = [panel, title, notice]
    fixtureEnemies.forEach((enemy, index) => {
      const style = enemyVisualStyle(enemy)
      const x = 92 + index * 146
      const y = 142
      if (enemy.entityKind === 'boss') {
        const warning = this.add.graphics()
        warning.fillStyle(0x8f2f2a, 0.22)
        warning.fillCircle(x, y, 54)
        warning.lineStyle(2, 0xf2c45c, 0.95)
        warning.strokeCircle(x, y, 54)
        const warningLabel = this.add.text(x, 232, '权威圆域 · 1.2秒', { color: '#f4a28c', fontFamily: HAN_FONT, fontSize: '14px', fontStyle: 'bold' }).setOrigin(0.5)
        objects.push(warning, warningLabel)
      }
      const shape = this.add.graphics().setPosition(x, y)
      shape.fillStyle(style.fillColor, 0.96)
      shape.lineStyle(enemy.entityKind === 'boss' ? 4 : 3, style.outlineColor, 1)
      this.drawEnemySilhouette(shape, style.silhouette, enemy.entityKind === 'boss' ? 38 : 29)
      if (enemy.entityKind === 'boss') this.drawBossPhaseCracks(shape, 38, enemy.bossPhase)
      const glyph = this.add.text(x, y - 2, enemy.glyph, { color: '#fff7ed', fontFamily: HAN_FONT, fontSize: enemy.entityKind === 'boss' ? '42px' : '34px', fontStyle: 'bold', stroke: '#020617', strokeThickness: 4 }).setOrigin(0.5)
      const marker = this.add.text(x + 29, y + 28, style.marker, { color: '#fff7ed', fontFamily: HAN_FONT, fontSize: '13px', fontStyle: 'bold', backgroundColor: '#07111f', padding: { x: 3, y: 1 } }).setOrigin(0.5)
      const label = this.add.text(x, 205, style.label, { color: '#d9ccb1', fontFamily: HAN_FONT, fontSize: '15px', fontStyle: 'bold' }).setOrigin(0.5)
      objects.push(shape, glyph, marker, label)
    })
    this.add.container(0, 0, objects).setDepth(96)
  }

  private drawTerrain() {
    const graphics = this.terrainLayer
    const [backgroundHex, groundHex, accentHex] = this.sceneTheme?.palette ?? ['#0b1121', '#1a233a', '#fb923c']
    const backgroundColor = Phaser.Display.Color.HexStringToColor(backgroundHex).color
    const groundColor = Phaser.Display.Color.HexStringToColor(groundHex).color
    const accentColor = Phaser.Display.Color.HexStringToColor(accentHex).color
    graphics.clear()
    // 花果山使用可选的美术背景；资源缺失时仍退回完整程序化战场。
    graphics.fillStyle(backgroundColor, this.backgroundImage ? 0.56 : 1)
    graphics.fillRect(0, 0, BATTLEFIELD_SIZE, BATTLEFIELD_SIZE)
    for (let y = 0; y < BATTLEFIELD_DIMENSION; y += 1) {
      for (let x = 0; x < BATTLEFIELD_DIMENSION; x += 1) {
        const left = gridToPixel(x) + CELL_GAP
        const top = gridToPixel(y) + CELL_GAP
        const size = BATTLEFIELD_CELL_SIZE - CELL_GAP * 2
        const isGround = this.terrainMatrix[y]?.[x] === 1
        graphics.fillStyle(
          isGround ? groundColor : 0x0f172a,
          this.backgroundImage ? (isGround ? 0.34 : 0.62) : (isGround ? 0.72 : 0.9),
        )
        graphics.fillRoundedRect(left, top, size, size, 3)
        if (isGround) {
          graphics.lineStyle(1, 0xffffff, 0.05)
          graphics.strokeRoundedRect(left + 0.5, top + 0.5, size - 1, size - 1, 3)
        }
        if (isCoreCell(x, y)) {
          graphics.fillStyle(accentColor, 0.2)
          graphics.fillRoundedRect(left, top, size, size, 3)
          graphics.lineStyle(1, accentColor, 0.45)
          graphics.strokeRoundedRect(left + 1, top + 1, size - 2, size - 2, 3)
        }
        else if (isProtectedZoneCell(x, y)) {
          graphics.fillStyle(accentColor, 0.055)
          graphics.fillRoundedRect(left, top, size, size, 3)
        }
        const gateLabel = GATE_LABELS.get(coordKey(x, y))
        if (gateLabel) this.add.text(left + size / 2, top + size / 2, gateLabel, { color: accentHex, fontFamily: 'ui-monospace, monospace', fontSize: '10px', fontStyle: 'bold' }).setOrigin(0.5).setAlpha(0.85).setDepth(5)
      }
    }
  }

  private bindPointerInput() {
    this.input.on('wheel', (pointer: Phaser.Input.Pointer, _objects: unknown[], _deltaX: number, deltaY: number) => {
      if (deltaY === 0) return
      pointer.event?.preventDefault()
      this.zoomBy(deltaY < 0 ? 0.14 : -0.14, { x: pointer.x, y: pointer.y })
    })
    this.inputZone.on('pointermove', (pointer: Phaser.Input.Pointer, localX: number, localY: number) => {
      if (this.activeGesturePointers.has(pointer.id)) {
        this.activeGesturePointers.set(pointer.id, { x: pointer.x, y: pointer.y })
      }
      if (this.activeGesturePointers.size >= 2) {
        this.updatePinchGesture()
        return
      }
      if (this.panPointerId === pointer.id) {
        const previous = this.pointerDownScreen
        if (previous) {
          this.panBy(previous.x - pointer.x, previous.y - pointer.y)
          this.pointerDownScreen = { x: pointer.x, y: pointer.y }
          this.gestureConsumedPointers.add(pointer.id)
        }
        return
      }
      const cell = this.positionToCell(localX, localY)
      const nextKey = cell ? coordKey(cell.x, cell.y) : null
      if (nextKey === this.lastHoveredCellKey) return
      this.lastHoveredCellKey = nextKey
    })
    this.inputZone.on('pointerdown', (pointer: Phaser.Input.Pointer, localX: number, localY: number) => {
      const cell = this.positionToCell(localX, localY)
      this.pointerDownCell = cell
      this.pointerDownScreen = { x: pointer.x, y: pointer.y }
      this.activeGesturePointers.set(pointer.id, { x: pointer.x, y: pointer.y })
      if (pointer.middleButtonDown() || pointer.rightButtonDown() || pointer.event?.shiftKey) {
        this.panPointerId = pointer.id
        this.gestureConsumedPointers.add(pointer.id)
      }
      if (this.activeGesturePointers.size >= 2) this.beginPinchGesture()
    })
    this.inputZone.on('pointerup', (pointer: Phaser.Input.Pointer, localX: number, localY: number) => {
      const cell = this.positionToCell(localX, localY)
      const start = this.pointerDownCell
      const consumed = this.gestureConsumedPointers.has(pointer.id)
      this.pointerDownCell = null
      this.pointerDownScreen = null
      this.activeGesturePointers.delete(pointer.id)
      this.gestureConsumedPointers.delete(pointer.id)
      if (this.panPointerId === pointer.id) this.panPointerId = null
      if (this.activeGesturePointers.size < 2) this.resetPinchGesture()
      void consumed
      void cell
      void start
    })
    this.inputZone.on('pointerout', () => {
      this.lastHoveredCellKey = null
      this.pointerDownCell = null
      this.pointerDownScreen = null
      this.activeGesturePointers.clear()
      this.gestureConsumedPointers.clear()
      this.panPointerId = null
      this.resetPinchGesture()
    })
  }

  private beginPinchGesture() {
    for (const pointerId of this.activeGesturePointers.keys()) this.gestureConsumedPointers.add(pointerId)
    const [first, second] = [...this.activeGesturePointers.values()]
    if (!first || !second) return
    this.lastPinchDistance = Phaser.Math.Distance.Between(first.x, first.y, second.x, second.y)
    this.lastPinchCenter = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
  }

  private updatePinchGesture() {
    const [first, second] = [...this.activeGesturePointers.values()]
    if (!first || !second) return
    const distance = Phaser.Math.Distance.Between(first.x, first.y, second.x, second.y)
    const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
    if (this.lastPinchDistance > 0) {
      const zoomDelta = (distance - this.lastPinchDistance) / 260
      if (Math.abs(zoomDelta) > 0.002) this.zoomBy(zoomDelta, center)
    }
    if (this.lastPinchCenter) {
      this.panBy(this.lastPinchCenter.x - center.x, this.lastPinchCenter.y - center.y)
    }
    this.lastPinchDistance = distance
    this.lastPinchCenter = center
  }

  private resetPinchGesture() {
    this.lastPinchDistance = 0
    this.lastPinchCenter = null
  }

  private positionToCell(localX: number, localY: number): BattlefieldGridPosition | null {
    const x = Math.floor(localX / BATTLEFIELD_CELL_SIZE)
    const y = Math.floor(localY / BATTLEFIELD_CELL_SIZE)
    return x >= 0 && x < BATTLEFIELD_DIMENSION && y >= 0 && y < BATTLEFIELD_DIMENSION ? { x, y } : null
  }

  private renderSnapshot(snapshot: BattlefieldSnapshot, consumePresentation = true) {
    const cues = consumePresentation
      ? consumeCombatPresentation(snapshot, this.presentationState, this.presentationPreferences)
      : []
    this.drawZones(snapshot.zones)
    this.syncPieces(snapshot.pieces)
    this.syncSummonedUnits(snapshot.summonedUnits)
    this.syncEnemies(snapshot.enemies, snapshot.statuses)
    this.combatAudio.play(cues, snapshot.tick, snapshot.tickRateMs)
    this.presentationDirector?.play(cues)
    this.presentationDirector?.syncSynergyLinks(activeSynergyPresentationLinks(this.presentationState))
    this.presentationDirector?.renderBossTelegraphs(snapshot.enemies, snapshot.tick, snapshot.tickRateMs)
    this.renderUiState()
  }

  private flashEnemy(entityId: string, durationMs: number) {
    const view = this.enemyViews.get(entityId)
    if (!view) return
    if (view.mode === 'compact') {
      view.sprite.setAlpha(0.35)
      this.time.delayedCall(Math.max(40, durationMs), () => {
        if (view.container.scene) view.sprite.setAlpha(1)
      })
      return
    }
    this.tweens.killTweensOf(view.glyph)
    this.tweens.killTweensOf(view.body)
    if (this.presentationPreferences.reducedMotion) {
      view.glyph.setAlpha(0.45)
      view.body.setAlpha(0.45)
      this.time.delayedCall(Math.max(40, durationMs), () => {
        if (!view.container.scene) return
        view.glyph.setAlpha(1)
        view.body.setAlpha(1)
      })
      return
    }
    this.tweens.add({ targets: [view.glyph, view.body], alpha: 0.22, duration: Math.max(25, Math.floor(durationMs / 2)), yoyo: true })
  }

  private drawZones(zones: BattlefieldEffectZoneState[]) {
    this.zoneLayer.clear()
    for (const zone of zones) {
      const centerX = gridToPixel(zone.x) + BATTLEFIELD_CELL_SIZE / 2
      const centerY = gridToPixel(zone.y) + BATTLEFIELD_CELL_SIZE / 2
      this.zoneLayer.fillStyle(0x22d3ee, 0.08)
      this.zoneLayer.lineStyle(2, 0x67e8f9, 0.46)
      if (zone.shape.kind === 'circle') {
        const radius = Math.max(BATTLEFIELD_CELL_SIZE / 2, zone.shape.radiusMilliCells / 1000 * BATTLEFIELD_CELL_SIZE)
        this.zoneLayer.fillCircle(centerX, centerY, radius)
        this.zoneLayer.strokeCircle(centerX, centerY, radius)
      } else {
        const width = Math.max(BATTLEFIELD_CELL_SIZE, zone.shape.lengthMilliCells / 1000 * BATTLEFIELD_CELL_SIZE)
        const height = Math.max(BATTLEFIELD_CELL_SIZE / 2, zone.shape.halfWidthMilliCells / 500 * BATTLEFIELD_CELL_SIZE)
        this.zoneLayer.fillRoundedRect(centerX - width / 2, centerY - height / 2, width, height, 6)
        this.zoneLayer.strokeRoundedRect(centerX - width / 2, centerY - height / 2, width, height, 6)
      }
    }
  }

  private syncSummonedUnits(units: BattlefieldSummonedUnitState[]) {
    const activeIds = new Set(units.map((unit) => unit.entityId))
    for (const [entityId, view] of this.summonedUnitViews) {
      if (activeIds.has(entityId)) continue
      this.tweens.killTweensOf(view.container)
      view.container.destroy(true)
      this.summonedUnitViews.delete(entityId)
    }
    for (const unit of units) {
      const targetX = gridToPixel(unit.x) + BATTLEFIELD_CELL_SIZE / 2
      const targetY = gridToPixel(unit.y) + BATTLEFIELD_CELL_SIZE / 2
      let view = this.summonedUnitViews.get(unit.entityId)
      if (!view) {
        const body = this.add.graphics()
        const glyph = this.add.text(0, -1, unit.glyph, { color: '#a7f3d0', fontFamily: HAN_FONT, fontSize: '18px', fontStyle: 'bold', stroke: '#022c22', strokeThickness: 2 }).setOrigin(0.5)
        const level = this.add.text(10, 10, `召${unit.ownerLevel}`, { color: '#d1fae5', fontFamily: 'ui-monospace, monospace', fontSize: '7px', backgroundColor: '#022c22', padding: { x: 2, y: 0 } }).setOrigin(0.5)
        body.fillStyle(0x064e3b, 0.76)
        body.fillCircle(0, 0, 11)
        body.lineStyle(2, 0x34d399, 0.9)
        body.strokeCircle(0, 0, 11)
        const container = this.add.container(targetX, targetY, [body, glyph, level])
        this.summonLayer.add(container)
        view = { container, body, glyph, level, glyphValue: unit.glyph, levelValue: unit.ownerLevel }
        this.summonedUnitViews.set(unit.entityId, view)
      } else {
        this.tweens.killTweensOf(view.container)
        this.tweens.add({ targets: view.container, x: targetX, y: targetY, duration: ENEMY_TWEEN_MS, ease: 'Linear' })
        if (view.glyphValue !== unit.glyph) view.glyph.setText(unit.glyph)
        if (view.levelValue !== unit.ownerLevel) view.level.setText(`召${unit.ownerLevel}`)
        view.glyphValue = unit.glyph
        view.levelValue = unit.ownerLevel
      }
    }
  }

  private syncPieces(pieces: BattlefieldPieceState[]) {
    const activeIds = new Set(pieces.map((piece) => piece.entityId))
    for (const [entityId, view] of this.pieceViews) {
      if (!activeIds.has(entityId)) {
        view.container.destroy(true)
        this.pieceViews.delete(entityId)
      }
    }
    for (const piece of pieces) {
      let view = this.pieceViews.get(piece.entityId)
      if (!view) {
        view = this.createPieceView(piece)
        this.pieceViews.set(piece.entityId, view)
      }
      view.container.setPosition(gridToPixel(piece.x), gridToPixel(piece.y))
      if (view.kind !== piece.kind
        || view.glyphValue !== piece.glyph
        || view.levelValue !== (piece.level ?? 0)
        || view.generalIdValue !== (piece.generalId ?? '')
        || view.generalQualityValue !== (piece.generalQuality ?? '')
        || view.fixedValue !== Boolean(piece.generalFixed)) this.drawPiece(view, piece)
    }
  }

  private createPieceView(piece: BattlefieldPieceState): PieceView {
    const selection = this.add.graphics()
    const body = this.add.graphics()
    const glyph = this.add.text(BATTLEFIELD_CELL_SIZE / 2, BATTLEFIELD_CELL_SIZE / 2 - 1, '', { fontFamily: HAN_FONT, fontSize: '23px', fontStyle: 'bold' }).setOrigin(0.5)
    const level = this.add.text(BATTLEFIELD_CELL_SIZE - 5, BATTLEFIELD_CELL_SIZE - 4, '', { fontFamily: 'ui-monospace, monospace', fontSize: '8px', fontStyle: 'bold', backgroundColor: '#020617', padding: { x: 2, y: 0 } }).setOrigin(1)
    const container = this.add.container(gridToPixel(piece.x), gridToPixel(piece.y), [selection, body, glyph, level])
    this.pieceLayer.add(container)
    const view: PieceView = {
      container,
      body,
      selection,
      glyph,
      level,
      kind: '',
      glyphValue: '',
      levelValue: -1,
      generalIdValue: '',
      generalQualityValue: '',
      fixedValue: false,
    }
    this.drawPiece(view, piece)
    return view
  }

  private drawPiece(view: PieceView, piece: BattlefieldPieceState) {
    const size = BATTLEFIELD_CELL_SIZE - ENTITY_INSET * 2
    const color = piece.generalId
      ? GENERAL_QUALITY_COLORS[piece.generalQuality ?? 'purple']
      : piece.kind === 'character' ? 0x67e8f9 : SOLDIER_BLUE
    view.body.clear()
    view.body.fillStyle(0x07111f, 0.94)
    view.body.fillRoundedRect(ENTITY_INSET, ENTITY_INSET, size, size, 5)
    view.body.lineStyle(piece.generalFixed ? 3 : 2, color, 0.95)
    view.body.strokeRoundedRect(ENTITY_INSET + 1, ENTITY_INSET + 1, size - 2, size - 2, 5)
    view.glyph.setText(piece.glyph).setColor(Phaser.Display.Color.IntegerToColor(color).rgba)
    view.level
      .setText(piece.kind === 'soldier' ? `${piece.level ?? 1}` : piece.generalId ? piece.generalFixed ? '固' : '将' : '')
      .setVisible(piece.kind === 'soldier' || Boolean(piece.generalId))
    view.kind = piece.kind
    view.glyphValue = piece.glyph
    view.levelValue = piece.level ?? 0
    view.generalIdValue = piece.generalId ?? ''
    view.generalQualityValue = piece.generalQuality ?? ''
    view.fixedValue = Boolean(piece.generalFixed)
  }

  private syncEnemies(enemies: BattlefieldEnemyState[], statuses: BattlefieldEnemyStatusState[]) {
    for (const enemy of enemies) this.seenEnemyIds.add(enemy.entityId)
    const compactMode = shouldUseCompactEnemyRendering(enemies.length)
    if (compactMode !== this.compactEnemyMode) {
      for (const view of this.enemyViews.values()) {
        this.tweens.killTweensOf(view.container)
        view.container.destroy(true)
      }
      this.enemyViews.clear()
      this.compactEnemyMode = compactMode
      if (!compactMode) this.clearCompactEnemyTextures()
    }
    const statusLabelsByEnemyId = new Map<string, string[]>()
    for (const status of statuses) {
      const label = `${STATUS_LABELS[status.statusId] ?? status.statusId.slice(0, 1)}${status.stacks > 1 ? status.stacks : ''}`
      const labels = statusLabelsByEnemyId.get(status.enemyId) ?? []
      if (!labels.includes(label)) labels.push(label)
      statusLabelsByEnemyId.set(status.enemyId, labels)
    }
    const activeIds = new Set(enemies.map((enemy) => enemy.entityId))
    const activeCompactSignatures = new Set<string>()
    for (const [entityId, view] of this.enemyViews) {
      if (!activeIds.has(entityId)) {
        this.tweens.killTweensOf(view.container)
        view.container.destroy(true)
        this.enemyViews.delete(entityId)
      }
    }
    for (const enemy of enemies) {
      let view = this.enemyViews.get(enemy.entityId)
      const targetX = gridToPixel(enemy.x) + BATTLEFIELD_CELL_SIZE / 2
      const targetY = gridToPixel(enemy.y) + BATTLEFIELD_CELL_SIZE / 2
      const statusSignature = (statusLabelsByEnemyId.get(enemy.entityId) ?? []).slice(0, 3).join('·')
      if (compactMode) {
        const compact = view?.mode === 'compact' ? view : null
        const textureSignature = this.compactEnemyTextureSignature(enemy, statusSignature)
        activeCompactSignatures.add(textureSignature)
        if (!compact) {
          view = this.createCompactEnemyView(enemy, statusSignature, textureSignature, targetX, targetY)
          this.enemyViews.set(enemy.entityId, view)
        } else {
          compact.movementFromX = compact.container.x
          compact.movementFromY = compact.container.y
          compact.targetX = targetX
          compact.targetY = targetY
          compact.movementStartedAt = this.time.now
          compact.movementDurationMs = this.presentationPreferences.reducedMotion
            ? 0
            : enemyMoveProfile(enemy, this.presentationPreferences).durationMs
          if (compact.movementDurationMs === 0) compact.container.setPosition(targetX, targetY)
          if (compact.textureSignature !== textureSignature) {
            compact.sprite.setTexture(this.compactEnemyTexture(enemy, statusSignature, textureSignature))
            compact.textureSignature = textureSignature
          }
          compact.visualSignature = textureSignature
          compact.statusSignature = statusSignature
          compact.hp = enemy.hp
          compact.maxHp = enemy.maxHp
          compact.spawnProtected = Boolean(enemy.spawnProtected)
        }
        continue
      }
      if (!view) {
        view = this.createEnemyView(enemy, targetX, targetY)
        this.enemyViews.set(enemy.entityId, view)
      } else if (view.mode === 'detailed') {
        this.tweens.killTweensOf(view.container)
        if (view.spawnProtected && !Boolean(enemy.spawnProtected)) {
          // 解除攻击锁的同帧对齐到服务端越线位置，避免补间滞后造成“身体还在出生格里就掉血”。
          view.container.setPosition(targetX, targetY)
        } else if (this.presentationPreferences.reducedMotion) {
          view.container.setPosition(targetX, targetY)
        } else {
          const movement = enemyMoveProfile(enemy, this.presentationPreferences)
          this.tweens.add({ targets: view.container, x: targetX, y: targetY, duration: movement.durationMs, ease: movement.ease })
        }
      }
      if (view.mode !== 'detailed') continue
      const style = enemyVisualStyle(enemy)
      const visualSignature = [
        enemy.glyph,
        enemy.entityKind,
        style.role,
        Boolean(enemy.spawnProtected),
        Boolean(enemy.invulnerable),
        enemy.bossPhase,
        enemy.armor ?? 0,
        enemy.magicResistance ?? 0,
      ].join(':')
      const presentationChanged = view.visualSignature !== visualSignature
      if (presentationChanged) {
        this.drawEnemyBody(view, enemy)
        this.drawEnemyStatusAura(view, view.statusSignature)
      }
      if (view.statusSignature !== statusSignature) {
        view.status.setText(statusSignature).setVisible(statusSignature.length > 0)
        this.drawEnemyStatusAura(view, statusSignature)
        view.statusSignature = statusSignature
      }
      if (presentationChanged || view.hp !== enemy.hp || view.maxHp !== enemy.maxHp) this.drawEnemyHealth(view, enemy.hp, enemy.maxHp)
    }
    if (compactMode) this.pruneCompactEnemyTextures(activeCompactSignatures)
  }

  private compactEnemyTextureSignature(enemy: BattlefieldEnemyState, statusSignature: string) {
    const style = enemyVisualStyle(enemy)
    const radius = enemy.entityKind === 'boss' ? BOSS_BODY_RADIUS_PX + 5 : ENEMY_BODY_RADIUS_PX
    const hpPixels = compactEnemyHealthPixels(enemy.hp, enemy.maxHp, radius * 2)
    return [
      enemy.glyph, enemy.entityKind, style.role, style.silhouette, Boolean(enemy.spawnProtected), Boolean(enemy.invulnerable),
      enemy.bossPhase, enemy.armor ?? 0, enemy.magicResistance ?? 0, hpPixels, statusSignature,
    ].join(':')
  }

  private createCompactEnemyView(
    enemy: BattlefieldEnemyState,
    statusSignature: string,
    textureSignature: string,
    x: number,
    y: number,
  ): CompactEnemyView {
    const sprite = this.add.image(0, 0, this.compactEnemyTexture(enemy, statusSignature, textureSignature)).setOrigin(0.5)
    const container = this.add.container(x, y, [sprite])
    this.enemyLayer.add(container)
    return {
      mode: 'compact', container, sprite, textureSignature, visualSignature: textureSignature, statusSignature,
      hp: enemy.hp, maxHp: enemy.maxHp, spawnProtected: Boolean(enemy.spawnProtected),
      targetX: x, targetY: y, movementFromX: x, movementFromY: y,
      movementStartedAt: this.time.now, movementDurationMs: 0,
    }
  }

  private compactEnemyTexture(enemy: BattlefieldEnemyState, statusSignature: string, signature: string) {
    const cached = this.compactEnemyTextures.get(signature)
    if (cached) return cached
    const isBoss = enemy.entityKind === 'boss'
    const size = isBoss ? 96 : 64
    const centerX = size / 2
    const centerY = isBoss ? 50 : 31
    const radius = isBoss ? BOSS_BODY_RADIUS_PX : ENEMY_BODY_RADIUS_PX
    const style = enemyVisualStyle(enemy)
    const textureKey = `battlefield-enemy-compact-${this.compactEnemyTextureSequence++}`
    const texture = this.textures.createCanvas(textureKey, size, size)
    if (!texture) throw new Error('COMPACT_ENEMY_TEXTURE_CREATE_FAILED')
    const context = texture.context
    context.clearRect(0, 0, size, size)
    context.save()
    context.translate(centerX, centerY)
    context.fillStyle = canvasColor(enemy.invulnerable ? 0x553617 : isBoss
      ? enemy.bossPhase >= 3 ? 0x412454 : enemy.bossPhase === 2 ? 0x65331f : style.fillColor
      : style.fillColor, isBoss ? 0.94 : 0.84)
    context.strokeStyle = canvasColor(enemy.invulnerable ? 0xf9e18b : isBoss
      ? enemy.bossPhase >= 3 ? 0xd8b4fe : enemy.bossPhase === 2 ? 0xf59e63 : style.outlineColor
      : style.outlineColor, 0.98)
    context.lineWidth = enemy.invulnerable || isBoss ? 3 : 2
    this.drawCompactSilhouette(context, style.silhouette, radius)
    if (enemy.spawnProtected) {
      context.strokeStyle = canvasColor(0xe7d18a, 0.9)
      context.lineWidth = 2
      context.strokeRect(-radius - 3, -radius - 3, (radius + 3) * 2, (radius + 3) * 2)
    }
    const armor = enemy.armor ?? 0
    const resistance = enemy.magicResistance ?? 0
    if (style.role === 'armored' || armor > resistance + 2) {
      context.strokeStyle = canvasColor(0xf0cf7b, 0.94)
      context.lineWidth = 3
      context.strokeRect(-radius - 4, -7, 4, 14)
      context.strokeRect(radius, -7, 4, 14)
    }
    if (style.role === 'mystic' || resistance > armor + 2) {
      context.strokeStyle = canvasColor(0xd7c0ff, 0.92)
      context.lineWidth = 2
      context.beginPath()
      context.arc(0, 0, radius + 4, -Math.PI * 0.15, Math.PI * 0.45)
      context.stroke()
    }
    if (statusSignature) {
      context.strokeStyle = /[晕定封]/.test(statusSignature) ? canvasColor(0xfef08a, 0.9) : canvasColor(0x8ee3cf, 0.86)
      context.lineWidth = 2
      context.beginPath()
      context.arc(0, 0, radius + 6, 0, Math.PI * 2)
      context.stroke()
    }
    context.fillStyle = enemy.invulnerable ? '#fde68a' : isBoss ? '#fff7ed' : '#fecaca'
    context.strokeStyle = isBoss ? '#451a03' : '#450a0a'
    context.lineWidth = 2
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.font = `bold ${enemy.invulnerable ? isBoss ? 17 : 13 : isBoss ? 28 : 20}px ${HAN_FONT}`
    context.strokeText(enemy.glyph, 0, -1)
    context.fillText(enemy.glyph, 0, -1)
    const markerX = isBoss ? 17 : 12
    const markerY = isBoss ? 17 : 12
    context.fillStyle = '#07111f'
    context.fillRect(markerX - 6, markerY - 5, 12, 10)
    context.fillStyle = '#fff7ed'
    context.font = 'bold 7px ui-monospace, monospace'
    context.fillText(enemy.invulnerable ? '护' : style.marker, markerX, markerY)
    if (isBoss) {
      context.fillStyle = '#771d1d'
      context.fillRect(-13, -radius - 18, 26, 11)
      context.fillStyle = '#fef3c7'
      context.font = 'bold 8px serif'
      context.fillText(`王·${Math.max(1, enemy.bossPhase)}`, 0, -radius - 12)
    }
    if (statusSignature) {
      context.font = 'bold 7px ui-monospace, monospace'
      const width = Math.max(14, context.measureText(statusSignature).width + 4)
      context.fillStyle = '#422006'
      context.fillRect(-width / 2, -radius - (isBoss ? 16 : 12), width, 10)
      context.fillStyle = '#fef08a'
      context.fillText(statusSignature, 0, -radius - (isBoss ? 11 : 7))
    }
    const healthRadius = isBoss ? BOSS_BODY_RADIUS_PX + 5 : ENEMY_BODY_RADIUS_PX
    const healthY = radius + (isBoss ? 8 : 4)
    const ratio = Phaser.Math.Clamp(enemy.maxHp > 0 ? enemy.hp / enemy.maxHp : 0, 0, 1)
    context.fillStyle = '#020617'
    context.fillRect(-healthRadius, healthY, healthRadius * 2, isBoss ? 6 : 4)
    context.fillStyle = ratio > 0.4 ? '#22c55e' : ratio > 0.2 ? '#f59e0b' : '#ef4444'
    context.fillRect(-healthRadius, healthY, Math.round(healthRadius * 2 * ratio), isBoss ? 6 : 4)
    context.restore()
    texture.refresh()
    this.compactEnemyTextures.set(signature, textureKey)
    return textureKey
  }

  private drawCompactSilhouette(context: CanvasRenderingContext2D, silhouette: ReturnType<typeof enemyVisualStyle>['silhouette'], radius: number) {
    context.beginPath()
    if (silhouette === 'circle') context.arc(0, 0, radius, 0, Math.PI * 2)
    else if (silhouette === 'diamond') {
      context.moveTo(0, -radius - 2); context.lineTo(radius + 2, 0); context.lineTo(0, radius + 2); context.lineTo(-radius - 2, 0); context.closePath()
    } else if (silhouette === 'triangle') {
      context.moveTo(0, -radius - 3); context.lineTo(radius + 3, radius + 2); context.lineTo(-radius - 3, radius + 2); context.closePath()
    } else if (silhouette === 'cluster') {
      const childRadius = Math.max(6, radius * 0.62)
      for (const [x, y] of [[-6, 4], [6, 4], [0, -6]]) {
        context.moveTo(x + childRadius, y); context.arc(x, y, childRadius, 0, Math.PI * 2)
      }
    } else if (silhouette === 'rounded-square') context.rect(-radius, -radius, radius * 2, radius * 2)
    else {
      const sides = silhouette === 'hexagon' ? 6 : 8
      for (let index = 0; index < sides; index += 1) {
        const angle = -Math.PI / 2 + Math.PI * 2 * index / sides
        const x = Math.cos(angle) * (radius + (silhouette === 'octagon' ? 2 : 1))
        const y = Math.sin(angle) * (radius + (silhouette === 'octagon' ? 2 : 1))
        if (index === 0) context.moveTo(x, y)
        else context.lineTo(x, y)
      }
      context.closePath()
    }
    context.fill()
    context.stroke()
  }

  private pruneCompactEnemyTextures(activeSignatures: ReadonlySet<string>) {
    for (const [signature, key] of this.compactEnemyTextures) {
      if (activeSignatures.has(signature)) continue
      this.textures.remove(key)
      this.compactEnemyTextures.delete(signature)
    }
  }

  private clearCompactEnemyTextures() {
    for (const key of this.compactEnemyTextures.values()) this.textures.remove(key)
    this.compactEnemyTextures.clear()
  }

  private createEnemyView(enemy: BattlefieldEnemyState, x: number, y: number): DetailedEnemyView {
    const body = this.add.graphics()
    const defense = this.add.graphics()
    const statusAura = this.add.graphics()
    const glyph = this.add.text(0, -1, '', { color: '#fecaca', fontFamily: HAN_FONT, fontSize: '20px', fontStyle: 'bold', stroke: '#450a0a', strokeThickness: 2 }).setOrigin(0.5)
    const health = this.add.graphics()
    const status = this.add.text(0, -22, '', { color: '#fef08a', fontFamily: 'ui-monospace, monospace', fontSize: '7px', fontStyle: 'bold', backgroundColor: '#422006', padding: { x: 2, y: 1 } }).setOrigin(0.5).setVisible(false)
    const bossBadge = this.add.text(0, -29, '妖王', { color: '#fef3c7', fontFamily: HAN_FONT, fontSize: '8px', fontStyle: 'bold', backgroundColor: '#771d1d', padding: { x: 3, y: 1 }, stroke: '#451a03', strokeThickness: 1 }).setOrigin(0.5).setVisible(false)
    const roleBadge = this.add.text(10, 10, '', { color: '#fff7ed', fontFamily: HAN_FONT, fontSize: '7px', fontStyle: 'bold', backgroundColor: '#07111f', padding: { x: 2, y: 0 }, stroke: '#020617', strokeThickness: 1 }).setOrigin(0.5)
    const container = this.add.container(x, y, [body, defense, statusAura, glyph, health, status, bossBadge, roleBadge])
    this.enemyLayer.add(container)
    const view: DetailedEnemyView = {
      mode: 'detailed',
      container,
      body,
      defense,
      statusAura,
      glyph,
      health,
      status,
      bossBadge,
      roleBadge,
      glyphValue: '',
      entityKind: 'ordinary_minion',
      visualRole: 'unknown',
      visualSignature: '',
      hp: Number.NaN,
      maxHp: Number.NaN,
      spawnProtected: false,
      invulnerable: false,
      statusSignature: '',
    }
    this.drawEnemyBody(view, enemy)
    this.drawEnemyHealth(view, enemy.hp, enemy.maxHp)
    this.animateEnemySpawn(view, enemy)
    return view
  }

  private drawEnemyBody(view: DetailedEnemyView, enemy: BattlefieldEnemyState) {
    const { glyph, entityKind } = enemy
    const spawnProtected = Boolean(enemy.spawnProtected)
    const invulnerable = Boolean(enemy.invulnerable)
    const isBoss = entityKind === 'boss'
    const style = enemyVisualStyle(enemy)
    const radius = isBoss ? BOSS_BODY_RADIUS_PX : ENEMY_BODY_RADIUS_PX
    view.visualRole = style.role
    view.body.clear()
    const bossPhaseFill = enemy.bossPhase >= 3 ? 0x412454 : enemy.bossPhase === 2 ? 0x65331f : style.fillColor
    const bossPhaseOutline = enemy.bossPhase >= 3 ? 0xd8b4fe : enemy.bossPhase === 2 ? 0xf59e63 : style.outlineColor
    view.body.fillStyle(invulnerable ? 0x553617 : isBoss ? bossPhaseFill : style.fillColor, isBoss ? 0.94 : 0.82)
    view.body.lineStyle(invulnerable ? 3 : isBoss ? 3 : 2, invulnerable ? 0xf9e18b : isBoss ? bossPhaseOutline : style.outlineColor, 0.98)
    this.drawEnemySilhouette(view.body, style.silhouette, radius)

    if (isBoss) this.drawBossPhaseCracks(view.body, radius, enemy.bossPhase)
    if (spawnProtected) {
      view.body.lineStyle(2, 0xe7d18a, 0.86)
      view.body.strokeRect(-radius - 3, -radius - 3, (radius + 3) * 2, (radius + 3) * 2)
    }
    this.drawEnemyDefense(view, enemy, radius)
    view.glyph
      .setText(glyph)
      .setFontSize(invulnerable ? (isBoss ? '17px' : '13px') : (isBoss ? '28px' : '20px'))
      .setColor(invulnerable ? '#fde68a' : isBoss ? '#fff7ed' : '#fecaca')
    view.bossBadge.setText(`王·${Math.max(1, enemy.bossPhase)}`).setVisible(isBoss)
    view.roleBadge.setText(invulnerable ? '护' : style.marker).setPosition(isBoss ? 15 : 10, isBoss ? 15 : 10)
    view.status.setY(isBoss ? -38 : -20)
    view.glyphValue = glyph
    view.entityKind = entityKind
    view.visualSignature = [glyph, entityKind, style.role, spawnProtected, invulnerable, enemy.bossPhase, enemy.armor ?? 0, enemy.magicResistance ?? 0].join(':')
    view.spawnProtected = spawnProtected
    view.invulnerable = invulnerable
  }

  private drawEnemySilhouette(graphics: Phaser.GameObjects.Graphics, silhouette: ReturnType<typeof enemyVisualStyle>['silhouette'], radius: number) {
    if (silhouette === 'circle') {
      graphics.fillCircle(0, 0, radius)
      graphics.strokeCircle(0, 0, radius)
      return
    }
    if (silhouette === 'diamond') {
      graphics.beginPath()
      graphics.moveTo(0, -radius - 2)
      graphics.lineTo(radius + 2, 0)
      graphics.lineTo(0, radius + 2)
      graphics.lineTo(-radius - 2, 0)
      graphics.closePath()
      graphics.fillPath()
      graphics.strokePath()
      return
    }
    if (silhouette === 'triangle') {
      graphics.fillTriangle(0, -radius - 3, radius + 3, radius + 2, -radius - 3, radius + 2)
      graphics.strokeTriangle(0, -radius - 3, radius + 3, radius + 2, -radius - 3, radius + 2)
      graphics.lineStyle(1, 0xf3ead5, 0.65)
      graphics.strokeCircle(0, 3, radius * 0.55)
      return
    }
    if (silhouette === 'cluster') {
      const childRadius = Math.max(6, radius * 0.62)
      graphics.fillCircle(-6, 4, childRadius)
      graphics.fillCircle(6, 4, childRadius)
      graphics.fillCircle(0, -6, childRadius)
      graphics.strokeCircle(-6, 4, childRadius)
      graphics.strokeCircle(6, 4, childRadius)
      graphics.strokeCircle(0, -6, childRadius)
      return
    }
    if (silhouette === 'rounded-square') {
      graphics.fillRoundedRect(-radius, -radius, radius * 2, radius * 2, 4)
      graphics.strokeRoundedRect(-radius, -radius, radius * 2, radius * 2, 4)
      return
    }
    const sides = silhouette === 'hexagon' ? 6 : 8
    graphics.beginPath()
    for (let index = 0; index < sides; index += 1) {
      const angle = -Math.PI / 2 + Math.PI * 2 * index / sides
      const x = Math.cos(angle) * (radius + (silhouette === 'octagon' ? 2 : 1))
      const y = Math.sin(angle) * (radius + (silhouette === 'octagon' ? 2 : 1))
      if (index === 0) graphics.moveTo(x, y)
      else graphics.lineTo(x, y)
    }
    graphics.closePath()
    graphics.fillPath()
    graphics.strokePath()
  }

  private drawBossPhaseCracks(graphics: Phaser.GameObjects.Graphics, radius: number, phase: number) {
    const cracks = Math.min(4, Math.max(0, phase - 1))
    if (cracks === 0) return
    graphics.lineStyle(2, phase >= 3 ? 0xd8b4fe : 0xf7c66a, 0.92)
    for (let index = 0; index < cracks; index += 1) {
      const angle = -0.8 + index * 1.25
      const edgeX = Math.cos(angle) * (radius - 2)
      const edgeY = Math.sin(angle) * (radius - 2)
      graphics.beginPath()
      graphics.moveTo(edgeX, edgeY)
      graphics.lineTo(edgeX * 0.58 + (index % 2 ? 3 : -3), edgeY * 0.58)
      graphics.lineTo(edgeX * 0.24, edgeY * 0.24)
      graphics.strokePath()
    }
  }

  private drawEnemyDefense(view: DetailedEnemyView, enemy: BattlefieldEnemyState, radius: number) {
    view.defense.clear()
    const armor = enemy.armor ?? 0
    const resistance = enemy.magicResistance ?? 0
    if (view.visualRole === 'armored' || armor > resistance + 2) {
      view.defense.lineStyle(3, 0xf0cf7b, 0.92)
      view.defense.strokeRect(-radius - 4, -7, 5, 14)
      view.defense.strokeRect(radius - 1, -7, 5, 14)
    }
    if (view.visualRole === 'mystic' || resistance > armor + 2) {
      view.defense.lineStyle(2, 0xd7c0ff, 0.9)
      view.defense.beginPath()
      view.defense.arc(0, 0, radius + 4, -Math.PI * 0.15, Math.PI * 0.45)
      view.defense.strokePath()
      view.defense.fillStyle(0xd7c0ff, 0.9)
      view.defense.fillTriangle(radius + 1, -5, radius + 6, -2, radius + 2, 2)
    }
    if (enemy.invulnerable) {
      view.defense.lineStyle(2, 0xf9e18b, 0.96)
      view.defense.lineBetween(-radius - 5, -radius - 1, -radius - 5, -4)
      view.defense.lineBetween(radius + 5, radius + 1, radius + 5, 4)
      view.defense.lineBetween(-radius - 5, radius + 1, -4, radius + 5)
      view.defense.lineBetween(radius + 5, -radius - 1, 4, -radius - 5)
    }
  }

  private drawEnemyStatusAura(view: DetailedEnemyView, signature: string) {
    view.statusAura.clear()
    if (!signature) return
    const radius = view.entityKind === 'boss' ? BOSS_BODY_RADIUS_PX + 7 : ENEMY_BODY_RADIUS_PX + 5
    if (/[晕定封]/.test(signature)) {
      view.statusAura.lineStyle(2, 0xfef08a, 0.9)
      view.statusAura.strokeCircle(0, 0, radius)
      view.statusAura.lineBetween(-radius * 0.7, -radius * 0.7, radius * 0.7, radius * 0.7)
      view.statusAura.lineBetween(radius * 0.7, -radius * 0.7, -radius * 0.7, radius * 0.7)
    }
    else if (signature.includes('缓')) {
      view.statusAura.lineStyle(3, 0x8ee3cf, 0.85)
      view.statusAura.beginPath()
      view.statusAura.arc(0, 0, radius, Math.PI * 0.15, Math.PI * 1.45)
      view.statusAura.strokePath()
    }
    if (signature.includes('破')) {
      view.statusAura.lineStyle(2, 0xf4a28c, 0.95)
      view.statusAura.lineBetween(-radius, -4, -3, 1)
      view.statusAura.lineBetween(radius, 4, 3, -1)
    }
  }

  private animateEnemySpawn(view: DetailedEnemyView, enemy: BattlefieldEnemyState) {
    if (this.presentationPreferences.reducedMotion) return
    const movement = enemyMoveProfile(enemy, this.presentationPreferences)
    view.container.setAlpha(0.15).setScale(view.visualRole === 'swarm' ? 0.45 : 0.68)
    this.tweens.add({
      targets: view.container,
      alpha: 1,
      scaleX: 1,
      scaleY: 1,
      duration: Math.max(90, movement.durationMs),
      ease: this.presentationPreferences.lowEffects ? 'Linear' : 'Back.Out',
    })
  }

  private drawEnemyHealth(view: DetailedEnemyView, hp: number, maxHp: number) {
    const ratio = maxHp > 0 ? Phaser.Math.Clamp(hp / maxHp, 0, 1) : 0
    const radius = view.entityKind === 'boss' ? BOSS_BODY_RADIUS_PX + 5 : ENEMY_BODY_RADIUS_PX
    const height = view.entityKind === 'boss' ? 6 : 4
    view.health.clear()
    view.health.fillStyle(0x020617, 0.95)
    view.health.fillRoundedRect(-radius, radius, radius * 2, height, 1)
    view.health.fillStyle(ratio > 0.4 ? 0x22c55e : ratio > 0.2 ? 0xf59e0b : 0xef4444, 1)
    view.health.fillRoundedRect(-radius, radius, radius * 2 * ratio, height, 1)
    view.hp = hp
    view.maxHp = maxHp
  }

  private renderUiState() {
    this.previewLayer.clear()
    for (const [pieceId, view] of this.pieceViews) {
      view.selection.clear()
      if (pieceId !== this.latestUiState.selectedPieceId) continue
      view.selection.fillStyle(0x67e8f9, 0.12)
      view.selection.fillRoundedRect(1, 1, BATTLEFIELD_CELL_SIZE - 2, BATTLEFIELD_CELL_SIZE - 2, 5)
      view.selection.lineStyle(3, 0x67e8f9, 1)
      view.selection.strokeRoundedRect(1, 1, BATTLEFIELD_CELL_SIZE - 2, BATTLEFIELD_CELL_SIZE - 2, 5)
    }
    const { hoveredCell, placementMode, canPreviewAtHoveredCell } = this.latestUiState
    if (!hoveredCell || !placementMode) return
    const x = gridToPixel(hoveredCell.x) + 2
    const y = gridToPixel(hoveredCell.y) + 2
    const color = canPreviewAtHoveredCell ? 0x22d3ee : 0xef4444
    this.previewLayer.fillStyle(color, canPreviewAtHoveredCell ? 0.18 : 0.1)
    this.previewLayer.fillRoundedRect(x, y, BATTLEFIELD_CELL_SIZE - 4, BATTLEFIELD_CELL_SIZE - 4, 4)
    this.previewLayer.lineStyle(2, color, 0.9)
    this.previewLayer.strokeRoundedRect(x, y, BATTLEFIELD_CELL_SIZE - 4, BATTLEFIELD_CELL_SIZE - 4, 4)
  }
}
