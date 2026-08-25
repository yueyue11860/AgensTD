import Phaser from 'phaser'
import type { BattlefieldEnemyState } from './battlefield-model'
import type { ActiveSynergyPresentationLink, BattlefieldPresentationCue, PresentationPoint, SoldierPresentationStyle } from '../presentation/combat-presentation-adapter'
import { buildGeneralActionPath, generalManifestationRecipe, isMoonPalaceSynergy } from '../presentation/general-manifestation'
import {
  telegraphProgress,
  withinPresentationBudget,
} from '../presentation/enemy-visual-language'

const HAN_FONT = '"Noto Serif SC", "Songti SC", "STSong", serif'
const MAX_GRAPHICS_POOL = 48
const MAX_TEXT_POOL = 18

export interface BattlefieldPresentationPreferences {
  reducedMotion: boolean
  lowEffects: boolean
}

interface BattlefieldPresentationHost {
  flashEnemy: (entityId: string, durationMs: number) => void
}

function pixel(point: PresentationPoint): { x: number, y: number } {
  return { x: point.x * 32, y: point.y * 32 }
}

function angleBetween(source: PresentationPoint, target: PresentationPoint): number {
  return Math.atan2(target.y - source.y, target.x - source.x)
}

/**
 * Phaser 专用表现导演。所有对象均从池中借出并在 tween 完成后归还；
 * 它只解释 cue，不参与任何伤害或坐标结算。
 */
export class BattlefieldPresentationDirector {
  private readonly scene: Phaser.Scene
  private readonly host: BattlefieldPresentationHost
  private readonly effectLayer: Phaser.GameObjects.Container
  private readonly climaxLayer: Phaser.GameObjects.Container
  private readonly telegraphGraphics: Phaser.GameObjects.Graphics
  private readonly telegraphLabels = new Map<string, Phaser.GameObjects.Text>()
  private readonly graphicsPool: Phaser.GameObjects.Graphics[] = []
  private readonly textPool: Phaser.GameObjects.Text[] = []
  private readonly leasedGraphics = new Set<Phaser.GameObjects.Graphics>()
  private readonly leasedTexts = new Set<Phaser.GameObjects.Text>()
  private readonly synergyLinkGraphics = new Map<string, Phaser.GameObjects.Graphics>()
  private readonly synergyLinkLabels = new Map<string, Phaser.GameObjects.Text>()
  private preferences: BattlefieldPresentationPreferences = { reducedMotion: false, lowEffects: false }

  constructor(scene: Phaser.Scene, host: BattlefieldPresentationHost) {
    this.scene = scene
    this.host = host
    this.effectLayer = scene.add.container(0, 0).setDepth(50)
    this.climaxLayer = scene.add.container(0, 0).setDepth(90)
    this.telegraphGraphics = scene.add.graphics().setDepth(85)
  }

  setPreferences(preferences: BattlefieldPresentationPreferences): void {
    this.preferences = preferences
  }

  diagnostics() {
    return {
      activeVfxObjects: this.leasedGraphics.size + this.leasedTexts.size + this.telegraphLabels.size
        + this.synergyLinkGraphics.size + this.synergyLinkLabels.size,
      pooledVfxObjects: this.graphicsPool.length + this.textPool.length,
      telegraphLabels: this.telegraphLabels.size,
    }
  }

  play(cues: readonly BattlefieldPresentationCue[]): void {
    for (const cue of withinPresentationBudget(cues, this.preferences)) {
      switch (cue.kind) {
        case 'attack':
          this.playAttack(cue.style, cue.source, cue.targets, cue.detail === 'full' ? 1 : 0.58)
          break
        case 'damage':
          this.playDamage(cue)
          break
        case 'death':
          this.playInkDeath(cue.target, cue.isBoss ? 12 : 7, cue.isBoss)
          break
        case 'summon':
          this.playSealPulse(cue.target, 0x34d399, '召灵', cue.detail)
          break
        case 'merge':
          this.playSealPulse(cue.target, 0x60a5fa, `合·${cue.level}`, cue.detail)
          break
        case 'general-formed':
          this.playGeneralFormation(cue)
          break
        case 'general-state':
          this.playGeneralState(cue)
          break
        case 'general-action':
          this.playGeneralAction(cue)
          break
        case 'general-status':
          this.playGeneralStatus(cue)
          break
        case 'synergy':
          this.playSynergyChange(cue)
          break
        case 'wave-start':
          this.playWaveTitle(cue.waveNumber, cue.label, cue.detail)
          break
        case 'boss-spawn':
          this.playBossTitle(cue.target, `${cue.label} · 降临`, 0xfbbf24, cue.detail)
          break
        case 'boss-warning':
          this.playBossTitle(cue.target, `⚠ ${cue.label}`, 0xf87171, cue.detail)
          break
        case 'boss-phase':
          this.playBossTitle(cue.target, `妖王 · 第${cue.phase}相`, 0xfb923c, cue.detail)
          this.playSealPulse(cue.target, 0xfb923c, `相${cue.phase}`, cue.detail)
          break
        case 'boss-death':
          this.playInkDeath(cue.target, 18, true)
          this.playBossTitle(cue.target, `${cue.label} · 伏诛`, 0xfde68a, cue.detail)
          if (!this.preferences.reducedMotion && !this.preferences.lowEffects && cue.detail !== 'result') {
            this.scene.cameras.main.shake(140, 0.004)
          }
          break
      }
    }
  }

