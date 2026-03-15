export interface RateLimitDecision {
  allowed: boolean
  retryAfterMs: number
  remaining: number
}

export class ActionRateLimiter {
  private readonly windows = new Map<string, number[]>()

  constructor(
    private readonly windowMs: number,
    private readonly maxActions: number,
  ) {}

  consume(key: string, now = Date.now()): RateLimitDecision {
    const cutoff = now - this.windowMs
    const existing = (this.windows.get(key) ?? []).filter((timestamp) => timestamp > cutoff)

    if (existing.length >= this.maxActions) {
      const retryAfterMs = Math.max(existing[0] + this.windowMs - now, 0)
      this.windows.set(key, existing)
      return {
        allowed: false,
        retryAfterMs,
        remaining: 0,
      }
    }

    existing.push(now)
    this.windows.set(key, existing)

    return {
      allowed: true,
      retryAfterMs: 0,
      remaining: Math.max(this.maxActions - existing.length, 0),
    }
  }
}
