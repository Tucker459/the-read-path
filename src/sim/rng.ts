/**
 * Seeded pseudo-randomness.
 *
 * Nothing in a simulation may call `Math.random`. Every random choice — a
 * network latency, a hash collision, a compaction trigger — flows through a
 * generator seeded from a known value, which is what makes a run reproducible
 * from `(seed, commands)` alone and therefore shareable as a link.
 */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number
  /** Uniform integer in [min, max). */
  int(min: number, max: number): number
  /** Uniform float in [min, max). */
  float(min: number, max: number): number
  /** True with the given probability. */
  chance(probability: number): boolean
  /** A uniformly chosen element. Throws on an empty list. */
  pick<T>(items: readonly T[]): T
}

/** FNV-1a, so a human-friendly string seed becomes a usable 32-bit state. */
function hashSeed(seed: string | number): number {
  if (typeof seed === 'number') return seed >>> 0
  let hash = 2166136261
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/**
 * mulberry32 — small, fast, and good enough for visualization. Not suitable
 * for anything where randomness quality actually matters.
 */
export function createRng(seed: string | number): Rng {
  let state = hashSeed(seed)

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 61), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min)),
    float: (min, max) => min + next() * (max - min),
    chance: (probability) => next() < probability,
    pick: <T,>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error('pick() called on an empty list')
      return items[Math.floor(next() * items.length)] as T
    },
  }
}