  syncSynergyLinks(links: readonly ActiveSynergyPresentationLink[]): void {
    const active = new Set<string>()
    for (const link of links) {
      if (!isMoonPalaceSynergy(link.synergyId) || link.memberPoints.length < 2) continue
      active.add(link.synergyId)
      let graphics = this.synergyLinkGraphics.get(link.synergyId)
      if (!graphics) {
        graphics = this.scene.add.graphics().setDepth(41)
        this.synergyLinkGraphics.set(link.synergyId, graphics)
      }
      graphics.clear()
      const points = link.memberPoints.map(pixel)
      const alpha = this.preferences.reducedMotion ? 0.38 : this.preferences.lowEffects ? 0.46 : 0.58
      graphics.lineStyle(this.preferences.lowEffects ? 1 : 2, 0xd8ecff, alpha)
      for (let index = 1; index < points.length; index += 1) graphics.lineBetween(points[index - 1]!.x, points[index - 1]!.y, points[index]!.x, points[index]!.y)
      for (const point of points) {
        graphics.fillStyle(0xeaf6ff, alpha * 0.42)
        graphics.fillCircle(point.x, point.y, 8)
        graphics.lineStyle(1, 0xf5f3ff, alpha)
        graphics.strokeCircle(point.x, point.y, 11)
      }
      const center = {
        x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
        y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
      }
      let label = this.synergyLinkLabels.get(link.synergyId)
      if (!label) {
        label = this.scene.add.text(0, 0, '月', { color: '#eaf6ff', fontFamily: HAN_FONT, fontSize: '11px', fontStyle: 'bold', backgroundColor: '#17213ccc', padding: { x: 4, y: 2 }, stroke: '#111827', strokeThickness: 2 }).setOrigin(0.5).setDepth(42)
        this.synergyLinkLabels.set(link.synergyId, label)
      }
      label.setText(link.level > 1 ? `月·${link.level}` : '月').setPosition(center.x, center.y)
    }
    for (const [synergyId, graphics] of this.synergyLinkGraphics) {
      if (active.has(synergyId)) continue
      graphics.destroy()
      this.synergyLinkGraphics.delete(synergyId)
      this.synergyLinkLabels.get(synergyId)?.destroy()
      this.synergyLinkLabels.delete(synergyId)
    }
  }

  renderBossTelegraphs(enemies: readonly BattlefieldEnemyState[], tick: number, tickRateMs?: number): void {
    this.telegraphGraphics.clear()
    const activeIds = new Set<string>()
    for (const enemy of enemies) {
      if (enemy.entityKind !== 'boss' || !enemy.activeCast) continue
      activeIds.add(enemy.entityId)
      const center = pixel({ x: enemy.x + 0.5, y: enemy.y + 0.5 })
      const { progress, remainingTicks } = telegraphProgress(enemy.activeCast.startedAtTick, enemy.activeCast.executeAtTick, tick)
      const geometry = enemy.activeCast.geometry
      const fillAlpha = this.preferences.reducedMotion ? 0.06 : this.preferences.lowEffects ? 0.09 : 0.15

      if (geometry?.kind === 'corridor') {
        const from = { x: geometry.from.xMilli / 1000 * 32, y: geometry.from.yMilli / 1000 * 32 }
        const to = { x: geometry.to.xMilli / 1000 * 32, y: geometry.to.yMilli / 1000 * 32 }
        const dx = to.x - from.x
        const dy = to.y - from.y
        const magnitude = Math.hypot(dx, dy) || 1
        const width = geometry.halfWidthMilliCells / 1000 * 32
        const ox = -dy / magnitude * width
        const oy = dx / magnitude * width
        const corridor = [
          { x: from.x + ox, y: from.y + oy },
          { x: to.x + ox, y: to.y + oy },
          { x: to.x - ox, y: to.y - oy },
          { x: from.x - ox, y: from.y - oy },
        ].map((entry) => new Phaser.Math.Vector2(entry.x, entry.y))
        this.telegraphGraphics.fillStyle(0x8f2f2a, fillAlpha)
        this.telegraphGraphics.fillPoints(corridor, true)
        this.telegraphGraphics.lineStyle(2, 0xf2c45c, 0.88)
        this.telegraphGraphics.strokePoints(corridor, true)
      }
      else if (geometry?.kind === 'circle') {
        const at = { x: geometry.xMilli / 1000 * 32, y: geometry.yMilli / 1000 * 32 }
        const radius = geometry.radiusMilliCells / 1000 * 32
        this.telegraphGraphics.fillStyle(0x8f2f2a, fillAlpha)
        this.telegraphGraphics.fillCircle(at.x, at.y, radius)
        this.telegraphGraphics.lineStyle(2, 0xf2c45c, 0.88)
        this.telegraphGraphics.strokeCircle(at.x, at.y, radius)
      }
      else if (geometry?.kind === 'polyline' && geometry.points.length > 0) {
        const points = geometry.points.map((entry) => new Phaser.Math.Vector2(entry.xMilli / 1000 * 32, entry.yMilli / 1000 * 32))
        this.telegraphGraphics.lineStyle(2, 0xf2c45c, 0.88)
        this.telegraphGraphics.strokePoints(points, false)
        for (const point of points.slice(1)) this.telegraphGraphics.strokeCircle(point.x, point.y, 16)
      }
      else {
        // Legacy/malformed casts get a source-only marker. Never infer an impacted area.
        const at = geometry?.kind === 'point'
          ? { x: geometry.xMilli / 1000 * 32, y: geometry.yMilli / 1000 * 32 }
          : center
        this.telegraphGraphics.fillStyle(0x8f2f2a, fillAlpha)
        this.telegraphGraphics.fillCircle(at.x, at.y, 22)
        this.telegraphGraphics.lineStyle(2, 0xf2c45c, 0.88)
        this.telegraphGraphics.strokeCircle(at.x, at.y, 22)
      }

      this.telegraphGraphics.lineStyle(3, 0xfbbf24, 0.8)
      this.telegraphGraphics.strokeCircle(center.x, center.y, 30)
      this.telegraphGraphics.lineStyle(this.preferences.lowEffects ? 3 : 5, 0xef6b55, 0.98)
      this.telegraphGraphics.beginPath()
      this.telegraphGraphics.arc(center.x, center.y, 39, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (this.preferences.reducedMotion ? 1 : progress))
      this.telegraphGraphics.strokePath()

      let label = this.telegraphLabels.get(enemy.entityId)
      if (!label) {
        label = this.scene.add.text(0, 0, '', {
          color: '#fff7ed',
          fontFamily: HAN_FONT,
          fontSize: '12px',
          fontStyle: 'bold',
          backgroundColor: '#7f1d1d',
          padding: { x: 7, y: 3 },
          stroke: '#450a0a',
          strokeThickness: 2,
        }).setOrigin(0.5).setDepth(88)
        this.telegraphLabels.set(enemy.entityId, label)
      }
      const countdown = tickRateMs && tickRateMs > 0
        ? `${(remainingTicks * tickRateMs / 1000).toFixed(1)}秒`
        : `${remainingTicks}拍`
      const shapeLabel = geometry?.kind === 'corridor' ? '走廊'
        : geometry?.kind === 'circle' ? '环形'
          : geometry?.kind === 'polyline' ? '路径' : geometry?.kind === 'point' ? '落点' : '警戒'
      label.setText(`${shapeLabel} · ${enemy.activeCast.skillName} · ${countdown}`).setPosition(center.x, center.y - 54).setVisible(true)
    }
    for (const [entityId, label] of this.telegraphLabels) {
      if (activeIds.has(entityId)) continue
      label.destroy()
      this.telegraphLabels.delete(entityId)
    }
  }

