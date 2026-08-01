import { describe, expect, it } from 'vitest'
import { createRng } from './rng'

describe('createRng', () => {
  it('produces the same sequence for the same seed', () => {
    const first = createRng('lsm')
    const second = createRng('lsm')
    const left = Array.from({ length: 50 }, () => first.next())
    const right = Array.from({ length: 50 }, () => second.next())
    expect(left).toEqual(right)
  })

  it('produces different sequences for different seeds', () => {
    const left = Array.from({ length: 20 }, () => createRng('a').next())
    const right = Array.from({ length: 20 }, () => createRng('b').next())
    expect(left).not.toEqual(right)
  })

  it('accepts numeric seeds', () => {
    const left = Array.from({ length: 10 }, () => createRng(42).next())
    const right = Array.from({ length: 10 }, () => createRng(42).next())
    expect(left).toEqual(right)
  })

  it('stays within [0, 1)', () => {
    const rng = createRng('bounds')
    for (let i = 0; i < 10_000; i++) {
      const value = rng.next()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('keeps int() within [min, max) and reaches both ends', () => {
    const rng = createRng('ints')
    const seen = new Set<number>()
    for (let i = 0; i < 10_000; i++) {
      const value = rng.int(3, 7)
      expect(Number.isInteger(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(3)
      expect(value).toBeLessThan(7)
      seen.add(value)
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6])
  })

  it('distributes roughly uniformly', () => {
    const rng = createRng('uniform')
    const buckets = new Array(10).fill(0)
    const draws = 100_000
    for (let i = 0; i < draws; i++) {
      buckets[Math.floor(rng.next() * 10)]++
    }
    // A generator this simple should still land every bucket within a few
    // percent of the expected tenth.
    for (const count of buckets) {
      expect(count).toBeGreaterThan(draws / 10 - draws * 0.01)
      expect(count).toBeLessThan(draws / 10 + draws * 0.01)
    }
  })

  it('honours chance() at its extremes', () => {
    const rng = createRng('chance')
    for (let i = 0; i < 100; i++) {
      expect(rng.chance(1)).toBe(true)
      expect(rng.chance(0)).toBe(false)
    }
  })

  it('throws when picking from nothing', () => {
    expect(() => createRng('empty').pick([])).toThrow(/empty/)
  })
})
