import type { BattlefieldPresentationCue } from '../presentation/combat-presentation-adapter'

export type CombatSoundId =
  | 'hit_blade'
  | 'hit_spear'
  | 'hit_bow'
  | 'hit_cavalry'
  | 'hit_general'
  | 'summon'
  | 'merge'
  | 'general_formed'
  | 'houyi_motif'
  | 'yangjian_motif'
  | 'moon_palace_motif'
  | 'boss_warning'
  | 'boss_death'

export interface CombatSoundRequest {
  soundId: CombatSoundId
  throttleKey: string
  throttleMs: number
  priority: 1 | 2 | 3 | 4
  gain: number
}

export interface CombatSoundMappingOptions {
  lowEffects: boolean
  currentTick: number
  tickRateMs?: number
}

export interface VoiceAdmission {
  admitted: boolean
  voiceId: string | null
  preemptedVoiceId: string | null
  reason: 'admitted' | 'throttled' | 'capacity'
}

interface ActiveVoice {
  priority: number
  startedAtMs: number
}

/** 纯调度器：同类节流、并发硬上限，高优先级可抢占最旧的低优先级声音。 */
export class CombatAudioVoiceLimiter {
  private maxConcurrent: number
  private sequence = 0
  private readonly active = new Map<string, ActiveVoice>()
  private readonly lastStartedByKey = new Map<string, number>()

  constructor(maxConcurrent = 10) {
    this.maxConcurrent = Math.max(1, Math.floor(maxConcurrent))
  }

  setMaxConcurrent(maxConcurrent: number): void {
    this.maxConcurrent = Math.max(1, Math.floor(maxConcurrent))
  }

  admit(request: CombatSoundRequest, nowMs: number): VoiceAdmission {
    const lastStarted = this.lastStartedByKey.get(request.throttleKey)
    if (lastStarted !== undefined && nowMs - lastStarted < request.throttleMs) {
      return { admitted: false, voiceId: null, preemptedVoiceId: null, reason: 'throttled' }
    }

    let preemptedVoiceId: string | null = null
    if (this.active.size >= this.maxConcurrent) {
      const candidate = [...this.active.entries()].sort((left, right) => (
        left[1].priority - right[1].priority || left[1].startedAtMs - right[1].startedAtMs
      ))[0]
      if (!candidate || request.priority <= candidate[1].priority) {
        return { admitted: false, voiceId: null, preemptedVoiceId: null, reason: 'capacity' }
      }
      preemptedVoiceId = candidate[0]
      this.active.delete(preemptedVoiceId)
    }

    this.sequence += 1
    const voiceId = `combat-voice-${this.sequence}`
    this.active.set(voiceId, { priority: request.priority, startedAtMs: nowMs })
    this.lastStartedByKey.set(request.throttleKey, nowMs)
    return { admitted: true, voiceId, preemptedVoiceId, reason: 'admitted' }
  }

  complete(voiceId: string): void {
    this.active.delete(voiceId)
  }

  reset(): void {
    this.active.clear()
    this.lastStartedByKey.clear()
  }

  get activeCount(): number {
    return this.active.size
  }
}

function eventAgeMs(cue: BattlefieldPresentationCue, options: CombatSoundMappingOptions): number {
  const ageTicks = Math.max(0, options.currentTick - cue.tick)
  if (ageTicks === 0) return 0
  return options.tickRateMs && options.tickRateMs > 0 ? ageTicks * options.tickRateMs : Number.POSITIVE_INFINITY
}

