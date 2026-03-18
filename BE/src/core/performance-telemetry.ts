import { performance } from 'node:perf_hooks'

interface DurationMetric {
  count: number
  totalMs: number
  maxMs: number
  lastMs: number
}

function roundMetricValue(value: number) {
  return Number(value.toFixed(3))
}

export class PerformanceTelemetry {
  private readonly durationMetrics = new Map<string, DurationMetric>()

  private readonly counters = new Map<string, number>()

  private readonly gauges = new Map<string, number>()

  private lastReportAt = Date.now()

  constructor(private readonly reportIntervalMs: number = 10000) {}

  measure<T>(name: string, callback: () => T) {
    const startedAt = performance.now()

    try {
      return callback()
    }
    finally {
      this.recordDuration(name, performance.now() - startedAt)
    }
  }

  async measureAsync<T>(name: string, callback: () => Promise<T>) {
    const startedAt = performance.now()

    try {
      return await callback()
    }
    finally {
      this.recordDuration(name, performance.now() - startedAt)
    }
  }

  recordDuration(name: string, durationMs: number) {
    const metric = this.durationMetrics.get(name) ?? {
      count: 0,
      totalMs: 0,
      maxMs: 0,
      lastMs: 0,
    }

    metric.count += 1
    metric.totalMs += durationMs
    metric.maxMs = Math.max(metric.maxMs, durationMs)
    metric.lastMs = durationMs
    this.durationMetrics.set(name, metric)
  }

  incrementCounter(name: string, amount: number = 1) {
    this.counters.set(name, (this.counters.get(name) ?? 0) + amount)
  }

  setGauge(name: string, value: number) {
    this.gauges.set(name, value)
  }

  getSnapshot() {
    return {
      durations: Object.fromEntries(
        [...this.durationMetrics.entries()]
          .sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
          .map(([name, metric]) => [name, {
            count: metric.count,
            avgMs: roundMetricValue(metric.totalMs / metric.count),
            maxMs: roundMetricValue(metric.maxMs),
            lastMs: roundMetricValue(metric.lastMs),
          }]),
      ),
      counters: Object.fromEntries(
        [...this.counters.entries()]
          .sort(([leftName], [rightName]) => leftName.localeCompare(rightName)),
      ),
      gauges: Object.fromEntries(
        [...this.gauges.entries()]
          .sort(([leftName], [rightName]) => leftName.localeCompare(rightName)),
      ),
    }
  }

  maybeReport(context?: { tick?: number }) {
    const now = Date.now()
    if (now - this.lastReportAt < this.reportIntervalMs) {
      return
    }

    this.lastReportAt = now
    console.info('[perf]', JSON.stringify({
      tick: context?.tick,
      recordedAt: new Date(now).toISOString(),
      ...this.getSnapshot(),
    }))
  }
}