import Phaser from 'phaser'
import type { BattlefieldEnemyState, BattlefieldGridPosition, BattlefieldInteractionBridge, BattlefieldPieceState, BattlefieldSnapshot } from './battlefield-model'

export const BATTLEFIELD_DIMENSION = 29
export const BATTLEFIELD_CELL_SIZE = 32
export const BATTLEFIELD_SIZE = BATTLEFIELD_DIMENSION * BATTLEFIELD_CELL_SIZE

const CELL_GAP = 1
const ENTITY_INSET = 3
const ENEMY_TWEEN_MS = 220
const HAN_FONT = '"Noto Serif SC", "Songti SC", "STSong", serif'

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
}

interface EnemyView {
  container: Phaser.GameObjects.Container
  body: Phaser.GameObjects.Graphics
  glyph: Phaser.GameObjects.Text
  health: Phaser.GameObjects.Graphics
  glyphValue: string
  hp: number
  maxHp: number
  invulnerable: boolean
}

export interface BattlefieldSceneUiState {
  hoveredCell: BattlefieldGridPosition | null
  selectedPieceId: string | null
  placementMode: boolean
  canPreviewAtHoveredCell: boolean
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

function soldierColor(type?: string) {
  if (type === 'blade') return 0xfbbf24
  if (type === 'spear') return 0x34d399
  if (type === 'bow') return 0x60a5fa
  if (type === 'cavalry') return 0xc084fc
  return 0x67e8f9
}

export class BattlefieldScene extends Phaser.Scene {
  private readonly terrainMatrix: readonly (readonly number[])[]
  private readonly bridge: BattlefieldInteractionBridge
  private latestSnapshot: BattlefieldSnapshot | null = null
  private latestUiState: BattlefieldSceneUiState = { hoveredCell: null, selectedPieceId: null, placementMode: false, canPreviewAtHoveredCell: false }
  private terrainLayer!: Phaser.GameObjects.Graphics
  private previewLayer!: Phaser.GameObjects.Graphics
  private pieceLayer!: Phaser.GameObjects.Container
  private enemyLayer!: Phaser.GameObjects.Container
  private inputZone!: Phaser.GameObjects.Zone
  private readonly pieceViews = new Map<string, PieceView>()
  private readonly enemyViews = new Map<string, EnemyView>()
  private lastHoveredCellKey: string | null = null
  private pointerDownCell: BattlefieldGridPosition | null = null

  constructor(terrainMatrix: readonly (readonly number[])[], bridge: BattlefieldInteractionBridge) {
    super({ key: 'BattlefieldScene' })
    this.terrainMatrix = terrainMatrix
    this.bridge = bridge
  }

  create() {
    this.cameras.main.setBackgroundColor('#0b1121')
    this.terrainLayer = this.add.graphics()
    this.previewLayer = this.add.graphics().setDepth(10)
    this.pieceLayer = this.add.container(0, 0).setDepth(20)
    this.enemyLayer = this.add.container(0, 0).setDepth(30)
    this.inputZone = this.add.zone(0, 0, BATTLEFIELD_SIZE, BATTLEFIELD_SIZE).setOrigin(0).setDepth(100).setInteractive()
    this.drawTerrain()
    this.bindPointerInput()
    if (this.latestSnapshot) this.renderSnapshot(this.latestSnapshot)
    this.renderUiState()
  }

  setSnapshot(snapshot: BattlefieldSnapshot | null) {
    this.latestSnapshot = snapshot
    if (this.sys.isActive() && snapshot) this.renderSnapshot(snapshot)
  }

  setUiState(uiState: BattlefieldSceneUiState) {
    this.latestUiState = uiState
    if (this.sys.isActive()) this.renderUiState()
  }

