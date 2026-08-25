import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Coins, OctagonX, RefreshCw, ShieldAlert, Skull, Timer, Users } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { io, type Socket } from 'socket.io-client'
import { GameOverOverlay } from '../components/game-over-overlay'
import { MissionBriefingModal } from '../components/mission-briefing-modal'
import { cx } from '../lib/cx'
import { LEVEL_DEFS } from '../lib/level-defs'
import { resolveGatewayToken, resolvePlayerId, resolvePlayerKind, resolvePlayerName, resolveSocketUrl } from '../lib/runtime-config'
import type { EntityDelta, GameState as NetworkGameState, GameStatePatch, TickEnvelope } from '../../shared/contracts/game'
import type { PveSceneTheme } from '../../shared/contracts/pve-stage-config'

const BOARD_DIMENSION = 29
const DEFAULT_ROOM_ID = 'public-1'

const PhaserBattlefield = lazy(async () => {
  const module = await import('../components/phaser-battlefield')
  return { default: module.PhaserBattlefield }
})

type RoomPhase = 'lobby' | 'countdown' | 'waiting_for_level' | 'playing'
type MatchStatus = 'waiting' | 'running' | 'finished'
type MatchOutcome = 'victory' | 'defeat'
type PieceKind = 'soldier' | 'character'
type StorageZone = 'tray' | 'reserve'

interface ServerBoardPieceState {
  entityId: string
  ownerPlayerId: string
  kind: PieceKind
  glyph: string
  soldierType?: string
  level?: number
  x: number
  y: number
  formationId?: string
  generalId?: string
  generalName?: string
  generalQuality?: 'purple' | 'orange' | 'red'
  generalArchetype?: 'physical' | 'magic' | 'summon' | 'control'
  generalFixed?: boolean
}

interface ServerGeneralFormationState {
  formationId: string
  generalId: string
  name: string
  characterEntityIds: string[]
  fixed: boolean
}

interface ServerGeneralProgressState {
  generalId: string
  name: string
  quality: 'purple' | 'orange' | 'red'
  archetype: 'physical' | 'magic' | 'summon' | 'control'
  level: number
  maxLevel: number
  experiencePoints: number
  experienceToNextLevel: number | null
  activeSkillReadyAtTick: number
  activeSkillName: string
  attack: number
  attackIntervalMs: number
  attackRangeMilliCells: number
  critChanceBps: number
  critDamageBps: number
  activeSkillCooldownMs: number
}

interface ServerActiveSynergyState {
  synergyId: string
  name: string
  level: number
  contributingGeneralIds: string[]
}

interface ServerTrayPieceState {
  entityId: string
  kind: PieceKind
  glyph: string
  soldierType?: string
  level?: number
}

interface ServerEnemyState {
  entityId: string
  glyph: string
  x: number
  y: number
  hp: number
  maxHp: number
  spawnProtected?: boolean
  invulnerable?: boolean
}

interface ServerEnemyStatusState {
  instanceId: string
  enemyId: string
  sourceGeneralId: string
  statusId: string
  magnitude: number
  stacks: number
  expiresAtTick: number
}

interface ServerSummonedUnitState {
  entityId: string
  ownerPlayerId: string
  sourceGeneralId: string
  summonUnitId: string
  glyph: string
  ownerLevel: number
  x: number
  y: number
  expiresAtTick: number
}

interface ServerEffectZoneState {
  entityId: string
  ownerPlayerId: string
  sourceGeneralId: string
  zoneId: string
  x: number
  y: number
  shape:
    | { kind: 'circle', radiusMilliCells: number }
    | { kind: 'line', lengthMilliCells: number, halfWidthMilliCells: number }
  expiresAtTick: number
}

interface ServerCombatEventState {
  id: string
  tick: number
  type: string
  data: Record<string, string | number | boolean | string[] | number[] | null>
}

interface ServerWaveState {
  index: number
  label?: string
  prepCountdownSec?: number
}

interface SelectedLevelInfo {
  levelId: number
  label: string
  description: string
  waveCount: number
  targetClearRate: number
  minPlayers: number
}

interface ServerDrivenGameState {
  roomId: string
  phase: RoomPhase
  tick: number
  status: MatchStatus
  boardPieces: ServerBoardPieceState[]
  enemies: ServerEnemyState[]
  tray: Array<ServerTrayPieceState | null>
  reserve: Array<ServerTrayPieceState | null>
  rice: number
  nextRecruitCost: number
  populationUsed: number
  populationCap: number
  trayRevision: number
  reserveRevision: number
  boardRevision: number
  generalFormations: ServerGeneralFormationState[]
  generalProgress: ServerGeneralProgressState[]
  activeSynergies: ServerActiveSynergyState[]
  statuses: ServerEnemyStatusState[]
  summonedUnits: ServerSummonedUnitState[]
  zones: ServerEffectZoneState[]
  recentEvents: ServerCombatEventState[]
  overloadTicks: number
  overloadCountdownSec: number
  maxCapacity: number
  currentWave: ServerWaveState
  maxWaves: number
  result: {
    outcome: MatchOutcome
    reason?: string
  } | null
}

const SOLDIER_LABELS: Record<string, string> = {
  blade: '天刀兵',
  spear: '天枪兵',
  bow: '天弓兵',
  cavalry: '天骑兵',
}

const GENERAL_QUALITY_LABELS = {
  purple: '紫品',
  orange: '橙品',
  red: '红品',
} as const

const GENERAL_ARCHETYPE_LABELS = {
  physical: '物理',
  magic: '魔法',
  summon: '召唤',
  control: '控制',
} as const

const STATUS_LABELS: Record<string, string> = {
  slow: '减速',
  stun: '眩晕',
  root: '定身',
  suppress: '压制',
  vulnerable: '易损',
  armor_break: '破甲',
}

const COMBAT_EVENT_LABELS: Record<string, string> = {
  GENERAL_SKILL_CAST: '神将释放技能',
  GENERAL_EFFECT_APPLIED: '神将效果生效',
  STATUS_APPLIED: '控制效果施加',
  STATUS_EXPIRED: '控制效果结束',
  PATH_DISPLACED: '小怪被位移',
  SUMMON_SPAWNED: '召唤物登场',
  SUMMON_EXPIRED: '召唤物退场',
  ZONE_SPAWNED: '效果区域生成',
  ZONE_EXPIRED: '效果区域消散',
  SYNERGY_ACTIVATED: '羁绊激活',
  SYNERGY_DEACTIVATED: '羁绊解除',
}

const ENEMY_GLYPHS: Record<string, string> = {
  scout: '鬼',
  grunt: '怪',
  tank: '妖',
  lord: '魔',
}

const REFERENCE_GATE_LABELS = new Map<string, string>([
  ['13:15', 'P1'],
  ['15:15', 'P2'],
  ['15:13', 'P3'],
  ['13:13', 'P4'],
])

const ARENA_PATHS = [
  [{ x: 13, y: 15 }, { x: 13, y: 18 }, { x: 7, y: 18 }, { x: 7, y: 21 }, { x: 21, y: 21 }, { x: 21, y: 7 }, { x: 7, y: 7 }, { x: 7, y: 14 }, { x: 3, y: 14 }, { x: 3, y: 3 }, { x: 25, y: 3 }, { x: 25, y: 25 }, { x: 3, y: 25 }, { x: 3, y: 14 }],
  [{ x: 15, y: 15 }, { x: 18, y: 15 }, { x: 18, y: 21 }, { x: 21, y: 21 }, { x: 21, y: 7 }, { x: 7, y: 7 }, { x: 7, y: 21 }, { x: 14, y: 21 }, { x: 14, y: 25 }, { x: 3, y: 25 }, { x: 3, y: 3 }, { x: 25, y: 3 }, { x: 25, y: 25 }, { x: 14, y: 25 }],
  [{ x: 15, y: 13 }, { x: 15, y: 10 }, { x: 21, y: 10 }, { x: 21, y: 7 }, { x: 7, y: 7 }, { x: 7, y: 21 }, { x: 21, y: 21 }, { x: 21, y: 14 }, { x: 25, y: 14 }, { x: 25, y: 25 }, { x: 3, y: 25 }, { x: 3, y: 3 }, { x: 25, y: 3 }, { x: 25, y: 14 }],
  [{ x: 13, y: 13 }, { x: 10, y: 13 }, { x: 10, y: 7 }, { x: 7, y: 7 }, { x: 7, y: 21 }, { x: 21, y: 21 }, { x: 21, y: 7 }, { x: 14, y: 7 }, { x: 14, y: 3 }, { x: 25, y: 3 }, { x: 25, y: 25 }, { x: 3, y: 25 }, { x: 3, y: 3 }, { x: 14, y: 3 }],
] as const

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRoomSnapshotPayload(value: unknown): value is {
  id: string
  slots: Array<{ slotId: string; playerId: string | null; isHost: boolean }>
} {
  return isObject(value)
    && typeof value.id === 'string'
    && Array.isArray(value.slots)
    && value.slots.every((slot) => isObject(slot) && typeof slot.slotId === 'string' && typeof slot.isHost === 'boolean')
}

