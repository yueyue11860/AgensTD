import { useEffect, useRef, useState, type CSSProperties } from 'react'
import Phaser from 'phaser'
import type { PveSceneTheme } from '../../shared/contracts/pve-stage-config'
import { BATTLEFIELD_SIZE, BattlefieldScene, type BattlefieldCameraViewState, type BattlefieldSceneUiState } from '../game/phaser/battlefield-scene'
import type { BattlefieldGridPosition, BattlefieldInteractionBridge, BattlefieldSnapshot } from '../game/phaser/battlefield-model'
import { moveBattlefieldCursor, type BattlefieldCursorDirection } from '../game/accessibility/battlefield-accessibility'
import type { ClientActionIntent } from '../game/presentation/client-action-intents'

interface PhaserBattlefieldProps extends BattlefieldInteractionBridge {
  snapshot: BattlefieldSnapshot | null
  terrainMatrix: readonly (readonly number[])[]
  sceneTheme?: PveSceneTheme | null
  hoveredCell: BattlefieldGridPosition | null
  selectedPieceId: string | null
  selectedPieceCell?: BattlefieldGridPosition | null
  placementMode: boolean
  canPreviewAtHoveredCell: boolean
  clientActionIntents?: readonly ClientActionIntent[]
  /** 预留给 HUD 设置；不传时使用安全的轻音量默认值。 */
  muted?: boolean
  masterVolume?: number
  /** 每次重连 full snapshot 递增；变化时仅建立表现基线，不重播历史事件。 */
  presentationSyncRevision?: number
  accessibilitySummaryId: string
  accessibilityLabel: string
  onCancelInteraction: () => void
}

