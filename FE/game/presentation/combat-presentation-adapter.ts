import type {
  BattlefieldCombatEventState,
  BattlefieldEnemyState,
  BattlefieldPieceState,
  BattlefieldSnapshot,
} from '../phaser/battlefield-model'
import type { GeneralActionVisual } from './general-manifestation'
import type { CombatTargetGeometry } from '../../../shared/contracts/game'

function finiteGeometryNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function parseGeometryPoint(value: unknown): { xMilli: number; yMilli: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  return finiteGeometryNumber(candidate.xMilli) && finiteGeometryNumber(candidate.yMilli)
    ? { xMilli: candidate.xMilli, yMilli: candidate.yMilli }
    : null
}

/** Strict parser: malformed server geometry is ignored, never partially guessed. */
export function parseCombatTargetGeometry(value: unknown): CombatTargetGeometry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (candidate.kind === 'point') {
    const parsed = parseGeometryPoint(candidate)
    return parsed ? { kind: 'point', ...parsed } : null
  }
  if (candidate.kind === 'circle') {
    const parsed = parseGeometryPoint(candidate)
    return parsed && finiteGeometryNumber(candidate.radiusMilliCells) && candidate.radiusMilliCells >= 0
      ? { kind: 'circle', ...parsed, radiusMilliCells: candidate.radiusMilliCells }
      : null
  }
  if (candidate.kind === 'corridor') {
    const from = parseGeometryPoint(candidate.from)
    const to = parseGeometryPoint(candidate.to)
    return from && to && finiteGeometryNumber(candidate.halfWidthMilliCells) && candidate.halfWidthMilliCells >= 0
      ? { kind: 'corridor', from, to, halfWidthMilliCells: candidate.halfWidthMilliCells }
      : null
  }
  if (candidate.kind === 'polyline' && Array.isArray(candidate.points)) {
    const points = candidate.points.map(parseGeometryPoint)
    return points.length > 0 && points.every((entry) => entry !== null)
      ? { kind: 'polyline', points: points as Array<{ xMilli: number; yMilli: number }> }
      : null
  }
  return null
}

function choreographyPresentationPoints(geometry: CombatTargetGeometry | null | undefined) {
  if (!geometry) return []
  if (geometry.kind === 'polyline') return geometry.points.map((entry) => ({ x: entry.xMilli / 1000, y: entry.yMilli / 1000 }))
  if (geometry.kind === 'corridor') return [geometry.from, geometry.to].map((entry) => ({ x: entry.xMilli / 1000, y: entry.yMilli / 1000 }))
  return [{ x: geometry.xMilli / 1000, y: geometry.yMilli / 1000 }]
}

export type SoldierPresentationStyle = 'blade' | 'spear' | 'bow' | 'cavalry' | 'general' | 'unknown'
export type PresentationDetail = 'full' | 'compact' | 'result'

export interface PresentationPoint {
  x: number
  y: number
}

interface PresentationEntityRef extends PresentationPoint {
  entityId: string
  role: 'piece' | 'enemy' | 'summon'
  style: SoldierPresentationStyle
  isBoss: boolean
  bossPhase: number
  hp: number | null
  glyph: string | null
}

interface CueBase {
  id: string
  tick: number
  detail: PresentationDetail
}

