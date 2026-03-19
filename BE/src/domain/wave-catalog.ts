import type { EnemyKind, WaveState } from './game-state'

export interface WaveSpawnGroup {
  kind: EnemyKind
  count: number
  startOffsetTicks: number
  intervalTicks: number
}

export interface WaveDefinition {
  index: number
  label: string
  durationTicks: number
  spawns: WaveSpawnGroup[]
}

export interface WaveTimelineEntry extends WaveDefinition {
  startTick: number
  endTick: number
}

export interface ScheduledEnemySpawn {
  waveIndex: number
  waveLabel: string
  dueTick: number
  kind: EnemyKind
}

export const waveCatalog: WaveDefinition[] = [
  {
    index: 1,
    label: '第 1 波 · 试探推进',
    durationTicks: 18,
    spawns: [
      { kind: 'runner', count: 4, startOffsetTicks: 0, intervalTicks: 3 },
    ],
  },
  {
    index: 2,
    label: '第 2 波 · 快速扰动',
    durationTicks: 24,
    spawns: [
      { kind: 'swift', count: 5, startOffsetTicks: 0, intervalTicks: 3 },
      { kind: 'runner', count: 3, startOffsetTicks: 4, intervalTicks: 4 },
    ],
  },
  {
    index: 3,
    label: '第 3 波 · 装甲压制',
    durationTicks: 28,
    spawns: [
      { kind: 'runner', count: 6, startOffsetTicks: 0, intervalTicks: 3 },
      { kind: 'brute', count: 2, startOffsetTicks: 6, intervalTicks: 8 },
    ],
  },
  {
    index: 4,
    label: '第 4 波 · 混编冲锋',
    durationTicks: 32,
    spawns: [
      { kind: 'swift', count: 6, startOffsetTicks: 0, intervalTicks: 2 },
      { kind: 'brute', count: 3, startOffsetTicks: 8, intervalTicks: 7 },
    ],
  },
]

export function buildWaveTimeline(waves: WaveDefinition[], firstWaveStartTick = 1): WaveTimelineEntry[] {
  let currentStartTick = firstWaveStartTick

  return waves.map((wave) => {
    const timelineEntry: WaveTimelineEntry = {
      ...wave,
      startTick: currentStartTick,
      endTick: currentStartTick + wave.durationTicks - 1,
    }

    currentStartTick = timelineEntry.endTick + 1
    return timelineEntry
  })
}

export function buildWaveSpawnSchedule(timeline: WaveTimelineEntry[]): ScheduledEnemySpawn[] {
  const schedule: ScheduledEnemySpawn[] = []

  for (const wave of timeline) {
    for (const spawnGroup of wave.spawns) {
      for (let index = 0; index < spawnGroup.count; index += 1) {
        schedule.push({
          waveIndex: wave.index,
          waveLabel: wave.label,
          dueTick: wave.startTick + spawnGroup.startOffsetTicks + index * spawnGroup.intervalTicks,
          kind: spawnGroup.kind,
        })
      }
    }
  }

  return schedule.sort((left, right) => left.dueTick - right.dueTick)
}

export function getWaveStateForTick(
  tick: number,
  timeline: WaveTimelineEntry[],
  schedule: ScheduledEnemySpawn[],
  nextSpawnScheduleIndex: number,
): WaveState {
  const activeWave = timeline.find((wave) => tick <= wave.endTick) ?? timeline[timeline.length - 1]

  if (!activeWave) {
    return {
      index: 0,
      label: '无波次',
      startedAtTick: 0,
      endsAtTick: null,
      remainingSpawns: 0,
      prepCountdownSec: 0,
    }
  }

  let remainingSpawns = 0
  for (let index = nextSpawnScheduleIndex; index < schedule.length; index += 1) {
    if (schedule[index].waveIndex === activeWave.index) {
      remainingSpawns += 1
    }
  }

  return {
    index: activeWave.index,
    label: activeWave.label,
    startedAtTick: activeWave.startTick,
    endsAtTick: activeWave.endTick,
    remainingSpawns,
    prepCountdownSec: 0,
  }
}