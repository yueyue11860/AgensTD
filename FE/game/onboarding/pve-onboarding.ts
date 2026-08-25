export const PVE_ONBOARDING_VERSION = 1 as const

export type PveOnboardingStepId =
  | 'recruit'
  | 'select-tray'
  | 'deploy'
  | 'merge'
  | 'general'
  | 'boss-warning'

export type PveOnboardingStatus = 'active' | 'paused' | 'completed' | 'skipped'

export interface PveOnboardingProgress {
  version: number
  status: PveOnboardingStatus
  completedSteps: PveOnboardingStepId[]
  skippedSteps: PveOnboardingStepId[]
  maxReachedIndex: number
}

export interface OnboardingPieceLike {
  kind: 'soldier' | 'character'
  soldierType?: string
  level?: number
}

export interface OnboardingFormationLike {
  fixed: boolean
}

export interface OnboardingEventLike {
  id: string
  type: string
  data?: Record<string, unknown>
}

export interface PveOnboardingObservation {
  status: string
  currentWave: number
  nextRecruitCost: number
  trayRevision: number
  boardRevision: number
  tray: Array<OnboardingPieceLike | null>
  reserve: Array<OnboardingPieceLike | null>
  boardPieces: OnboardingPieceLike[]
  generalFormations: OnboardingFormationLike[]
  enemies: Array<{ entityKind: string, activeCast?: unknown }>
  recentEvents: OnboardingEventLike[]
  selectedTrayIndex: number | null
}

export interface PveOnboardingFacts {
  running: boolean
  recruited: boolean
  traySelected: boolean
  deployed: boolean
  mergeAvailable: boolean
  merged: boolean
  generalFormed: boolean
  generalFixed: boolean
  bossWarning: boolean
  currentWave: number
  nextRecruitCost: number
}

export const PVE_ONBOARDING_STEPS: readonly PveOnboardingStepId[] = [
  'recruit',
  'select-tray',
  'deploy',
  'merge',
  'general',
  'boss-warning',
]

const AUTO_COMPLETION_FACT: Partial<Record<PveOnboardingStepId, keyof PveOnboardingFacts>> = {
  recruit: 'recruited',
  'select-tray': 'traySelected',
  deploy: 'deployed',
  merge: 'merged',
  general: 'generalFixed',
}

export function createPveOnboardingProgress(version = PVE_ONBOARDING_VERSION): PveOnboardingProgress {
  return { version, status: 'active', completedSteps: [], skippedSteps: [], maxReachedIndex: 0 }
}

function uniqueSteps(value: unknown): PveOnboardingStepId[] {
  if (!Array.isArray(value)) return []
  const valid = new Set(PVE_ONBOARDING_STEPS)
  return [...new Set(value.filter((step): step is PveOnboardingStepId => typeof step === 'string' && valid.has(step as PveOnboardingStepId)))]
}

export function parsePveOnboardingProgress(value: unknown, version = PVE_ONBOARDING_VERSION): PveOnboardingProgress {
  if (!value || typeof value !== 'object') return createPveOnboardingProgress(version)
  const record = value as Record<string, unknown>
  if (record.version !== version) return createPveOnboardingProgress(version)
  const status: PveOnboardingStatus = record.status === 'paused' || record.status === 'completed' || record.status === 'skipped'
    ? record.status
    : 'active'
  return {
    version,
    status,
    completedSteps: uniqueSteps(record.completedSteps),
    skippedSteps: uniqueSteps(record.skippedSteps),
    maxReachedIndex: Math.max(0, Math.min(PVE_ONBOARDING_STEPS.length - 1, Math.floor(typeof record.maxReachedIndex === 'number' ? record.maxReachedIndex : 0))),
  }
}

export function pveOnboardingStorageKey(playerId: string, version = PVE_ONBOARDING_VERSION): string {
  return `agenstd.pve-onboarding.${encodeURIComponent(playerId)}.v${version}`
}

export function shouldResetPveOnboardingFromQuery(isDevelopment: boolean, query: string): boolean {
  if (!isDevelopment) return false
  return new URLSearchParams(query.startsWith('?') ? query : `?${query}`).get('onboardingReset') === '1'
}

function eventTypes(events: readonly OnboardingEventLike[]): Set<string> {
  return new Set(events.map(event => event.type))
}

function hasMatchingSoldierPair(pieces: readonly (OnboardingPieceLike | null)[]): boolean {
  const counts = new Map<string, number>()
  for (const piece of pieces) {
    if (!piece || piece.kind !== 'soldier' || !piece.soldierType) continue
    const level = Math.max(1, Math.floor(piece.level ?? 1))
    const key = `${piece.soldierType}:${level}`
    const next = (counts.get(key) ?? 0) + 1
    if (next >= 2) return true
    counts.set(key, next)
  }
  return false
}

