import crypto from 'node:crypto'

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`)
    .join(',')}}`
}

export function hashPveCheckpointPayload(payload: Record<string, unknown>): string {
  return crypto.createHash('sha256').update(stable(payload)).digest('hex')
}
