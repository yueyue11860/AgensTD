"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PerformanceTelemetry = void 0;
const node_perf_hooks_1 = require("node:perf_hooks");
function roundMetricValue(value) {
    return Number(value.toFixed(3));
}
class PerformanceTelemetry {
    reportIntervalMs;
    durationMetrics = new Map();
    counters = new Map();
    gauges = new Map();
    lastReportAt = Date.now();
    constructor(reportIntervalMs = 10000) {
        this.reportIntervalMs = reportIntervalMs;
    }
    measure(name, callback) {
        const startedAt = node_perf_hooks_1.performance.now();
        try {
            return callback();
        }
        finally {
            this.recordDuration(name, node_perf_hooks_1.performance.now() - startedAt);
        }
    }
    async measureAsync(name, callback) {
        const startedAt = node_perf_hooks_1.performance.now();
        try {
            return await callback();
        }
        finally {
            this.recordDuration(name, node_perf_hooks_1.performance.now() - startedAt);
        }
    }
    recordDuration(name, durationMs) {
        const metric = this.durationMetrics.get(name) ?? {
            count: 0,
            totalMs: 0,
            maxMs: 0,
            lastMs: 0,
        };
        metric.count += 1;
        metric.totalMs += durationMs;
        metric.maxMs = Math.max(metric.maxMs, durationMs);
        metric.lastMs = durationMs;
        this.durationMetrics.set(name, metric);
    }
    incrementCounter(name, amount = 1) {
        this.counters.set(name, (this.counters.get(name) ?? 0) + amount);
    }
    setGauge(name, value) {
        this.gauges.set(name, value);
    }
    getSnapshot() {
        return {
            durations: Object.fromEntries([...this.durationMetrics.entries()]
                .sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
                .map(([name, metric]) => [name, {
                    count: metric.count,
                    avgMs: roundMetricValue(metric.totalMs / metric.count),
                    maxMs: roundMetricValue(metric.maxMs),
                    lastMs: roundMetricValue(metric.lastMs),
                }])),
            counters: Object.fromEntries([...this.counters.entries()]
                .sort(([leftName], [rightName]) => leftName.localeCompare(rightName))),
            gauges: Object.fromEntries([...this.gauges.entries()]
                .sort(([leftName], [rightName]) => leftName.localeCompare(rightName))),
        };
    }
    maybeReport(context) {
        const now = Date.now();
        if (now - this.lastReportAt < this.reportIntervalMs) {
            return;
        }
        this.lastReportAt = now;
        console.info('[perf]', JSON.stringify({
            tick: context?.tick,
            recordedAt: new Date(now).toISOString(),
            ...this.getSnapshot(),
        }));
    }
}
exports.PerformanceTelemetry = PerformanceTelemetry;
