/**
 * A Bloom filter: a set that answers "no" with certainty and "yes" with a
 * probability.
 *
 * The only property that matters for correctness is one-sided error. A filter
 * may claim a key is present when it is not, but it may never claim a key is
 * absent when it is. That asymmetry is what makes it safe for a storage engine
 * to skip a file entirely on a negative answer — "no" can be trusted
 * absolutely, and "yes" is only a hint that costs a wasted read when wrong.
 *
 * Shared rather than owned by any one concept: the LSM-tree read path uses it
 * to avoid opening SSTables, and it stands alone as a concept of its own.
 */
export interface Bloom {
  /** Bit array packed into 32-bit words. Never mutated after construction. */
  words: number[]
  /** Number of bits, conventionally `m`. */
  bits: number
  /** Number of hash functions, conventionally `k`. */
  hashes: number
}

/** FNV-1a with a seed, so one string yields several independent-ish hashes. */
function hash(key: string, seed: number): number {
  let value = (2166136261 ^ seed) >>> 0
  for (let i = 0; i < key.length; i++) {
    value ^= key.charCodeAt(i)
    value = Math.imul(value, 16777619)
  }
  return value >>> 0
}

export function emptyBloom(bits = 64, hashes = 3): Bloom {
  return { words: new Array<number>(Math.ceil(bits / 32)).fill(0), bits, hashes }
}

/**
 * The bit indices a key maps to.
 *
 * These may repeat. Two of the k hashes landing on the same bit is ordinary,
 * and it quietly weakens the filter — the key is then guarded by fewer
 * distinct bits than its k would suggest.
 */
export function bloomPositions(bloom: Pick<Bloom, 'bits' | 'hashes'>, key: string): number[] {
  const positions: number[] = []
  for (let h = 0; h < bloom.hashes; h++) positions.push(hash(key, h) % bloom.bits)
  return positions
}

export function bloomGet(bloom: Bloom, index: number): boolean {
  return ((bloom.words[index >>> 5] as number) & (1 << (index & 31))) !== 0
}

/** Add a key, returning a new filter. */
export function bloomAdd(bloom: Bloom, key: string): Bloom {
  const words = [...bloom.words]
  for (const position of bloomPositions(bloom, key)) {
    words[position >>> 5] = (words[position >>> 5] as number) | (1 << (position & 31))
  }
  return { ...bloom, words }
}

export function createBloom(keys: readonly string[], bits = 64, hashes = 3): Bloom {
  let bloom = emptyBloom(bits, hashes)
  for (const key of keys) bloom = bloomAdd(bloom, key)
  return bloom
}

/**
 * False means definitely absent. True means possibly present, and the caller
 * still has to look.
 */
export function bloomMightContain(bloom: Bloom, key: string): boolean {
  for (const position of bloomPositions(bloom, key)) {
    if (!bloomGet(bloom, position)) return false
  }
  return true
}

/** Fraction of bits set — the intuition behind why a full filter stops helping. */
export function bloomFill(bloom: Bloom): number {
  let set = 0
  for (const word of bloom.words) {
    let remaining = word
    while (remaining !== 0) {
      set += remaining & 1
      remaining >>>= 1
    }
  }
  return set / bloom.bits
}

/**
 * The textbook false-positive rate: (1 − e^(−kn/m))^k.
 *
 * Worth comparing against a measured rate rather than trusting outright — it
 * assumes perfectly independent hash functions, which no real implementation
 * has.
 */
export function expectedFalsePositiveRate(bits: number, hashes: number, inserted: number): number {
  if (bits === 0) return 1
  if (inserted === 0) return 0
  return Math.pow(1 - Math.exp((-hashes * inserted) / bits), hashes)
}

/**
 * The k that minimises false positives for a given size and load: (m/n) ln 2.
 *
 * Both too few and too many hashes hurt, for opposite reasons. Too few leaves
 * the filter easy to satisfy by chance; too many fill it up until nearly every
 * probe succeeds.
 */
export function optimalHashes(bits: number, inserted: number): number {
  if (inserted === 0) return 1
  return Math.max(1, Math.round((bits / inserted) * Math.LN2))
}

/** Bits per key needed to reach a target false-positive rate. */
export function bitsPerKeyFor(targetRate: number): number {
  return -Math.log(targetRate) / (Math.LN2 * Math.LN2)
}