  destroy(): void {
    for (const object of this.leasedGraphics) {
      this.scene.tweens.killTweensOf(object)
      object.destroy()
    }
    for (const object of this.graphicsPool) object.destroy()
    for (const object of this.leasedTexts) {
      this.scene.tweens.killTweensOf(object)
      object.destroy()
    }
    for (const object of this.textPool) object.destroy()
    for (const label of this.telegraphLabels.values()) label.destroy()
    this.telegraphLabels.clear()
    for (const graphics of this.synergyLinkGraphics.values()) graphics.destroy()
    for (const label of this.synergyLinkLabels.values()) label.destroy()
    this.synergyLinkGraphics.clear()
    this.synergyLinkLabels.clear()
    this.telegraphGraphics.destroy()
    this.effectLayer.destroy()
    this.climaxLayer.destroy()
    this.leasedGraphics.clear()
    this.leasedTexts.clear()
    this.graphicsPool.length = 0
    this.textPool.length = 0
  }

  private borrowGraphics(climax = false): Phaser.GameObjects.Graphics {
    const graphics = this.graphicsPool.pop() ?? this.scene.add.graphics()
    graphics.clear().setVisible(true).setActive(true).setAlpha(1).setScale(1).setAngle(0)
    const layer = climax ? this.climaxLayer : this.effectLayer
    if (graphics.parentContainer !== layer) layer.add(graphics)
    this.leasedGraphics.add(graphics)
    return graphics
  }

  private releaseGraphics(graphics: Phaser.GameObjects.Graphics): void {
    if (!this.leasedGraphics.delete(graphics) || !graphics.scene) return
    this.scene.tweens.killTweensOf(graphics)
    graphics.clear().setVisible(false).setActive(false).setPosition(0, 0).setScale(1).setAlpha(1)
    if (this.graphicsPool.length >= MAX_GRAPHICS_POOL) graphics.destroy()
    else this.graphicsPool.push(graphics)
  }

  private borrowText(climax = false): Phaser.GameObjects.Text {
    const text = this.textPool.pop() ?? this.scene.add.text(0, 0, '', { fontFamily: HAN_FONT }).setOrigin(0.5)
    text.setVisible(true).setActive(true).setAlpha(1).setScale(1).setAngle(0).setOrigin(0.5)
    const layer = climax ? this.climaxLayer : this.effectLayer
    if (text.parentContainer !== layer) layer.add(text)
    this.leasedTexts.add(text)
    return text
  }

  private releaseText(text: Phaser.GameObjects.Text): void {
    if (!this.leasedTexts.delete(text) || !text.scene) return
    this.scene.tweens.killTweensOf(text)
    text.setVisible(false).setActive(false).setText('').setPosition(0, 0).setScale(1).setAlpha(1)
    if (this.textPool.length >= MAX_TEXT_POOL) text.destroy()
    else this.textPool.push(text)
  }

