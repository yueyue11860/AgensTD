import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Coins, Crosshair, OctagonX, RefreshCw, ShieldAlert, Skull, Sparkles, Timer, Users, Volume2, VolumeX } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { io, type Socket } from 'socket.io-client'
import { GameOverOverlay } from '../components/game-over-overlay'
import { MissionBriefingModal, type PveStageChoice } from '../components/mission-briefing-modal'
import { PveOnboardingCoach } from '../components/pve-onboarding-coach'
import { BattleChapterDirector, BattlefieldDomSummary } from '../components/battlefield-accessibility-layer'
import { usePlayerAccount, type PveDifficulty } from '../hooks/use-player-account'
import { useModalFocus } from '../hooks/use-modal-focus'
import { cx } from '../lib/cx'
import { LEVEL_DEFS } from '../lib/level-defs'
import { resolveGatewayToken, resolvePlayerId, resolvePlayerKind, resolvePlayerName, resolveSocketUrl } from '../lib/runtime-config'
import type { CombatTargetGeometry, EntityDelta, GameState as NetworkGameState, GameStatePatch, TickEnvelope } from '../../shared/contracts/game'
import { applyPveDeltaToGameState } from '../../shared/contracts/pve-state-delta'
import type { PveSceneTheme } from '../../shared/contracts/pve-stage-config'
import {
  createConnectionRecoveryState,
  isAuthenticationFailure,
  isAuthoritativeFullTick,
  parsePlayerConnectionState,
  reduceConnectionRecovery,
  type ConnectionRecoveryState,
} from '../game/network/connection-recovery'
import { useDeadlineCountdown } from '../hooks/use-deadline-countdown'
import { usePveOnboarding } from '../game/onboarding/use-pve-onboarding'
import {
  baselineCombatEventStream,
  CLIENT_COMBAT_PRESENTATION_VERSION,
  classifyStateEnvelope,
  createCombatEventStreamState,
  isCombatEventBatch,
  mergeCombatEventBatch,
  mergeCombatEventsIntoGameState,
} from '../game/network/combat-event-stream'
import { parseCombatTargetGeometry } from '../game/presentation/combat-presentation-adapter'

const BOARD_DIMENSION = 29
const DEFAULT_ROOM_ID = 'public-1'
const AUDIO_PREFS_STORAGE_KEY = 'agenstd.combat-audio.v1'

function readCombatAudioPreferences(): { muted: boolean, masterVolume: number } {
  if (typeof window === 'undefined') return { muted: false, masterVolume: 0.45 }
  try {
    const stored = JSON.parse(window.localStorage.getItem(AUDIO_PREFS_STORAGE_KEY) ?? 'null') as unknown
    if (!isObject(stored)) return { muted: false, masterVolume: 0.45 }
    return {
      muted: stored.muted === true,
      masterVolume: Math.min(1, Math.max(0, typeof stored.masterVolume === 'number' ? stored.masterVolume : 0.45)),
    }
  }
  catch {
    return { muted: false, masterVolume: 0.45 }
  }
}

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
  entityKind: 'ordinary_minion' | 'boss'
  bossDefinitionId: string | null
  bossName: string | null
  controlResistanceBps: number
  bossPhase: number
  activeCast: {
    skillId: string
    skillName: string
    startedAtTick: number
    executeAtTick: number
    targetPlayerIds: string[]
    actionId?: string
    targetIds?: string[]
    geometry?: CombatTargetGeometry | null
  } | null
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
  actionId?: string
  targetIds?: string[]
  geometry?: CombatTargetGeometry | null
}

interface ServerWaveState {
  index: number
  label?: string
  prepCountdownSec?: number
}

interface ServerActiveItemState {
  itemId: string
  name: string
  slotIndex: 0 | 1
  chargesRemaining: number
  cooldownEndsAtTick: number
  runtimeVersion: number
  targetingKind: 'none' | 'active_general' | 'battlefield_point' | 'character_token' | 'discarded_character_to_empty_slot' | string
  enabled: boolean
}

interface ServerDiscardedCharacterState {
  entityId: string
  glyph: string
  createdSequence: number
}

interface SelectedLevelInfo {
  levelId: number
  difficulty: PveDifficulty
  label: string
  description: string
  waveCount: number
  targetClearRate: number
  minPlayers: number
}

interface ServerDrivenGameState {
  matchId: string | null
  roomId: string
  phase: RoomPhase
  tick: number
  tickRateMs: number
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
  activeItems: Array<ServerActiveItemState | null>
  discardedCharacters: ServerDiscardedCharacterState[]
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
  ACTIVE_ITEM_USED: '主动道具生效',
  ACTIVE_ITEM_REJECTED: '主动道具使用失败',
  BOSS_SPAWNED: 'Boss 登场',
  BOSS_CAST_WARNING: 'Boss 技能预警',
  BOSS_SKILL_CAST: 'Boss 释放技能',
  BOSS_SKILL_ENDED: 'Boss 技能结束',
  BOSS_PHASE_CHANGED: 'Boss 进入新阶段',
  BOSS_SKILL_PLUGIN_ERROR: 'Boss 技能异常',
  BOSS_DIED: 'Boss 已击败',
}

function combatEventDisplay(event: ServerCombatEventState) {
  const base = COMBAT_EVENT_LABELS[event.type] ?? event.type
  const bossName = typeof event.data.bossName === 'string'
    ? event.data.bossName
    : typeof event.data.bossDefinitionId === 'string'
      ? event.data.bossDefinitionId
      : ''
  const skillName = typeof event.data.skillName === 'string'
    ? event.data.skillName
    : typeof event.data.skillId === 'string'
      ? event.data.skillId
      : ''
  if (bossName && skillName) return `${base} · ${bossName}「${skillName}」`
  if (skillName) return `${base} · ${skillName}`
  if (bossName) return `${base} · ${bossName}`
  return base
}

const ACTIVE_ITEM_PRESENTATION: Record<string, { name: string; targetingKind: ServerActiveItemState['targetingKind'] }> = {
  change_character_brush: { name: '点将笔', targetingKind: 'character_token' },
  cultivation_pill: { name: '修为丹', targetingKind: 'active_general' },
  general_ascension_talisman: { name: '神将符', targetingKind: 'active_general' },
  rerecruit_order: { name: '再征令', targetingKind: 'none' },
  soul_recall_banner: { name: '招魂幡', targetingKind: 'discarded_character_to_empty_slot' },
  heavenly_thunder_order: { name: '天雷令', targetingKind: 'battlefield_point' },
  wind_stilling_talisman: { name: '定风符', targetingKind: 'battlefield_point' },
  war_drum_order: { name: '战鼓令', targetingKind: 'active_general' },
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
  slots: RoomConnectionSlot[]
} {
  return isObject(value)
    && typeof value.id === 'string'
    && Array.isArray(value.slots)
    && value.slots.every((slot) => isObject(slot) && typeof slot.slotId === 'string' && typeof slot.isHost === 'boolean')
}