function isReferenceCoreCell(x: number, y: number) {
  return x >= 13 && x <= 15 && y >= 13 && y <= 15
}

function markLine(target: number[][], start: { x: number; y: number }, end: { x: number; y: number }) {
  if (start.x === end.x) {
    const step = start.y <= end.y ? 1 : -1
    for (let y = start.y; y !== end.y + step; y += step) target[y][start.x] = 0
    return
  }

  const step = start.x <= end.x ? 1 : -1
  for (let x = start.x; x !== end.x + step; x += step) target[start.y][x] = 0
}

function createArenaTerrainMatrix() {
  const matrix = Array.from({ length: BOARD_DIMENSION }, () => Array<number>(BOARD_DIMENSION).fill(1))
  for (const path of ARENA_PATHS) {
    for (let index = 0; index < path.length - 1; index += 1) markLine(matrix, path[index], path[index + 1])
  }
  return matrix
}

const ARENA_TERRAIN_MATRIX = createArenaTerrainMatrix()

function extractSyncCandidate(payload: unknown) {
  if (!isObject(payload)) return null
  if (isObject(payload.gameState)) return payload.gameState
  if (isObject(payload.state)) return payload.state
  return payload
}

function readNumber(record: Record<string, unknown> | null, key: string, fallback: number) {
  return record && typeof record[key] === 'number' ? record[key] : fallback
}

function normalizePiece(rawPiece: unknown, ownerPlayerId = ''): ServerBoardPieceState | null {
  if (!isObject(rawPiece)) return null
  const entityId = typeof rawPiece.entityId === 'string' ? rawPiece.entityId : typeof rawPiece.id === 'string' ? rawPiece.id : null
  const x = typeof rawPiece.x === 'number' ? rawPiece.x : isObject(rawPiece.cell) && typeof rawPiece.cell.x === 'number' ? rawPiece.cell.x : null
  const y = typeof rawPiece.y === 'number' ? rawPiece.y : isObject(rawPiece.cell) && typeof rawPiece.cell.y === 'number' ? rawPiece.cell.y : null
  if (!entityId || x === null || y === null) return null

  const soldierType = typeof rawPiece.soldierType === 'string' ? rawPiece.soldierType : undefined
  const rawKind = rawPiece.kind === 'character' || rawPiece.pieceKind === 'character' ? 'character' : 'soldier'
  const fallbackGlyph = soldierType === 'blade' ? '刀' : soldierType === 'spear' ? '枪' : soldierType === 'bow' ? '弓' : soldierType === 'cavalry' ? '骑' : '兵'

  return {
    entityId,
    ownerPlayerId: typeof rawPiece.ownerPlayerId === 'string' ? rawPiece.ownerPlayerId : ownerPlayerId,
    kind: rawKind,
    glyph: typeof rawPiece.glyph === 'string' ? rawPiece.glyph : fallbackGlyph,
    soldierType,
    level: typeof rawPiece.level === 'number' ? rawPiece.level : 1,
    formationId: typeof rawPiece.formationId === 'string' ? rawPiece.formationId : undefined,
    generalId: typeof rawPiece.generalId === 'string' ? rawPiece.generalId : undefined,
    generalName: typeof rawPiece.generalName === 'string' ? rawPiece.generalName : undefined,
    generalQuality: rawPiece.generalQuality === 'orange' || rawPiece.generalQuality === 'red' || rawPiece.generalQuality === 'purple'
      ? rawPiece.generalQuality
      : undefined,
    generalArchetype: rawPiece.generalArchetype === 'magic'
      || rawPiece.generalArchetype === 'summon'
      || rawPiece.generalArchetype === 'control'
      || rawPiece.generalArchetype === 'physical'
      ? rawPiece.generalArchetype
      : undefined,
    generalFixed: rawPiece.generalFixed === true,
    x,
    y,
  }
}

function normalizeTrayPiece(rawPiece: unknown, index: number): ServerTrayPieceState | null {
  if (!isObject(rawPiece)) return null
  const entityId = typeof rawPiece.entityId === 'string' ? rawPiece.entityId : typeof rawPiece.id === 'string' ? rawPiece.id : `tray-${index}`
  const soldierType = typeof rawPiece.soldierType === 'string' ? rawPiece.soldierType : undefined
  const kind: PieceKind = rawPiece.kind === 'character' ? 'character' : 'soldier'
  const fallbackGlyph = soldierType === 'blade' ? '刀' : soldierType === 'spear' ? '枪' : soldierType === 'bow' ? '弓' : soldierType === 'cavalry' ? '骑' : '兵'
  return {
    entityId,
    kind,
    glyph: typeof rawPiece.glyph === 'string' ? rawPiece.glyph : fallbackGlyph,
    soldierType,
    level: typeof rawPiece.level === 'number' ? rawPiece.level : kind === 'soldier' ? 1 : undefined,
  }
}

function normalizeEnemy(rawEnemy: unknown): ServerEnemyState | null {
  if (!isObject(rawEnemy)) return null
  const entityId = typeof rawEnemy.entityId === 'string' ? rawEnemy.entityId : typeof rawEnemy.id === 'string' ? rawEnemy.id : null
  const x = typeof rawEnemy.x === 'number' ? rawEnemy.x : isObject(rawEnemy.position) && typeof rawEnemy.position.x === 'number' ? rawEnemy.position.x : null
  const y = typeof rawEnemy.y === 'number' ? rawEnemy.y : isObject(rawEnemy.position) && typeof rawEnemy.position.y === 'number' ? rawEnemy.position.y : null
  const rawKind = typeof rawEnemy.kind === 'string' ? rawEnemy.kind : typeof rawEnemy.type === 'string' ? rawEnemy.type : ''
  if (!entityId || x === null || y === null) return null
  const hp = typeof rawEnemy.hp === 'number' ? rawEnemy.hp : 0
  return {
    entityId,
    glyph: typeof rawEnemy.glyph === 'string'
      ? rawEnemy.glyph
      : typeof rawEnemy.name === 'string' && rawEnemy.name.length <= 2
        ? rawEnemy.name
        : ENEMY_GLYPHS[rawKind.toLowerCase()] ?? '怪',
    x,
    y,
    hp,
    maxHp: typeof rawEnemy.maxHp === 'number' ? rawEnemy.maxHp : Math.max(1, hp),
    spawnProtected: rawEnemy.spawnProtected === true,
    invulnerable: rawEnemy.invulnerable === true,
  }
}

function normalizeEnemyStatus(rawStatus: unknown): ServerEnemyStatusState | null {
  if (!isObject(rawStatus)
    || typeof rawStatus.instanceId !== 'string'
    || typeof rawStatus.enemyId !== 'string'
    || typeof rawStatus.statusId !== 'string') return null
  return {
    instanceId: rawStatus.instanceId,
    enemyId: rawStatus.enemyId,
    sourceGeneralId: typeof rawStatus.sourceGeneralId === 'string' ? rawStatus.sourceGeneralId : '',
    statusId: rawStatus.statusId,
    magnitude: readNumber(rawStatus, 'magnitude', 0),
    stacks: Math.max(1, readNumber(rawStatus, 'stacks', 1)),
    expiresAtTick: readNumber(rawStatus, 'expiresAtTick', 0),
  }
}

function normalizeSummonedUnit(rawUnit: unknown): ServerSummonedUnitState | null {
  if (!isObject(rawUnit)
    || typeof rawUnit.entityId !== 'string'
    || typeof rawUnit.glyph !== 'string'
    || typeof rawUnit.x !== 'number'
    || typeof rawUnit.y !== 'number') return null
  return {
    entityId: rawUnit.entityId,
    ownerPlayerId: typeof rawUnit.ownerPlayerId === 'string' ? rawUnit.ownerPlayerId : '',
    sourceGeneralId: typeof rawUnit.sourceGeneralId === 'string' ? rawUnit.sourceGeneralId : '',
    summonUnitId: typeof rawUnit.summonUnitId === 'string' ? rawUnit.summonUnitId : rawUnit.entityId,
    glyph: rawUnit.glyph,
    ownerLevel: Math.max(1, readNumber(rawUnit, 'ownerLevel', 1)),
    x: rawUnit.x,
    y: rawUnit.y,
    expiresAtTick: readNumber(rawUnit, 'expiresAtTick', 0),
  }
}