  private duration(ms: number): number {
    if (this.preferences.reducedMotion) return 1
    return this.preferences.lowEffects ? Math.max(40, Math.floor(ms * 0.55)) : ms
  }

  private playGeneralFormation(cue: Extract<BattlefieldPresentationCue, { kind: 'general-formed' }>): void {
    const recipe = generalManifestationRecipe(cue.generalId)
    const color = recipe.color
    const center = pixel(cue.target)
    const members = (cue.memberPoints?.length ? cue.memberPoints : [cue.target]).map(pixel)
    const ink = this.borrowGraphics(true)
    ink.lineStyle(3, color, 0.92)
    for (const member of members) ink.lineBetween(member.x, member.y, center.x, center.y)
    for (const member of members) {
      ink.fillStyle(color, 0.18)
      ink.fillCircle(member.x, member.y, 16)
      ink.lineStyle(2, recipe.accent, 0.88)
      ink.strokeCircle(member.x, member.y, 14)
    }
    const seal = this.borrowGraphics(true)
    seal.setPosition(center.x, center.y).setScale(0.5)
    seal.fillStyle(color, 0.14)
    seal.fillCircle(0, 0, 33)
    seal.lineStyle(4, color, 0.95)
    seal.strokeCircle(0, 0, 31)
    seal.lineStyle(1, recipe.accent, 0.72)
    seal.strokeRect(-21, -21, 42, 42)
    const title = this.borrowText(true)
    title.setText(`${cue.label} · 显圣`).setStyle({ color: Phaser.Display.Color.IntegerToColor(recipe.accent).rgba, fontFamily: HAN_FONT, fontSize: '22px', fontStyle: 'bold', backgroundColor: '#111827dd', padding: { x: 10, y: 5 }, stroke: '#2a1b08', strokeThickness: 4 }).setPosition(center.x, center.y - 40)
    const hold = cue.detail === 'full' ? 760 : 420
    if (this.preferences.reducedMotion || cue.detail === 'result') {
      this.scene.time.delayedCall(520, () => { this.releaseGraphics(ink); this.releaseGraphics(seal); this.releaseText(title) })
      return
    }
    this.scene.tweens.add({ targets: ink, alpha: 0, delay: this.duration(hold * 0.45), duration: this.duration(hold * 0.55), onComplete: () => this.releaseGraphics(ink) })
    this.scene.tweens.add({ targets: seal, scaleX: 1.35, scaleY: 1.35, alpha: 0, duration: this.duration(hold), ease: 'Back.Out', onComplete: () => this.releaseGraphics(seal) })
    this.scene.tweens.add({ targets: title, y: center.y - 66, alpha: 0, delay: this.duration(hold * 0.4), duration: this.duration(hold * 0.6), ease: 'Cubic.Out', onComplete: () => this.releaseText(title) })
  }

  private playGeneralState(cue: Extract<BattlefieldPresentationCue, { kind: 'general-state' }>): void {
    const recipe = generalManifestationRecipe(cue.generalId)
    const label = cue.state === 'fixed' ? '定阵' : cue.state === 'unfixed' ? '解阵' : '散将'
    const color = cue.state === 'fixed' ? recipe.color : 0x94a3b8
    this.playSealPulse(cue.target, color, label, cue.detail, false)
  }

  private playGeneralAction(cue: Extract<BattlefieldPresentationCue, { kind: 'general-action' }>): void {
    const path = buildGeneralActionPath(cue.source, cue.targets)
    if (path.targets.length === 0) return
    if (cue.geometry?.kind === 'corridor') this.playAuthoritativeCorridor(cue.geometry)
    if (cue.visual === 'sun-arrow') this.playSunArrow(cue, path.targets)
    else if (cue.visual === 'three-point-blade') this.playThreePointBlade(cue, path.targets)
    else this.playAttack('general', cue.source, path.targets, cue.detail === 'full' ? 1 : 0.58)
  }

  private playAuthoritativeCorridor(geometry: Extract<NonNullable<Extract<BattlefieldPresentationCue,
    { kind: 'general-action' }>['geometry']>, { kind: 'corridor' }>): void {
    const from = { x: geometry.from.xMilli / 1000 * 32, y: geometry.from.yMilli / 1000 * 32 }
    const to = { x: geometry.to.xMilli / 1000 * 32, y: geometry.to.yMilli / 1000 * 32 }
    const dx = to.x - from.x
    const dy = to.y - from.y
    const magnitude = Math.hypot(dx, dy) || 1
    const width = geometry.halfWidthMilliCells / 1000 * 32
    const ox = -dy / magnitude * width
    const oy = dx / magnitude * width
    const points = [
      { x: from.x + ox, y: from.y + oy },
      { x: to.x + ox, y: to.y + oy },
      { x: to.x - ox, y: to.y - oy },
      { x: from.x - ox, y: from.y - oy },
    ].map((entry) => new Phaser.Math.Vector2(entry.x, entry.y))
    const graphics = this.borrowGraphics(false)
    graphics.fillStyle(0x70a5d8, this.preferences.reducedMotion ? 0.08 : 0.14)
    graphics.fillPoints(points, true)
    graphics.lineStyle(this.preferences.lowEffects ? 1 : 2, 0xd9ecff, 0.82)
    graphics.strokePoints(points, true)
    const hold = this.preferences.reducedMotion ? 360 : this.preferences.lowEffects ? 260 : 520
    this.scene.tweens.add({ targets: graphics, alpha: 0, duration: this.duration(hold), onComplete: () => this.releaseGraphics(graphics) })
  }