export type BattlefieldPresentationCue =
  | CueBase & { kind: 'attack', style: SoldierPresentationStyle, source: PresentationPoint, targets: PresentationPoint[], actionId?: string, targetIds?: string[], geometry?: CombatTargetGeometry | null }
  | CueBase & { kind: 'damage', targetId: string, target: PresentationPoint, amount: number, critical: boolean, showText: boolean, isBoss: boolean, sourceStyle: SoldierPresentationStyle, impactDelayMs: number, generalId?: string | null, sourceKind?: string | null, effectId?: string | null }
  | CueBase & { kind: 'death', targetId: string, target: PresentationPoint, isBoss: boolean }
  | CueBase & { kind: 'summon', target: PresentationPoint, label: string, actionId?: string, targetIds?: string[] }
  | CueBase & { kind: 'merge', target: PresentationPoint, level: number }
  | CueBase & { kind: 'general-formed', target: PresentationPoint, label: string, generalId?: string | null, formationId?: string | null, memberPoints?: PresentationPoint[], glyphs?: string[] }
  | CueBase & { kind: 'general-state', target: PresentationPoint, label: string, generalId: string | null, state: 'fixed' | 'unfixed' | 'deactivated' }
  | CueBase & { kind: 'general-action', actionKind: 'basic' | 'skill', visual: GeneralActionVisual, generalId: string, skillId: string | null, skillName: string, source: PresentationPoint, targets: PresentationPoint[], actionId?: string, targetIds?: string[], geometry?: CombatTargetGeometry | null }
  | CueBase & { kind: 'general-status', generalId: string, statusId: string, targetId: string, target: PresentationPoint }
  | CueBase & { kind: 'synergy', target: PresentationPoint, label: string, synergyId?: string | null, level?: number, state?: 'activated' | 'upgraded' | 'deactivated' | 'reconfigured', memberPoints?: PresentationPoint[] }
  | CueBase & { kind: 'wave-start', waveNumber: number, label: string }
  | CueBase & { kind: 'boss-spawn', targetId: string, target: PresentationPoint, label: string }
  | CueBase & { kind: 'boss-warning', targetId: string, target: PresentationPoint, label: string, executeAtTick: number | null, pluginId: string | null, skillId: string | null, actionId?: string, targetIds?: string[], geometry?: CombatTargetGeometry | null }
  | CueBase & { kind: 'boss-phase', targetId: string, target: PresentationPoint, phase: number }
  | CueBase & { kind: 'boss-death', targetId: string, target: PresentationPoint, label: string }

export interface CombatPresentationState {
  lastTick: number | null
  seenEventIds: Set<string>
  seenEventOrder: string[]
  seenActionIds: Set<string>
  seenActionOrder: string[]
  entities: Map<string, PresentationEntityRef>
  lastDamageFloatTick: Map<string, number>
  knownDeadIds: Set<string>
  activeSynergies: Map<string, { level: number, contributingGeneralIds: string[] }>
}

export interface ActiveSynergyPresentationLink {
  synergyId: string
  level: number
  memberPoints: PresentationPoint[]
}

export interface CombatPresentationOptions {
  reducedMotion?: boolean
  lowEffects?: boolean
  maxSeenEvents?: number
  fullEventAgeMs?: number
  compactEventAgeMs?: number
}

const DEFAULT_MAX_SEEN_EVENTS = 2048
const DEFAULT_FULL_EVENT_AGE_MS = 450
const DEFAULT_COMPACT_EVENT_AGE_MS = 1800
const DAMAGE_FLOAT_SAMPLE_TICKS = 3
const MOON_PALACE_SYNERGY_ID = 'moon_palace_companions'
const MOON_PALACE_MEMBER_IDS = ['houyi', 'chang_e'] as const

function knownGeneralName(generalId: string | null): string {
  if (generalId === 'houyi') return '后羿'
  if (generalId === 'yangjian') return '杨戬'
  return generalId ?? '神将'
}

function knownGeneralActionVisual(generalId: string | null, actionKind: 'basic' | 'skill', skillId?: string | null): GeneralActionVisual {
  if (generalId === 'houyi' && (actionKind === 'basic' || skillId === 'chuanyun_zhurijian')) return 'sun-arrow'
  if (generalId === 'yangjian' && (actionKind === 'basic' || skillId === 'yangjian_sanjian_liangrenzhan')) return 'three-point-blade'
  return 'generic'
}

export function createCombatPresentationState(): CombatPresentationState {
  return {
    lastTick: null,
    seenEventIds: new Set(),
    seenEventOrder: [],
    seenActionIds: new Set(),
    seenActionOrder: [],
    entities: new Map(),
    lastDamageFloatTick: new Map(),
    knownDeadIds: new Set(),
    activeSynergies: new Map(),
  }
}