/** 表现 cue 到声音语义的纯映射；超过 1.8 秒的历史事件不会在重连后补响。 */
export function mapCueToCombatSound(
  cue: BattlefieldPresentationCue,
  options: CombatSoundMappingOptions,
): CombatSoundRequest | null {
  if (eventAgeMs(cue, options) > 1800) return null
  if (cue.kind === 'damage') {
    const soundId: CombatSoundId = cue.sourceStyle === 'blade'
      ? 'hit_blade'
      : cue.sourceStyle === 'spear'
        ? 'hit_spear'
        : cue.sourceStyle === 'bow'
          ? 'hit_bow'
          : cue.sourceStyle === 'cavalry'
            ? 'hit_cavalry'
            : 'hit_general'
    return {
      soundId,
      throttleKey: soundId,
      throttleMs: options.lowEffects && !cue.critical && !cue.isBoss ? 170 : 58,
      priority: cue.isBoss || cue.critical ? 2 : 1,
      gain: cue.critical ? 0.16 : cue.isBoss ? 0.13 : options.lowEffects ? 0.07 : 0.1,
    }
  }
  if (cue.kind === 'summon') return { soundId: 'summon', throttleKey: 'summon', throttleMs: 140, priority: 2, gain: 0.11 }
  if (cue.kind === 'merge') return { soundId: 'merge', throttleKey: 'merge', throttleMs: 120, priority: 2, gain: 0.12 }
  if (cue.kind === 'general-action' && cue.actionKind === 'skill') {
    if (cue.generalId === 'houyi' && cue.visual === 'sun-arrow') return { soundId: 'houyi_motif', throttleKey: 'general-skill:houyi', throttleMs: 620, priority: 3, gain: 0.13 }
    if (cue.generalId === 'yangjian' && cue.visual === 'three-point-blade') return { soundId: 'yangjian_motif', throttleKey: 'general-skill:yangjian', throttleMs: 520, priority: 3, gain: 0.13 }
  }
  if (cue.kind === 'general-formed') {
    if (cue.generalId === 'houyi') return { soundId: 'houyi_motif', throttleKey: 'general-formed:houyi', throttleMs: 700, priority: 3, gain: 0.14 }
    if (cue.generalId === 'yangjian') return { soundId: 'yangjian_motif', throttleKey: 'general-formed:yangjian', throttleMs: 700, priority: 3, gain: 0.14 }
    return { soundId: 'general_formed', throttleKey: 'general-formed', throttleMs: 350, priority: 3, gain: 0.14 }
  }
  if (cue.kind === 'synergy') {
    if (cue.synergyId === 'moon_palace_companions') return { soundId: 'moon_palace_motif', throttleKey: `synergy:moon-palace:${cue.state ?? 'changed'}`, throttleMs: 650, priority: 3, gain: cue.state === 'deactivated' ? 0.09 : 0.13 }
    return { soundId: 'general_formed', throttleKey: 'general-formed', throttleMs: 350, priority: 3, gain: 0.14 }
  }
  if (cue.kind === 'boss-warning' || cue.kind === 'boss-spawn' || cue.kind === 'boss-phase') return { soundId: 'boss_warning', throttleKey: `boss-warning:${cue.targetId}`, throttleMs: 450, priority: 4, gain: 0.17 }
  if (cue.kind === 'boss-death') return { soundId: 'boss_death', throttleKey: `boss-death:${cue.targetId}`, throttleMs: 1000, priority: 4, gain: 0.2 }
  return null
}

interface ToneSpec {
  type: OscillatorType
  startHz: number
  endHz: number
  delayMs: number
  durationMs: number
  gainRatio: number
}