  private playSunArrow(cue: Extract<BattlefieldPresentationCue, { kind: 'general-action' }>, targets: readonly PresentationPoint[]): void {
    const from = pixel(cue.source)
    const full = cue.actionKind === 'skill' && cue.detail === 'full' && !this.preferences.lowEffects && !this.preferences.reducedMotion
    const windup = this.borrowGraphics(full)
    windup.setPosition(from.x, from.y)
    windup.lineStyle(full ? 4 : 2, 0xf6c453, 0.95)
    windup.beginPath(); windup.arc(0, 0, full ? 22 : 15, -Math.PI / 2, Math.PI / 2); windup.strokePath()
    windup.lineBetween(0, full ? -22 : -15, 0, full ? 22 : 15)
    windup.fillStyle(0xffc928, full ? 0.24 : 0.14)
    windup.fillCircle(-9, 0, full ? 15 : 9)
    windup.lineStyle(2, 0xfff3b0, 0.8)
    windup.strokeCircle(-9, 0, full ? 17 : 11)
    const label = this.borrowText(full)
    label.setText(full ? `金乌 · ${cue.skillName}` : '后羿·引弦').setStyle({ color: '#fff3b0', fontFamily: HAN_FONT, fontSize: full ? '18px' : '11px', fontStyle: 'bold', stroke: '#3b2505', strokeThickness: 3 }).setPosition(from.x, from.y - 30)
    const windupMs = this.preferences.reducedMotion ? 0 : full ? 170 : 70
    this.scene.time.delayedCall(this.duration(windupMs), () => {
      this.releaseGraphics(windup)
      this.releaseText(label)
      for (const target of targets.slice(0, this.preferences.lowEffects ? 1 : 6)) {
        const to = pixel(target)
        const arrow = this.borrowGraphics(full)
        arrow.lineStyle(full ? 5 : 3, 0xffd76a, 0.98)
        arrow.lineBetween(from.x, from.y, to.x, to.y)
        if (full) {
          arrow.lineStyle(2, 0xff8f1f, 0.52)
          arrow.lineBetween(from.x - 5, from.y + 4, to.x - 5, to.y + 4)
        }
        const sun = this.borrowGraphics(full)
        sun.setPosition(to.x, to.y)
        sun.fillStyle(0xffc928, 0.28); sun.fillCircle(0, 0, full ? 16 : 10)
        sun.lineStyle(2, 0xfff3b0, 0.9); sun.strokeCircle(0, 0, full ? 18 : 12)
        const travel = this.preferences.reducedMotion ? 260 : full ? 420 : 210
        if (this.preferences.reducedMotion) {
          this.scene.time.delayedCall(420, () => { this.releaseGraphics(arrow); this.releaseGraphics(sun) })
          continue
        }
        this.scene.tweens.add({ targets: [arrow, sun], alpha: 0, delay: this.duration(travel * 0.45), duration: this.duration(travel * 0.55), onComplete: () => { this.releaseGraphics(arrow); this.releaseGraphics(sun) } })
      }
    })
  }

  private playThreePointBlade(cue: Extract<BattlefieldPresentationCue, { kind: 'general-action' }>, targets: readonly PresentationPoint[]): void {
    const from = pixel(cue.source)
    const full = cue.actionKind === 'skill' && cue.detail === 'full' && !this.preferences.lowEffects && !this.preferences.reducedMotion
    const windup = this.borrowGraphics(full)
    windup.setPosition(from.x, from.y)
    windup.lineStyle(full ? 4 : 2, 0x8bd3dd, 0.95)
    windup.lineBetween(-18, 0, 16, 0)
    windup.lineBetween(5, 0, 16, -8)
    windup.lineBetween(5, 0, 16, 8)
    const label = this.borrowText(full)
    label.setText(full ? cue.skillName : '杨戬·蓄锋').setStyle({ color: '#e6fbff', fontFamily: HAN_FONT, fontSize: full ? '18px' : '11px', fontStyle: 'bold', stroke: '#0b2630', strokeThickness: 3 }).setPosition(from.x, from.y - 27)
    this.scene.time.delayedCall(this.duration(full ? 130 : 60), () => {
      this.releaseGraphics(windup); this.releaseText(label)
      for (const target of targets.slice(0, this.preferences.lowEffects ? 1 : 6)) {
        const to = pixel(target)
        const slash = this.borrowGraphics(full)
        slash.lineStyle(full ? 5 : 3, 0xa5f3fc, 0.96)
        slash.lineBetween(from.x, from.y, to.x, to.y)
        if (full) {
          const angle = Math.atan2(to.y - from.y, to.x - from.x)
          const nx = Math.cos(angle + Math.PI / 2) * 8
          const ny = Math.sin(angle + Math.PI / 2) * 8
          slash.lineStyle(2, 0xe6fbff, 0.72)
          slash.lineBetween(from.x + nx, from.y + ny, to.x + nx, to.y + ny)
          slash.lineBetween(from.x - nx, from.y - ny, to.x - nx, to.y - ny)
        }
        if (this.preferences.reducedMotion) {
          this.scene.time.delayedCall(420, () => this.releaseGraphics(slash))
          continue
        }
        this.scene.tweens.add({ targets: slash, alpha: 0, scaleX: 1.05, scaleY: 1.05, duration: this.duration(full ? 360 : 190), ease: 'Cubic.Out', onComplete: () => this.releaseGraphics(slash) })
      }
    })
  }