function dataString(event: BattlefieldCombatEventState, key: string): string | null {
  const value = event.data[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function dataNumber(event: BattlefieldCombatEventState, key: string): number | null {
  const value = event.data[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function dataBoolean(event: BattlefieldCombatEventState, key: string): boolean {
  return event.data[key] === true
}

function dataStrings(event: BattlefieldCombatEventState, key: string): string[] {
  const value = event.data[key]
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : []
}

function pieceStyle(piece: BattlefieldPieceState): SoldierPresentationStyle {
  if (piece.kind !== 'soldier') return piece.generalId ? 'general' : 'unknown'
  if (piece.soldierType === 'blade' || piece.soldierType === 'spear' || piece.soldierType === 'bow' || piece.soldierType === 'cavalry') {
    return piece.soldierType
  }
  return 'unknown'
}

function impactDelayForStyle(style: SoldierPresentationStyle): number {
  if (style === 'blade') return 110
  if (style === 'spear') return 165
  if (style === 'bow') return 250
  if (style === 'cavalry') return 190
  return 195
}

function refForPiece(piece: BattlefieldPieceState): PresentationEntityRef {
  return {
    entityId: piece.entityId,
    role: 'piece',
    style: pieceStyle(piece),
    x: piece.x + 0.5,
    y: piece.y + 0.5,
    isBoss: false,
    bossPhase: 0,
    hp: null,
    glyph: piece.glyph,
  }
}

function refForEnemy(enemy: BattlefieldEnemyState): PresentationEntityRef {
  return {
    entityId: enemy.entityId,
    role: 'enemy',
    style: 'unknown',
    x: enemy.x + 0.5,
    y: enemy.y + 0.5,
    isBoss: enemy.entityKind === 'boss',
    bossPhase: enemy.bossPhase,
    hp: enemy.hp,
    glyph: enemy.glyph,
  }
}

function point(ref: PresentationEntityRef): PresentationPoint {
  return { x: ref.x, y: ref.y }
}

function centroid(refs: PresentationEntityRef[]): PresentationPoint | null {
  if (refs.length === 0) return null
  return {
    x: refs.reduce((sum, ref) => sum + ref.x, 0) / refs.length,
    y: refs.reduce((sum, ref) => sum + ref.y, 0) / refs.length,
  }
}

function indexSnapshot(snapshot: BattlefieldSnapshot): Map<string, PresentationEntityRef> {
  const entities = new Map<string, PresentationEntityRef>()
  const formationRefs = new Map<string, PresentationEntityRef[]>()
  const generalRefs = new Map<string, PresentationEntityRef[]>()
  for (const piece of snapshot.pieces) {
    const ref = refForPiece(piece)
    entities.set(piece.entityId, ref)
    if (piece.formationId) formationRefs.set(piece.formationId, [...(formationRefs.get(piece.formationId) ?? []), ref])
    if (piece.generalId) generalRefs.set(piece.generalId, [...(generalRefs.get(piece.generalId) ?? []), ref])
  }
  for (const [alias, refs] of [...formationRefs, ...generalRefs]) {
    const center = centroid(refs)
    if (center) entities.set(alias, { ...refs[0], entityId: alias, ...center, style: 'general' })
  }
  for (const enemy of snapshot.enemies) entities.set(enemy.entityId, refForEnemy(enemy))
  for (const summon of snapshot.summonedUnits) {
    entities.set(summon.entityId, {
      entityId: summon.entityId,
      role: 'summon',
      style: 'general',
      x: summon.x + 0.5,
      y: summon.y + 0.5,
      isBoss: false,
      bossPhase: 0,
      hp: null,
      glyph: summon.glyph,
    })
  }
  return entities
}

function synergyContributors(event: BattlefieldCombatEventState, state: CombatPresentationState): string[] {
  const explicit = dataStrings(event, 'contributingGeneralIds')
  if (explicit.length > 0) return explicit
  const synergyId = dataString(event, 'synergyId')
  const remembered = synergyId ? state.activeSynergies.get(synergyId)?.contributingGeneralIds : undefined
  if (remembered?.length) return [...remembered]
  return synergyId === MOON_PALACE_SYNERGY_ID ? [...MOON_PALACE_MEMBER_IDS] : []
}

function updateSynergyLedger(event: BattlefieldCombatEventState, state: CombatPresentationState): void {
  const synergyId = dataString(event, 'synergyId')
  if (!synergyId) return
  if (event.type === 'SYNERGY_DEACTIVATED') {
    state.activeSynergies.delete(synergyId)
    return
  }
  if (!['SYNERGY_ACTIVATED', 'SYNERGY_LEVEL_CHANGED', 'SYNERGY_RECONFIGURED'].includes(event.type)) return
  const contributingGeneralIds = synergyContributors(event, state)
  if (contributingGeneralIds.length === 0) return
  state.activeSynergies.set(synergyId, {
    level: Math.max(1, Math.floor(dataNumber(event, 'level') ?? 1)),
    contributingGeneralIds,
  })
}

export function activeSynergyPresentationLinks(state: CombatPresentationState): ActiveSynergyPresentationLink[] {
  return [...state.activeSynergies].flatMap(([synergyId, entry]) => {
    const memberPoints = entry.contributingGeneralIds.flatMap((generalId) => {
      const ref = state.entities.get(generalId)
      return ref ? [point(ref)] : []
    })
    return memberPoints.length >= 2 ? [{ synergyId, level: entry.level, memberPoints }] : []
  })
}

function resolveRef(
  id: string | null,
  current: Map<string, PresentationEntityRef>,
  previous: Map<string, PresentationEntityRef>,
): PresentationEntityRef | null {
  if (!id) return null
  return current.get(id) ?? previous.get(id) ?? null
}

function detailFor(
  event: BattlefieldCombatEventState,
  snapshot: BattlefieldSnapshot,
  options: CombatPresentationOptions,
): PresentationDetail {
  if (options.reducedMotion || options.lowEffects) return 'result'
  const ageTicks = Math.max(0, snapshot.tick - event.tick)
  if (ageTicks === 0) return 'full'
  // 没有权威 tickRate 时不猜毫秒：历史事件只播放结果，避免重连后补播整段攻击。
  if (!snapshot.tickRateMs || snapshot.tickRateMs <= 0) return 'result'
  const ageMs = ageTicks * snapshot.tickRateMs
  if (ageMs <= (options.fullEventAgeMs ?? DEFAULT_FULL_EVENT_AGE_MS)) return 'full'
  if (ageMs <= (options.compactEventAgeMs ?? DEFAULT_COMPACT_EVENT_AGE_MS)) return 'compact'
  return 'result'
}

function choreographyIsHistorical(
  event: BattlefieldCombatEventState,
  snapshot: BattlefieldSnapshot,
  options: CombatPresentationOptions,
): boolean {
  const ageTicks = Math.max(0, snapshot.tick - event.tick)
  if (ageTicks === 0) return false
  if (!snapshot.tickRateMs || snapshot.tickRateMs <= 0) return true
  return ageTicks * snapshot.tickRateMs > (options.compactEventAgeMs ?? DEFAULT_COMPACT_EVENT_AGE_MS)
}

function rememberEvent(state: CombatPresentationState, eventId: string, maxSeenEvents: number): void {
  state.seenEventIds.add(eventId)
  state.seenEventOrder.push(eventId)
  while (state.seenEventOrder.length > maxSeenEvents) {
    const expired = state.seenEventOrder.shift()
    if (expired) state.seenEventIds.delete(expired)
  }
}

function rememberAction(state: CombatPresentationState, actionId: string, maxSeenEvents: number): void {
  state.seenActionIds.add(actionId)
  state.seenActionOrder.push(actionId)
  while (state.seenActionOrder.length > maxSeenEvents) {
    const expired = state.seenActionOrder.shift()
    if (expired) state.seenActionIds.delete(expired)
  }
}

function choreographyActionId(event: BattlefieldCombatEventState): string | null {
  if (!['BASIC_ATTACK_STARTED', 'GENERAL_BASIC_ATTACK_STARTED', 'GENERAL_SKILL_CAST', 'SUMMON_SPAWNED', 'BOSS_CAST_WARNING'].includes(event.type)) return null
  return event.actionId ?? dataString(event, 'actionId')
}

function fallbackEventPoint(event: BattlefieldCombatEventState): PresentationPoint | null {
  const xMilli = dataNumber(event, 'xMilli')
  const yMilli = dataNumber(event, 'yMilli')
  return xMilli === null || yMilli === null ? null : { x: xMilli / 1000, y: yMilli / 1000 }
}

function eventTargetIds(event: BattlefieldCombatEventState): string[] {
  if (event.targetIds?.length) return event.targetIds
  const many = dataStrings(event, 'targetIds')
  if (many.length > 0) return many
  const single = dataString(event, 'targetEnemyId') ?? dataString(event, 'enemyId') ?? dataString(event, 'bossEnemyId')
  return single ? [single] : []
}

/**
 * 重连 full snapshot 只用于建立权威表现基线：记住窗口内事件与实体状态，但不生成 cue，
 * 因而不会把离线期间已经发生的攻击、暴击或 Boss 演出重新播放一遍。
 */
export function synchronizeCombatPresentation(
  snapshot: BattlefieldSnapshot,
  state: CombatPresentationState,
  options: CombatPresentationOptions = {},
): void {
  if (state.lastTick !== null && snapshot.tick < state.lastTick) {
    state.seenEventIds.clear()
    state.seenEventOrder.length = 0
    state.seenActionIds.clear()
    state.seenActionOrder.length = 0
    state.lastDamageFloatTick.clear()
    state.knownDeadIds.clear()
    state.activeSynergies.clear()
  }
  const maxSeenEvents = Math.max(64, Math.floor(options.maxSeenEvents ?? DEFAULT_MAX_SEEN_EVENTS))
  for (const event of [...(snapshot.recentEvents ?? [])].sort((left, right) => left.tick - right.tick)) {
    if (!state.seenEventIds.has(event.id)) rememberEvent(state, event.id, maxSeenEvents)
    const actionId = choreographyActionId(event)
    if (actionId && !state.seenActionIds.has(actionId)) rememberAction(state, actionId, maxSeenEvents)
    updateSynergyLedger(event, state)
  }
  state.lastTick = snapshot.tick
  state.entities = indexSnapshot(snapshot)
  state.knownDeadIds.clear()
}

/**
 * 将权威快照/事件转换成纯表现 cue。函数会就地推进 state，但不修改 snapshot；
 * 同一事件 id 无论被 recentEvents 重复投影多少次都只消费一次。
 */
export function consumeCombatPresentation(
  snapshot: BattlefieldSnapshot,
  state: CombatPresentationState,
  options: CombatPresentationOptions = {},
): BattlefieldPresentationCue[] {
  if (state.lastTick !== null && snapshot.tick < state.lastTick) {
    state.seenEventIds.clear()
    state.seenEventOrder.length = 0
    state.seenActionIds.clear()
    state.seenActionOrder.length = 0
    state.entities.clear()
    state.lastDamageFloatTick.clear()
    state.knownDeadIds.clear()
    state.activeSynergies.clear()
  }

  const current = indexSnapshot(snapshot)
  const previous = state.entities
  const cues: BattlefieldPresentationCue[] = []
  const batchEventIds = new Set<string>()
  const newEvents = (snapshot.recentEvents ?? [])
    .filter((event) => {
      if (state.seenEventIds.has(event.id) || batchEventIds.has(event.id)) return false
      batchEventIds.add(event.id)
      return true
    })
    // Array.prototype.sort 是稳定排序；同 Tick 保留服务端事件顺序，确保前摇先于伤害结果。
    .sort((left, right) => left.tick - right.tick)
  const explicitDamageTargets = new Set<string>()
  const explicitDeathTargets = new Set<string>()
  const bossDeathTargets = new Set(
    newEvents.filter((event) => event.type === 'BOSS_DIED').flatMap(eventTargetIds),
  )
  const maxSeenEvents = Math.max(64, Math.floor(options.maxSeenEvents ?? DEFAULT_MAX_SEEN_EVENTS))

  for (const event of newEvents) {
    rememberEvent(state, event.id, maxSeenEvents)
    const actionId = choreographyActionId(event)
    if (actionId && state.seenActionIds.has(actionId)) continue
    if (actionId) rememberAction(state, actionId, maxSeenEvents)
    const detail = detailFor(event, snapshot, options)
    const targetIds = eventTargetIds(event)
    let targets = targetIds.flatMap((id) => {
      const ref = resolveRef(id, current, previous)
      return ref ? [point(ref)] : []
    })
    const geometryPoints = choreographyPresentationPoints(event.geometry)
    if (event.geometry?.kind === 'polyline' && geometryPoints.length > 1) targets = geometryPoints.slice(1)

    if (event.type === 'BASIC_ATTACK_STARTED' || event.type === 'GENERAL_BASIC_ATTACK_STARTED') {
      if (detail === 'result') continue
      const sourceId = dataString(event, 'attackerId') ?? dataString(event, 'formationId') ?? dataString(event, 'generalId')
      const source = resolveRef(sourceId, current, previous)
      const sourcePoint = event.geometry?.kind === 'polyline' && geometryPoints.length > 0
        ? geometryPoints[0]
        : source ? point(source) : null
      const generalId = dataString(event, 'generalId')
      if (sourcePoint && targets.length > 0 && event.type === 'GENERAL_BASIC_ATTACK_STARTED' && knownGeneralActionVisual(generalId, 'basic') !== 'generic') {
        cues.push({ id: event.id, tick: event.tick, detail, kind: 'general-action', actionKind: 'basic', visual: knownGeneralActionVisual(generalId, 'basic'), generalId: generalId!, skillId: null, skillName: '普攻', source: sourcePoint, targets, ...(actionId ? { actionId } : {}), targetIds, geometry: event.geometry })
      }
      else if (sourcePoint && source && targets.length > 0) cues.push({ id: event.id, tick: event.tick, detail, kind: 'attack', style: source.style, source: sourcePoint, targets, ...(actionId ? { actionId } : {}), targetIds, geometry: event.geometry })
      continue
    }

    if (event.type === 'GENERAL_SKILL_CAST') {
      if (choreographyIsHistorical(event, snapshot, options)) continue
      const generalId = dataString(event, 'generalId')
      const source = resolveRef(dataString(event, 'formationId') ?? generalId, current, previous)
      const skillId = dataString(event, 'skillId')
      const sourcePoint = event.geometry?.kind === 'polyline' && geometryPoints.length > 0
        ? geometryPoints[0]
        : source ? point(source) : null
      if (sourcePoint && generalId && targets.length > 0) cues.push({
        id: event.id,
        tick: event.tick,
        detail,
        kind: 'general-action',
        actionKind: 'skill',
        visual: knownGeneralActionVisual(generalId, 'skill', skillId),
        generalId,
        skillId,
        skillName: dataString(event, 'skillName') ?? '神将技',
        source: sourcePoint,
        targets,
        ...(actionId ? { actionId } : {}),
        targetIds,
        geometry: event.geometry,
      })
      continue
    }

    if (event.type === 'DAMAGE_APPLIED') {
      const enemyId = dataString(event, 'enemyId')
      if (enemyId) explicitDamageTargets.add(enemyId)
      const target = resolveRef(enemyId, current, previous)
      const amount = Math.max(0, Math.floor(dataNumber(event, 'finalDamage') ?? 0))
      if (!target || amount <= 0) continue
      const critical = dataBoolean(event, 'isCritical')
      const attacker = resolveRef(dataString(event, 'attackerId'), current, previous)
      const lastFloat = state.lastDamageFloatTick.get(enemyId ?? '') ?? Number.NEGATIVE_INFINITY
      const showText = critical || target.isBoss || event.tick - lastFloat >= DAMAGE_FLOAT_SAMPLE_TICKS
      if (showText && enemyId) state.lastDamageFloatTick.set(enemyId, event.tick)
      const sourceStyle = attacker?.style ?? 'general'
      cues.push({ id: event.id, tick: event.tick, detail, kind: 'damage', targetId: enemyId ?? target.entityId, target: point(target), amount, critical, showText, isBoss: target.isBoss, sourceStyle, impactDelayMs: impactDelayForStyle(sourceStyle), generalId: dataString(event, 'generalId'), sourceKind: dataString(event, 'sourceKind'), effectId: dataString(event, 'effectId') })
      continue
    }

    if (event.type === 'ENEMY_DIED') {
      const enemyId = dataString(event, 'enemyId')
      if (enemyId) {
        explicitDeathTargets.add(enemyId)
        state.knownDeadIds.add(enemyId)
      }
      const target = resolveRef(enemyId, current, previous)
      if (target && !bossDeathTargets.has(enemyId ?? '')) cues.push({ id: event.id, tick: event.tick, detail, kind: 'death', targetId: enemyId ?? target.entityId, target: point(target), isBoss: target.isBoss })
      continue
    }

    if (event.type === 'SUMMON_SPAWNED') {
      const target = resolveRef(dataString(event, 'summonId'), current, previous)
      const at = target ? point(target) : fallbackEventPoint(event)
      if (at) cues.push({ id: event.id, tick: event.tick, detail, kind: 'summon', target: at, label: dataString(event, 'summonUnitId') ?? '召', ...(actionId ? { actionId } : {}), targetIds })
      continue
    }

    if (event.type === 'SOLDIER_MERGED') {
      const target = resolveRef(dataString(event, 'mergedPieceId') ?? dataString(event, 'targetPieceId'), current, previous)
      if (target) cues.push({ id: event.id, tick: event.tick, detail, kind: 'merge', target: point(target), level: Math.max(1, Math.floor(dataNumber(event, 'level') ?? 1)) })
      continue
    }

    if (event.type === 'GENERAL_ACTIVATED') {
      const formationId = dataString(event, 'formationId')
      const generalId = dataString(event, 'generalId')
      const refs = dataStrings(event, 'characterPieceIds').flatMap((id) => {
        const ref = resolveRef(id, current, previous)
        return ref ? [ref] : []
      })
      const target = resolveRef(formationId ?? generalId, current, previous)
      const at = target ? point(target) : centroid(refs)
      if (at) {
        cues.push({ id: event.id, tick: event.tick, detail, kind: 'general-formed', target: at, label: knownGeneralName(generalId), generalId, formationId, memberPoints: refs.map(point), glyphs: refs.flatMap(ref => ref.glyph ? [ref.glyph] : []) })
      }
      continue
    }

    if (event.type === 'GENERAL_FIXED_CHANGED' || event.type === 'GENERAL_DEACTIVATED') {
      const generalId = dataString(event, 'generalId')
      const target = resolveRef(dataString(event, 'formationId') ?? generalId, current, previous)
      if (target) {
        const stateValue = event.type === 'GENERAL_DEACTIVATED' ? 'deactivated' : dataBoolean(event, 'fixed') ? 'fixed' : 'unfixed'
        cues.push({ id: event.id, tick: event.tick, detail, kind: 'general-state', target: point(target), label: knownGeneralName(generalId), generalId, state: stateValue })
      }
      continue
    }

    if (event.type === 'STATUS_APPLIED') {
      const generalId = dataString(event, 'generalId')
      const statusId = dataString(event, 'statusId')
      const targetId = dataString(event, 'enemyId')
      const target = resolveRef(targetId, current, previous)
      if (target && generalId && statusId && targetId) cues.push({ id: event.id, tick: event.tick, detail, kind: 'general-status', generalId, statusId, targetId, target: point(target) })
      continue
    }

    if (event.type === 'SYNERGY_ACTIVATED' || event.type === 'SYNERGY_LEVEL_CHANGED' || event.type === 'SYNERGY_DEACTIVATED' || event.type === 'SYNERGY_RECONFIGURED') {
      const synergyId = dataString(event, 'synergyId')
      const contributorIds = synergyContributors(event, state)
      const refs = contributorIds.flatMap((id) => {
        const ref = resolveRef(id, current, previous)
        return ref ? [ref] : []
      })
      const at = centroid(refs)
      const synergyState = event.type === 'SYNERGY_ACTIVATED' ? 'activated' : event.type === 'SYNERGY_DEACTIVATED' ? 'deactivated' : event.type === 'SYNERGY_LEVEL_CHANGED' ? 'upgraded' : 'reconfigured'
      if (at) cues.push({ id: event.id, tick: event.tick, detail, kind: 'synergy', target: at, label: synergyId === MOON_PALACE_SYNERGY_ID ? '月宫旧侣' : synergyId ?? '羁绊', synergyId, level: Math.max(1, Math.floor(dataNumber(event, 'level') ?? 1)), state: synergyState, memberPoints: refs.map(point) })
      updateSynergyLedger(event, state)
      continue
    }

    if (event.type === 'WAVE_STARTED') {
      const waveNumber = Math.max(1, Math.floor(dataNumber(event, 'waveNumber') ?? dataNumber(event, 'wave') ?? 1))
      const bossPerLane = Math.max(0, Math.floor(dataNumber(event, 'bossPerLane') ?? 0))
      cues.push({
        id: event.id,
        tick: event.tick,
        detail,
        kind: 'wave-start',
        waveNumber,
        label: bossPerLane > 0 ? '妖王节点 · 警戒' : `字灵妖潮 · 第${waveNumber}波`,
      })
      continue
    }

    const bossId = dataString(event, 'bossEnemyId') ?? dataString(event, 'enemyId')
    const boss = resolveRef(bossId, current, previous)
    if (event.type === 'BOSS_SPAWNED' && boss) {
      cues.push({ id: event.id, tick: event.tick, detail, kind: 'boss-spawn', targetId: bossId ?? boss.entityId, target: point(boss), label: dataString(event, 'bossName') ?? '妖王' })
    }
    else if (event.type === 'BOSS_CAST_WARNING' && boss) {
      const skillName = dataString(event, 'skillName') ?? '妖术'
      cues.push({
        id: event.id,
        tick: event.tick,
        detail,
        kind: 'boss-warning',
        targetId: bossId ?? boss.entityId,
        target: point(boss),
        label: skillName,
        executeAtTick: dataNumber(event, 'executeAtTick'),
        pluginId: dataString(event, 'pluginId'),
        skillId: dataString(event, 'skillId'),
        ...(actionId ? { actionId } : {}),
        targetIds,
        geometry: event.geometry,
      })
    }
    else if (event.type === 'BOSS_PHASE_CHANGED' && boss) {
      cues.push({ id: event.id, tick: event.tick, detail, kind: 'boss-phase', targetId: bossId ?? boss.entityId, target: point(boss), phase: Math.max(1, Math.floor(dataNumber(event, 'phase') ?? boss.bossPhase)) })
    }
    else if (event.type === 'BOSS_DIED' && boss) {
      if (bossId) {
        explicitDeathTargets.add(bossId)
        state.knownDeadIds.add(bossId)
      }
      cues.push({ id: event.id, tick: event.tick, detail, kind: 'boss-death', targetId: bossId ?? boss.entityId, target: point(boss), label: dataString(event, 'bossName') ?? '妖王' })
    }
  }

  // 无 recentEvents 的旧调用方仍能得到确定的受击/死亡结果反馈；事件接入后会由上面的集合抑制重复。
  if (state.lastTick !== null) {
    for (const [entityId, ref] of current) {
      if (ref.role !== 'enemy' || explicitDamageTargets.has(entityId)) continue
      const before = previous.get(entityId)
      if (!before || before.hp === null || ref.hp === null || ref.hp >= before.hp) continue
      const amount = before.hp - ref.hp
      const lastFloat = state.lastDamageFloatTick.get(entityId) ?? Number.NEGATIVE_INFINITY
      const showText = ref.isBoss || snapshot.tick - lastFloat >= DAMAGE_FLOAT_SAMPLE_TICKS
      if (showText) state.lastDamageFloatTick.set(entityId, snapshot.tick)
      cues.push({ id: `snapshot:${snapshot.tick}:damage:${entityId}:${before.hp}-${ref.hp}`, tick: snapshot.tick, detail: options.reducedMotion || options.lowEffects ? 'result' : 'compact', kind: 'damage', targetId: entityId, target: point(ref), amount, critical: false, showText, isBoss: ref.isBoss, sourceStyle: 'unknown', impactDelayMs: 0 })
    }
    for (const [entityId, ref] of previous) {
      if (ref.role !== 'enemy' || current.has(entityId) || explicitDeathTargets.has(entityId) || state.knownDeadIds.has(entityId)) continue
      cues.push({ id: `snapshot:${snapshot.tick}:death:${entityId}`, tick: snapshot.tick, detail: 'result', kind: 'death', targetId: entityId, target: point(ref), isBoss: ref.isBoss })
    }
    for (const [entityId, ref] of current) {
      if (!ref.isBoss) continue
      const before = previous.get(entityId)
      if (before?.isBoss && ref.bossPhase > before.bossPhase && !newEvents.some((event) => event.type === 'BOSS_PHASE_CHANGED' && eventTargetIds(event).includes(entityId))) {
        cues.push({ id: `snapshot:${snapshot.tick}:boss-phase:${entityId}:${ref.bossPhase}`, tick: snapshot.tick, detail: options.reducedMotion || options.lowEffects ? 'result' : 'compact', kind: 'boss-phase', targetId: entityId, target: point(ref), phase: ref.bossPhase })
      }
    }
  }

  state.lastTick = snapshot.tick
  state.entities = current
  const activeEnemyIds = new Set(snapshot.enemies.map((enemy) => enemy.entityId))
  for (const id of state.lastDamageFloatTick.keys()) if (!activeEnemyIds.has(id)) state.lastDamageFloatTick.delete(id)
  for (const id of state.knownDeadIds) if (!activeEnemyIds.has(id)) state.knownDeadIds.delete(id)
  return cues
}