const RECIPES: Readonly<Record<CombatSoundId, readonly ToneSpec[]>> = {
  hit_blade: [{ type: 'triangle', startHz: 210, endHz: 82, delayMs: 0, durationMs: 72, gainRatio: 1 }],
  hit_spear: [{ type: 'square', startHz: 360, endHz: 190, delayMs: 0, durationMs: 58, gainRatio: 0.72 }],
  hit_bow: [{ type: 'sine', startHz: 680, endHz: 310, delayMs: 0, durationMs: 92, gainRatio: 0.82 }],
  hit_cavalry: [
    { type: 'sine', startHz: 118, endHz: 72, delayMs: 0, durationMs: 72, gainRatio: 1 },
    { type: 'sine', startHz: 104, endHz: 68, delayMs: 48, durationMs: 72, gainRatio: 0.78 },
  ],
  hit_general: [{ type: 'sine', startHz: 310, endHz: 170, delayMs: 0, durationMs: 105, gainRatio: 0.72 }],
  summon: [
    { type: 'sine', startHz: 330, endHz: 440, delayMs: 0, durationMs: 120, gainRatio: 0.55 },
    { type: 'sine', startHz: 494, endHz: 660, delayMs: 65, durationMs: 150, gainRatio: 0.5 },
  ],
  merge: [
    { type: 'triangle', startHz: 240, endHz: 360, delayMs: 0, durationMs: 100, gainRatio: 0.7 },
    { type: 'triangle', startHz: 360, endHz: 520, delayMs: 72, durationMs: 140, gainRatio: 0.7 },
  ],
  general_formed: [
    { type: 'sine', startHz: 330, endHz: 440, delayMs: 0, durationMs: 220, gainRatio: 0.48 },
    { type: 'sine', startHz: 494, endHz: 660, delayMs: 90, durationMs: 250, gainRatio: 0.46 },
    { type: 'triangle', startHz: 660, endHz: 880, delayMs: 185, durationMs: 300, gainRatio: 0.38 },
  ],
  houyi_motif: [
    { type: 'sine', startHz: 392, endHz: 587, delayMs: 0, durationMs: 165, gainRatio: 0.42 },
    { type: 'triangle', startHz: 587, endHz: 988, delayMs: 82, durationMs: 245, gainRatio: 0.34 },
  ],
  yangjian_motif: [
    { type: 'triangle', startHz: 294, endHz: 196, delayMs: 0, durationMs: 92, gainRatio: 0.52 },
    { type: 'sine', startHz: 440, endHz: 330, delayMs: 54, durationMs: 155, gainRatio: 0.38 },
    { type: 'triangle', startHz: 523, endHz: 247, delayMs: 108, durationMs: 135, gainRatio: 0.32 },
  ],
  moon_palace_motif: [
    { type: 'sine', startHz: 440, endHz: 523, delayMs: 0, durationMs: 240, gainRatio: 0.32 },
    { type: 'sine', startHz: 659, endHz: 784, delayMs: 115, durationMs: 310, gainRatio: 0.27 },
  ],
  boss_warning: [
    { type: 'sawtooth', startHz: 96, endHz: 61, delayMs: 0, durationMs: 260, gainRatio: 0.66 },
    { type: 'sine', startHz: 190, endHz: 128, delayMs: 45, durationMs: 210, gainRatio: 0.42 },
  ],
  boss_death: [
    { type: 'sawtooth', startHz: 150, endHz: 34, delayMs: 0, durationMs: 650, gainRatio: 0.62 },
    { type: 'triangle', startHz: 88, endHz: 42, delayMs: 130, durationMs: 720, gainRatio: 0.65 },
    { type: 'sine', startHz: 420, endHz: 70, delayMs: 0, durationMs: 430, gainRatio: 0.3 },
  ],
}

interface RuntimeVoice {
  sources: Set<OscillatorNode>
  timerId: number
}

type WindowWithWebkitAudio = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }

/** 惰性 WebAudio 合成器。构造时不会创建 AudioContext，只有用户手势调用 unlock 才会创建。 */
export class BattlefieldCombatAudio {
  private context: AudioContext | null = null
  private masterGain: GainNode | null = null
  private unlocked = false
  private destroyed = false
  private suspendedForVisibility = false
  private muted = false
  private masterVolume = 0.45
  private lowEffects = false
  private readonly limiter = new CombatAudioVoiceLimiter(10)
  private readonly voices = new Map<string, RuntimeVoice>()

  async unlock(): Promise<boolean> {
    if (this.destroyed || typeof window === 'undefined') return false
    try {
      if (!this.context) {
        const AudioContextConstructor = window.AudioContext ?? (window as WindowWithWebkitAudio).webkitAudioContext
        if (!AudioContextConstructor) return false
        this.context = new AudioContextConstructor({ latencyHint: 'interactive' })
        this.masterGain = this.context.createGain()
        this.masterGain.connect(this.context.destination)
        this.applyMasterGain()
        // 极短静音源只用于完成 Safari/iOS 的手势解锁，不产生可闻声音。
        const unlockOscillator = this.context.createOscillator()
        const unlockGain = this.context.createGain()
        unlockGain.gain.value = 0
        unlockOscillator.connect(unlockGain)
        unlockGain.connect(this.context.destination)
        unlockOscillator.addEventListener('ended', () => {
          unlockOscillator.disconnect()
          unlockGain.disconnect()
        }, { once: true })
        unlockOscillator.start()
        unlockOscillator.stop(this.context.currentTime + 0.005)
      }
      if (!this.suspendedForVisibility && this.context.state !== 'running') await this.context.resume()
      this.unlocked = this.context.state === 'running' || this.suspendedForVisibility
      return this.unlocked
    }
    catch {
      return false
    }
  }