  private playGeneralStatus(cue: Extract<BattlefieldPresentationCue, { kind: 'general-status' }>): void {
    if (cue.generalId === 'yangjian' && cue.statusId === 'armor_break') {
      this.playSealPulse(cue.target, 0x8bd3dd, '破甲', cue.detail)
    }
  }

  private playSynergyChange(cue: Extract<BattlefieldPresentationCue, { kind: 'synergy' }>): void {
    if (isMoonPalaceSynergy(cue.synergyId)) {
      const label = cue.state === 'deactivated' ? '月缘渐隐' : cue.state === 'upgraded' ? `月宫旧侣·${cue.level ?? 1}阶` : '月宫旧侣'
      const color = cue.state === 'deactivated' ? 0x64748b : 0xd8ecff
      if (cue.memberPoints && cue.memberPoints.length >= 2) {
        const line = this.borrowGraphics(true)
        const points = cue.memberPoints.map(pixel)
        line.lineStyle(cue.state === 'deactivated' ? 1 : 3, color, 0.9)
        for (let index = 1; index < points.length; index += 1) line.lineBetween(points[index - 1]!.x, points[index - 1]!.y, points[index]!.x, points[index]!.y)
        this.scene.tweens.add({ targets: line, alpha: 0, duration: this.duration(cue.state === 'deactivated' ? 520 : 760), onComplete: () => this.releaseGraphics(line) })
      }
      this.playSealPulse(cue.target, color, label, cue.detail, true)
      return
    }
    this.playSealPulse(cue.target, 0xc084fc, cue.state === 'deactivated' ? '羁绊消退' : '羁绊共鸣', cue.detail, true)
  }

  private playAttack(style: SoldierPresentationStyle, source: PresentationPoint, targets: readonly PresentationPoint[], scale: number): void {
    const targetLimit = this.preferences.lowEffects ? 1 : 3
    const windupMs = scale >= 1 ? (style === 'bow' ? 60 : 45) : 20
    this.playWindup(style, source, scale, windupMs)
    this.scene.time.delayedCall(this.duration(windupMs), () => {
      for (const target of targets.slice(0, targetLimit)) {
        if (style === 'blade') this.playBlade(source, target, scale)
        else if (style === 'spear') this.playSpear(source, target, scale)
        else if (style === 'bow') this.playBow(source, target, scale)
        else if (style === 'cavalry') this.playCavalry(source, target, scale)
        else this.playGeneralProjectile(source, target, scale)
      }
    })
  }

  private playWindup(style: SoldierPresentationStyle, source: PresentationPoint, scale: number, windupMs: number): void {
    const at = pixel(source)
    const ink = this.borrowGraphics()
    const color = style === 'blade' ? 0xe2e8f0 : style === 'spear' ? 0x7dd3fc : style === 'bow' ? 0xfde68a : style === 'cavalry' ? 0xf59e0b : 0xc084fc
    ink.setPosition(at.x, at.y).setScale(0.55)
    ink.lineStyle(2, color, 0.8)
    if (style === 'blade' || style === 'bow') {
      ink.beginPath()
      if (style === 'blade') ink.arc(0, 0, 15 * scale, Math.PI * 0.7, Math.PI * 1.7)
      else ink.arc(0, 0, 14 * scale, -Math.PI / 2, Math.PI / 2)
      ink.strokePath()
    }
    else if (style === 'spear') ink.lineBetween(-13 * scale, 0, 13 * scale, 0)
    else if (style === 'cavalry') {
      ink.lineBetween(-12, -5, 0, 0)
      ink.lineBetween(-12, 5, 0, 0)
    }
    else ink.strokeCircle(0, 0, 11 * scale)
    this.scene.tweens.add({ targets: ink, scaleX: 1, scaleY: 1, alpha: 0.15, duration: this.duration(windupMs), ease: 'Quad.In', onComplete: () => this.releaseGraphics(ink) })
  }

  private playBlade(source: PresentationPoint, target: PresentationPoint, scale: number): void {
    const at = pixel(source)
    const angle = angleBetween(source, target)
    const slash = this.borrowGraphics()
    slash.setPosition(at.x, at.y).setRotation(angle)
    slash.lineStyle(4, 0xf8fafc, 0.95)
    slash.beginPath()
    slash.arc(0, 0, 22 * scale, -0.9, 0.9)
    slash.strokePath()
    slash.lineStyle(2, 0x94a3b8, 0.65)
    slash.beginPath()
    slash.arc(0, 0, 17 * scale, -0.75, 0.75)
    slash.strokePath()
    this.scene.tweens.add({ targets: slash, rotation: angle + 0.42, scaleX: 1.22, scaleY: 1.22, alpha: 0, duration: this.duration(105), ease: 'Cubic.Out', onComplete: () => this.releaseGraphics(slash) })
  }

