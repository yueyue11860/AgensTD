import { GameEngine } from './game-engine'

export class GameLoop {
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly engine: GameEngine,
    private readonly tickRateMs: number,
  ) {}

  start() {
    if (this.timer) {
      return
    }

    this.timer = setInterval(() => {
      this.engine.tick()
    }, this.tickRateMs)
  }

  stop() {
    if (!this.timer) {
      return
    }

    clearInterval(this.timer)
    this.timer = null
  }
}