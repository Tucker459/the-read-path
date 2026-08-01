/**
 * A small Bloom filter, sized per SSTable.
 *
 * The only property that matters for correctness is one-sided error: a filter
 * may claim a key is present when it is not, but it may never claim a key is
 * absent when it is. That asymmetry is what makes it safe to skip a table
 * entirely on a negative answer — the read path can trust "no" absolutely and
 * treat "maybe" as a hint.
 */
export interface Bloom {
  /** Bit array packed into 32-bit words. Never mutated after construction. */
  words: number[]
  /** Number of bits. */
  bits: number
  /** Number of hash functions. */
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

export function createBloom(keys: readonly string[], bits = 64, hashes = 3): Bloom {
  const words = new Array<number>(Math.ceil(bits / 32)).fill(0)
  for (const key of keys) {
    for (let h = 0; h < hashes; h++) {
      const bit = hash(key, h) % bits
      const word = bit >>> 5
      words[word] = (words[word] as number) | (1 << (bit & 31))
    }
  }
  return { words, bits, hashes }
}

/**
 * False means definitely absent. True means possibly present, and the caller
 * still has to look.
 */
export function bloomMightContain(bloom: Bloom, key: string): boolean {
  for (let h = 0; h < bloom.hashes; h++) {
    const bit = hash(key, h) % bloom.bits
    const word = bloom.words[bit >>> 5] as number
    if ((word & (1 << (bit & 31))) === 0) return false
  }
  return true
}

/** Fraction of bits set — the intuition behind why a full filter stops helping. */
export function bloomFill(bloom: Bloom): number {
  let set = 0
  for (const word of bloom.words) {
    let w = word
    while (w !== 0) {
      set += w & 1
      w >>>= 1
    }
  }
  return set / bloom.bits
}
