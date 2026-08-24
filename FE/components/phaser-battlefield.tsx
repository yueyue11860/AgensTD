import { useEffect, useRef } from 'react'
import Phaser from 'phaser'
import { BATTLEFIELD_SIZE, BattlefieldScene, type BattlefieldSceneUiState } from '../game/phaser/battlefield-scene'
import type { BattlefieldGridPosition, BattlefieldInteractionBridge, BattlefieldSnapshot } from '../game/phaser/battlefield-model'

interface PhaserBattlefieldProps extends BattlefieldInteractionBridge {
  snapshot: BattlefieldSnapshot | null
  terrainMatrix: readonly (readonly number[])[]
  hoveredCell: BattlefieldGridPosition | null
  selectedPieceId: string | null
  placementMode: boolean
  canPreviewAtHoveredCell: boolean
}

export function PhaserBattlefield({ snapshot, terrainMatrix, hoveredCell, selectedPieceId, placementMode, canPreviewAtHoveredCell, onCellClick, onCellHover, onCellLeave }: PhaserBattlefieldProps) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const sceneRef = useRef<BattlefieldScene | null>(null)
  const callbacksRef = useRef<BattlefieldInteractionBridge>({ onCellClick, onCellHover, onCellLeave })
  callbacksRef.current = { onCellClick, onCellHover, onCellLeave }

  useEffect(() => {
    const mountNode = mountRef.current
    if (!mountNode) return
    const bridge: BattlefieldInteractionBridge = {
      onCellClick: (x, y) => callbacksRef.current.onCellClick(x, y),
      onCellHover: (x, y) => callbacksRef.current.onCellHover(x, y),
      onCellLeave: () => callbacksRef.current.onCellLeave(),
    }
    const scene = new BattlefieldScene(terrainMatrix, bridge)
    sceneRef.current = scene
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: mountNode,
      width: BATTLEFIELD_SIZE,
      height: BATTLEFIELD_SIZE,
      backgroundColor: '#0b1121',
      render: { antialias: true, pixelArt: false, roundPixels: true },
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene,
    })
    return () => {
      sceneRef.current = null
      game.destroy(true)
    }
  }, [terrainMatrix])

  useEffect(() => sceneRef.current?.setSnapshot(snapshot), [snapshot])
  useEffect(() => {
    const uiState: BattlefieldSceneUiState = { hoveredCell, selectedPieceId, placementMode, canPreviewAtHoveredCell }
    sceneRef.current?.setUiState(uiState)
  }, [canPreviewAtHoveredCell, hoveredCell, placementMode, selectedPieceId])

  return <section className="gaming-board-frame" aria-label="29×29西游汉字战场"><div className="gaming-board-viewport"><div ref={mountRef} className="gaming-phaser-surface" /></div></section>
}
