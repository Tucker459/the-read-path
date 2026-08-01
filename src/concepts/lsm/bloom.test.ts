import { describe, expect, it } from 'vitest'
import { bloomFill, bloomMightContain, createBloom } from './bloom'
import { createRng } from '../../sim'

describe('bloom filter', () => {
  it('never reports a false negative', () => {
    // The one property the read path depends on. A false negative would make
    // the LSM silently lose data that is sitting on disk.
    const rng = createRng('bloom-negatives')
    for (let trial = 0; trial < 200; trial++) {
      const keys = Array.from({ length: rng.int(1, 30) }, () => `key:${rng.int(0, 100000)}`)
      const bloom = createBloom(keys)
      for (const key of keys) {
        expect(bloomMightContain(bloom, key)).toBe(true)
      }
    }
  })

  it('rejects most absent keys', () => {
    const bloom = createBloom(Array.from({ length: 8 }, (_, i) => `present:${i}`))
    let rejected = 0
    const probes = 1000
    for (let i = 0; i < probes; i++) {
      if (!bloomMightContain(bloom, `absent:${i}`)) rejected += 1
    }
    // With 8 keys in 64 bits this should reject the large majority. The exact
    // rate matters less than that skipping is the common case.
    expect(rejected / probes).toBeGreaterThan(0.6)
  })

  it('degrades as it fills, which is why filters are sized per table', () => {
    const small = createBloom(Array.from({ length: 4 }, (_, i) => `k${i}`))
    const large = createBloom(Array.from({ length: 60 }, (_, i) => `k${i}`))
    expect(bloomFill(small)).toBeLessThan(bloomFill(large))

    const reject = (bloom: ReturnType<typeof createBloom>) => {
      let count = 0
      for (let i = 0; i < 500; i++) if (!bloomMightContain(bloom, `miss:${i}`)) count += 1
      return count
    }
    expect(reject(small)).toBeGreaterThan(reject(large))
  })

  it('is empty when built from no keys', () => {
    const bloom = createBloom([])
    expect(bloomFill(bloom)).toBe(0)
    expect(bloomMightContain(bloom, 'anything')).toBe(false)
  })

  it('is deterministic', () => {
    const keys = ['alpha', 'beta', 'gamma']
    expect(createBloom(keys)).toEqual(createBloom(keys))
  })
})