  setMasterVolume(volume: number): void {
    this.masterVolume = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 0.45))
    this.applyMasterGain()
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    this.applyMasterGain()
  }

  setLowEffects(lowEffects: boolean): void {
    if (this.lowEffects !== lowEffects) this.stopAllVoices()
    this.lowEffects = lowEffects
    this.limiter.setMaxConcurrent(lowEffects ? 5 : 10)
  }

  setSuspendedForVisibility(suspended: boolean): void {
    this.suspendedForVisibility = suspended
    if (!this.context || !this.unlocked) return
    if (suspended) {
      this.stopAllVoices()
      void this.context.suspend().catch(() => undefined)
    }
    else if (this.context.state !== 'running') {
      void this.context.resume().catch(() => undefined)
    }
  }

  play(cues: readonly BattlefieldPresentationCue[], currentTick: number, tickRateMs?: number): void {
    if (!this.context || !this.masterGain || !this.unlocked || this.destroyed || this.suspendedForVisibility || this.muted || this.masterVolume <= 0) return
    for (const cue of cues) {
      const request = mapCueToCombatSound(cue, { lowEffects: this.lowEffects, currentTick, tickRateMs })
      if (request) this.playRequest(request)
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.stopAllVoices()
    this.masterGain?.disconnect()
    this.masterGain = null
    const context = this.context
    this.context = null
    this.unlocked = false
    if (context && context.state !== 'closed') void context.close().catch(() => undefined)
  }

  private applyMasterGain(): void {
    if (!this.context || !this.masterGain) return
    const target = this.muted ? 0 : this.masterVolume
    this.masterGain.gain.cancelScheduledValues(this.context.currentTime)
    this.masterGain.gain.setTargetAtTime(target, this.context.currentTime, 0.012)
  }

  private playRequest(request: CombatSoundRequest): void {
    const context = this.context
    const masterGain = this.masterGain
    if (!context || !masterGain || context.state !== 'running') return
    const admission = this.limiter.admit(request, context.currentTime * 1000)
    if (!admission.admitted || !admission.voiceId) return
    if (admission.preemptedVoiceId) this.stopVoice(admission.preemptedVoiceId)
    const sources = new Set<OscillatorNode>()
    let longestMs = 0
    try {
      for (const tone of RECIPES[request.soundId]) {
        const oscillator = context.createOscillator()
        const envelope = context.createGain()
        const startAt = context.currentTime + tone.delayMs / 1000
        const stopAt = startAt + tone.durationMs / 1000
        const peakGain = Math.max(0.0001, request.gain * tone.gainRatio)
        oscillator.type = tone.type
        oscillator.frequency.setValueAtTime(Math.max(1, tone.startHz), startAt)
        oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, tone.endHz), stopAt)
        envelope.gain.setValueAtTime(0.0001, startAt)
        envelope.gain.exponentialRampToValueAtTime(peakGain, startAt + Math.min(0.018, tone.durationMs / 3000))
        envelope.gain.exponentialRampToValueAtTime(0.0001, stopAt)
        oscillator.connect(envelope)
        envelope.connect(masterGain)
        oscillator.start(startAt)
        oscillator.stop(stopAt + 0.01)
        sources.add(oscillator)
        longestMs = Math.max(longestMs, tone.delayMs + tone.durationMs + 20)
      }
      const voiceId = admission.voiceId
      const timerId = window.setTimeout(() => this.finishVoice(voiceId), longestMs + 25)
      this.voices.set(voiceId, { sources, timerId })
    }
    catch {
      for (const source of sources) {
        try { source.stop() }
        catch { /* source may already have ended */ }
      }
      this.limiter.complete(admission.voiceId)
    }
  }

  private finishVoice(voiceId: string): void {
    const voice = this.voices.get(voiceId)
    if (!voice) return
    this.voices.delete(voiceId)
    this.limiter.complete(voiceId)
  }

  private stopVoice(voiceId: string): void {
    const voice = this.voices.get(voiceId)
    if (!voice) {
      this.limiter.complete(voiceId)
      return
    }
    window.clearTimeout(voice.timerId)
    for (const source of voice.sources) {
      try { source.stop() }
      catch { /* source may already have ended */ }
    }
    this.voices.delete(voiceId)
    this.limiter.complete(voiceId)
  }

  private stopAllVoices(): void {
    for (const voiceId of [...this.voices.keys()]) this.stopVoice(voiceId)
    this.limiter.reset()
  }
}