function normalizeEffectZone(rawZone: unknown): ServerEffectZoneState | null {
  if (!isObject(rawZone)
    || typeof rawZone.entityId !== 'string'
    || typeof rawZone.x !== 'number'
    || typeof rawZone.y !== 'number'
    || !isObject(rawZone.shape)) return null
  const shape = rawZone.shape.kind === 'circle'
    ? { kind: 'circle' as const, radiusMilliCells: readNumber(rawZone.shape, 'radiusMilliCells', 500) }
    : rawZone.shape.kind === 'line'
      ? {
          kind: 'line' as const,
          lengthMilliCells: readNumber(rawZone.shape, 'lengthMilliCells', 1000),
          halfWidthMilliCells: readNumber(rawZone.shape, 'halfWidthMilliCells', 500),
        }
      : null
  if (!shape) return null
  return {
    entityId: rawZone.entityId,
    ownerPlayerId: typeof rawZone.ownerPlayerId === 'string' ? rawZone.ownerPlayerId : '',
    sourceGeneralId: typeof rawZone.sourceGeneralId === 'string' ? rawZone.sourceGeneralId : '',
    zoneId: typeof rawZone.zoneId === 'string' ? rawZone.zoneId : rawZone.entityId,
    x: rawZone.x,
    y: rawZone.y,
    shape,
    expiresAtTick: readNumber(rawZone, 'expiresAtTick', 0),
  }
}

function normalizeCombatEvent(rawEvent: unknown): ServerCombatEventState | null {
  if (!isObject(rawEvent)
    || typeof rawEvent.id !== 'string'
    || typeof rawEvent.tick !== 'number'
    || typeof rawEvent.type !== 'string') return null
  const data: ServerCombatEventState['data'] = {}
  if (isObject(rawEvent.data)) {
    for (const [key, value] of Object.entries(rawEvent.data)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) data[key] = value
      else if (Array.isArray(value) && value.every((item) => typeof item === 'string')) data[key] = value
      else if (Array.isArray(value) && value.every((item) => typeof item === 'number')) data[key] = value
    }
  }
  return { id: rawEvent.id, tick: rawEvent.tick, type: rawEvent.type, data }
}

function normalizeSyncState(payload: unknown, playerId: string): ServerDrivenGameState | null {
  const candidate = extractSyncCandidate(payload)
  if (!candidate || typeof candidate.tick !== 'number') return null

  const pve = isObject(candidate.pve) ? candidate.pve : null
  const players = pve && Array.isArray(pve.players) ? pve.players : []
  const player = players.find((entry) => isObject(entry) && entry.playerId === playerId)
  const currentPlayer = isObject(player) ? player : null
  const rawBoardPieces = pve && Array.isArray(pve.boardPieces) ? pve.boardPieces : Array.isArray(candidate.towers) ? candidate.towers : []
  const boardPieces = rawBoardPieces.map((piece) => normalizePiece(piece, playerId)).filter((piece): piece is ServerBoardPieceState => piece !== null)
  const rawEnemies = pve && Array.isArray(pve.enemies) ? pve.enemies : Array.isArray(candidate.enemies) ? candidate.enemies : []
  const enemies = rawEnemies.map(normalizeEnemy).filter((enemy): enemy is ServerEnemyState => enemy !== null)
  const statuses = pve && Array.isArray(pve.statuses)
    ? pve.statuses.map(normalizeEnemyStatus).filter((status): status is ServerEnemyStatusState => status !== null)
    : []
  const summonedUnits = pve && Array.isArray(pve.summonedUnits)
    ? pve.summonedUnits.map(normalizeSummonedUnit).filter((unit): unit is ServerSummonedUnitState => unit !== null)
    : []
  const zones = pve && Array.isArray(pve.zones)
    ? pve.zones.map(normalizeEffectZone).filter((zone): zone is ServerEffectZoneState => zone !== null)
    : []
  const recentEvents = pve && Array.isArray(pve.recentEvents)
    ? pve.recentEvents.map(normalizeCombatEvent).filter((event): event is ServerCombatEventState => event !== null)
    : []
  const tray = Array<ServerTrayPieceState | null>(5).fill(null)
  const reserve = Array<ServerTrayPieceState | null>(2).fill(null)
  const generalFormations: ServerGeneralFormationState[] = currentPlayer && Array.isArray(currentPlayer.generalFormations)
    ? currentPlayer.generalFormations.flatMap((rawFormation) => {
        if (!isObject(rawFormation)
          || typeof rawFormation.formationId !== 'string'
          || typeof rawFormation.generalId !== 'string') return []
        return [{
          formationId: rawFormation.formationId,
          generalId: rawFormation.generalId,
          name: typeof rawFormation.name === 'string' ? rawFormation.name : rawFormation.generalId,
          characterEntityIds: Array.isArray(rawFormation.characterEntityIds)
            ? rawFormation.characterEntityIds.filter((id): id is string => typeof id === 'string')
            : [],
          fixed: rawFormation.fixed === true,
        }]
      })
    : []
  const generalProgress: ServerGeneralProgressState[] = currentPlayer && Array.isArray(currentPlayer.generalProgress)
    ? currentPlayer.generalProgress.flatMap((rawProgress) => {
        if (!isObject(rawProgress)
          || typeof rawProgress.generalId !== 'string'
          || typeof rawProgress.name !== 'string'
          || typeof rawProgress.level !== 'number') return []
        const quality = rawProgress.quality === 'orange' || rawProgress.quality === 'red' ? rawProgress.quality : 'purple'
        const archetype = rawProgress.archetype === 'magic'
          || rawProgress.archetype === 'summon'
          || rawProgress.archetype === 'control'
          ? rawProgress.archetype
          : 'physical'
        return [{
          generalId: rawProgress.generalId,
          name: rawProgress.name,
          quality,
          archetype,
          level: rawProgress.level,
          maxLevel: readNumber(rawProgress, 'maxLevel', 3),
          experiencePoints: readNumber(rawProgress, 'experiencePoints', 0),
          experienceToNextLevel: typeof rawProgress.experienceToNextLevel === 'number'
            ? rawProgress.experienceToNextLevel
            : null,
          activeSkillReadyAtTick: readNumber(rawProgress, 'activeSkillReadyAtTick', 0),
          activeSkillName: typeof rawProgress.activeSkillName === 'string' ? rawProgress.activeSkillName : '自动技能',
          attack: readNumber(rawProgress, 'attack', 0),
          attackIntervalMs: readNumber(rawProgress, 'attackIntervalMs', 0),
          attackRangeMilliCells: readNumber(rawProgress, 'attackRangeMilliCells', 0),
          critChanceBps: readNumber(rawProgress, 'critChanceBps', 0),
          critDamageBps: readNumber(rawProgress, 'critDamageBps', 10000),
          activeSkillCooldownMs: readNumber(rawProgress, 'activeSkillCooldownMs', 0),
        }]
      })
    : []
  const activeSynergies: ServerActiveSynergyState[] = currentPlayer && Array.isArray(currentPlayer.activeSynergies)
    ? currentPlayer.activeSynergies.flatMap((rawSynergy) => {
        if (!isObject(rawSynergy)
          || typeof rawSynergy.synergyId !== 'string'
          || typeof rawSynergy.name !== 'string') return []
        return [{
          synergyId: rawSynergy.synergyId,
          name: rawSynergy.name,
          level: readNumber(rawSynergy, 'level', 1),
          contributingGeneralIds: Array.isArray(rawSynergy.contributingGeneralIds)
            ? rawSynergy.contributingGeneralIds.filter((id): id is string => typeof id === 'string')
            : [],
        }]
      })
    : []

  if (currentPlayer && Array.isArray(currentPlayer.tray)) {
    for (const [fallbackIndex, rawSlot] of currentPlayer.tray.entries()) {
      if (!isObject(rawSlot)) continue
      const index = typeof rawSlot.index === 'number' ? rawSlot.index : fallbackIndex
      if (index >= 0 && index < tray.length) tray[index] = normalizeTrayPiece(rawSlot.piece, index)
    }
  }
  if (currentPlayer && Array.isArray(currentPlayer.reserve)) {
    for (const [fallbackIndex, rawSlot] of currentPlayer.reserve.entries()) {
      if (!isObject(rawSlot)) continue
      const index = typeof rawSlot.index === 'number' ? rawSlot.index : fallbackIndex
      if (index >= 0 && index < reserve.length) reserve[index] = normalizeTrayPiece(rawSlot.piece, index)
    }
  }

  const roomRuntime = isObject(candidate.room) ? candidate.room : null
  const resources = isObject(candidate.resources) ? candidate.resources : null
  const rawWave = isObject(candidate.wave) ? candidate.wave : null
  const currentWave = pve ? readNumber(pve, 'currentWave', 0) : readNumber(rawWave, 'index', 0)
  const resultOutcome: MatchOutcome | null = isObject(candidate.result)
    && (candidate.result.outcome === 'victory' || candidate.result.outcome === 'defeat')
    ? candidate.result.outcome
    : null

  return {
    roomId: typeof candidate.roomId === 'string' ? candidate.roomId : DEFAULT_ROOM_ID,
    phase: candidate.phase === 'countdown' || candidate.phase === 'waiting_for_level' || candidate.phase === 'playing' ? candidate.phase : 'lobby',
    tick: candidate.tick,
    status: candidate.status === 'running' || candidate.status === 'finished' ? candidate.status : 'waiting',
    boardPieces,
    enemies,
    tray,
    reserve,
    rice: readNumber(currentPlayer, 'rice', readNumber(resources, 'gold', 0)),
    nextRecruitCost: readNumber(currentPlayer, 'nextRecruitCost', 5),
    populationUsed: readNumber(currentPlayer, 'populationUsed', boardPieces.filter((piece) => piece.ownerPlayerId === playerId && piece.kind === 'soldier').length),
    populationCap: readNumber(currentPlayer, 'populationCap', 10),
    trayRevision: readNumber(currentPlayer, 'trayRevision', 0),
    reserveRevision: readNumber(currentPlayer, 'reserveRevision', 0),
    boardRevision: readNumber(currentPlayer, 'boardRevision', 0),
    generalFormations,
    generalProgress,
    activeSynergies,
    statuses,
    summonedUnits,
    zones,
    recentEvents,
    overloadTicks: readNumber(roomRuntime, 'overloadTicks', 0),
    overloadCountdownSec: pve ? readNumber(pve, 'overloadCountdownSec', 0) : readNumber(roomRuntime, 'overloadCountdownSec', 0),
    maxCapacity: pve ? readNumber(pve, 'maxCapacity', 10) : readNumber(roomRuntime, 'maxCapacity', 10),
    currentWave: {
      index: currentWave,
      label: currentWave > 0 ? `第 ${currentWave} 波` : '等待出怪',
      prepCountdownSec: readNumber(rawWave, 'prepCountdownSec', 0),
    },
    maxWaves: pve ? readNumber(pve, 'maxWaves', 0) : 0,
    result: resultOutcome ? {
      outcome: resultOutcome,
      reason: isObject(candidate.result) && typeof candidate.result.reason === 'string' ? candidate.result.reason : undefined,
    } : null,
  }
}