  private playSpear(source: PresentationPoint, target: PresentationPoint, scale: number): void {
    const from = pixel(source)
    const to = pixel(target)
    const bolt = this.borrowGraphics()
    bolt.fillStyle(0xe2e8f0, 1)
    bolt.fillTriangle(8, 0, -3, -4, -3, 4)
    bolt.fillStyle(0x7dd3fc, 0.8)
    bolt.fillRect(-14 * scale, -1, 20 * scale, 2)
    bolt.setPosition(from.x, from.y).setRotation(angleBetween(source, target))
    this.scene.tweens.add({ targets: bolt, x: to.x, y: to.y, duration: this.duration(120), ease: 'Cubic.In', onComplete: () => this.releaseGraphics(bolt) })
  }

  private playBow(source: PresentationPoint, target: PresentationPoint, scale: number): void {
    const from = pixel(source)
    const to = pixel(target)
    const arrow = this.borrowGraphics()
    arrow.lineStyle(2, 0xfde68a, 1)
    arrow.lineBetween(-8 * scale, 0, 7 * scale, 0)
    arrow.fillStyle(0xfbbf24, 1)
    arrow.fillTriangle(9 * scale, 0, 3 * scale, -3, 3 * scale, 3)
    arrow.setPosition(from.x, from.y).setRotation(angleBetween(source, target))
    this.scene.tweens.add({ targets: arrow, x: to.x, y: to.y - 2, duration: this.duration(190), ease: 'Sine.In', onComplete: () => this.releaseGraphics(arrow) })
  }

  private playCavalry(source: PresentationPoint, target: PresentationPoint, scale: number): void {
    const from = pixel(source)
    const to = pixel(target)
    const hoof = this.borrowGraphics()
    hoof.lineStyle(3, 0xf59e0b, 0.9)
    hoof.strokeEllipse(0, 0, 20 * scale, 12 * scale)
    hoof.lineStyle(2, 0xfde68a, 0.55)
    hoof.strokeEllipse(-8, 5, 15 * scale, 8 * scale)
    hoof.setPosition(from.x, from.y).setRotation(angleBetween(source, target))
    this.scene.tweens.add({ targets: hoof, x: to.x, y: to.y, alpha: 0.12, scaleX: 1.45, duration: this.duration(145), ease: 'Quad.In', onComplete: () => this.releaseGraphics(hoof) })
  }

  private playGeneralProjectile(source: PresentationPoint, target: PresentationPoint, scale: number): void {
    const from = pixel(source)
    const to = pixel(target)
    const orb = this.borrowGraphics()
    orb.fillStyle(0xc084fc, 0.86)
    orb.fillCircle(0, 0, 5 * scale)
    orb.lineStyle(2, 0x67e8f9, 0.85)
    orb.strokeCircle(0, 0, 8 * scale)
    orb.setPosition(from.x, from.y)
    this.scene.tweens.add({ targets: orb, x: to.x, y: to.y, scaleX: 0.7, scaleY: 0.7, duration: this.duration(150), ease: 'Sine.In', onComplete: () => this.releaseGraphics(orb) })
  }

  private playDamage(cue: Extract<BattlefieldPresentationCue, { kind: 'damage' }>): void {
    const delay = cue.detail === 'full' && !this.preferences.reducedMotion ? cue.impactDelayMs : 0
    this.scene.time.delayedCall(delay, () => {
      this.host.flashEnemy(cue.targetId, this.duration(cue.critical ? 120 : 80))
      const at = pixel(cue.target)
      const impact = this.borrowGraphics()
      impact.setPosition(at.x, at.y)
      impact.lineStyle(cue.critical ? 4 : 2, cue.critical ? 0xfbbf24 : 0xfca5a5, 0.95)
      impact.strokeCircle(0, 0, cue.critical ? 14 : 9)
      this.scene.tweens.add({ targets: impact, scaleX: 1.7, scaleY: 1.7, alpha: 0, duration: this.duration(cue.critical ? 170 : 110), ease: 'Quad.Out', onComplete: () => this.releaseGraphics(impact) })
      if (cue.showText) this.playDamageText(cue.target, cue.amount, cue.critical)
    })
  }

  private playDamageText(target: PresentationPoint, amount: number, critical: boolean): void {
    const at = pixel(target)
    const text = this.borrowText()
    text.setText(`${critical ? '暴击 ' : '−'}${amount}`)
      .setStyle({ color: critical ? '#fde68a' : '#fee2e2', fontFamily: HAN_FONT, fontSize: critical ? '17px' : '12px', fontStyle: 'bold', stroke: '#450a0a', strokeThickness: 3 })
      .setPosition(at.x, at.y - 14)
    this.scene.tweens.add({ targets: text, y: at.y - (critical ? 44 : 34), alpha: 0, scaleX: critical ? 1.18 : 1, scaleY: critical ? 1.18 : 1, duration: this.duration(420), ease: 'Cubic.Out', onComplete: () => this.releaseText(text) })
  }