  private drawTerrain() {
    const graphics = this.terrainLayer
    graphics.clear()
    graphics.fillStyle(0x0b1121, 1)
    graphics.fillRect(0, 0, BATTLEFIELD_SIZE, BATTLEFIELD_SIZE)
    for (let y = 0; y < BATTLEFIELD_DIMENSION; y += 1) {
      for (let x = 0; x < BATTLEFIELD_DIMENSION; x += 1) {
        const left = gridToPixel(x) + CELL_GAP
        const top = gridToPixel(y) + CELL_GAP
        const size = BATTLEFIELD_CELL_SIZE - CELL_GAP * 2
        const isGround = this.terrainMatrix[y]?.[x] === 1
        graphics.fillStyle(isGround ? 0x1a233a : 0x0f172a, 1)
        graphics.fillRoundedRect(left, top, size, size, 3)
        if (isGround) {
          graphics.lineStyle(1, 0xffffff, 0.05)
          graphics.strokeRoundedRect(left + 0.5, top + 0.5, size - 1, size - 1, 3)
        }
        if (isCoreCell(x, y)) {
          graphics.fillStyle(0xfb923c, 0.2)
          graphics.fillRoundedRect(left, top, size, size, 3)
          graphics.lineStyle(1, 0xfb923c, 0.45)
          graphics.strokeRoundedRect(left + 1, top + 1, size - 2, size - 2, 3)
        }
        else if (isProtectedZoneCell(x, y)) {
          graphics.fillStyle(0xfb923c, 0.035)
          graphics.fillRoundedRect(left, top, size, size, 3)
        }
        const gateLabel = GATE_LABELS.get(coordKey(x, y))
        if (gateLabel) this.add.text(left + size / 2, top + size / 2, gateLabel, { color: '#fb923c', fontFamily: 'ui-monospace, monospace', fontSize: '10px', fontStyle: 'bold' }).setOrigin(0.5).setAlpha(0.85).setDepth(5)
      }
    }
  }

  private bindPointerInput() {
    this.inputZone.on('pointermove', (_pointer: Phaser.Input.Pointer, localX: number, localY: number) => {
      const cell = this.positionToCell(localX, localY)
      const nextKey = cell ? coordKey(cell.x, cell.y) : null
      if (nextKey === this.lastHoveredCellKey) return
      this.lastHoveredCellKey = nextKey
      if (cell) this.bridge.onCellHover(cell.x, cell.y)
      else this.bridge.onCellLeave()
    })
    this.inputZone.on('pointerdown', (_pointer: Phaser.Input.Pointer, localX: number, localY: number) => {
      const cell = this.positionToCell(localX, localY)
      this.pointerDownCell = cell
      if (cell) this.bridge.onCellClick(cell.x, cell.y)
    })
    this.inputZone.on('pointerup', (_pointer: Phaser.Input.Pointer, localX: number, localY: number) => {
      const cell = this.positionToCell(localX, localY)
      const start = this.pointerDownCell
      this.pointerDownCell = null
      if (cell && start && (cell.x !== start.x || cell.y !== start.y)) {
        this.bridge.onCellClick(cell.x, cell.y)
      }
    })
    this.inputZone.on('pointerout', () => {
      this.lastHoveredCellKey = null
      this.pointerDownCell = null
      this.bridge.onCellLeave()
    })
  }

  private positionToCell(localX: number, localY: number): BattlefieldGridPosition | null {
    const x = Math.floor(localX / BATTLEFIELD_CELL_SIZE)
    const y = Math.floor(localY / BATTLEFIELD_CELL_SIZE)
    return x >= 0 && x < BATTLEFIELD_DIMENSION && y >= 0 && y < BATTLEFIELD_DIMENSION ? { x, y } : null
  }

  private renderSnapshot(snapshot: BattlefieldSnapshot) {
    this.syncPieces(snapshot.pieces)
    this.syncEnemies(snapshot.enemies)
    this.renderUiState()
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
      if (view.kind !== piece.kind || view.glyphValue !== piece.glyph || view.levelValue !== (piece.level ?? 0)) this.drawPiece(view, piece)
    }
  }

  private createPieceView(piece: BattlefieldPieceState): PieceView {
    const selection = this.add.graphics()
    const body = this.add.graphics()
    const glyph = this.add.text(BATTLEFIELD_CELL_SIZE / 2, BATTLEFIELD_CELL_SIZE / 2 - 1, '', { fontFamily: HAN_FONT, fontSize: '23px', fontStyle: 'bold' }).setOrigin(0.5)
    const level = this.add.text(BATTLEFIELD_CELL_SIZE - 5, BATTLEFIELD_CELL_SIZE - 4, '', { fontFamily: 'ui-monospace, monospace', fontSize: '8px', fontStyle: 'bold', backgroundColor: '#020617', padding: { x: 2, y: 0 } }).setOrigin(1)
    const container = this.add.container(gridToPixel(piece.x), gridToPixel(piece.y), [selection, body, glyph, level])
    this.pieceLayer.add(container)
    const view: PieceView = { container, body, selection, glyph, level, kind: '', glyphValue: '', levelValue: -1 }
    this.drawPiece(view, piece)
    return view
  }