function isNetworkGameState(value: unknown): value is NetworkGameState {
  return isObject(value)
    && typeof value.tick === 'number'
    && typeof value.status === 'string'
    && isObject(value.map)
    && isObject(value.resources)
    && Array.isArray(value.towers)
    && Array.isArray(value.enemies)
}

function isNetworkGameStatePatch(value: unknown): value is GameStatePatch {
  return isObject(value) && typeof value.tick === 'number' && typeof value.status === 'string' && isObject(value.resources)
}

function applyNetworkEntityDelta<T extends { id: string }>(current: T[], delta?: EntityDelta<T>) {
  if (!delta) return current
  const removedIds = new Set(delta.remove)
  const upserts = new Map(delta.upsert.map((entity) => [entity.id, entity]))
  const next = current.filter((entity) => !removedIds.has(entity.id)).map((entity) => {
    const replacement = upserts.get(entity.id)
    if (replacement) upserts.delete(entity.id)
    return replacement ?? entity
  })
  next.push(...upserts.values())
  return next
}

function mergeNetworkTickPayload(payload: unknown, previous: NetworkGameState | null): NetworkGameState | null {
  if (isNetworkGameState(payload)) return !previous || payload.tick >= previous.tick ? payload : previous
  if (!isObject(payload)) return null

  const envelope = payload as Partial<TickEnvelope> & { gameState?: unknown; patch?: unknown }
  if (envelope.mode === 'full' && isNetworkGameState(envelope.gameState)) {
    return !previous || envelope.gameState.tick >= previous.tick ? envelope.gameState : previous
  }
  if ((envelope.mode !== 'patch' && envelope.mode !== 'checkpoint') || !isNetworkGameStatePatch(envelope.patch) || !previous) return null
  if (envelope.patch.tick <= previous.tick) return previous

  return {
    ...previous,
    ...envelope.patch,
    towers: envelope.patch.towers ?? applyNetworkEntityDelta(previous.towers, envelope.patch.towerDelta),
    enemies: envelope.patch.enemies ?? applyNetworkEntityDelta(previous.enemies, envelope.patch.enemyDelta),
    map: envelope.patch.map ?? previous.map,
    pve: envelope.patch.pve ?? previous.pve,
  }
}

function findPieceAtCell(pieces: ServerBoardPieceState[], x: number, y: number) {
  return pieces.find((piece) => piece.x === x && piece.y === y) ?? null
}

function canMergeSoldiers(
  source: Pick<ServerTrayPieceState, 'kind' | 'soldierType' | 'level'> | null,
  target: Pick<ServerTrayPieceState, 'kind' | 'soldierType' | 'level'> | null,
) {
  return Boolean(
    source
    && target
    && source.kind === 'soldier'
    && target.kind === 'soldier'
    && source.soldierType === target.soldierType
    && source.level === target.level
    && (target.level ?? 1) < 5,
  )
}

function isTerrainDeployableCell(x: number, y: number) {
  return x >= 0
    && x < BOARD_DIMENSION
    && y >= 0
    && y < BOARD_DIMENSION
    && ARENA_TERRAIN_MATRIX[y][x] === 1
    && !isReferenceCoreCell(x, y)
}

function CrisisWarning({ overloadTicks, overloadCountdownSec, enemyCount, maxCapacity }: { overloadTicks: number; overloadCountdownSec: number; enemyCount: number; maxCapacity: number }) {
  useEffect(() => {
    document.body.classList.toggle('crisis-overload-active', overloadTicks > 0)
    return () => document.body.classList.remove('crisis-overload-active')
  }, [overloadTicks])

  if (overloadTicks <= 0) return null
  return (
    <div className="gaming-warning-card">
      <ShieldAlert className="h-5 w-5 shrink-0 text-red-200" />
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-red-200/80">同屏超载</p>
        <p className="mt-0.5 tabular-nums text-red-50"><span className="text-2xl font-bold">{enemyCount}</span><span className="text-sm text-red-200/70"> / {maxCapacity}</span></p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-red-50">{overloadCountdownSec}s</p>
      </div>
    </div>
  )
}

function GamingBoard({ gameState, sceneTheme, selectedPieceId, placementMode, hoveredCell, onCellClick, onCellHover, onCellLeave }: {
  gameState: ServerDrivenGameState | null
  sceneTheme?: PveSceneTheme | null
  selectedPieceId: string | null
  placementMode: boolean
  hoveredCell: { x: number; y: number } | null
  onCellClick: (x: number, y: number) => void
  onCellHover: (x: number, y: number) => void
  onCellLeave: () => void
}) {
  const canPreviewAtHoveredCell = Boolean(
    hoveredCell
    && placementMode
    && isTerrainDeployableCell(hoveredCell.x, hoveredCell.y),
  )
  return (
    <Suspense fallback={<section className="gaming-board-frame" aria-busy="true"><div className="gaming-board-viewport">正在加载战场引擎…</div></section>}>
      <PhaserBattlefield
        snapshot={gameState ? {
          tick: gameState.tick,
          pieces: gameState.boardPieces,
          enemies: gameState.enemies,
          statuses: gameState.statuses,
          summonedUnits: gameState.summonedUnits,
          zones: gameState.zones,
        } : null}
        terrainMatrix={ARENA_TERRAIN_MATRIX}
        sceneTheme={sceneTheme}
        hoveredCell={hoveredCell}
        selectedPieceId={selectedPieceId}
        placementMode={placementMode}
        canPreviewAtHoveredCell={canPreviewAtHoveredCell}
        onCellClick={onCellClick}
        onCellHover={onCellHover}
        onCellLeave={onCellLeave}
      />
    </Suspense>
  )
}