interface RoomConnectionSlot {
  slotId: string
  playerId: string | null
  playerName?: string | null
  connected?: boolean
  connectionState?: 'connected' | 'reconnecting' | 'disconnected'
  reconnectDeadlineAt?: number
  reconnectRemainingMs?: number
  isHost: boolean
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
  const rawActiveCast = isObject(rawEnemy.activeCast) ? rawEnemy.activeCast : null
  const activeCast = rawActiveCast
    && typeof rawActiveCast.skillId === 'string'
    && typeof rawActiveCast.executeAtTick === 'number'
    ? {
        skillId: rawActiveCast.skillId,
        skillName: typeof rawActiveCast.skillName === 'string' ? rawActiveCast.skillName : rawActiveCast.skillId,
        startedAtTick: readNumber(rawActiveCast, 'startedAtTick', rawActiveCast.executeAtTick),
        executeAtTick: rawActiveCast.executeAtTick,
      targetPlayerIds: Array.isArray(rawActiveCast.targetPlayerIds)
          ? rawActiveCast.targetPlayerIds.filter((id): id is string => typeof id === 'string')
          : [],
        ...(typeof rawActiveCast.actionId === 'string' ? { actionId: rawActiveCast.actionId } : {}),
        ...(Array.isArray(rawActiveCast.targetIds)
          ? { targetIds: rawActiveCast.targetIds.filter((id): id is string => typeof id === 'string') }
          : {}),
        ...(rawActiveCast.geometry !== undefined
          ? { geometry: parseCombatTargetGeometry(rawActiveCast.geometry) }
          : {}),
      }
    : null
  return {
    entityId,
    entityKind: rawEnemy.entityKind === 'boss' ? 'boss' : 'ordinary_minion',
    bossDefinitionId: typeof rawEnemy.bossDefinitionId === 'string' ? rawEnemy.bossDefinitionId : null,
    bossName: typeof rawEnemy.bossName === 'string' ? rawEnemy.bossName : null,
    controlResistanceBps: Math.max(0, readNumber(rawEnemy, 'controlResistanceBps', 0)),
    bossPhase: Math.max(0, Math.floor(readNumber(rawEnemy, 'bossPhase', 0))),
    activeCast,
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
  return {
    id: rawEvent.id,
    tick: rawEvent.tick,
    type: rawEvent.type,
    data,
    ...(typeof rawEvent.actionId === 'string' ? { actionId: rawEvent.actionId } : {}),
    ...(Array.isArray(rawEvent.targetIds)
      ? { targetIds: rawEvent.targetIds.filter((id): id is string => typeof id === 'string') }
      : {}),
    ...(rawEvent.geometry !== undefined ? { geometry: parseCombatTargetGeometry(rawEvent.geometry) } : {}),
  }
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
  const reserve = Array<ServerTrayPieceState | null>(Math.max(2, currentPlayer && Array.isArray(currentPlayer.reserve) ? currentPlayer.reserve.length : 0)).fill(null)
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
  const rawItemRuntime = currentPlayer && isObject(currentPlayer.itemRuntime) ? currentPlayer.itemRuntime : null
  const itemRuntimeVersion = readNumber(rawItemRuntime, 'version', 0)
  const rawActiveItems = rawItemRuntime && Array.isArray(rawItemRuntime.slots)
    ? rawItemRuntime.slots
    : currentPlayer && Array.isArray(currentPlayer.activeItems)
      ? currentPlayer.activeItems
      : []
  const activeItems: Array<ServerActiveItemState | null> = [0, 1].map((slotIndex) => {
    const rawItem = rawActiveItems[slotIndex]
    if (!isObject(rawItem) || typeof rawItem.itemId !== 'string') return null
    const definition = ACTIVE_ITEM_PRESENTATION[rawItem.itemId]
    const targeting = isObject(rawItem.targeting) ? rawItem.targeting : null
    return {
      itemId: rawItem.itemId,
      name: typeof rawItem.name === 'string' ? rawItem.name : definition?.name ?? rawItem.itemId,
      slotIndex: slotIndex as 0 | 1,
      chargesRemaining: readNumber(rawItem, 'chargesRemaining', 0),
      cooldownEndsAtTick: readNumber(rawItem, 'cooldownEndsAtTick', 0),
      runtimeVersion: readNumber(rawItem, 'runtimeVersion', itemRuntimeVersion),
      targetingKind: typeof targeting?.kind === 'string'
        ? targeting.kind
        : typeof rawItem.targetingKind === 'string'
          ? rawItem.targetingKind
          : definition?.targetingKind ?? 'none',
      enabled: rawItem.enabled !== false,
    }
  })
  const discardedCharacters: ServerDiscardedCharacterState[] = currentPlayer && Array.isArray(currentPlayer.discardedCharacters)
    ? currentPlayer.discardedCharacters.flatMap((rawToken) => {
        if (!isObject(rawToken)) return []
        const entityId = typeof rawToken.entityId === 'string'
          ? rawToken.entityId
          : typeof rawToken.id === 'string'
            ? rawToken.id
            : null
        if (!entityId || typeof rawToken.glyph !== 'string') return []
        return [{
          entityId,
          glyph: rawToken.glyph,
          createdSequence: readNumber(rawToken, 'createdSequence', 0),
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
    matchId: typeof candidate.matchId === 'string' ? candidate.matchId : null,
    roomId: typeof candidate.roomId === 'string' ? candidate.roomId : DEFAULT_ROOM_ID,
    phase: candidate.phase === 'countdown' || candidate.phase === 'waiting_for_level' || candidate.phase === 'playing' ? candidate.phase : 'lobby',
    tick: candidate.tick,
    tickRateMs: Math.max(1, readNumber(candidate, 'tickRateMs', 100)),
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
    activeItems,
    discardedCharacters,
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
    pve: applyPveDeltaToGameState(previous, envelope.patch),
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

function LeaveConfirmDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const dialogRef = useModalFocus(onCancel)
  return (
    <div className="cyber-modal-backdrop" onClick={onCancel}>
      <div
        ref={dialogRef}
        className="gaming-confirm-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="leave-match-dialog-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="gaming-confirm-eyebrow">Exit Match</p>
        <h2 id="leave-match-dialog-title" className="mt-3 text-2xl font-semibold tracking-[0.08em] text-white">确认退出游戏？</h2>
        <p className="mt-3 text-sm leading-7 text-slate-300">确认后将离开当前对局，并返回等待房间页面。</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} className="gaming-confirm-button gaming-confirm-button-muted">取消</button>
          <button type="button" onClick={onConfirm} className="gaming-confirm-button gaming-confirm-button-danger">确认退出</button>
        </div>
      </div>
    </div>
  )
}

function TeammateConnectionRow({ slot, selfPlayerId }: { slot: RoomConnectionSlot, selfPlayerId: string }) {
  const remainingSeconds = useDeadlineCountdown(slot.reconnectDeadlineAt ?? null)
  const reconnecting = slot.connectionState === 'reconnecting'
  const label = slot.playerId === selfPlayerId ? '你' : slot.playerName ?? slot.playerId ?? '空位'
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-slate-950/35 px-3 py-2 text-xs">
      <span className="truncate text-slate-300">{slot.slotId} · {label}</span>
      <strong className={cx(
        'shrink-0 font-mono',
        slot.connected ? 'text-emerald-300' : reconnecting ? 'text-amber-300' : 'text-slate-500',
      )}>
        {slot.connected
          ? '在线'
          : reconnecting
            ? `重连中 ${remainingSeconds ?? Math.ceil((slot.reconnectRemainingMs ?? 0) / 1000)}秒`
            : slot.playerId ? '已离线' : '待加入'}
      </strong>
    </div>
  )
}

function GamingBoard({ gameState, sceneTheme, selectedPieceId, selectedObjectLabel, executableActions, placementMode, allowAnyTargetCell, hoveredCell, audioMuted, audioMasterVolume, presentationSyncRevision, onCellClick, onCellHover, onCellLeave, onCancelInteraction }: {
  gameState: ServerDrivenGameState | null
  sceneTheme?: PveSceneTheme | null
  selectedPieceId: string | null
  selectedObjectLabel: string
  executableActions: string
  placementMode: boolean
  allowAnyTargetCell?: boolean
  hoveredCell: { x: number; y: number } | null
  audioMuted: boolean
  audioMasterVolume: number
  presentationSyncRevision: number
  onCellClick: (x: number, y: number) => void
  onCellHover: (x: number, y: number) => void
  onCellLeave: () => void
  onCancelInteraction: () => void
}) {
  const summaryId = 'pve-battlefield-dom-summary'
  const bossNames = gameState?.enemies
    .filter(enemy => enemy.entityKind === 'boss')
    .map(enemy => enemy.bossName ?? enemy.glyph) ?? []
  const canPreviewAtHoveredCell = Boolean(
    hoveredCell
    && placementMode
    && (allowAnyTargetCell || isTerrainDeployableCell(hoveredCell.x, hoveredCell.y)),
  )
  return (
    <Suspense fallback={<section className="gaming-board-frame" aria-busy="true"><div className="gaming-board-viewport">正在加载战场引擎…</div></section>}>
      <BattlefieldDomSummary
        id={summaryId}
        wave={gameState?.currentWave.index ?? 0}
        maxWaves={gameState?.maxWaves ?? 0}
        enemyCount={gameState?.enemies.length ?? 0}
        bossNames={bossNames}
        cursor={hoveredCell}
        selectedObject={selectedObjectLabel}
        executableActions={executableActions}
      />
      <PhaserBattlefield
        snapshot={gameState ? {
          tick: gameState.tick,
          tickRateMs: gameState.tickRateMs,
          pieces: gameState.boardPieces,
          enemies: gameState.enemies,
          statuses: gameState.statuses,
          summonedUnits: gameState.summonedUnits,
          zones: gameState.zones,
          recentEvents: gameState.recentEvents,
        } : null}
        terrainMatrix={ARENA_TERRAIN_MATRIX}
        sceneTheme={sceneTheme}
        hoveredCell={hoveredCell}
        selectedPieceId={selectedPieceId}
        selectedPieceCell={gameState?.boardPieces.find(piece => piece.entityId === selectedPieceId) ?? null}
        placementMode={placementMode}
        canPreviewAtHoveredCell={canPreviewAtHoveredCell}
        muted={audioMuted}
        masterVolume={audioMasterVolume}
        presentationSyncRevision={presentationSyncRevision}
        accessibilitySummaryId={summaryId}
        accessibilityLabel={`29×29西游汉字战场，第 ${gameState?.currentWave.index ?? 0} 波。方向键移动格游标，Enter 或空格执行，Escape 取消。`}
        onCancelInteraction={onCancelInteraction}
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
  const awaitingCheckpointRef = useRef(true)
  const terminalDisconnectRef = useRef(false)
  const connectionGraceMsRef = useRef(45_000)
  const stateRevisionRef = useRef(0)
  const combatEventStreamRef = useRef(createCombatEventStreamState())
  const playerAccount = usePlayerAccount()
  const lastItemRejectionRef = useRef<string | null>(null)
  const [gameState, setGameState] = useState<ServerDrivenGameState | null>(null)
  const [combatAudioPreferences, setCombatAudioPreferences] = useState(readCombatAudioPreferences)
  const [roomPhase, setRoomPhase] = useState<RoomPhase>('lobby')
  const [selectedTrayIndex, setSelectedTrayIndex] = useState<number | null>(null)
  const [selectedReserveIndex, setSelectedReserveIndex] = useState<number | null>(null)
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null)
  const [targetingItemSlot, setTargetingItemSlot] = useState<0 | 1 | null>(null)
  const [selectedDiscardedTokenId, setSelectedDiscardedTokenId] = useState<string | null>(null)
  const [hoveredCell, setHoveredCell] = useState<{ x: number; y: number } | null>(null)
  const [isLeaveConfirmOpen, setIsLeaveConfirmOpen] = useState(false)
  const [isBuildDockExpanded, setIsBuildDockExpanded] = useState(() => typeof window === 'undefined' || window.innerWidth >= 1080)
  const [error, setError] = useState<string | null>(null)
  const [selectedLevelInfo, setSelectedLevelInfo] = useState<SelectedLevelInfo | null>(null)
  const [pendingStageSelection, setPendingStageSelection] = useState<PveStageChoice | null>(null)
  const [missionBriefingDismissed, setMissionBriefingDismissed] = useState(false)
  const [mySlot, setMySlot] = useState<string | null>(null)
  const [hostPlayerId, setHostPlayerId] = useState<string | null>(null)
  const [roomSlots, setRoomSlots] = useState<RoomConnectionSlot[]>([])
  const [connectionRecovery, setConnectionRecovery] = useState<ConnectionRecoveryState>(() => createConnectionRecoveryState())
  const reconnectRemainingSeconds = useDeadlineCountdown(connectionRecovery.deadlineAt)

  const isHost = hostPlayerId ? hostPlayerId === playerId : mySlot === 'P1'
  const interactionLocked = connectionRecovery.phase !== 'ready'
  const isAwaitingLevelSelection = roomPhase === 'waiting_for_level' || ((roomPhase === 'lobby' || roomPhase === 'countdown') && gameState?.status === 'waiting')
  const shouldShowMissionBriefing = !missionBriefingDismissed && pendingStageSelection === null && !selectedLevelInfo && !gameState?.result?.outcome && isAwaitingLevelSelection
  const selectedLevelPreview = selectedLevelInfo ?? (pendingStageSelection !== null ? (() => {
    const level = LEVEL_DEFS.find((candidate) => candidate.levelId === pendingStageSelection.levelId)
    return level ? { levelId: level.levelId, difficulty: pendingStageSelection.difficulty, label: level.label, description: level.subtitle, waveCount: 0, targetClearRate: level.clearRate, minPlayers: level.minPlayers } : null
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
  const recruitDisabled = interactionLocked || !gameState || gameState.status !== 'running' || gameState.rice < gameState.nextRecruitCost
  const selectedBattlefieldObject = targetingItemSlot !== null
    ? `主动道具「${gameState?.activeItems[targetingItemSlot]?.name ?? '未知道具'}」`
    : selectedTrayIndex !== null
      ? `召唤托盘第 ${selectedTrayIndex + 1} 格「${gameState?.tray[selectedTrayIndex]?.glyph ?? '空'}」`
      : selectedReserveIndex !== null
        ? `备战席第 ${selectedReserveIndex + 1} 格「${gameState?.reserve[selectedReserveIndex]?.glyph ?? '空'}」`
        : selectedPiece
          ? `棋盘单位「${selectedFormation?.name ?? selectedPiece.glyph}」`
          : '无'
  const battlefieldExecutableActions = targetingItemSlot !== null
    ? '方向键选择格位，Enter 或空格确认道具目标，Escape 取消。'
    : selectedTrayIndex !== null || selectedReserveIndex !== null || selectedPiece !== null
      ? '方向键选择格位，Enter 或空格部署、移动或合成，Escape 取消。'
      : '先选择召唤托盘、备战席或己方棋子；战场聚焦后可用方向键浏览。'
  const onboardingObservation = useMemo(() => gameState ? {
    status: gameState.status,
    currentWave: gameState.currentWave.index,
    nextRecruitCost: gameState.nextRecruitCost,
    trayRevision: gameState.trayRevision,
    boardRevision: gameState.boardRevision,
    tray: gameState.tray,
    reserve: gameState.reserve,
    boardPieces: gameState.boardPieces,
    generalFormations: gameState.generalFormations,
    enemies: gameState.enemies,
    recentEvents: gameState.recentEvents,
    selectedTrayIndex,
  } : null, [gameState, selectedTrayIndex])
  const onboarding = usePveOnboarding(playerId, onboardingObservation)

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
    try {
      window.localStorage.setItem(AUDIO_PREFS_STORAGE_KEY, JSON.stringify(combatAudioPreferences))
    }
    catch {
      // 隐私模式或禁用存储时仅保留本次页面设置。
    }
  }, [combatAudioPreferences])

  useEffect(() => {
    if (reconnectRemainingSeconds !== 0 || connectionRecovery.deadlineAt === null || connectionRecovery.phase === 'ready') return
    setConnectionRecovery((current) => reduceConnectionRecovery(current, { type: 'deadline_tick', now: Date.now() }))
  }, [connectionRecovery.deadlineAt, connectionRecovery.phase, reconnectRemainingSeconds])

  useEffect(() => {
    if (connectionRecovery.phase !== 'expired') return
    setError('重连期限已过，本局席位已释放。你可以返回房间重新加入。')
  }, [connectionRecovery.phase])

  useEffect(() => {
    if (!socketUrl || typeof window === 'undefined') {
      setError('未解析到 WebSocket 地址。')
      return
    }

    stateRevisionRef.current = 0
    combatEventStreamRef.current = createCombatEventStreamState()

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
      const envelope = isObject(payload)
        && (payload.mode === 'full' || payload.mode === 'patch' || payload.mode === 'checkpoint')
        ? payload as unknown as TickEnvelope
        : null
      if (envelope) {
        const decision = classifyStateEnvelope(envelope, stateRevisionRef.current)
        if (decision === 'stale') return
        if (decision === 'gap') {
          awaitingCheckpointRef.current = true
          socket.emit('REQUEST_FULL_STATE')
          return
        }
      }
      const isFull = isAuthoritativeFullTick(payload)
      if (awaitingCheckpointRef.current && !isFull) {
        socket.emit('REQUEST_FULL_STATE')
        return
      }
      const networkState = mergeNetworkTickPayload(payload, latestNetworkState)
      if (!networkState) {
        if (isObject(payload) && (payload.mode === 'patch' || payload.mode === 'checkpoint')) socket.emit('REQUEST_FULL_STATE')
        return
      }
      latestNetworkState = networkState
      stateRevisionRef.current = envelope?.revision ?? networkState.tick
      if (envelope?.mode === 'full' && envelope.presentationVersion === CLIENT_COMBAT_PRESENTATION_VERSION) {
        combatEventStreamRef.current = baselineCombatEventStream(networkState.matchId, envelope.eventSeq)
      }
      else if (envelope?.mode === 'full') {
        combatEventStreamRef.current = createCombatEventStreamState()
      }
      const nextState = normalizeSyncState(networkState, playerId)
      if (nextState) {
        setGameState(nextState)
        if (isFull) {
          awaitingCheckpointRef.current = false
          setConnectionRecovery((current) => reduceConnectionRecovery(current, { type: 'full_snapshot' }))
        }
        setError(null)
      }
    }

    const handleCombatEventBatch = (payload: unknown) => {
      if (!isCombatEventBatch(payload)) return
      const result = mergeCombatEventBatch(combatEventStreamRef.current, payload)
      combatEventStreamRef.current = result.state
      if (result.accepted.length > 0) {
        latestNetworkState = mergeCombatEventsIntoGameState(latestNetworkState, result.accepted)
        const nextState = latestNetworkState ? normalizeSyncState(latestNetworkState, playerId) : null
        if (nextState) setGameState(nextState)
      }
      if (result.ackSeq !== null) {
        socket.emit('COMBAT_EVENT_ACK', {
          matchId: payload.matchId,
          presentationVersion: CLIENT_COMBAT_PRESENTATION_VERSION,
          ackSeq: result.ackSeq,
        })
      }
      if (result.gapFromSeq !== null) {
        socket.emit('REQUEST_COMBAT_EVENTS', {
          matchId: payload.matchId,
          presentationVersion: CLIENT_COMBAT_PRESENTATION_VERSION,
          fromSeq: result.gapFromSeq,
        })
      }
    }
    const handleCombatEventReset = () => {
      awaitingCheckpointRef.current = true
      socket.emit('REQUEST_FULL_STATE')
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
      const difficulty: PveDifficulty = payload.difficulty === 'normal' || payload.difficulty === 'hard' ? payload.difficulty : 'easy'
      setError(null)
      setPendingStageSelection(null)
      setSelectedLevelInfo({ levelId: payload.levelId, difficulty, label: payload.label, description: payload.description, waveCount: payload.waveCount, targetClearRate: payload.targetClearRate, minPlayers: payload.minPlayers })
    }
    const handleRoomSnapshot = (payload: unknown) => {
      if (!isRoomSnapshotPayload(payload)) return
      setRoomSlots(payload.slots)
      setMySlot(payload.slots.find((slot) => slot.playerId === playerId)?.slotId ?? null)
      setHostPlayerId(payload.slots.find((slot) => slot.isHost && typeof slot.playerId === 'string')?.playerId ?? null)
    }
    const handlePlayerConnectionState = (payload: unknown) => {
      const update = parsePlayerConnectionState(payload)
      if (!update) return
      if (update.playerId === playerId) connectionGraceMsRef.current = update.graceMs
      setRoomSlots((current) => current.map((slot) => slot.playerId === update.playerId
        ? {
            ...slot,
            connected: update.status === 'connected',
            connectionState: update.status,
            reconnectDeadlineAt: update.reconnectDeadlineAt ?? undefined,
            reconnectRemainingMs: update.reconnectRemainingMs,
          }
        : slot))
      if (update.playerId === playerId && update.status === 'reconnecting' && update.reconnectDeadlineAt !== null) {
        const deadlineAt = update.reconnectDeadlineAt
        setConnectionRecovery((current) => reduceConnectionRecovery(current, {
          type: 'server_reconnecting', deadlineAt, graceMs: update.graceMs,
        }))
      }
    }
    const handleEngineError = (engineError: unknown) => {
      setPendingStageSelection(null)
      setMissionBriefingDismissed(false)
      if (typeof engineError === 'string') setError(engineError)
      else if (isObject(engineError) && typeof engineError.message === 'string') {
        if (engineError.code === 'RECONNECT_WINDOW_EXPIRED') {
          setConnectionRecovery((current) => ({ ...current, phase: 'expired', deadlineAt: null, message: engineError.message as string }))
        }
        setError(engineError.message)
      }
    }

    const handleConnect = () => {
      terminalDisconnectRef.current = false
      awaitingCheckpointRef.current = true
      setConnectionRecovery((current) => reduceConnectionRecovery(current, { type: 'transport_connected' }))
      setError(null)
      socket.emit('JOIN_ROOM', { roomId, playerId, playerName, playerKind, capabilities: { combatEventBatch: CLIENT_COMBAT_PRESENTATION_VERSION } })
    }
    const handleDisconnect = (reason: Socket.DisconnectReason) => {
      if (terminalDisconnectRef.current || reason === 'io client disconnect') return
      awaitingCheckpointRef.current = true
      const deadlineAt = Date.now() + connectionGraceMsRef.current
      setConnectionRecovery((current) => reduceConnectionRecovery(current, {
        type: 'server_reconnecting', deadlineAt, graceMs: connectionGraceMsRef.current,
      }))
      setRoomSlots((current) => current.map((slot) => slot.playerId === playerId
        ? { ...slot, connected: false, connectionState: 'reconnecting', reconnectDeadlineAt: deadlineAt, reconnectRemainingMs: connectionGraceMsRef.current }
        : slot))
    }
    const handleConnectError = (connectError: Error) => {
      if (isAuthenticationFailure(connectError.message)) {
        socket.io.opts.reconnection = false
        setConnectionRecovery((current) => reduceConnectionRecovery(current, { type: 'auth_failed', message: '登录凭证已失效，请重新登录。' }))
        setError('登录凭证已失效，请重新登录。')
        return
      }
      setError(`暂时无法连接服务器：${connectError.message}`)
    }
    const handleConnectionReplaced = () => {
      socket.io.opts.reconnection = false
      terminalDisconnectRef.current = true
      awaitingCheckpointRef.current = true
      setConnectionRecovery((current) => reduceConnectionRecovery(current, { type: 'replaced' }))
      setError('此账号已在另一个窗口接管本局。')
      socket.disconnect()
    }
    const handleReconnectFailed = () => {
      setError('自动重连未成功。请手动重试，或返回房间重新加入。')
    }
    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('connect_error', handleConnectError)
    socket.on('engine_error', handleEngineError)
    socket.on('TICK_UPDATE', handleTickUpdate)
    socket.on('COMBAT_EVENT_BATCH', handleCombatEventBatch)
    socket.on('COMBAT_EVENT_RESET', handleCombatEventReset)
    socket.on('ROOM_JOINED', handleRoomJoined)
    socket.on('ROOM_SNAPSHOT', handleRoomSnapshot)
    socket.on('PLAYER_CONNECTION_STATE', handlePlayerConnectionState)
    socket.on('PLAYER_CONNECTION_REPLACED', handleConnectionReplaced)
    socket.on('ROOM_PHASE_CHANGED', handleRoomPhaseChanged)
    socket.on('LEVEL_SELECTED', handleLevelSelected)
    socket.io.on('reconnect_failed', handleReconnectFailed)

    return () => {
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
      socket.off('connect_error', handleConnectError)
      socket.off('TICK_UPDATE', handleTickUpdate)
      socket.off('COMBAT_EVENT_BATCH', handleCombatEventBatch)
      socket.off('COMBAT_EVENT_RESET', handleCombatEventReset)
      socket.off('ROOM_JOINED', handleRoomJoined)
      socket.off('ROOM_SNAPSHOT', handleRoomSnapshot)
      socket.off('PLAYER_CONNECTION_STATE', handlePlayerConnectionState)
      socket.off('PLAYER_CONNECTION_REPLACED', handleConnectionReplaced)
      socket.off('ROOM_PHASE_CHANGED', handleRoomPhaseChanged)
      socket.off('LEVEL_SELECTED', handleLevelSelected)
      socket.io.off('reconnect_failed', handleReconnectFailed)
      socket.disconnect()
      socketRef.current = null
    }
  }, [gatewayToken, playerId, playerKind, playerName, roomId, socketUrl])

  useEffect(() => {
    if (roomPhase === 'playing' || gameState?.status === 'running') setPendingStageSelection(null)
  }, [gameState?.status, roomPhase])

  useEffect(() => {
    if (selectedTrayIndex !== null && !gameState?.tray[selectedTrayIndex]) setSelectedTrayIndex(null)
    if (selectedReserveIndex !== null && !gameState?.reserve[selectedReserveIndex]) setSelectedReserveIndex(null)
    if (selectedPieceId && !gameState?.boardPieces.some((piece) => piece.entityId === selectedPieceId)) setSelectedPieceId(null)
    if (targetingItemSlot !== null && !gameState?.activeItems[targetingItemSlot]) setTargetingItemSlot(null)
    if (selectedDiscardedTokenId && !gameState?.discardedCharacters.some((token) => token.entityId === selectedDiscardedTokenId)) {
      setSelectedDiscardedTokenId(null)
    }
  }, [gameState, selectedDiscardedTokenId, selectedPieceId, selectedReserveIndex, selectedTrayIndex, targetingItemSlot])

  useEffect(() => {
    const rejected = [...(gameState?.recentEvents ?? [])].reverse().find((event) => event.type === 'ACTIVE_ITEM_REJECTED')
    if (!rejected || lastItemRejectionRef.current === rejected.id) return
    lastItemRejectionRef.current = rejected.id
    const reason = typeof rejected.data.error === 'string' ? rejected.data.error : '服务端拒绝了该道具目标'
    setError(`道具使用失败：${reason}（未在客户端预扣次数）`)
  }, [gameState?.recentEvents])

  function emitAction(payload: Record<string, unknown>) {
    const socket = socketRef.current
    if (!socket?.connected || interactionLocked || awaitingCheckpointRef.current) {
      setError('权威战局尚未恢复，操作已锁定且不会发送。')
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

  function cancelBattlefieldInteraction() {
    clearPieceSelection()
    setTargetingItemSlot(null)
    setSelectedDiscardedTokenId(null)
    setHoveredCell(null)
    setError(null)
  }

  function useItemOnStoragePiece(zone: StorageZone, index: number) {
    if (!gameState || targetingItemSlot === null) return false
    const item = gameState.activeItems[targetingItemSlot]
    if (!item) return false
    const piece = zone === 'tray' ? gameState.tray[index] : gameState.reserve[index]
    const expectedRevision = zone === 'tray' ? gameState.trayRevision : gameState.reserveRevision
    if (item.targetingKind === 'character_token') {
      if (!piece || piece.kind !== 'character') {
        setError(`使用${item.name}时需要点击一个神将字符。`)
        return true
      }
      useActiveItem(item, { kind: 'piece', pieceId: piece.entityId, expectedRevision })
      return true
    }
    if (item.targetingKind === 'discarded_character_to_empty_slot') {
      const token = gameState.discardedCharacters.find((entry) => entry.entityId === selectedDiscardedTokenId)
      if (!token) {
        setError('请先选择一个弃置字符。')
        return true
      }
      if (piece) {
        setError('招魂幡只能把弃置字符放入空托盘位或空备战位。')
        return true
      }
      useActiveItem(item, {
        kind: 'discarded_character_to_empty_slot',
        tokenId: token.entityId,
        expectedTokenRevision: token.createdSequence,
        destination: {
          zone: zone === 'tray' ? 'summon_tray' : 'reserve',
          index,
          expectedRevision,
        },
      })
      return true
    }
    return false
  }

  function handleTrayClick(index: number) {
    if (!gameState) return
    if (useItemOnStoragePiece('tray', index)) return
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
    if (useItemOnStoragePiece('reserve', index)) return
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

  function useActiveItem(item: ServerActiveItemState, target: Record<string, unknown>) {
    if (!gameState) return false
    const used = emitAction({
      action: 'USE_ACTIVE_ITEM',
      slotIndex: item.slotIndex,
      itemId: item.itemId,
      target,
      expectedItemRuntimeVersion: item.runtimeVersion,
    })
    if (used) {
      setTargetingItemSlot(null)
      setSelectedDiscardedTokenId(null)
    }
    return used
  }

  function handleActiveItemClick(item: ServerActiveItemState) {
    if (!gameState || gameState.status !== 'running') return
    if (!item.enabled || item.chargesRemaining <= 0 || item.cooldownEndsAtTick > gameState.tick) return
    setError(null)
    if (item.targetingKind === 'none') {
      useActiveItem(item, { kind: 'none' })
      return
    }
    if (item.targetingKind === 'active_general') {
      if (!selectedFormation || !selectedGeneralProgress) {
        setError(`使用${item.name}前，请先点击选中一名已激活神将。`)
        return
      }
      useActiveItem(item, { kind: 'general', generalId: selectedFormation.generalId })
      return
    }
    if (item.targetingKind === 'battlefield_point') {
      clearPieceSelection()
      setSelectedDiscardedTokenId(null)
      setTargetingItemSlot((current) => current === item.slotIndex ? null : item.slotIndex)
      return
    }
    if (item.targetingKind === 'character_token') {
      clearPieceSelection()
      setSelectedDiscardedTokenId(null)
      setTargetingItemSlot((current) => current === item.slotIndex ? null : item.slotIndex)
      return
    }
    if (item.targetingKind === 'discarded_character_to_empty_slot') {
      if (gameState.discardedCharacters.length === 0) {
        setError('当前没有可供招魂幡找回的弃置字符。')
        return
      }
      clearPieceSelection()
      setSelectedDiscardedTokenId(gameState.discardedCharacters[0]!.entityId)
      setTargetingItemSlot((current) => current === item.slotIndex ? null : item.slotIndex)
      return
    }
    setError(`${item.name}的目标类型暂不受支持，本次未消耗道具次数。`)
  }

  function handleCellClick(x: number, y: number) {
    if (!gameState) return
    const target = findPieceAtCell(gameState.boardPieces, x, y)
    if (targetingItemSlot !== null) {
      const item = gameState.activeItems[targetingItemSlot]
      if (!item) {
        setTargetingItemSlot(null)
        return
      }
      if (item.targetingKind === 'battlefield_point') {
        useActiveItem(item, { kind: 'battlefield_point', xMilli: x * 1000 + 500, yMilli: y * 1000 + 500 })
        return
      }
      if (item.targetingKind === 'character_token') {
        if (!target || target.ownerPlayerId !== playerId || target.kind !== 'character') {
          setError(`使用${item.name}时需要点击自己的一个神将字符。`)
          return
        }
        useActiveItem(item, { kind: 'piece', pieceId: target.entityId, expectedRevision: gameState.boardRevision })
        return
      }
      if (item.targetingKind === 'discarded_character_to_empty_slot') {
        setError('招魂幡的目标位置只能是空托盘位或空备战位。')
        return
      }
      return
    }

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

  function returnHome() {
    document.body.classList.remove('crisis-overload-active')
    navigate('/home')
  }

  function retryConnection() {
    const socket = socketRef.current
    if (!socket) return
    terminalDisconnectRef.current = false
    awaitingCheckpointRef.current = true
    socket.io.opts.reconnection = true
    setConnectionRecovery((current) => reduceConnectionRecovery(current, { type: 'retry', now: Date.now() }))
    setError(null)
    if (socket.connected) {
      socket.emit('JOIN_ROOM', { roomId, playerId, playerName, playerKind, capabilities: { combatEventBatch: CLIENT_COMBAT_PRESENTATION_VERSION } })
      socket.emit('REQUEST_FULL_STATE')
    }
    else socket.connect()
  }

  function handleSelectLevel(selection: PveStageChoice) {
    setError(null)
    setPendingStageSelection(selection)
    setMissionBriefingDismissed(true)
    const socket = socketRef.current
    if (!socket?.connected || interactionLocked || awaitingCheckpointRef.current) {
      setPendingStageSelection(null)
      setMissionBriefingDismissed(false)
      setError('权威战局尚未恢复，请等待重连完成。')
      return
    }
    socket.emit('SELECT_LEVEL', selection)
  }

  return (
    <main
      className="gaming-page"
      data-authoritative-tick={gameState?.tick ?? 0}
      data-wave={gameState?.currentWave.index ?? 0}
      data-enemy-count={gameState?.enemies.length ?? 0}
      data-overload-ticks={gameState?.overloadTicks ?? 0}
      data-overload-countdown-sec={gameState?.overloadCountdownSec ?? 0}
      data-enemy-capacity={gameState?.maxCapacity ?? 0}
      data-rice={gameState?.rice ?? 0}
      data-next-recruit-cost={gameState?.nextRecruitCost ?? 0}
      data-board-piece-count={gameState?.boardPieces.length ?? 0}
      data-tray-piece-count={gameState?.tray.filter(Boolean).length ?? 0}
      data-match-outcome={gameState?.result?.outcome ?? ''}
    >
      <div className="cyber-background" />
      <div className="cyber-noise" />
      <button type="button" onClick={() => setIsLeaveConfirmOpen(true)} className="gaming-exit-fab"><OctagonX className="h-3.5 w-3.5" /><span>退出</span></button>

      {connectionRecovery.phase !== 'ready' ? (
        <div className="pointer-events-none fixed inset-0 z-[160] flex items-start justify-center bg-slate-950/20 px-4 pt-16" aria-live="assertive">
          <section
            role={connectionRecovery.phase === 'reconnecting' || connectionRecovery.phase === 'awaiting_snapshot' ? 'status' : 'alert'}
            className={cx(
              'pointer-events-auto w-full max-w-xl rounded-2xl border px-5 py-4 shadow-2xl backdrop-blur-xl',
              connectionRecovery.phase === 'reconnecting' || connectionRecovery.phase === 'awaiting_snapshot'
                ? 'border-amber-300/35 bg-slate-950/90 shadow-amber-950/50'
                : 'border-red-300/35 bg-slate-950/95 shadow-red-950/50',
            )}
          >
            <div className="flex items-start justify-between gap-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-300">Connection recovery</p>
                <h2 className="mt-1 text-lg font-semibold text-white">
                  {connectionRecovery.phase === 'reconnecting'
                    ? `正在重连 · 席位保留 ${reconnectRemainingSeconds ?? '—'} 秒`
                    : connectionRecovery.phase === 'awaiting_snapshot'
                      ? '连接已恢复 · 正在校准战局'
                      : connectionRecovery.phase === 'replaced'
                        ? '本局已被其他窗口接管'
                        : connectionRecovery.phase === 'auth_failed'
                          ? '登录状态已失效'
                          : '重连期限已过'}
                </h2>
                <p className="mt-1 text-sm leading-6 text-slate-300">{connectionRecovery.message ?? '等待服务器返回完整权威快照；期间所有操作均不会发送。'}</p>
              </div>
              {(connectionRecovery.phase === 'reconnecting' || connectionRecovery.phase === 'awaiting_snapshot') ? <RefreshCw className="mt-1 h-5 w-5 shrink-0 animate-spin text-amber-300" /> : <ShieldAlert className="mt-1 h-5 w-5 shrink-0 text-red-300" />}
            </div>
            {(connectionRecovery.phase === 'expired' || connectionRecovery.phase === 'replaced' || connectionRecovery.phase === 'auth_failed') ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {connectionRecovery.phase !== 'auth_failed' ? <button type="button" onClick={retryConnection} className="rounded-lg border border-cyan-300/35 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-300/10">手动重试</button> : null}
                <button type="button" onClick={() => navigate(connectionRecovery.phase === 'auth_failed' ? '/login' : `/room/${encodeURIComponent(roomId)}`)} className="rounded-lg border border-white/15 px-4 py-2 text-sm text-slate-200 hover:bg-white/5">
                  {connectionRecovery.phase === 'auth_failed' ? '重新登录' : '返回房间'}
                </button>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      <BattleChapterDirector
        matchId={gameState?.matchId ?? null}
        chapterLabel={selectedLevelPreview ? `第 ${selectedLevelPreview.levelId} 回 · ${selectedLevelPreview.label}` : '西游守关'}
        currentWave={gameState?.currentWave.index ?? 0}
        maxWaves={gameState?.maxWaves ?? 0}
        prepCountdownSec={gameState?.currentWave.prepCountdownSec ?? 0}
        enemyCount={gameState?.enemies.length ?? 0}
        recentEvents={gameState?.recentEvents ?? []}
        bosses={gameState?.enemies.filter(enemy => enemy.entityKind === 'boss') ?? []}
      />

      <PveOnboardingCoach
        step={onboarding.currentStep}
        facts={onboarding.facts}
        visible={onboarding.visible && !interactionLocked && !shouldShowMissionBriefing && !gameState?.result}
        paused={onboarding.paused && Boolean(onboarding.facts?.running) && !gameState?.result}
        onSkipStep={onboarding.skipStep}
        onSkipAll={onboarding.skipAll}
        onPause={onboarding.pause}
        onResume={onboarding.resume}
      />

      <section className="gaming-shell" aria-busy={interactionLocked} style={interactionLocked ? { pointerEvents: 'none' } : undefined}>
        <header className="gaming-command-bar" aria-label="全局战况">
          <div className="gaming-command-mission">
            <span>DEFENSE GRID</span>
            <strong>{selectedLevelPreview?.label ?? '节点防线'}</strong>
            <small>{selectedLevelPreview ? ({ easy: '简单', normal: '普通', hard: '困难' } as const)[selectedLevelPreview.difficulty] : '等待关卡同步'}</small>
          </div>
          <div className="gaming-command-metrics">
            <div data-onboarding-anchor="rice"><Coins className="h-4 w-4" /><span>斋饭</span><strong>{gameState?.rice ?? 0}</strong></div>
            <div><Users className="h-4 w-4" /><span>人口</span><strong>{gameState?.populationUsed ?? 0}/{gameState?.populationCap ?? 10}</strong></div>
            <div><Skull className="h-4 w-4" /><span>敌军</span><strong>{gameState?.enemies.length ?? 0}</strong></div>
          </div>
          <div className="gaming-wave-command">
            <ShieldAlert className="h-5 w-5" />
            <span>{(gameState?.currentWave.prepCountdownSec ?? 0) > 0 ? `备战 ${gameState?.currentWave.prepCountdownSec}s` : '交战中'}</span>
            <strong>第 {gameState?.currentWave.index ?? 0} / {gameState?.maxWaves ?? '—'} 波</strong>
            <i><b style={{ width: `${Math.max(0, Math.min(100, ((gameState?.currentWave.index ?? 0) / Math.max(1, gameState?.maxWaves ?? 1)) * 100))}%` }} /></i>
            <div className="col-span-2 flex min-w-0 items-center gap-2 pt-1" aria-label="战斗音量">
              <button
                type="button"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-200/20 bg-slate-950/60 text-amber-100 transition hover:border-amber-200/45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
                aria-label={combatAudioPreferences.muted ? '开启战斗音效' : '静音战斗音效'}
                aria-pressed={combatAudioPreferences.muted}
                title={combatAudioPreferences.muted ? '开启战斗音效' : '静音战斗音效'}
                onClick={() => setCombatAudioPreferences((previous) => ({ ...previous, muted: !previous.muted }))}
              >
                {combatAudioPreferences.muted || combatAudioPreferences.masterVolume <= 0
                  ? <VolumeX className="h-4 w-4" />
                  : <Volume2 className="h-4 w-4" />}
              </button>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={Math.round(combatAudioPreferences.masterVolume * 100)}
                aria-label="战斗音效主音量"
                aria-valuetext={`${Math.round(combatAudioPreferences.masterVolume * 100)}%`}
                className="min-w-16 flex-1 accent-amber-400"
                onChange={(event) => {
                  const masterVolume = Number(event.currentTarget.value) / 100
                  setCombatAudioPreferences({ muted: masterVolume <= 0, masterVolume })
                }}
              />
              <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-slate-300">{Math.round(combatAudioPreferences.masterVolume * 100)}%</span>
            </div>
          </div>
          {(gameState?.enemies.some((enemy) => enemy.entityKind === 'boss') ?? false) ? (
            <div className="gaming-command-boss" aria-live="polite" data-onboarding-anchor="boss">
              {gameState!.enemies.filter((enemy) => enemy.entityKind === 'boss').slice(0, 1).map((boss) => (
                <div key={boss.entityId}>
                  <span><b>BOSS</b>{boss.bossName ?? boss.glyph} · 阶段 {Math.max(1, boss.bossPhase)}</span>
                  <strong>{Math.max(0, Math.ceil(boss.hp)).toLocaleString()} / {Math.max(1, Math.ceil(boss.maxHp)).toLocaleString()}</strong>
                  <i><b style={{ width: `${boss.maxHp > 0 ? Math.max(0, Math.min(100, boss.hp / boss.maxHp * 100)) : 0}%` }} /></i>
                  {boss.activeCast ? <small><Timer className="h-3.5 w-3.5" />{boss.activeCast.skillName} · {Math.max(0, Math.ceil((boss.activeCast.executeAtTick - gameState!.tick) * gameState!.tickRateMs / 1000))}s</small> : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="gaming-command-boss gaming-command-boss-dormant" data-onboarding-anchor="boss">
              <div>
                <span><b>BOSS</b>首领尚未现身</span>
                <strong>预计第 {Math.min(gameState?.maxWaves ?? 20, Math.max(5, (Math.floor((gameState?.currentWave.index ?? 0) / 5) + 1) * 5))} 波</strong>
                <i><b style={{ width: '0%' }} /></i>
                <small>留意朱砂预警，提前调整阵型</small>
              </div>
            </div>
          )}
          <CrisisWarning
            overloadTicks={gameState?.overloadTicks ?? 0}
            overloadCountdownSec={gameState?.overloadCountdownSec ?? 0}
            enemyCount={gameState?.enemies.filter((enemy) => enemy.entityKind === 'ordinary_minion').length ?? 0}
            maxCapacity={gameState?.maxCapacity ?? 10}
          />
        </header>
        <div className={cx('gaming-stage', isBuildDockExpanded && 'gaming-stage-dock-open')}>
          <aside className={cx('gaming-side-rail gaming-side-rail-build', isBuildDockExpanded && 'gaming-side-rail-build-expanded')}>
            <button
              type="button"
              className="gaming-dock-toggle"
              data-onboarding-anchor="recruit tray"
              aria-expanded={isBuildDockExpanded}
              aria-controls="gaming-build-dock-content"
              onClick={() => setIsBuildDockExpanded(value => !value)}
            >
              <span>{isBuildDockExpanded ? '收起' : '布阵'}</span>
              <strong>{gameState?.tray.filter(Boolean).length ?? 0}/5</strong>
            </button>
            <div id="gaming-build-dock-content" className="gaming-side-rail-scroll" aria-hidden={!isBuildDockExpanded}>
              {error ? <section className="gaming-panel-card"><p className="gaming-error-text">{error}</p></section> : null}
              <section className="gaming-panel-card gaming-connection-panel" aria-label="队友连接状态">
                <div className="mb-2 flex items-center justify-between"><p className="gaming-section-label">联机路况</p><small className="text-slate-500">{roomSlots.filter((slot) => slot.connected).length}/{roomSlots.filter((slot) => slot.playerId).length || 1} 在线</small></div>
                <div className="space-y-2">
                  {roomSlots.filter((slot) => slot.playerId).map((slot) => <TeammateConnectionRow key={slot.slotId} slot={slot} selfPlayerId={playerId} />)}
                  {roomSlots.every((slot) => !slot.playerId) ? <p className="text-xs text-slate-500">等待房间成员同步…</p> : null}
                </div>
              </section>
              <section className="gaming-panel-card gaming-recruit-panel">
                <p className="gaming-section-label">召唤托盘</p>
                <p className="gaming-recruit-help">可与备战席、棋盘互换；同类同级直接升级</p>
                <div className="gaming-summon-tray" data-onboarding-anchor="tray">
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
                <button type="button" className="gaming-recruit-button" data-onboarding-anchor="recruit-button" disabled={recruitDisabled} onClick={handleRecruit}>
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
                    {Array.from({ length: gameState?.reserve.length ?? 2 }, (_, index) => {
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

              <section className="gaming-panel-card gaming-active-items-panel">
                <div className="gaming-active-items-heading">
                  <div><p className="gaming-section-label">主动道具</p><p className="gaming-recruit-help">2 槽 · 服务端确认后才扣除次数</p></div>
                  {targetingItemSlot !== null ? <button type="button" onClick={() => {
                    setTargetingItemSlot(null)
                    setSelectedDiscardedTokenId(null)
                  }}>取消选择</button> : null}
                </div>
                <div className="gaming-active-items-row">
                  {[0, 1].map((slotIndex) => {
                    const item = gameState?.activeItems[slotIndex] ?? null
                    const coolingTicks = item && gameState ? Math.max(0, item.cooldownEndsAtTick - gameState.tick) : 0
                    const disabled = !item || !gameState || gameState.status !== 'running' || !item.enabled || item.chargesRemaining <= 0 || coolingTicks > 0
                    const requiresGeneral = item?.targetingKind === 'active_general'
                    const isTargeting = targetingItemSlot === slotIndex
                    return (
                      <button
                        type="button"
                        key={slotIndex}
                        className={cx('gaming-active-item', isTargeting && 'gaming-active-item-targeting')}
                        disabled={disabled}
                        onClick={() => item && handleActiveItemClick(item)}
                        title={requiresGeneral ? '先选中一名神将后使用' : item?.targetingKind === 'battlefield_point' ? '点击后在战场选择位置' : undefined}
                      >
                        <span>{item ? item.name.slice(0, 1) : '空'}</span>
                        <div><strong>{item?.name ?? '未携带'}</strong><small>{item ? coolingTicks > 0 ? `冷却 ${Math.ceil(coolingTicks / 10)}s` : `${item.chargesRemaining} 次可用` : '局外构筑后生效'}</small></div>
                        {isTargeting ? <Crosshair className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
                      </button>
                    )
                  })}
                </div>
                {targetingItemSlot !== null ? (() => {
                  const targetingItem = gameState?.activeItems[targetingItemSlot]
                  if (targetingItem?.targetingKind === 'battlefield_point') {
                    return <p className="gaming-item-target-hint"><Crosshair className="h-3.5 w-3.5" />请在棋盘上点击一个位置；取消不会发送命令。</p>
                  }
                  if (targetingItem?.targetingKind === 'character_token') {
                    return <p className="gaming-item-target-hint"><Crosshair className="h-3.5 w-3.5" />请点击托盘、备战席或棋盘中的一个神将字符。</p>
                  }
                  if (targetingItem?.targetingKind === 'discarded_character_to_empty_slot') {
                    return <p className="gaming-item-target-hint"><Crosshair className="h-3.5 w-3.5" />先选择弃置字符，再点击空托盘位或空备战位。</p>
                  }
                  return null
                })() : null}
                {(gameState?.discardedCharacters.length ?? 0) > 0 ? (
                  <div className="gaming-discarded-characters">
                    <small>弃置字符</small>
                    <div>
                      {gameState!.discardedCharacters.map((token) => (
                        <button
                          type="button"
                          key={token.entityId}
                          className={cx(selectedDiscardedTokenId === token.entityId && 'gaming-discarded-character-active')}
                          onClick={() => {
                            const item = targetingItemSlot === null ? null : gameState?.activeItems[targetingItemSlot]
                            if (item?.targetingKind !== 'discarded_character_to_empty_slot') {
                              setError('请先点击招魂幡，再选择要找回的弃置字符。')
                              return
                            }
                            setSelectedDiscardedTokenId(token.entityId)
                            setError(null)
                          }}
                          aria-label={`弃置字符${token.glyph}`}
                        >{token.glyph}</button>
                      ))}
                    </div>
                  </div>
                ) : null}
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
            selectedObjectLabel={selectedBattlefieldObject}
            executableActions={battlefieldExecutableActions}
            placementMode={selectedTrayIndex !== null || selectedReserveIndex !== null || selectedPieceId !== null || targetingItemSlot !== null}
            allowAnyTargetCell={targetingItemSlot !== null}
            hoveredCell={hoveredCell}
            audioMuted={combatAudioPreferences.muted}
            audioMasterVolume={combatAudioPreferences.masterVolume}
            presentationSyncRevision={connectionRecovery.syncRevision}
            onCellClick={handleCellClick}
            onCellHover={(x, y) => setHoveredCell({ x, y })}
            onCellLeave={() => setHoveredCell(null)}
            onCancelInteraction={cancelBattlefieldInteraction}
          />

          <aside className="gaming-side-rail gaming-side-rail-right" aria-label="情境情报抽屉">
            <details className="gaming-panel-card gaming-info-fold" data-onboarding-anchor="synergy">
              <summary><span>已激活羁绊</span><small>{gameState?.activeSynergies.length ?? 0}</small></summary>
              <div className="gaming-synergy-list">
                {(gameState?.activeSynergies.length ?? 0) > 0 ? gameState?.activeSynergies.map((synergy) => (
                  <div className="gaming-synergy-entry" key={synergy.synergyId}>
                    <div><strong>{synergy.name}</strong><span>Lv.{synergy.level}</span></div>
                    <p>成员：{synergy.contributingGeneralIds.map(generalDisplayName).join('、') || '等待成员投影'}</p>
                  </div>
                )) : <p className="gaming-synergy-empty">当前阵容暂无已激活羁绊</p>}
              </div>
            </details>
            <details className="gaming-panel-card gaming-info-fold">
              <summary><span>战斗效果</span><small>{(gameState?.summonedUnits.length ?? 0) + (gameState?.zones.length ?? 0) + (gameState?.statuses.length ?? 0)}</small></summary>
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
                    <p key={event.id}><span>{combatEventDisplay(event)}</span><small>T{event.tick}</small></p>
                  ))}
                </div>
              ) : null}
            </details>
            <details className="gaming-panel-card gaming-info-fold">
              <summary><span>操作提示</span><small>点击展开</small></summary>
              <div className="gaming-operation-guide">
                <p>托盘天兵 → 同类同级天兵：直接升级</p>
                <p>托盘、备战席、棋盘任意两处可交换或合成</p>
                <p>备战席单位不占人口</p>
                <p>流放：清空备战席中的全部单位</p>
                <p>2/3/4 字神将按配方横向连续排列自动组成；固定后可整体迁移</p>
              </div>
            </details>
            {selectedLevelPreview ? <details className="gaming-panel-card gaming-info-fold"><summary><span>关卡情报</span><small>PVE-{selectedLevelPreview.levelId}</small></summary><h2 className="mt-2 text-lg font-semibold text-white">{selectedLevelPreview.label} · {{ easy: '简单', normal: '普通', hard: '困难' }[selectedLevelPreview.difficulty]}</h2><p className="mt-2 text-sm leading-6 text-slate-300">{selectedLevelPreview.description}</p></details> : null}
          </aside>
        </div>
      </section>

      {isLeaveConfirmOpen ? (
        <LeaveConfirmDialog onCancel={() => setIsLeaveConfirmOpen(false)} onConfirm={leaveGame} />
      ) : null}

      {shouldShowMissionBriefing ? <MissionBriefingModal isHost={isHost} playerKind={playerKind} stageAccess={playerAccount.data?.pveProgression.stages ?? []} progressionLoading={playerAccount.isLoading} onSelectLevel={handleSelectLevel} engineError={error ?? playerAccount.error} /> : null}
      {gameState?.result?.outcome ? <GameOverOverlay outcome={gameState.result.outcome} currentLevelId={selectedLevelInfo?.levelId ?? null} matchId={gameState.matchId} onReplay={leaveGame} onAdjustBuild={() => navigate('/build')} onLeave={returnHome} /> : null}
    </main>
  )
}
