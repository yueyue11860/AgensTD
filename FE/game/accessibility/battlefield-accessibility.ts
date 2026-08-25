export interface BattlefieldGridCursor {
  x: number
  y: number
}

export type BattlefieldCursorDirection = 'up' | 'down' | 'left' | 'right'

export interface AccessibleBattleEvent {
  id: string
  tick: number
  type: string
  data: Record<string, string | number | boolean | string[] | number[] | null>
}

export interface AccessibleBossState {
  entityId: string
  bossName: string | null
  glyph: string
  hp: number
  maxHp: number
}

export interface BattleAnnouncement {
  key: string
  kind: 'opening' | 'preparation' | 'wave' | 'boss'
  title: string
  objective: string
  threat: string
}

export interface BattleAnnouncementInput {
  matchId: string | null
  chapterLabel: string
  currentWave: number
  maxWaves: number
  prepCountdownSec: number
  enemyCount: number
  recentEvents: readonly AccessibleBattleEvent[]
  bosses: readonly AccessibleBossState[]
}

export function moveBattlefieldCursor(
  cursor: BattlefieldGridCursor | null,
  direction: BattlefieldCursorDirection,
  dimension = 29,
): BattlefieldGridCursor {
  const maximum = Math.max(0, Math.floor(dimension) - 1)
  const origin = cursor ?? { x: Math.floor(maximum / 2), y: Math.floor(maximum / 2) }
  const delta = direction === 'up'
    ? { x: 0, y: -1 }
    : direction === 'down'
      ? { x: 0, y: 1 }
      : direction === 'left'
        ? { x: -1, y: 0 }
        : { x: 1, y: 0 }
  return {
    x: Math.max(0, Math.min(maximum, origin.x + delta.x)),
    y: Math.max(0, Math.min(maximum, origin.y + delta.y)),
  }
}

function eventWaveNumber(event: AccessibleBattleEvent): number | null {
  const waveNumber = event.data.waveNumber
  return typeof waveNumber === 'number' && Number.isFinite(waveNumber) ? Math.floor(waveNumber) : null
}

function eventBossName(event: AccessibleBattleEvent) {
  return typeof event.data.bossName === 'string' && event.data.bossName.trim()
    ? event.data.bossName.trim()
    : null
}

/**
 * 将服务端权威波次、Boss 投影和 recentEvents 转成可去重的章回公告候选。
 * 不根据本地计时推进波次，也不自行推演 Boss 是否已经生成。
 */
export function deriveBattleAnnouncementCandidates(input: BattleAnnouncementInput): BattleAnnouncement[] {
  if (!input.matchId || input.currentWave <= 0) return []

  const seenEventIds = new Set<string>()
  const currentWaveEvents = input.recentEvents.filter((event) => {
    if (seenEventIds.has(event.id)) return false
    seenEventIds.add(event.id)
    return eventWaveNumber(event) === input.currentWave
  })
  const waveStartedEvent = currentWaveEvents.find(event => event.type === 'WAVE_STARTED')
  const bossSpawnedEvents = currentWaveEvents.filter(event => event.type === 'BOSS_SPAWNED')
  const openingWaveCount = waveStartedEvent && typeof waveStartedEvent.data.countPerLane === 'number'
    ? ` · 每路 ${Math.max(0, Math.floor(waveStartedEvent.data.countPerLane))} 名敌军`
    : ''

  const candidates: BattleAnnouncement[] = [{
    key: `${input.matchId}:opening`,
    kind: 'opening',
    title: `${input.chapterLabel} · 开阵`,
    objective: '召唤天兵，落子布防，守住第一轮妖潮。',
    threat: `当前敌军 ${input.enemyCount} · 全局共 ${Math.max(input.currentWave, input.maxWaves)} 波${input.currentWave === 1 ? openingWaveCount : ''}`,
  }]

  if (input.currentWave > 1 && input.prepCountdownSec > 0 && !waveStartedEvent && bossSpawnedEvents.length === 0) {
    candidates.push({
      key: `${input.matchId}:prep:${input.currentWave}`,
      kind: 'preparation',
      title: `第 ${input.currentWave} 波 · 备战`,
      objective: '检查人口与阵型，在倒计时结束前完成落子。',
      threat: `权威备战倒计时 ${Math.ceil(input.prepCountdownSec)} 秒 · 当前敌军 ${input.enemyCount}`,
    })
  }

  for (const event of currentWaveEvents) {
    const waveNumber = input.currentWave

    if (event.type === 'WAVE_STARTED' && input.currentWave > 1 && bossSpawnedEvents.length === 0) {
      const countPerLane = typeof event.data.countPerLane === 'number' ? Math.max(0, Math.floor(event.data.countPerLane)) : null
      const bossPerLane = typeof event.data.bossPerLane === 'number' ? Math.max(0, Math.floor(event.data.bossPerLane)) : 0
      candidates.push({
        key: `${input.matchId}:event:${event.id}`,
        kind: 'wave',
        title: `第 ${waveNumber} 波 · 妖潮已起`,
        objective: '守住进军路线，优先处理突破防线的敌军。',
        threat: countPerLane === null
          ? `服务端已下达第 ${waveNumber} 波军令`
          : `每路 ${countPerLane} 名敌军${bossPerLane > 0 ? ` · 含 ${bossPerLane} 名首领` : ''}`,
      })
    }

    if (event.type === 'BOSS_SPAWNED') {
      const projectedBoss = input.bosses.find((boss) => boss.entityId === event.data.enemyId) ?? input.bosses[0]
      const name = eventBossName(event) ?? projectedBoss?.bossName ?? projectedBoss?.glyph ?? '首领'
      const hp = projectedBoss ? `${Math.max(0, Math.ceil(projectedBoss.hp)).toLocaleString()} / ${Math.max(1, Math.ceil(projectedBoss.maxHp)).toLocaleString()} 生命` : '首领状态已由服务端确认'
      candidates.push({
        key: `${input.matchId}:event:${event.id}`,
        kind: 'boss',
        title: `第 ${waveNumber} 波 · ${name} 登场`,
        objective: '集火首领，并为技能预警保留调整阵型的空间。',
        threat: hp,
      })
    }
  }

  return candidates
}