export function GamingPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const roomId = searchParams.get('roomId') ?? DEFAULT_ROOM_ID
  const socketUrl = useMemo(() => resolveSocketUrl(), [])
  const gatewayToken = useMemo(() => resolveGatewayToken(), [])
  const playerId = useMemo(() => resolvePlayerId() ?? 'human-dev', [])
  const playerName = useMemo(() => resolvePlayerName() ?? playerId, [playerId])
  const playerKind = resolvePlayerKind()
  const socketRef = useRef<Socket | null>(null)
  const [gameState, setGameState] = useState<ServerDrivenGameState | null>(null)
  const [roomPhase, setRoomPhase] = useState<RoomPhase>('lobby')
  const [selectedTrayIndex, setSelectedTrayIndex] = useState<number | null>(null)
  const [selectedReserveIndex, setSelectedReserveIndex] = useState<number | null>(null)
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null)
  const [hoveredCell, setHoveredCell] = useState<{ x: number; y: number } | null>(null)
  const [isLeaveConfirmOpen, setIsLeaveConfirmOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedLevelInfo, setSelectedLevelInfo] = useState<SelectedLevelInfo | null>(null)
  const [pendingLevelId, setPendingLevelId] = useState<number | null>(null)
  const [missionBriefingDismissed, setMissionBriefingDismissed] = useState(false)
  const [mySlot, setMySlot] = useState<string | null>(null)
  const [hostPlayerId, setHostPlayerId] = useState<string | null>(null)

  const isHost = hostPlayerId ? hostPlayerId === playerId : mySlot === 'P1'
  const isAwaitingLevelSelection = roomPhase === 'waiting_for_level' || ((roomPhase === 'lobby' || roomPhase === 'countdown') && gameState?.status === 'waiting')
  const shouldShowMissionBriefing = !missionBriefingDismissed && pendingLevelId === null && !selectedLevelInfo && !gameState?.result?.outcome && isAwaitingLevelSelection
  const selectedLevelPreview = selectedLevelInfo ?? (pendingLevelId !== null ? (() => {
    const level = LEVEL_DEFS.find((candidate) => candidate.levelId === pendingLevelId)
    return level ? { levelId: level.levelId, label: level.label, description: level.subtitle, waveCount: 0, targetClearRate: level.clearRate, minPlayers: level.minPlayers } : null
  })() : null)
  const selectedPiece = gameState?.boardPieces.find((piece) => piece.entityId === selectedPieceId) ?? null
  const selectedFormation = selectedPiece?.formationId
    ? gameState?.generalFormations.find((formation) => formation.formationId === selectedPiece.formationId) ?? null
    : null
  const selectedGeneralProgress = selectedFormation
    ? gameState?.generalProgress.find((progress) => progress.generalId === selectedFormation.generalId) ?? null
    : null
  const selectedFormationPieces = selectedFormation
    ? (gameState?.boardPieces.filter((piece) => piece.formationId === selectedFormation.formationId)
        .sort((left, right) => left.y - right.y || left.x - right.x) ?? [])
    : []
  const selectedFormationGlyphs = selectedFormationPieces.map((piece) => piece.glyph)
  const selectedGeneralSynergies = selectedFormation
    ? gameState?.activeSynergies.filter((synergy) => synergy.contributingGeneralIds.includes(selectedFormation.generalId)) ?? []
    : []
  const selectedGeneralExperienceRatio = selectedGeneralProgress
    ? selectedGeneralProgress.experienceToNextLevel === null
      ? 1
      : selectedGeneralProgress.experiencePoints / Math.max(1, selectedGeneralProgress.experiencePoints + selectedGeneralProgress.experienceToNextLevel)
    : 0
  const generalDisplayName = (generalId: string) => gameState?.generalProgress.find((progress) => progress.generalId === generalId)?.name
    ?? gameState?.generalFormations.find((formation) => formation.generalId === generalId)?.name
    ?? generalId
  const selectedReservePiece = selectedReserveIndex === null ? null : gameState?.reserve[selectedReserveIndex] ?? null
  const recruitDisabled = !gameState || gameState.status !== 'running' || gameState.rice < gameState.nextRecruitCost

  useEffect(() => {
    const root = document.getElementById('root')
    document.documentElement.classList.add('gaming-route-active')
    document.body.classList.add('gaming-route-active')
    root?.classList.add('gaming-route-active')
    return () => {
      document.documentElement.classList.remove('gaming-route-active')
      document.body.classList.remove('gaming-route-active', 'crisis-overload-active')
      root?.classList.remove('gaming-route-active')
    }
  }, [])

  useEffect(() => {
    if (!socketUrl || typeof window === 'undefined') {
      setError('未解析到 WebSocket 地址。')
      return
    }

    const socket = io(socketUrl, {
      autoConnect: true,
      withCredentials: true,
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 15000,
      randomizationFactor: 0.5,
      timeout: 8000,
      auth: gatewayToken ? { token: gatewayToken } : undefined,
      query: { roomId, playerId, playerKind },
    })
    socketRef.current = socket
    let latestNetworkState: NetworkGameState | null = null

    const handleTickUpdate = (payload: unknown) => {
      const networkState = mergeNetworkTickPayload(payload, latestNetworkState)
      if (!networkState) {
        if (isObject(payload) && (payload.mode === 'patch' || payload.mode === 'checkpoint')) socket.emit('REQUEST_FULL_STATE')
        return
      }
      latestNetworkState = networkState
      const nextState = normalizeSyncState(networkState, playerId)
      if (nextState) {
        setGameState(nextState)
        setError(null)
      }
    }

    const handleRoomJoined = (payload: unknown) => {
      if (isObject(payload) && typeof payload.slot === 'string') setMySlot(payload.slot)
      if (isObject(payload) && typeof payload.hostPlayerId === 'string') setHostPlayerId(payload.hostPlayerId)
      if (isObject(payload) && typeof payload.phase === 'string') setRoomPhase(payload.phase === 'countdown' || payload.phase === 'waiting_for_level' || payload.phase === 'playing' ? payload.phase : 'lobby')
    }
    const handleRoomPhaseChanged = (payload: unknown) => {
      if (!isObject(payload) || typeof payload.phase !== 'string') return
      const phase: RoomPhase = payload.phase === 'countdown' || payload.phase === 'waiting_for_level' || payload.phase === 'playing' ? payload.phase : 'lobby'
      setRoomPhase(phase)
      setGameState((current) => current ? { ...current, phase } : current)
    }
    const handleLevelSelected = (payload: unknown) => {
      if (!isObject(payload) || typeof payload.levelId !== 'number' || typeof payload.label !== 'string' || typeof payload.description !== 'string' || typeof payload.waveCount !== 'number' || typeof payload.targetClearRate !== 'number' || typeof payload.minPlayers !== 'number') return
      setError(null)
      setPendingLevelId(null)
      setSelectedLevelInfo({ levelId: payload.levelId, label: payload.label, description: payload.description, waveCount: payload.waveCount, targetClearRate: payload.targetClearRate, minPlayers: payload.minPlayers })
    }
    const handleRoomSnapshot = (payload: unknown) => {
      if (!isRoomSnapshotPayload(payload)) return
      setMySlot(payload.slots.find((slot) => slot.playerId === playerId)?.slotId ?? null)
      setHostPlayerId(payload.slots.find((slot) => slot.isHost && typeof slot.playerId === 'string')?.playerId ?? null)
    }
    const handleEngineError = (engineError: unknown) => {
      setPendingLevelId(null)
      setMissionBriefingDismissed(false)
      if (typeof engineError === 'string') setError(engineError)
      else if (isObject(engineError) && typeof engineError.message === 'string') setError(engineError.message)
    }

    socket.on('connect', () => {
      setError(null)
      socket.emit('JOIN_ROOM', { roomId, playerId, playerName, playerKind })
    })
    socket.on('connect_error', (connectError) => setError(connectError.message))
    socket.on('engine_error', handleEngineError)
    socket.on('TICK_UPDATE', handleTickUpdate)
    socket.on('ROOM_JOINED', handleRoomJoined)
    socket.on('ROOM_SNAPSHOT', handleRoomSnapshot)
    socket.on('ROOM_PHASE_CHANGED', handleRoomPhaseChanged)
    socket.on('LEVEL_SELECTED', handleLevelSelected)

    return () => {
      socket.off('TICK_UPDATE', handleTickUpdate)
      socket.off('ROOM_JOINED', handleRoomJoined)
      socket.off('ROOM_SNAPSHOT', handleRoomSnapshot)
      socket.off('ROOM_PHASE_CHANGED', handleRoomPhaseChanged)
      socket.off('LEVEL_SELECTED', handleLevelSelected)
      socket.disconnect()
      socketRef.current = null
    }
  }, [gatewayToken, playerId, playerKind, playerName, roomId, socketUrl])

  useEffect(() => {
    if (roomPhase === 'playing' || gameState?.status === 'running') setPendingLevelId(null)
  }, [gameState?.status, roomPhase])

  useEffect(() => {
    if (selectedTrayIndex !== null && !gameState?.tray[selectedTrayIndex]) setSelectedTrayIndex(null)
    if (selectedReserveIndex !== null && !gameState?.reserve[selectedReserveIndex]) setSelectedReserveIndex(null)
    if (selectedPieceId && !gameState?.boardPieces.some((piece) => piece.entityId === selectedPieceId)) setSelectedPieceId(null)
  }, [gameState, selectedPieceId, selectedReserveIndex, selectedTrayIndex])

  function emitAction(payload: Record<string, unknown>) {
    const socket = socketRef.current
    if (!socket?.connected) {
      setError('WebSocket 尚未连接。')
      return false
    }
    socket.emit('SEND_ACTION', {
      requestId: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `pve-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      clientTick: gameState?.tick,
      payload,
    })
    return true
  }

  function handleRecruit() {
    if (recruitDisabled || !gameState) return
    if (emitAction({ action: 'RECRUIT_BATCH', expectedTrayRevision: gameState.trayRevision })) {
      setSelectedTrayIndex(null)
      setSelectedReserveIndex(null)
      setSelectedPieceId(null)
    }
  }

  function getStoragePiece(zone: StorageZone, index: number) {
    return zone === 'tray' ? gameState?.tray[index] ?? null : gameState?.reserve[index] ?? null
  }

  function moveOrMergeStorage(sourceZone: StorageZone, sourceIndex: number, targetZone: StorageZone, targetIndex: number) {
    if (!gameState || (sourceZone === targetZone && sourceIndex === targetIndex)) return false
    const source = getStoragePiece(sourceZone, sourceIndex)
    const target = getStoragePiece(targetZone, targetIndex)
    if (!source) return false
    if (target && canMergeSoldiers(source, target)) {
      return emitAction({
        action: 'MERGE_SOLDIERS',
        sourceEntityId: source.entityId,
        targetEntityId: target.entityId,
        expectedTrayRevision: gameState.trayRevision,
        expectedBoardRevision: gameState.boardRevision,
        expectedReserveRevision: gameState.reserveRevision,
      })
    }
    return emitAction({
      action: 'SWAP_STORAGE_PIECES',
      sourceZone,
      sourceIndex,
      targetZone,
      targetIndex,
      expectedTrayRevision: gameState.trayRevision,
      expectedReserveRevision: gameState.reserveRevision,
    })
  }

  function clearPieceSelection() {
    setSelectedTrayIndex(null)
    setSelectedReserveIndex(null)
    setSelectedPieceId(null)
  }

  function handleTrayClick(index: number) {
    if (!gameState) return
    if (selectedPiece) {
      if (selectedPiece.ownerPlayerId !== playerId) return
      if (selectedFormation?.fixed) return
      emitAction({
        action: 'DEPLOY_TRAY_PIECE',
        trayIndex: index,
        x: selectedPiece.x,
        y: selectedPiece.y,
        expectedTrayRevision: gameState.trayRevision,
        expectedBoardRevision: gameState.boardRevision,
      })
      clearPieceSelection()
      return
    }
    if (selectedReserveIndex !== null) {
      moveOrMergeStorage('reserve', selectedReserveIndex, 'tray', index)
      clearPieceSelection()
      return
    }
    if (selectedTrayIndex !== null) {
      if (selectedTrayIndex === index) {
        setSelectedTrayIndex(null)
      }
      else {
        moveOrMergeStorage('tray', selectedTrayIndex, 'tray', index)
        clearPieceSelection()
      }
      return
    }
    if (!gameState.tray[index]) return
    setSelectedTrayIndex(index)
    setSelectedReserveIndex(null)
    setSelectedPieceId(null)
  }

  function handleReserveClick(index: number) {
    if (!gameState) return
    if (selectedPiece) {
      if (selectedPiece.ownerPlayerId !== playerId) return
      if (selectedFormation?.fixed) return
      emitAction({
        action: 'SWAP_RESERVE_BOARD',
        reserveIndex: index,
        x: selectedPiece.x,
        y: selectedPiece.y,
        expectedReserveRevision: gameState.reserveRevision,
        expectedBoardRevision: gameState.boardRevision,
      })
      clearPieceSelection()
      return
    }
    if (selectedTrayIndex !== null) {
      moveOrMergeStorage('tray', selectedTrayIndex, 'reserve', index)
      clearPieceSelection()
      return
    }
    if (selectedReserveIndex !== null) {
      if (selectedReserveIndex === index) {
        setSelectedReserveIndex(null)
      }
      else {
        moveOrMergeStorage('reserve', selectedReserveIndex, 'reserve', index)
        clearPieceSelection()
      }
      return
    }
    if (!gameState.reserve[index]) return
    setSelectedReserveIndex(index)
    setSelectedTrayIndex(null)
    setSelectedPieceId(null)
  }

  function handleExileReserve() {
    if (!gameState || gameState.status !== 'running') return
    if (emitAction({ action: 'EXILE_RESERVE', expectedReserveRevision: gameState.reserveRevision })) {
      setSelectedReserveIndex(null)
    }
  }

  function handleToggleGeneralFixed() {
    if (!gameState || !selectedFormation) return
    emitAction({
      action: 'SET_GENERAL_FIXED',
      formationId: selectedFormation.formationId,
      fixed: !selectedFormation.fixed,
      expectedBoardRevision: gameState.boardRevision,
    })
  }

  function handleCellClick(x: number, y: number) {
    if (!gameState) return
    const target = findPieceAtCell(gameState.boardPieces, x, y)

    if (selectedTrayIndex !== null) {
      const trayPiece = gameState.tray[selectedTrayIndex]
      if (!trayPiece || !isTerrainDeployableCell(x, y)) return

      if (target) {
        if (target.ownerPlayerId !== playerId) return
        const canMerge = trayPiece.kind === 'soldier'
          && target.kind === 'soldier'
          && trayPiece.soldierType === target.soldierType
          && trayPiece.level === target.level
          && (target.level ?? 1) < 5

        if (canMerge) {
          emitAction({
            action: 'MERGE_SOLDIERS',
            sourceEntityId: trayPiece.entityId,
            targetEntityId: target.entityId,
            expectedTrayRevision: gameState.trayRevision,
            expectedBoardRevision: gameState.boardRevision,
          })
        }
        else {
          emitAction({ action: 'DEPLOY_TRAY_PIECE', trayIndex: selectedTrayIndex, x, y, expectedTrayRevision: gameState.trayRevision, expectedBoardRevision: gameState.boardRevision })
        }
      }
      else {
        emitAction({ action: 'DEPLOY_TRAY_PIECE', trayIndex: selectedTrayIndex, x, y, expectedTrayRevision: gameState.trayRevision, expectedBoardRevision: gameState.boardRevision })
      }
      setSelectedTrayIndex(null)
      return
    }

    if (selectedReserveIndex !== null && selectedReservePiece) {
      if (!isTerrainDeployableCell(x, y) || (target && target.ownerPlayerId !== playerId)) return
      if (target && canMergeSoldiers(selectedReservePiece, target)) {
        emitAction({
          action: 'MERGE_SOLDIERS',
          sourceEntityId: selectedReservePiece.entityId,
          targetEntityId: target.entityId,
          expectedTrayRevision: gameState.trayRevision,
          expectedReserveRevision: gameState.reserveRevision,
          expectedBoardRevision: gameState.boardRevision,
        })
      }
      else {
        emitAction({
          action: 'SWAP_RESERVE_BOARD',
          reserveIndex: selectedReserveIndex,
          x,
          y,
          expectedReserveRevision: gameState.reserveRevision,
          expectedBoardRevision: gameState.boardRevision,
        })
      }
      setSelectedReserveIndex(null)
      return
    }

    if (selectedPiece) {
      if (selectedFormation?.fixed) {
        if (target && selectedFormation.characterEntityIds.includes(target.entityId)) {
          setSelectedPieceId(target.entityId)
          return
        }
        if (!target && selectedPiece.ownerPlayerId === playerId && isTerrainDeployableCell(x, y)) {
          emitAction({
            action: 'MOVE_FIXED_GENERAL',
            formationId: selectedFormation.formationId,
            x,
            y,
            expectedBoardRevision: gameState.boardRevision,
          })
        }
        setSelectedPieceId(null)
        return
      }
      if (target) {
        if (target.entityId === selectedPiece.entityId) {
          setSelectedPieceId(null)
          return
        }
        const canMerge = target.ownerPlayerId === playerId
          && selectedPiece.ownerPlayerId === playerId
          && target.entityId !== selectedPiece.entityId
          && target.kind === 'soldier'
          && selectedPiece.kind === 'soldier'
          && target.soldierType === selectedPiece.soldierType
          && target.level === selectedPiece.level
          && (target.level ?? 1) < 5
        if (canMerge) {
          emitAction({ action: 'MERGE_SOLDIERS', sourceEntityId: selectedPiece.entityId, targetEntityId: target.entityId, expectedBoardRevision: gameState.boardRevision })
        }
        else if (target.ownerPlayerId === playerId && isTerrainDeployableCell(x, y)) {
          emitAction({ action: 'MOVE_BOARD_PIECE', entityId: selectedPiece.entityId, x, y, expectedBoardRevision: gameState.boardRevision })
        }
        setSelectedPieceId(null)
        return
      }
      if (selectedPiece.ownerPlayerId === playerId && isTerrainDeployableCell(x, y)) {
        emitAction({ action: 'MOVE_BOARD_PIECE', entityId: selectedPiece.entityId, x, y, expectedBoardRevision: gameState.boardRevision })
      }
      setSelectedPieceId(null)
      return
    }

    if (target?.ownerPlayerId === playerId) {
      setSelectedPieceId(target.entityId)
      setSelectedTrayIndex(null)
      setSelectedReserveIndex(null)
    }
  }

  function leaveGame() {
    document.body.classList.remove('crisis-overload-active')
    navigate(`/room/${encodeURIComponent(roomId)}`, { state: { suppressAutoResume: true } })
  }

  function handleSelectLevel(levelId: number) {
    setError(null)
    setPendingLevelId(levelId)
    setMissionBriefingDismissed(true)
    const socket = socketRef.current
    if (!socket?.connected) {
      setPendingLevelId(null)
      setMissionBriefingDismissed(false)
      setError('WebSocket 尚未连接。')
      return
    }
    socket.emit('SELECT_LEVEL', { levelId })
  }

  return (
    <main className="gaming-page">
      <div className="cyber-background" />
      <div className="cyber-noise" />
      <button type="button" onClick={() => setIsLeaveConfirmOpen(true)} className="gaming-exit-fab"><OctagonX className="h-3.5 w-3.5" /><span>退出</span></button>
      <CrisisWarning overloadTicks={gameState?.overloadTicks ?? 0} overloadCountdownSec={gameState?.overloadCountdownSec ?? 0} enemyCount={gameState?.enemies.length ?? 0} maxCapacity={gameState?.maxCapacity ?? 10} />

      <section className="gaming-shell">
        <div className="gaming-stage">
          <aside className="gaming-side-rail gaming-side-rail-build">
            <div className="gaming-side-rail-scroll">
              {error ? <section className="gaming-panel-card"><p className="gaming-error-text">{error}</p></section> : null}
              <section className="gaming-panel-card gaming-recruit-panel">
                <p className="gaming-section-label">召唤托盘</p>
                <p className="gaming-recruit-help">可与备战席、棋盘互换；同类同级直接升级</p>
                <div className="gaming-summon-tray">
                  {Array.from({ length: 5 }, (_, index) => {
                    const piece = gameState?.tray[index] ?? null
                    return (
                      <button
                        key={index}
                        type="button"
                        draggable={Boolean(piece)}
                        className={cx('gaming-tray-slot', selectedTrayIndex === index && 'gaming-tray-slot-active', piece?.kind === 'character' && 'gaming-tray-slot-character')}
                        onClick={() => handleTrayClick(index)}
                        onDragStart={(event) => {
                          if (!piece) {
                            event.preventDefault()
                            return
                          }
                          event.dataTransfer.effectAllowed = 'move'
                          event.dataTransfer.setData('application/x-agenstd-tray-index', String(index))
                          event.dataTransfer.setData('application/x-agenstd-storage-piece', JSON.stringify({ zone: 'tray', index }))
                          setSelectedTrayIndex(index)
                          setSelectedReserveIndex(null)
                          setSelectedPieceId(null)
                        }}
                        onDragOver={(event) => {
                          if (event.dataTransfer.types.includes('application/x-agenstd-storage-piece')) {
                            event.preventDefault()
                            event.dataTransfer.dropEffect = 'move'
                          }
                        }}
                        onDrop={(event) => {
                          const rawSource = event.dataTransfer.getData('application/x-agenstd-storage-piece')
                          if (!rawSource) return
                          event.preventDefault()
                          try {
                            const source = JSON.parse(rawSource) as { zone?: unknown, index?: unknown }
                            if ((source.zone === 'tray' || source.zone === 'reserve') && Number.isInteger(source.index)) {
                              moveOrMergeStorage(source.zone, source.index as number, 'tray', index)
                              clearPieceSelection()
                            }
                          }
                          catch {
                            // Ignore malformed browser drag data.
                          }
                        }}
                        aria-label={piece ? `${piece.glyph}${piece.level ? `${piece.level}级` : ''}` : `空托盘${index + 1}`}
                      >
                        {piece ? <><span className="gaming-tray-glyph">{piece.glyph}</span>{piece.level ? <span className="gaming-tray-level">{piece.level}</span> : null}</> : <span className="gaming-tray-empty">空</span>}
                      </button>
                    )
                  })}
                </div>
                <button type="button" className="gaming-recruit-button" disabled={recruitDisabled} onClick={handleRecruit}>
                  <RefreshCw className="h-4 w-4" />
                  <span>召唤</span>
                  <strong>{gameState?.nextRecruitCost ?? 5} 斋饭</strong>
                </button>
                <p className="gaming-recruit-rule">每次刷新全部5格；首次召唤必含天兵</p>
                <div className="gaming-reserve-panel">
                  <div className="gaming-reserve-heading">
                    <div>
                      <p className="gaming-section-label">备战席</p>
                      <p className="gaming-recruit-help">不占人口 · 支持托盘、棋盘拖入或互换</p>
                    </div>
                    <button type="button" className="gaming-exile-button" disabled={!gameState || gameState.status !== 'running'} onClick={handleExileReserve}>流放</button>
                  </div>
                  <div className="gaming-reserve-row">
                    {Array.from({ length: 2 }, (_, index) => {
                      const piece = gameState?.reserve[index] ?? null
                      return (
                        <button
                          key={index}
                          type="button"
                          draggable={Boolean(piece)}
                          className={cx('gaming-tray-slot gaming-reserve-slot', selectedReserveIndex === index && 'gaming-tray-slot-active', piece?.kind === 'character' && 'gaming-tray-slot-character')}
                          onClick={() => handleReserveClick(index)}
                          onDragStart={(event) => {
                            if (!piece) {
                              event.preventDefault()
                              return
                            }
                            event.dataTransfer.effectAllowed = 'move'
                            event.dataTransfer.setData('application/x-agenstd-reserve-index', String(index))
                            event.dataTransfer.setData('application/x-agenstd-storage-piece', JSON.stringify({ zone: 'reserve', index }))
                            setSelectedReserveIndex(index)
                            setSelectedTrayIndex(null)
                            setSelectedPieceId(null)
                          }}
                          onDragOver={(event) => {
                            if (event.dataTransfer.types.includes('application/x-agenstd-storage-piece')) {
                              event.preventDefault()
                              event.dataTransfer.dropEffect = 'move'
                            }
                          }}
                          onDrop={(event) => {
                            const rawSource = event.dataTransfer.getData('application/x-agenstd-storage-piece')
                            if (!rawSource) return
                            event.preventDefault()
                            try {
                              const source = JSON.parse(rawSource) as { zone?: unknown, index?: unknown }
                              if ((source.zone === 'tray' || source.zone === 'reserve') && Number.isInteger(source.index)) {
                                moveOrMergeStorage(source.zone, source.index as number, 'reserve', index)
                                clearPieceSelection()
                              }
                            }
                            catch {
                              // Ignore malformed browser drag data.
                            }
                          }}
                          aria-label={piece ? `备战席${index + 1}：${piece.glyph}${piece.level ? `${piece.level}级` : ''}` : `备战席空位${index + 1}`}
                        >
                          {piece ? <><span className="gaming-tray-glyph">{piece.glyph}</span>{piece.level ? <span className="gaming-tray-level">{piece.level}</span> : null}</> : <span className="gaming-tray-empty">空</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </section>

              {selectedPiece ? (
                <section className={cx(
                  'gaming-selected-card gaming-selected-card-compact',
                  selectedGeneralProgress && `gaming-general-card gaming-general-quality-${selectedGeneralProgress.quality}`,
                )}>
                  <div className="gaming-piece-summary">
                    <span className="gaming-piece-summary-glyph">{selectedFormationGlyphs.length > 0 ? selectedFormationGlyphs.join('') : selectedPiece.glyph}</span>
                    <div>
                      <p className="font-semibold text-white">{selectedFormation?.name ?? (selectedPiece.kind === 'soldier' ? SOLDIER_LABELS[selectedPiece.soldierType ?? ''] ?? '天兵' : '神将字符')}</p>
                      <p className="text-xs text-cyan-100/65">{selectedGeneralProgress
                        ? `${selectedGeneralProgress.level}/${selectedGeneralProgress.maxLevel}级 · ${selectedGeneralProgress.activeSkillName}`
                        : selectedPiece.kind === 'soldier'
                          ? `${selectedPiece.level ?? 1}级 · 选择同类同级合成`
                          : '汉字不占人口'}</p>
                    </div>
                  </div>
                  {selectedFormation && selectedGeneralProgress ? (
                    <div className="gaming-general-details">
                      <div className="gaming-general-badges">
                        <span>{GENERAL_QUALITY_LABELS[selectedGeneralProgress.quality]}</span>
                        <span>{GENERAL_ARCHETYPE_LABELS[selectedGeneralProgress.archetype]}</span>
                        <span>Lv.{selectedGeneralProgress.level}/{selectedGeneralProgress.maxLevel}</span>
                      </div>
                      <p className="gaming-general-recipe">组合字：{selectedFormationGlyphs.join(' + ') || selectedFormation.name}</p>
                      <div className="gaming-general-experience">
                        <div><span>经验 {(selectedGeneralProgress.experiencePoints / 1000).toFixed(1)}</span><span>{selectedGeneralProgress.experienceToNextLevel === null ? '已满级' : `还需 ${(selectedGeneralProgress.experienceToNextLevel / 1000).toFixed(1)}`}</span></div>
                        <i><b style={{ width: `${Math.max(0, Math.min(100, selectedGeneralExperienceRatio * 100))}%` }} /></i>
                      </div>
                      <div className="gaming-general-stat-grid" aria-label="神将五维属性">
                        <span><small>攻击</small><strong>{selectedGeneralProgress.attack}</strong></span>
                        <span><small>攻速</small><strong>{selectedGeneralProgress.attackIntervalMs > 0 ? (1000 / selectedGeneralProgress.attackIntervalMs).toFixed(2) : '0.00'}/s</strong></span>
                        <span><small>射程</small><strong>{(selectedGeneralProgress.attackRangeMilliCells / 1000).toFixed(1)}格</strong></span>
                        <span><small>暴击</small><strong>{(selectedGeneralProgress.critChanceBps / 100).toFixed(0)}%</strong></span>
                        <span><small>暴伤</small><strong>{(selectedGeneralProgress.critDamageBps / 100).toFixed(0)}%</strong></span>
                      </div>
                      <p className="gaming-general-skill"><strong>{selectedGeneralProgress.activeSkillName}</strong><span>自动释放 · CD {(selectedGeneralProgress.activeSkillCooldownMs / 1000).toFixed(1)}s · {selectedGeneralProgress.activeSkillReadyAtTick <= (gameState?.tick ?? 0) ? '已就绪' : '冷却中'}</span></p>
                      <p className="gaming-general-synergies">羁绊：{selectedGeneralSynergies.map((synergy) => `${synergy.name} Lv.${synergy.level}`).join('、') || '尚未激活'}</p>
                      <div className="gaming-general-fixed-row">
                        <span>{selectedFormation.fixed ? '组合已固定，可整体迁移' : '组合未固定，可拆分字符'}</span>
                        <button type="button" className="gaming-exile-button" onClick={handleToggleGeneralFixed}>
                          {selectedFormation.fixed ? '解除固定' : '固定神将'}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </section>
              ) : null}
            </div>
          </aside>

          <GamingBoard
            gameState={gameState}
            sceneTheme={LEVEL_DEFS.find(({ levelId }) => levelId === selectedLevelPreview?.levelId)?.sceneTheme}
            selectedPieceId={selectedPieceId}
            placementMode={selectedTrayIndex !== null || selectedReserveIndex !== null || selectedPieceId !== null}
            hoveredCell={hoveredCell}
            onCellClick={handleCellClick}
            onCellHover={(x, y) => setHoveredCell({ x, y })}
            onCellLeave={() => setHoveredCell(null)}
          />

          <aside className="gaming-side-rail gaming-side-rail-right">
            <section className="gaming-panel-card">
              <p className="gaming-section-label">战场状态</p>
              <div className="gaming-status-stack">
                <div className="gaming-status-row"><Coins className="h-4 w-4 text-amber-300" /><span>斋饭</span><strong>{gameState?.rice ?? 0}</strong></div>
                <div className="gaming-status-row"><Users className="h-4 w-4 text-cyan-300" /><span>人口</span><strong>{gameState?.populationUsed ?? 0}/{gameState?.populationCap ?? 10}</strong></div>
                <div className="gaming-status-row"><Skull className="h-4 w-4 text-red-300" /><span>活跃小怪</span><strong>{gameState?.enemies.length ?? 0}</strong></div>
                <div className="gaming-status-row"><ShieldAlert className="h-4 w-4 text-orange-300" /><span>当前波次</span><strong>{gameState?.currentWave.index ?? 0}{gameState?.maxWaves ? `/${gameState.maxWaves}` : ''}</strong></div>
                {(gameState?.currentWave.prepCountdownSec ?? 0) > 0 ? (
                  <div className="gaming-status-row"><Timer className="h-4 w-4 text-violet-300" /><span>出怪倒计时</span><strong>{gameState?.currentWave.prepCountdownSec}s</strong></div>
                ) : null}
              </div>
            </section>
            <section className="gaming-panel-card">
              <p className="gaming-section-label">已激活羁绊</p>
              <div className="gaming-synergy-list">
                {(gameState?.activeSynergies.length ?? 0) > 0 ? gameState?.activeSynergies.map((synergy) => (
                  <div className="gaming-synergy-entry" key={synergy.synergyId}>
                    <div><strong>{synergy.name}</strong><span>Lv.{synergy.level}</span></div>
                    <p>成员：{synergy.contributingGeneralIds.map(generalDisplayName).join('、') || '等待成员投影'}</p>
                  </div>
                )) : <p className="gaming-synergy-empty">当前阵容暂无已激活羁绊</p>}
              </div>
            </section>
            <section className="gaming-panel-card">
              <p className="gaming-section-label">战斗效果</p>
              <div className="gaming-effect-summary" aria-label="召唤物、效果区域和敌人状态">
                <span><strong>{gameState?.summonedUnits.length ?? 0}</strong><small>召唤物</small></span>
                <span><strong>{gameState?.zones.length ?? 0}</strong><small>效果区域</small></span>
                <span><strong>{gameState?.statuses.length ?? 0}</strong><small>状态层</small></span>
              </div>
              {(gameState?.statuses.length ?? 0) > 0 ? (
                <div className="gaming-effect-list">
                  {gameState?.statuses.slice(0, 5).map((status) => (
                    <p key={status.instanceId}>
                      <strong>{STATUS_LABELS[status.statusId] ?? status.statusId}</strong>
                      <span>{gameState.enemies.find((enemy) => enemy.entityId === status.enemyId)?.glyph ?? '怪'} · {status.stacks > 1 ? `${status.stacks}层 · ` : ''}{status.magnitude !== 0 ? `强度 ${status.magnitude}` : '生效中'}</span>
                    </p>
                  ))}
                  {gameState && gameState.statuses.length > 5 ? <small>另有 {gameState.statuses.length - 5} 个状态，战场上以黄字标记</small> : null}
                </div>
              ) : <p className="gaming-synergy-empty gaming-effect-empty">当前没有持续中的控制或易损效果</p>}
              {(gameState?.recentEvents.length ?? 0) > 0 ? (
                <div className="gaming-event-list">
                  {[...(gameState?.recentEvents ?? [])].slice(-4).reverse().map((event) => (
                    <p key={event.id}><span>{COMBAT_EVENT_LABELS[event.type] ?? event.type}</span><small>T{event.tick}</small></p>
                  ))}
                </div>
              ) : null}
            </section>
            <section className="gaming-panel-card">
              <p className="gaming-section-label">操作提示</p>
              <div className="gaming-operation-guide">
                <p>托盘天兵 → 同类同级天兵：直接升级</p>
                <p>托盘、备战席、棋盘任意两处可交换或合成</p>
                <p>备战席单位不占人口</p>
                <p>流放：清空备战席中的全部单位</p>
                <p>2/3/4 字神将按配方横向连续排列自动组成；固定后可整体迁移</p>
              </div>
            </section>
            {selectedLevelPreview ? <section className="gaming-panel-card"><p className="gaming-section-label">已选关卡</p><h2 className="mt-2 text-lg font-semibold text-white">{selectedLevelPreview.label}</h2><p className="mt-2 text-sm leading-6 text-slate-300">{selectedLevelPreview.description}</p></section> : null}
          </aside>
        </div>
      </section>

      {isLeaveConfirmOpen ? (
        <div className="cyber-modal-backdrop" onClick={() => setIsLeaveConfirmOpen(false)}>
          <div className="gaming-confirm-panel" onClick={(event) => event.stopPropagation()}>
            <p className="gaming-confirm-eyebrow">Exit Match</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[0.08em] text-white">确认退出游戏？</h2>
            <p className="mt-3 text-sm leading-7 text-slate-300">确认后将离开当前对局，并返回等待房间页面。</p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setIsLeaveConfirmOpen(false)} className="gaming-confirm-button gaming-confirm-button-muted">取消</button>
              <button type="button" onClick={leaveGame} className="gaming-confirm-button gaming-confirm-button-danger">确认退出</button>
            </div>
          </div>
        </div>
      ) : null}

      {shouldShowMissionBriefing ? <MissionBriefingModal isHost={isHost} playerKind={playerKind} onSelectLevel={handleSelectLevel} engineError={error} /> : null}
      {gameState?.result?.outcome ? <GameOverOverlay outcome={gameState.result.outcome} currentLevelId={selectedLevelInfo?.levelId ?? null} actionLog={[]} onLeave={leaveGame} /> : null}
    </main>
  )
}
