import type {
  CombatEventBatch,
  GameState,
  SequencedCombatEvent,
  TickEnvelope,
} from '../../../shared/contracts/game'

function validCombatGeometry(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  const finite = (entry: unknown): entry is number => typeof entry === 'number' && Number.isFinite(entry)
  const point = (entry: unknown): boolean => Boolean(entry && typeof entry === 'object' && !Array.isArray(entry)
    && finite((entry as Record<string, unknown>).xMilli) && finite((entry as Record<string, unknown>).yMilli))
  if (candidate.kind === 'point') return point(candidate)
  if (candidate.kind === 'circle') return point(candidate) && finite(candidate.radiusMilliCells) && candidate.radiusMilliCells >= 0
  if (candidate.kind === 'corridor') return point(candidate.from) && point(candidate.to)
    && finite(candidate.halfWidthMilliCells) && candidate.halfWidthMilliCells >= 0
  return candidate.kind === 'polyline' && Array.isArray(candidate.points)
    && candidate.points.length > 0 && candidate.points.every(point)
}

export const CLIENT_COMBAT_PRESENTATION_VERSION = 1 as const

export interface CombatEventStreamState {
  matchId: string | null
  presentationVersion: number
  lastSeq: number
  pending: Map<number, CombatEventBatch>
}

export interface CombatEventMergeResult {
  state: CombatEventStreamState
  accepted: SequencedCombatEvent[]
  ackSeq: number | null
  gapFromSeq: number | null
}

export function createCombatEventStreamState(): CombatEventStreamState {
  return { matchId: null, presentationVersion: CLIENT_COMBAT_PRESENTATION_VERSION, lastSeq: 0, pending: new Map() }
}

export function baselineCombatEventStream(matchId: string | undefined, eventSeq: number | undefined) {
  const state = createCombatEventStreamState()
  state.matchId = matchId ?? null
  state.lastSeq = Number.isSafeInteger(eventSeq) && (eventSeq as number) >= 0 ? eventSeq as number : 0
  return state
}

export function isCombatEventBatch(value: unknown): value is CombatEventBatch {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<CombatEventBatch>
  return typeof candidate.matchId === 'string'
    && candidate.presentationVersion === CLIENT_COMBAT_PRESENTATION_VERSION
    && Number.isSafeInteger(candidate.fromSeq)
    && Number.isSafeInteger(candidate.toSeq)
    && Array.isArray(candidate.events)
    && candidate.events.every((event) => event && typeof event === 'object'
      && Number.isSafeInteger(event.seq)
      && typeof event.id === 'string'
      && typeof event.tick === 'number'
      && typeof event.type === 'string'
      && event.data !== null
      && typeof event.data === 'object'
      && (event.actionId === undefined || typeof event.actionId === 'string')
      && (event.targetIds === undefined || (Array.isArray(event.targetIds)
        && event.targetIds.every((id) => typeof id === 'string')))
      && (event.geometry === undefined || event.geometry === null
        || validCombatGeometry(event.geometry)))
}

export function mergeCombatEventBatch(
  current: CombatEventStreamState,
  batch: CombatEventBatch,
): CombatEventMergeResult {
  if (batch.presentationVersion !== CLIENT_COMBAT_PRESENTATION_VERSION || batch.fromSeq > batch.toSeq) {
    return { state: current, accepted: [], ackSeq: null, gapFromSeq: current.lastSeq + 1 }
  }
  if (current.matchId !== null && batch.matchId !== current.matchId) {
    return { state: current, accepted: [], ackSeq: null, gapFromSeq: current.lastSeq + 1 }
  }
  if (batch.toSeq <= current.lastSeq) {
    return { state: current, accepted: [], ackSeq: current.lastSeq, gapFromSeq: null }
  }

  const state: CombatEventStreamState = {
    matchId: batch.matchId,
    presentationVersion: batch.presentationVersion,
    lastSeq: current.lastSeq,
    pending: new Map(current.pending),
  }
  state.pending.set(batch.fromSeq, batch)
  const accepted: SequencedCombatEvent[] = []
  let detectedGap: number | null = null

  while (true) {
    const nextEntry = [...state.pending.entries()]
      .filter(([, candidate]) => candidate.fromSeq <= state.lastSeq + 1 && candidate.toSeq > state.lastSeq)
      .sort(([left], [right]) => left - right)[0]
    if (!nextEntry) break
    const [key, candidate] = nextEntry
    state.pending.delete(key)
    const fresh = candidate.events
      .filter((event) => event.seq > state.lastSeq)
      .sort((left, right) => left.seq - right.seq)
    let expected = state.lastSeq + 1
    for (const event of fresh) {
      if (event.seq !== expected) {
        detectedGap = expected
        break
      }
      accepted.push(event)
      state.lastSeq = event.seq
      expected += 1
    }
    // Header claims a wider interval than the actual contiguous payload. Do not silently ACK
    // past the missing event; request authoritative compensation from the first absent seq.
    if (state.lastSeq < candidate.toSeq) detectedGap = state.lastSeq + 1
    if (detectedGap !== null) break
  }

  for (const [key, candidate] of state.pending) {
    if (candidate.toSeq <= state.lastSeq) state.pending.delete(key)
  }

  const smallestPending = state.pending.size ? Math.min(...state.pending.keys()) : null
  const gapFromSeq = detectedGap ?? (smallestPending !== null && smallestPending > state.lastSeq + 1
    ? state.lastSeq + 1
    : null)
  return { state, accepted, ackSeq: state.lastSeq, gapFromSeq }
}

export function mergeCombatEventsIntoGameState(state: GameState | null, events: SequencedCombatEvent[]) {
  if (!state?.pve || events.length === 0) return state
  const byId = new Map(state.pve.recentEvents.map((event) => [event.id, event]))
  for (const { seq: _seq, ...event } of events) byId.set(event.id, event)
  return {
    ...state,
    pve: {
      ...state.pve,
      recentEvents: [...byId.values()].slice(-300),
    },
  }
}

export type StateEnvelopeDecision = 'apply' | 'stale' | 'gap'

export function classifyStateEnvelope(envelope: TickEnvelope, currentRevision: number): StateEnvelopeDecision {
  if (envelope.mode === 'full') return 'apply'
  if (envelope.revision === undefined || envelope.baseRevision === undefined) return 'apply'
  if (envelope.revision <= currentRevision) return 'stale'
  if (envelope.mode === 'checkpoint') return 'apply'
  return envelope.baseRevision === currentRevision ? 'apply' : 'gap'
}
