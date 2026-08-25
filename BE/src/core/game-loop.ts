import { GameEngine } from './game-engine'

export class GameLoop {
  private timer: NodeJS.Timeout | null = null

  private intervalMs: number

  constructor(
    private readonly engine: GameEngine,
    tickRateMs: number,
  ) {
    this.intervalMs = tickRateMs
  }

  start() {
    if (this.timer) {
      return
    }

    this.timer = setInterval(() => this.engine.tick(), this.intervalMs)
  }

  setIntervalMs(intervalMs: number) {
    const next = Math.max(1, Math.round(intervalMs))
    if (next === this.intervalMs) return
    const running = this.timer !== null
    this.stop()
    this.intervalMs = next
    if (running) this.start()
  }

  getIntervalMs() {
    return this.intervalMs
  }

  stop() {
    if (!this.timer) {
      return
    }

    clearInterval(this.timer)
    this.timer = null
  }
}