export function PhaserBattlefield({ snapshot, terrainMatrix, sceneTheme, hoveredCell, selectedPieceId, selectedPieceCell = null, placementMode, canPreviewAtHoveredCell, clientActionIntents = [], muted = false, masterVolume = 0.45, presentationSyncRevision = 0, accessibilitySummaryId, accessibilityLabel, onCancelInteraction, onCellClick, onCellHover, onCellLeave }: PhaserBattlefieldProps) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const sceneRef = useRef<BattlefieldScene | null>(null)
  const callbacksRef = useRef<BattlefieldInteractionBridge>({ onCellClick, onCellHover, onCellLeave })
  const cancelInteractionRef = useRef(onCancelInteraction)
  const appliedPresentationSyncRevisionRef = useRef(presentationSyncRevision)
  const pointerCellKeyRef = useRef<string | null>(null)
  const [cameraView, setCameraView] = useState<BattlefieldCameraViewState>({ mode: 'full', zoom: 1, scrollX: 0, scrollY: 0 })
  callbacksRef.current = { onCellClick, onCellHover, onCellLeave }
  cancelInteractionRef.current = onCancelInteraction

  useEffect(() => {
    const mountNode = mountRef.current
    if (!mountNode) return
    const bridge: BattlefieldInteractionBridge = {
      onCellClick: (x, y) => callbacksRef.current.onCellClick(x, y),
      onCellHover: (x, y) => callbacksRef.current.onCellHover(x, y),
      onCellLeave: () => callbacksRef.current.onCellLeave(),
    }
    const scene = new BattlefieldScene(terrainMatrix, bridge, sceneTheme, setCameraView)
    sceneRef.current = scene
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number }
    const lowEffects = (
      (navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4)
      || (typeof navigatorWithMemory.deviceMemory === 'number' && navigatorWithMemory.deviceMemory <= 4)
      || window.matchMedia('(max-width: 700px)').matches
    )
    const applyPresentationPreferences = () => scene.setPresentationPreferences({
      reducedMotion: reducedMotionQuery.matches,
      lowEffects,
    })
    applyPresentationPreferences()
    scene.setAudioPreferences({ muted, masterVolume })
    scene.setAudioSuspended(document.hidden)
    reducedMotionQuery.addEventListener('change', applyPresentationPreferences)
    let audioUnlocked = false
    const removeUnlockListeners = () => {
      mountNode.removeEventListener('pointerdown', tryUnlockAudio, true)
      window.removeEventListener('keydown', tryUnlockAudio, true)
    }
    const tryUnlockAudio = () => {
      if (audioUnlocked) return
      void scene.unlockAudio().then((unlocked) => {
        if (!unlocked) return
        audioUnlocked = true
        removeUnlockListeners()
      })
    }
    const handleVisibilityChange = () => scene.setAudioSuspended(document.hidden)
    mountNode.addEventListener('pointerdown', tryUnlockAudio, true)
    window.addEventListener('keydown', tryUnlockAudio, true)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: mountNode,
      width: BATTLEFIELD_SIZE,
      height: BATTLEFIELD_SIZE,
      backgroundColor: '#0b1121',
      // Enemy speed can be below one world pixel per rendered frame. Rounding
      // positions here quantizes smooth 60 FPS motion into visibly discrete hops.
      render: { antialias: !lowEffects, pixelArt: false, roundPixels: false, powerPreference: 'high-performance' },
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      input: { activePointers: 3 },
      scene,
    })
    return () => {
      reducedMotionQuery.removeEventListener('change', applyPresentationPreferences)
      removeUnlockListeners()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      sceneRef.current = null
      game.destroy(true)
    }
  }, [sceneTheme, terrainMatrix])

  useEffect(() => {
    if (presentationSyncRevision !== appliedPresentationSyncRevisionRef.current) {
      appliedPresentationSyncRevisionRef.current = presentationSyncRevision
      sceneRef.current?.synchronizeSnapshot(snapshot)
      return
    }
    sceneRef.current?.setSnapshot(snapshot)
    const diagnostics = sceneRef.current?.diagnostics()
    const mountNode = mountRef.current
    if (diagnostics && mountNode) {
      mountNode.dataset.activeVfxObjects = String(diagnostics.activeVfxObjects)
      mountNode.dataset.pooledVfxObjects = String(diagnostics.pooledVfxObjects)
      mountNode.dataset.displayObjects = String(diagnostics.displayObjects)
      mountNode.dataset.enemyViews = String(diagnostics.enemyViews)
      mountNode.dataset.seenEnemyCount = String(diagnostics.seenEnemyCount)
      mountNode.dataset.pieceViews = String(diagnostics.pieceViews)
      mountNode.dataset.compactEnemyTextures = String(diagnostics.compactEnemyTextures)
      mountNode.dataset.pendingClientActionIntents = String(diagnostics.pendingClientActionIntents)
    }
  }, [presentationSyncRevision, snapshot])
  useEffect(() => sceneRef.current?.setClientActionIntents(clientActionIntents), [clientActionIntents])
  useEffect(() => sceneRef.current?.setAudioPreferences({ muted, masterVolume }), [masterVolume, muted])
  useEffect(() => {
    const uiState: BattlefieldSceneUiState = { hoveredCell, selectedPieceId, placementMode, canPreviewAtHoveredCell }
    sceneRef.current?.setUiState(uiState)
  }, [canPreviewAtHoveredCell, hoveredCell, placementMode, selectedPieceId])

  const viewportPercent = 100 / cameraView.zoom
  const minimapStyle = {
    '--battlefield-minimap-left': `${cameraView.scrollX / BATTLEFIELD_SIZE * 100}%`,
    '--battlefield-minimap-top': `${cameraView.scrollY / BATTLEFIELD_SIZE * 100}%`,
    '--battlefield-minimap-size': `${viewportPercent}%`,
  } as CSSProperties
  const focusCamera = () => {
    const selected = selectedPieceCell ?? snapshot?.pieces.find(piece => piece.entityId === selectedPieceId)
    sceneRef.current?.setViewMode('focus', selected ? { x: selected.x, y: selected.y } : hoveredCell)
  }
  const cellAtClientPoint = (element: HTMLElement, clientX: number, clientY: number) => {
    const bounds = element.getBoundingClientRect()
    return sceneRef.current?.viewportPointToCell(
      (clientX - bounds.left) / bounds.width * BATTLEFIELD_SIZE,
      (clientY - bounds.top) / bounds.height * BATTLEFIELD_SIZE,
    ) ?? null
  }

  return (
    <section className="gaming-board-frame" aria-label="29×29西游汉字战场" data-onboarding-anchor="battlefield" data-pending-client-actions={clientActionIntents.length}>
      {clientActionIntents.length > 0 ? (
        <div className="gaming-client-intent-status" role="status" aria-live="polite">
          <span>本地响应</span>
          <strong>{clientActionIntents.at(-1)?.label}</strong>
          <small>{clientActionIntents.some(intent => intent.acceptedAtServerTick !== null) ? '服务器已接收 · 等待权威帧' : '正在发送 · 不修改权威数值'}</small>
        </div>
      ) : null}
      <div className="gaming-board-viewport">
        <div
          ref={mountRef}
          className="gaming-phaser-surface"
          role="application"
          tabIndex={0}
          aria-label={accessibilityLabel}
          aria-describedby={accessibilitySummaryId}
          aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Shift+ArrowUp Shift+ArrowDown Shift+ArrowLeft Shift+ArrowRight Enter Space Escape + - 0 F"
          onFocus={() => {
            if (!hoveredCell) callbacksRef.current.onCellHover(14, 14)
          }}
          onBlur={() => {
            pointerCellKeyRef.current = null
            callbacksRef.current.onCellLeave()
          }}
          onKeyDown={(event) => {
            if (event.shiftKey && event.key.startsWith('Arrow')) {
              event.preventDefault()
              const panStep = BATTLEFIELD_SIZE * 0.12
              sceneRef.current?.panBy(
                event.key === 'ArrowLeft' ? -panStep : event.key === 'ArrowRight' ? panStep : 0,
                event.key === 'ArrowUp' ? -panStep : event.key === 'ArrowDown' ? panStep : 0,
              )
              return
            }
            if (event.key === '+' || event.key === '=') {
              event.preventDefault()
              sceneRef.current?.zoomBy(0.18)
              return
            }
            if (event.key === '-' || event.key === '_') {
              event.preventDefault()
              sceneRef.current?.zoomBy(-0.18)
              return
            }
            if (event.key === '0') {
              event.preventDefault()
              sceneRef.current?.setViewMode('full')
              return
            }
            if (event.key.toLowerCase() === 'f') {
              event.preventDefault()
              focusCamera()
              return
            }
            const directionByKey: Partial<Record<string, BattlefieldCursorDirection>> = {
              ArrowUp: 'up',
              ArrowDown: 'down',
              ArrowLeft: 'left',
              ArrowRight: 'right',
            }
            const direction = directionByKey[event.key]
            if (direction) {
              event.preventDefault()
              const next = moveBattlefieldCursor(hoveredCell, direction, 29)
              callbacksRef.current.onCellHover(next.x, next.y)
              return
            }
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              const target = hoveredCell ?? { x: 14, y: 14 }
              callbacksRef.current.onCellClick(target.x, target.y)
              return
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              cancelInteractionRef.current()
            }
          }}
          onPointerDown={(event) => event.currentTarget.focus({ preventScroll: true })}
          onPointerMove={(event) => {
            if (event.pointerType === 'touch' && event.isPrimary === false) return
            const cell = cellAtClientPoint(event.currentTarget, event.clientX, event.clientY)
            const nextKey = cell ? `${cell.x}:${cell.y}` : null
            if (nextKey === pointerCellKeyRef.current) return
            pointerCellKeyRef.current = nextKey
            if (cell) callbacksRef.current.onCellHover(cell.x, cell.y)
            else callbacksRef.current.onCellLeave()
          }}
          onPointerLeave={() => {
            if (pointerCellKeyRef.current === null) return
            pointerCellKeyRef.current = null
            callbacksRef.current.onCellLeave()
          }}
          onClick={(event) => {
            const cell = cellAtClientPoint(event.currentTarget, event.clientX, event.clientY)
            if (cell) callbacksRef.current.onCellClick(cell.x, cell.y)
          }}
          onContextMenu={(event) => event.preventDefault()}
          onDragOver={(event) => {
            if (
              event.dataTransfer.types.includes('application/x-agenstd-tray-index')
              || event.dataTransfer.types.includes('application/x-agenstd-reserve-index')
            ) {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
            }
          }}
          onDrop={(event) => {
            if (
              !event.dataTransfer.types.includes('application/x-agenstd-tray-index')
              && !event.dataTransfer.types.includes('application/x-agenstd-reserve-index')
            ) return
            event.preventDefault()
            const cell = cellAtClientPoint(event.currentTarget, event.clientX, event.clientY)
            if (cell) callbacksRef.current.onCellClick(cell.x, cell.y)
          }}
        />
        <div className="gaming-camera-controls" role="group" aria-label="战场视角控制">
          <button type="button" onClick={() => sceneRef.current?.setViewMode('full')} aria-pressed={cameraView.mode === 'full'} title="显示全部29×29战场（0）">全阵</button>
          <button type="button" onClick={focusCamera} aria-pressed={cameraView.mode === 'focus'} title="聚焦当前选择（F）">聚焦</button>
          <button type="button" onClick={() => sceneRef.current?.zoomBy(-0.18)} aria-label="缩小战场" title="缩小（-）">−</button>
          <output aria-live="polite" aria-label="战场缩放比例">{Math.round(cameraView.zoom * 100)}%</output>
          <button type="button" onClick={() => sceneRef.current?.zoomBy(0.18)} aria-label="放大战场" title="放大（+）">＋</button>
        </div>
        {cameraView.zoom > 1.01 ? (
          <button
            type="button"
            className="gaming-battlefield-minimap"
            style={minimapStyle}
            aria-label="当前为聚焦视图，点击恢复全阵"
            title="点击恢复全阵"
            onClick={() => sceneRef.current?.setViewMode('full')}
          >
            <span className="gaming-battlefield-minimap-route" />
            <span className="gaming-battlefield-minimap-viewport" />
          </button>
        ) : null}
        <p className="gaming-camera-hint">滚轮缩放 · 双指缩放平移 · Shift+方向键平移</p>
      </div>
    </section>
  )
}