  private drawPiece(view: PieceView, piece: BattlefieldPieceState) {
    const size = BATTLEFIELD_CELL_SIZE - ENTITY_INSET * 2
    const color = piece.kind === 'character' ? 0xfb7185 : soldierColor(piece.soldierType)
    view.body.clear()
    view.body.fillStyle(0x07111f, 0.94)
    view.body.fillRoundedRect(ENTITY_INSET, ENTITY_INSET, size, size, 5)
    view.body.lineStyle(2, color, 0.95)
    view.body.strokeRoundedRect(ENTITY_INSET + 1, ENTITY_INSET + 1, size - 2, size - 2, 5)
    view.glyph.setText(piece.glyph).setColor(Phaser.Display.Color.IntegerToColor(color).rgba)
    view.level.setText(piece.kind === 'soldier' ? `${piece.level ?? 1}` : '').setVisible(piece.kind === 'soldier')
    view.kind = piece.kind
    view.glyphValue = piece.glyph
    view.levelValue = piece.level ?? 0
  }

  private syncEnemies(enemies: BattlefieldEnemyState[]) {
    const activeIds = new Set(enemies.map((enemy) => enemy.entityId))
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
      if (!view) {
        view = this.createEnemyView(enemy, targetX, targetY)
        this.enemyViews.set(enemy.entityId, view)
      } else {
        this.tweens.killTweensOf(view.container)
        this.tweens.add({ targets: view.container, x: targetX, y: targetY, duration: ENEMY_TWEEN_MS, ease: 'Linear' })
      }
      if (view.glyphValue !== enemy.glyph || view.invulnerable !== Boolean(enemy.invulnerable)) {
        this.drawEnemyBody(view, enemy.glyph, Boolean(enemy.invulnerable))
      }
      if (view.hp !== enemy.hp || view.maxHp !== enemy.maxHp) this.drawEnemyHealth(view, enemy.hp, enemy.maxHp)
    }
  }

  private createEnemyView(enemy: BattlefieldEnemyState, x: number, y: number): EnemyView {
    const body = this.add.graphics()
    const glyph = this.add.text(0, -1, '', { color: '#fecaca', fontFamily: HAN_FONT, fontSize: '20px', fontStyle: 'bold', stroke: '#450a0a', strokeThickness: 2 }).setOrigin(0.5)
    const health = this.add.graphics()
    const container = this.add.container(x, y, [body, glyph, health])
    this.enemyLayer.add(container)
    const view: EnemyView = { container, body, glyph, health, glyphValue: '', hp: Number.NaN, maxHp: Number.NaN, invulnerable: false }
    this.drawEnemyBody(view, enemy.glyph, Boolean(enemy.invulnerable))
    this.drawEnemyHealth(view, enemy.hp, enemy.maxHp)
    return view
  }

  private drawEnemyBody(view: EnemyView, glyph: string, invulnerable: boolean) {
    view.body.clear()
    view.body.fillStyle(invulnerable ? 0x78350f : 0x7f1d1d, 0.62)
    view.body.fillCircle(0, 0, 13)
    view.body.lineStyle(invulnerable ? 2 : 1, invulnerable ? 0xfbbf24 : 0xf87171, 0.9)
    view.body.strokeCircle(0, 0, 13)
    view.glyph.setText(invulnerable ? `护${glyph}` : glyph).setFontSize(invulnerable ? '13px' : '20px')
    view.glyphValue = glyph
    view.invulnerable = invulnerable
  }

  private drawEnemyHealth(view: EnemyView, hp: number, maxHp: number) {
    const ratio = maxHp > 0 ? Phaser.Math.Clamp(hp / maxHp, 0, 1) : 0
    view.health.clear()
    view.health.fillStyle(0x020617, 0.95)
    view.health.fillRoundedRect(-13, 13, 26, 4, 1)
    view.health.fillStyle(ratio > 0.4 ? 0x22c55e : ratio > 0.2 ? 0xf59e0b : 0xef4444, 1)
    view.health.fillRoundedRect(-13, 13, 26 * ratio, 4, 1)
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