  private playInkDeath(target: PresentationPoint, requestedCount: number, climax: boolean): void {
    const at = pixel(target)
    const count = this.preferences.reducedMotion ? 1 : this.preferences.lowEffects ? Math.min(4, requestedCount) : requestedCount
    for (let index = 0; index < count; index += 1) {
      const mote = this.borrowGraphics(climax)
      const angle = Math.PI * 2 * index / count + Phaser.Math.FloatBetween(-0.25, 0.25)
      const distance = (climax ? 42 : 23) * Phaser.Math.FloatBetween(0.65, 1.1)
      mote.fillStyle(index % 4 === 0 ? 0x991b1b : 0x050505, index % 4 === 0 ? 0.72 : 0.88)
      mote.fillCircle(0, 0, Phaser.Math.Between(climax ? 3 : 2, climax ? 7 : 4))
      mote.setPosition(at.x, at.y)
      this.scene.tweens.add({ targets: mote, x: at.x + Math.cos(angle) * distance, y: at.y + Math.sin(angle) * distance, scaleX: 0.1, scaleY: 0.1, alpha: 0, duration: this.duration(climax ? 520 : 310), ease: 'Cubic.Out', onComplete: () => this.releaseGraphics(mote) })
    }
  }

  private playSealPulse(target: PresentationPoint, color: number, label: string, detail: BattlefieldPresentationCue['detail'], climax = false): void {
    const at = pixel(target)
    const seal = this.borrowGraphics(climax)
    seal.setPosition(at.x, at.y).setScale(0.45)
    seal.fillStyle(color, 0.13)
    seal.fillCircle(0, 0, climax ? 28 : 19)
    seal.lineStyle(climax ? 4 : 3, color, 0.95)
    seal.strokeCircle(0, 0, climax ? 27 : 18)
    seal.lineStyle(1, 0xffffff, 0.5)
    seal.strokeRect(climax ? -18 : -12, climax ? -18 : -12, climax ? 36 : 24, climax ? 36 : 24)
    const duration = detail === 'full' ? (climax ? 620 : 380) : 230
    if (this.preferences.reducedMotion) {
      seal.setScale(1)
      const text = this.borrowText(climax)
      text.setText(label).setStyle({ color: Phaser.Display.Color.IntegerToColor(color).rgba, fontFamily: HAN_FONT, fontSize: climax ? '18px' : '11px', fontStyle: 'bold', stroke: '#020617', strokeThickness: 3 }).setPosition(at.x, at.y - 8)
      this.scene.time.delayedCall(climax ? 760 : 520, () => { this.releaseGraphics(seal); this.releaseText(text) })
      return
    }
    this.scene.tweens.add({ targets: seal, scaleX: 1.4, scaleY: 1.4, alpha: 0, duration: this.duration(duration), ease: 'Back.Out', onComplete: () => this.releaseGraphics(seal) })
    const text = this.borrowText(climax)
    text.setText(label).setStyle({ color: Phaser.Display.Color.IntegerToColor(color).rgba, fontFamily: HAN_FONT, fontSize: climax ? '18px' : '11px', fontStyle: 'bold', stroke: '#020617', strokeThickness: 3 }).setPosition(at.x, at.y - 8)
    this.scene.tweens.add({ targets: text, y: at.y - (climax ? 48 : 30), alpha: 0, duration: this.duration(duration), ease: 'Cubic.Out', onComplete: () => this.releaseText(text) })
  }

  private playWaveTitle(waveNumber: number, label: string, detail: BattlefieldPresentationCue['detail']): void {
    const text = this.borrowText(true)
    text.setOrigin(0, 0)
      .setText(`第${waveNumber}波 · ${label}`)
      .setStyle({
        color: '#f3ead5',
        fontFamily: HAN_FONT,
        fontSize: '15px',
        fontStyle: 'bold',
        backgroundColor: '#10182ad9',
        padding: { x: 10, y: 6 },
        stroke: '#3b2b13',
        strokeThickness: 2,
      })
      .setPosition(16, 16)
    if (this.preferences.reducedMotion) {
      this.scene.time.delayedCall(1200, () => this.releaseText(text))
      return
    }
    const duration = detail === 'full' ? 1800 : 900
    this.scene.tweens.add({ targets: text, x: 26, alpha: 0, delay: this.duration(duration * 0.62), duration: this.duration(duration * 0.38), ease: 'Sine.In', onComplete: () => this.releaseText(text) })
  }

  private playBossTitle(target: PresentationPoint, label: string, color: number, detail: BattlefieldPresentationCue['detail']): void {
    const at = pixel(target)
    const text = this.borrowText(true)
    text.setText(label).setStyle({ color: Phaser.Display.Color.IntegerToColor(color).rgba, fontFamily: HAN_FONT, fontSize: '25px', fontStyle: 'bold', backgroundColor: '#1c0a0a', padding: { x: 14, y: 7 }, stroke: '#020617', strokeThickness: 4 }).setPosition(at.x, Math.max(34, at.y - 68)).setScale(0.82)
    if (this.preferences.reducedMotion) {
      text.setScale(1)
      this.scene.time.delayedCall(1100, () => this.releaseText(text))
      return
    }
    const duration = detail === 'full' ? 820 : 420
    this.scene.tweens.add({ targets: text, y: Math.max(22, at.y - 86), alpha: 0, scaleX: 1.05, scaleY: 1.05, duration: this.duration(duration), ease: 'Cubic.Out', onComplete: () => this.releaseText(text) })
  }
}