/** Derives milestones only from authoritative snapshot/event data plus the local selection itself. */
export function derivePveOnboardingFacts(observation: PveOnboardingObservation): PveOnboardingFacts {
  const types = eventTypes(observation.recentEvents)
  const allPieces = [...observation.tray, ...observation.reserve, ...observation.boardPieces]
  const deployed = observation.boardRevision > 0
    || observation.boardPieces.length > 0
    || types.has('TRAY_BOARD_SWAPPED')
    || types.has('RESERVE_BOARD_SWAPPED')
    || types.has('BOARD_PIECE_MOVED')
  const recruited = observation.trayRevision > 0
    || observation.tray.some(Boolean)
    || types.has('RECRUITED')
    || deployed
  const merged = types.has('SOLDIER_MERGED')
    || allPieces.some(piece => piece?.kind === 'soldier' && (piece.level ?? 1) >= 2)
  const generalFormed = observation.generalFormations.length > 0 || types.has('GENERAL_ACTIVATED')
  const generalFixed = observation.generalFormations.some(formation => formation.fixed)
    || observation.recentEvents.some(event => event.type === 'GENERAL_FIXED_CHANGED' && event.data?.fixed === true)
  const bossWarning = observation.enemies.some(enemy => enemy.entityKind === 'boss' || Boolean(enemy.activeCast))
    || types.has('BOSS_SPAWNED')
    || types.has('BOSS_CAST_WARNING')
    || types.has('BOSS_PHASE_CHANGED')
  return {
    running: observation.status === 'running',
    recruited,
    traySelected: observation.selectedTrayIndex !== null || deployed,
    deployed,
    mergeAvailable: hasMatchingSoldierPair(allPieces),
    merged: merged || generalFormed,
    generalFormed,
    generalFixed,
    bossWarning,
    currentWave: Math.max(0, Math.floor(observation.currentWave)),
    nextRecruitCost: Math.max(0, Math.floor(observation.nextRecruitCost)),
  }
}

function sameProgress(left: PveOnboardingProgress, right: PveOnboardingProgress): boolean {
  return left.status === right.status
    && left.maxReachedIndex === right.maxReachedIndex
    && left.completedSteps.join('|') === right.completedSteps.join('|')
    && left.skippedSteps.join('|') === right.skippedSteps.join('|')
}

export function reconcilePveOnboardingProgress(
  progress: PveOnboardingProgress,
  facts: PveOnboardingFacts,
): PveOnboardingProgress {
  if (progress.status === 'completed' || progress.status === 'skipped') return progress
  const completed = new Set(progress.completedSteps)
  for (const [step, fact] of Object.entries(AUTO_COMPLETION_FACT) as Array<[PveOnboardingStepId, keyof PveOnboardingFacts]>) {
    if (facts[fact] === true) completed.add(step)
  }
  // Boss presentation supersedes stale early tips. Earlier steps remain learnable through the normal UI,
  // but the coach must not cover a live server warning.
  if (facts.bossWarning) {
    for (const step of PVE_ONBOARDING_STEPS.slice(0, -1)) completed.add(step)
  }
  // The tutorial is explicitly scoped to waves 1–5. Crossing the authoritative wave boundary
  // proves the player has passed the first Boss gate even if its short event window was trimmed
  // during reconnect; do not carry an eternally-active final tip into the next match.
  if (facts.currentWave > 5) completed.add('boss-warning')
  const acknowledged = new Set([...completed, ...progress.skippedSteps])
  const nextIndex = PVE_ONBOARDING_STEPS.findIndex(step => !acknowledged.has(step))
  const next: PveOnboardingProgress = {
    ...progress,
    completedSteps: PVE_ONBOARDING_STEPS.filter(step => completed.has(step)),
    maxReachedIndex: Math.max(progress.maxReachedIndex, nextIndex < 0 ? PVE_ONBOARDING_STEPS.length - 1 : nextIndex),
    status: nextIndex < 0 ? 'completed' : progress.status,
  }
  return sameProgress(progress, next) ? progress : next
}

export function currentPveOnboardingStep(progress: PveOnboardingProgress, facts: PveOnboardingFacts): PveOnboardingStepId | null {
  if (progress.status === 'completed' || progress.status === 'skipped') return null
  if (facts.bossWarning && !progress.completedSteps.includes('boss-warning') && !progress.skippedSteps.includes('boss-warning')) return 'boss-warning'
  const acknowledged = new Set([...progress.completedSteps, ...progress.skippedSteps])
  return PVE_ONBOARDING_STEPS.find(step => !acknowledged.has(step)) ?? null
}

export function skipPveOnboardingStep(progress: PveOnboardingProgress, step: PveOnboardingStepId): PveOnboardingProgress {
  if (progress.status === 'completed' || progress.status === 'skipped' || progress.skippedSteps.includes(step)) return progress
  const skippedSteps = [...progress.skippedSteps, step]
  const acknowledged = new Set([...progress.completedSteps, ...skippedSteps])
  return {
    ...progress,
    status: PVE_ONBOARDING_STEPS.every(candidate => acknowledged.has(candidate)) ? 'completed' : 'active',
    skippedSteps: PVE_ONBOARDING_STEPS.filter(candidate => skippedSteps.includes(candidate)),
    maxReachedIndex: Math.max(progress.maxReachedIndex, PVE_ONBOARDING_STEPS.indexOf(step)),
  }
}

export function pausePveOnboarding(progress: PveOnboardingProgress): PveOnboardingProgress {
  return progress.status === 'active' ? { ...progress, status: 'paused' } : progress
}

export function resumePveOnboarding(progress: PveOnboardingProgress): PveOnboardingProgress {
  return progress.status === 'paused' ? { ...progress, status: 'active' } : progress
}

export function skipAllPveOnboarding(progress: PveOnboardingProgress): PveOnboardingProgress {
  return { ...progress, status: 'skipped', skippedSteps: [...PVE_ONBOARDING_STEPS], maxReachedIndex: PVE_ONBOARDING_STEPS.length - 1 }
}
