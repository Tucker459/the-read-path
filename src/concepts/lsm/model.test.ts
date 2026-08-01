import { describe, expect, it } from 'vitest'
import { Simulation, createRng } from '../../sim'
import {
  DEFAULT_CONFIG,
  levelCapacity,
  lsmModel,
  maxKey,
  minKey,
  traceRead,
  writeAmplification,
  type LsmCommand,
  type LsmEvent,
  type LsmState,
} from './model'

function build(seed = 'lsm-test') {
  return new Simulation<LsmState, LsmEvent, LsmCommand>(lsmModel, { seed })
}

/** Run every pending event so background flushes and compactions finish. */
function settle(sim: Simulation<LsmState, LsmEvent, LsmCommand>, guard = 5000): void {
  let steps = 0
  while (!sim.isIdle && steps < guard) {
    const next = sim.nextEventTime
    if (next === undefined) break
    sim.advanceTo(next)
    steps += 1
  }
}

function get(sim: Simulation<LsmState, LsmEvent, LsmCommand>, key: string): string | null {
  return traceRead(sim.currentState, key).found
}

describe('lsm model', () => {
  it('reads back what it wrote', () => {
    const sim = build()
    sim.dispatch({ kind: 'put', key: 'a', value: '1' })
    expect(get(sim, 'a')).toBe('1')
  })

  it('returns null for a key never written', () => {
    expect(get(build(), 'missing')).toBeNull()
  })

  it('lets the newest write win', () => {
    const sim = build()
    sim.dispatch({ kind: 'put', key: 'a', value: 'old' })
    sim.dispatch({ kind: 'put', key: 'a', value: 'new' })
    expect(get(sim, 'a')).toBe('new')
  })

  it('keeps overwrites correct across a flush boundary', () => {
    const sim = build()
    sim.dispatch({ kind: 'put', key: 'a', value: 'old' })
    for (let i = 0; i < 10; i++) sim.dispatch({ kind: 'put', key: `pad${i}`, value: 'x' })
    settle(sim)
    sim.dispatch({ kind: 'put', key: 'a', value: 'new' })
    expect(get(sim, 'a')).toBe('new')
    settle(sim)
    expect(get(sim, 'a')).toBe('new')
  })

  it('treats a delete as a write and hides the older value', () => {
    const sim = build()
    sim.dispatch({ kind: 'put', key: 'a', value: '1' })
    sim.dispatch({ kind: 'delete', key: 'a' })
    expect(get(sim, 'a')).toBeNull()
  })

  it('does not resurrect a deleted key after flush and compaction', () => {
    // The failure this guards against is real and subtle: drop a tombstone
    // before the bottom level and an older value in a deeper level becomes
    // visible again.
    const sim = build()
    sim.dispatch({ kind: 'put', key: 'ghost', value: 'alive' })
    for (let i = 0; i < 12; i++) sim.dispatch({ kind: 'put', key: `pad${i}`, value: 'x' })
    settle(sim)

    sim.dispatch({ kind: 'delete', key: 'ghost' })
    for (let i = 12; i < 40; i++) sim.dispatch({ kind: 'put', key: `pad${i}`, value: 'x' })
    settle(sim)

    expect(get(sim, 'ghost')).toBeNull()
  })

  it('can write a key again after deleting it', () => {
    const sim = build()
    sim.dispatch({ kind: 'put', key: 'a', value: '1' })
    sim.dispatch({ kind: 'delete', key: 'a' })
    for (let i = 0; i < 12; i++) sim.dispatch({ kind: 'put', key: `pad${i}`, value: 'x' })
    settle(sim)
    sim.dispatch({ kind: 'put', key: 'a', value: '2' })
    settle(sim)
    expect(get(sim, 'a')).toBe('2')
  })

  it('flushes the memtable once it passes its limit', () => {
    const sim = build()
    const limit = DEFAULT_CONFIG.memtableLimit
    for (let i = 0; i < limit + 1; i++) sim.dispatch({ kind: 'put', key: `k${i}`, value: 'v' })
    expect(sim.currentState.levels[0]).toHaveLength(0)
    settle(sim)
    expect(sim.currentState.stats.flushes).toBeGreaterThan(0)
    expect(sim.currentState.memtable.length).toBeLessThanOrEqual(limit)
  })

  it('keeps sealed data readable while it is waiting to be written', () => {
    const sim = build()
    for (let i = 0; i < DEFAULT_CONFIG.memtableLimit + 1; i++) {
      sim.dispatch({ kind: 'put', key: `k${i}`, value: `v${i}` })
    }
    // Sealing is immediate; only the write-out is scheduled. So without
    // advancing the clock at all there is a sealed memtable and no L0 table.
    expect(sim.currentState.sealed.length).toBe(1)
    expect(sim.currentState.levels[0]).toHaveLength(0)
    expect(get(sim, 'k0')).toBe('v0')
  })

  it('queues further memtables when writes outrun flushes', () => {
    const sim = build()
    // Everything lands at one instant, faster than any flush can complete.
    for (let i = 0; i < 30; i++) sim.dispatch({ kind: 'put', key: `k${String(i).padStart(2, '0')}`, value: 'v' })
    expect(sim.currentState.sealed.length).toBeGreaterThan(1)
    const queued = sim.currentState.sealed.length
    settle(sim)
    // Every queued memtable eventually becomes its own table.
    expect(sim.currentState.sealed).toHaveLength(0)
    expect(sim.currentState.stats.flushes).toBeGreaterThanOrEqual(queued)
  })

  it('compacts L0 once it reaches the trigger', () => {
    const sim = build()
    for (let i = 0; i < 60; i++) sim.dispatch({ kind: 'put', key: `k${String(i).padStart(2, '0')}`, value: 'v' })
    settle(sim)
    expect(sim.currentState.stats.compactions).toBeGreaterThan(0)
    expect((sim.currentState.levels[0] ?? []).length).toBeLessThan(DEFAULT_CONFIG.l0Trigger)
  })

  it('keeps deeper levels as non-overlapping sorted runs', () => {
    const sim = build()
    for (let i = 0; i < 120; i++) {
      sim.dispatch({ kind: 'put', key: `k${String(i % 45).padStart(2, '0')}`, value: `v${i}` })
    }
    settle(sim)

    // L0 tables may overlap — each is a separate memtable. Everything below
    // must be disjoint, which is what lets a read consult only one table.
    for (let level = 1; level < sim.currentState.levels.length; level++) {
      const tables = sim.currentState.levels[level] ?? []
      for (let i = 1; i < tables.length; i++) {
        const previous = tables[i - 1]
        const current = tables[i]
        if (previous === undefined || current === undefined) continue
        expect(maxKey(previous) < minKey(current)).toBe(true)
      }
    }
  })

  it('holds each level within its capacity once settled', () => {
    const sim = build()
    for (let i = 0; i < 150; i++) {
      sim.dispatch({ kind: 'put', key: `k${String(i % 50).padStart(2, '0')}`, value: `v${i}` })
    }
    settle(sim)
    for (let level = 0; level < DEFAULT_CONFIG.maxLevel; level++) {
      const tables = sim.currentState.levels[level] ?? []
      expect(tables.length).toBeLessThanOrEqual(levelCapacity(DEFAULT_CONFIG, level) + 1)
    }
  })

  it('never creates an empty table', () => {
    // An empty table has no key range, so every range comparison against it is
    // meaningless. Bursts that trigger several flush requests at one instant
    // are what used to produce them.
    const sim = build()
    sim.dispatch({ kind: 'putMany', count: 40 })
    for (let i = 0; i < 30; i++) sim.dispatch({ kind: 'put', key: `b${i}`, value: 'v' })
    settle(sim)
    for (const table of sim.currentState.levels.flat()) {
      expect(table.entries.length).toBeGreaterThan(0)
    }
    expect(sim.currentState.sealed.every((entries) => entries.length > 0)).toBe(true)
  })

  it('keeps compacting after a compaction finds its tables already gone', () => {
    // A stalled compaction flag would silently stop all future compactions,
    // and the tree would grow L0 forever without any error.
    const sim = build()
    sim.dispatch({ kind: 'putMany', count: 80 })
    settle(sim)
    expect(sim.currentState.compacting).toHaveLength(0)
    expect(sim.currentState.stats.compactions).toBeGreaterThan(0)
  })

  it('never stores two tables with the same id', () => {
    const sim = build()
    for (let i = 0; i < 120; i++) sim.dispatch({ kind: 'put', key: `k${i % 40}`, value: `v${i}` })
    settle(sim)
    const ids = sim.currentState.levels.flat().map((table) => table.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('writes more bytes to disk than the user wrote', () => {
    const sim = build()
    for (let i = 0; i < 120; i++) sim.dispatch({ kind: 'put', key: `k${i % 40}`, value: `v${i}` })
    settle(sim)
    // The cost of keeping data sorted: every byte is rewritten each time it is
    // merged into a deeper level.
    expect(writeAmplification(sim.currentState.stats)).toBeGreaterThan(1)
  })

  it('reports zero amplification before anything is written', () => {
    expect(writeAmplification(build().currentState.stats)).toBe(0)
  })

  it('records a read path that starts at the memtable', () => {
    const sim = build()
    sim.dispatch({ kind: 'put', key: 'a', value: '1' })
    sim.dispatch({ kind: 'get', key: 'a' })
    const trace = sim.currentState.lastRead
    expect(trace?.steps[0]?.where).toBe('memtable')
    expect(trace?.found).toBe('1')
  })

  it('skips tables the bloom filter rules out', () => {
    const sim = build()
    // Even keys only, so the odd ones fall inside a table's range but are
    // absent — the only situation in which a filter can earn its keep.
    for (let i = 0; i < 60; i += 2) {
      sim.dispatch({ kind: 'put', key: `k${String(i).padStart(2, '0')}`, value: 'v' })
      settle(sim)
    }

    // The probe has to sort inside a table's key range and still be absent.
    // Contiguous keys leave no such gap — the range check alone eliminates
    // everything, and the filter is never consulted.
    sim.dispatch({ kind: 'get', key: 'k29' })
    const trace = sim.currentState.lastRead
    expect(trace?.found).toBeNull()
    expect(trace?.steps.some((step) => step.outcome === 'bloom-skip')).toBe(true)
  })

  it('reaches a key by range alone when no filter rules it out', () => {
    const sim = build()
    for (let i = 0; i < 60; i++) sim.dispatch({ kind: 'put', key: `k${String(i).padStart(2, '0')}`, value: 'v' })
    settle(sim)
    sim.dispatch({ kind: 'get', key: 'zzz-past-the-end' })
    // Every table's range excludes this, so nothing is opened at all.
    expect(sim.currentState.lastRead?.tablesRead).toBe(0)
    expect(sim.currentState.lastRead?.found).toBeNull()
  })

  it('agrees with a plain Map across a long random workload', () => {
    // The real test. An LSM-tree is an elaborate way to implement a map, so it
    // has to behave exactly like one no matter where a key currently lives.
    const rng = createRng('lsm-differential')
    const sim = build('lsm-differential')
    const reference = new Map<string, string>()
    const keys = Array.from({ length: 40 }, (_, i) => `k${String(i).padStart(2, '0')}`)

    for (let step = 0; step < 900; step++) {
      const key = rng.pick(keys)
      const roll = rng.next()

      if (roll < 0.6) {
        const value = `v${step}`
        sim.dispatch({ kind: 'put', key, value })
        reference.set(key, value)
      } else if (roll < 0.75) {
        sim.dispatch({ kind: 'delete', key })
        reference.delete(key)
      } else {
        expect(get(sim, key)).toBe(reference.get(key) ?? null)
      }

      // Let background work land at unpredictable points, so reads land
      // mid-flush and mid-compaction rather than only on a settled tree.
      if (rng.chance(0.3)) {
        const next = sim.nextEventTime
        if (next !== undefined) sim.advanceTo(next)
      }
    }

    settle(sim)
    for (const key of keys) {
      expect(get(sim, key)).toBe(reference.get(key) ?? null)
    }
    expect(sim.currentState.stats.compactions).toBeGreaterThan(0)
  })

  it('replays identically from the same seed', () => {
    const run = () => {
      const sim = build('lsm-replay')
      sim.dispatch({ kind: 'putMany', count: 30 })
      settle(sim)
      return sim.currentState.levels.flat().map((table) => table.entries)
    }
    expect(run()).toEqual(run())
  })

  it('honours a smaller memtable limit by flushing sooner', () => {
    // Writes have to be spread over time rather than dispatched all at once.
    // Landing them at a single instant fills the memtable faster than a flush
    // can complete, and both configurations end up flushing in one batch.
    const flushesFor = (memtableLimit: number) => {
      const sim = build()
      sim.dispatch({ kind: 'setConfig', patch: { memtableLimit } })
      for (let i = 0; i < 24; i++) {
        sim.dispatch({ kind: 'put', key: `k${String(i).padStart(2, '0')}`, value: 'v' })
        settle(sim)
      }
      return sim.currentState.stats.flushes
    }

    expect(flushesFor(2)).toBeGreaterThan(flushesFor(8))
  })
})
