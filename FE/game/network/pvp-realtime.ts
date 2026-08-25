export type PvpSequenceDecision = 'accept' | 'stale' | 'gap'

export function classifyPvpSequence(lastSeq: number, nextSeq: number): PvpSequenceDecision {
  if (!Number.isSafeInteger(nextSeq) || nextSeq <= lastSeq) return 'stale'
  if (lastSeq > 0 && nextSeq !== lastSeq + 1) return 'gap'
  return 'accept'
}

export function shouldRequestPvpFullRecovery(pending: boolean, lastRequestedAt: number, now: number, minIntervalMs = 1_000): boolean {
  return !pending && Number.isFinite(now) && now - lastRequestedAt >= minIntervalMs
}

export function consumePvpSseBuffer(buffer: string): { payloads: unknown[]; remainder: string } {
  const payloads: unknown[] = []
  let remainder = buffer
  let boundary = remainder.indexOf('\n\n')
  while (boundary >= 0) {
    const block = remainder.slice(0, boundary)
    remainder = remainder.slice(boundary + 2)
    const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n')
    if (data) payloads.push(JSON.parse(data) as unknown)
    boundary = remainder.indexOf('\n\n')
  }
  return { payloads, remainder }
}
