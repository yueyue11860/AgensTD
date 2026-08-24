function hashSeed(seed: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export class DeterministicPrng {
  private state: number

  constructor(seed: string | number) {
    const normalized = typeof seed === 'number' ? String(seed >>> 0) : seed
    this.state = hashSeed(normalized || 'pve-v2') || 0x6d2b79f5
  }

  nextUint32(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let value = this.state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return (value ^ (value >>> 14)) >>> 0
  }

  nextInt(exclusiveMax: number): number {
    if (!Number.isSafeInteger(exclusiveMax) || exclusiveMax <= 0) {
      throw new Error('exclusiveMax must be a positive safe integer')
    }
    return Math.floor((this.nextUint32() / 0x100000000) * exclusiveMax)
  }

  rollBps(thresholdBps: number): boolean {
    if (!Number.isInteger(thresholdBps) || thresholdBps < 0 || thresholdBps > 10000) {
      throw new Error('thresholdBps must be an integer between 0 and 10000')
    }
    return this.nextInt(10000) < thresholdBps
  }

  pickIndex(length: number): number {
    return this.nextInt(length)
  }

  snapshot(): number {
    return this.state >>> 0
  }
}
