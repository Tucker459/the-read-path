import { describe, expect, it } from 'vitest'
import { Simulation, createRng } from '../../sim'
import { bloomModel, sampleKey, type BloomCommand, type BloomEvent, type BloomState } from './model'
import { bloomFill, bloomMightContain, createBloom, expectedFalsePositiveRate, optimalHashes } from '../../lib/bloom'

function build(seed = 'bloom-test') {
  return new Simulation<BloomState, BloomEvent, BloomCommand>(bloomModel, { seed })
}

describe('bloom filter model', () => {
  it('starts empty', () => {
    const state = build().currentState
    expect(state.inserted).toEqual([])
    expect(bloomFill(state.filter)).toBe(0)
  })

  it('reports a key it has seen', () => {
    const sim = build()
    sim.dispatch({ kind: 'insert', key: 'alpha' })
    sim.dispatch({ kind: 'query', key: 'alpha' })
    expect(sim.currentState.lastAction).toMatchObject({ kind: 'query', verdict: 'true-positive' })
  })

  it('never reports a negative for an inserted key, at any size', () => {
    // The one property everything else depends on. A false negative would make
    // the LSM read path skip a table that really holds the key.
    const rng = createRng('no-false-negatives')
    for (const bits of [16, 32, 64, 256]) {
      for (const hashes of [1, 2, 3, 5, 8]) {
        const keys = Array.from({ length: 40 }, () => `k${rng.int(0, 100_000)}`)
        const filter = createBloom(keys, bits, hashes)
        for (const key of keys) expect(bloomMightContain(filter, key)).toBe(true)
      }
    }
  })

  it('classifies a positive on an uninserted key as a false positive', () => {
    // Deliberately tiny and overloaded, so a collision is close to certain.
    const sim = build()
    sim.dispatch({ kind: 'setBits', bits: 16 })
    for (let i = 0; i < 30; i++) sim.dispatch({ kind: 'insert', key: sampleKey(i) })

    let falsePositives = 0
    for (let i = 1000; i < 1100; i++) {
      sim.dispatch({ kind: 'query', key: sampleKey(i) })
      if (sim.currentState.lastAction?.kind === 'query' && sim.currentState.lastAction.verdict === 'false-positive') {
        falsePositives += 1
      }
    }
    expect(falsePositives).toBeGreaterThan(0)
    expect(sim.currentState.stats.falsePositives).toBe(falsePositives)
  })

  it('records which probed bits were set, matching the verdict', () => {
    const sim = build()
    sim.dispatch({ kind: 'insert', key: 'alpha' })
    sim.dispatch({ kind: 'query', key: 'alpha' })
    const action = sim.currentState.lastAction
    if (action?.kind !== 'query') throw new Error('expected a query')
    expect(action.areSet.every(Boolean)).toBe(true)
    expect(action.positions).toHaveLength(sim.currentState.filter.hashes)
  })

  it('shows which bits an insert newly claimed', () => {
    const sim = build()
    sim.dispatch({ kind: 'insert', key: 'alpha' })
    const first = sim.currentState.lastAction
    if (first?.kind !== 'insert') throw new Error('expected an insert')
    expect(first.wereAlreadySet.some(Boolean)).toBe(false)

    // Inserting the same key again claims nothing new — every bit is already
    // set, which is why a Bloom filter cannot count or delete.
    sim.dispatch({ kind: 'insert', key: 'alpha' })
    const second = sim.currentState.lastAction
    if (second?.kind !== 'insert') throw new Error('expected an insert')
    expect(second.wereAlreadySet.every(Boolean)).toBe(true)
  })

  it('does not double-count a repeated insert', () => {
    const sim = build()
    sim.dispatch({ kind: 'insert', key: 'alpha' })
    sim.dispatch({ kind: 'insert', key: 'alpha' })
    expect(sim.currentState.stats.inserts).toBe(1)
    expect(sim.currentState.inserted).toEqual(['alpha'])
  })

  it('rehashes every key when the size changes, keeping all of them findable', () => {
    const sim = build()
    const keys = Array.from({ length: 20 }, (_, i) => sampleKey(i))
    for (const key of keys) sim.dispatch({ kind: 'insert', key })

    sim.dispatch({ kind: 'setBits', bits: 512 })
    expect(sim.currentState.filter.bits).toBe(512)
    for (const key of keys) expect(bloomMightContain(sim.currentState.filter, key)).toBe(true)

    sim.dispatch({ kind: 'setHashes', hashes: 7 })
    expect(sim.currentState.filter.hashes).toBe(7)
    for (const key of keys) expect(bloomMightContain(sim.currentState.filter, key)).toBe(true)
  })

  it('fills up as keys are added, and empties on clear', () => {
    const sim = build()
    for (let i = 0; i < 30; i++) sim.dispatch({ kind: 'insert', key: sampleKey(i) })
    expect(bloomFill(sim.currentState.filter)).toBeGreaterThan(0.3)
    sim.dispatch({ kind: 'clear' })
    expect(bloomFill(sim.currentState.filter)).toBe(0)
    expect(sim.currentState.inserted).toEqual([])
  })

  it('measures a false-positive rate close to the predicted one', () => {
    // The payoff: the textbook formula assumes independent hashes, which FNV
    // with different seeds only approximates. Within a factor of two over a
    // realistic load is the honest claim.
    const sim = build('measure')
    sim.dispatch({ kind: 'setBits', bits: 256 })
    for (let i = 0; i < 40; i++) sim.dispatch({ kind: 'insert', key: sampleKey(i) })
    sim.dispatch({ kind: 'measure', trials: 4000 })

    const measurement = sim.currentState.measurement
    if (measurement === null) throw new Error('expected a measurement')
    const measured = measurement.falsePositives / measurement.trials
    const predicted = expectedFalsePositiveRate(256, 3, 40)

    expect(measurement.trials).toBe(4000)
    expect(measured).toBeGreaterThan(predicted / 2)
    expect(measured).toBeLessThan(predicted * 2)
  })

  it('measures zero false positives on an empty filter', () => {
    const sim = build()
    sim.dispatch({ kind: 'measure', trials: 500 })
    expect(sim.currentState.measurement?.falsePositives).toBe(0)
  })

  it('gets worse as the filter is overloaded', () => {
    const rateFor = (count: number) => {
      const sim = build(`load-${count}`)
      sim.dispatch({ kind: 'setBits', bits: 128 })
      for (let i = 0; i < count; i++) sim.dispatch({ kind: 'insert', key: sampleKey(i) })
      sim.dispatch({ kind: 'measure', trials: 3000 })
      const m = sim.currentState.measurement
      return m === null ? 0 : m.falsePositives / m.trials
    }
    expect(rateFor(60)).toBeGreaterThan(rateFor(10))
  })

  it('agrees that the optimal k beats a badly chosen one', () => {
    const bits = 256
    const inserted = 40
    const best = optimalHashes(bits, inserted)

    const rateFor = (hashes: number) => {
      const sim = build(`k-${hashes}`)
      sim.dispatch({ kind: 'setBits', bits })
      sim.dispatch({ kind: 'setHashes', hashes })
      for (let i = 0; i < inserted; i++) sim.dispatch({ kind: 'insert', key: sampleKey(i) })
      sim.dispatch({ kind: 'measure', trials: 4000 })
      const m = sim.currentState.measurement
      return m === null ? 1 : m.falsePositives / m.trials
    }

    // Too few hashes and a probe is easy to satisfy by chance; too many and the
    // filter saturates. The optimum has to beat both ends.
    expect(rateFor(best)).toBeLessThan(rateFor(1))
    expect(rateFor(best)).toBeLessThan(rateFor(16))
  })

  it('replays identically from the same seed', () => {
    const run = () => {
      const sim = build('bloom-replay')
      sim.dispatch({ kind: 'insertMany', count: 20 })
      sim.dispatch({ kind: 'measure', trials: 500 })
      return { words: sim.currentState.filter.words, measurement: sim.currentState.measurement }
    }
    expect(run()).toEqual(run())
  })

  it('probes only keys it never inserted when measuring', () => {
    const sim = build()
    for (let i = 0; i < 20; i++) sim.dispatch({ kind: 'insert', key: sampleKey(i) })
    sim.dispatch({ kind: 'measure', trials: 200 })
    // A probe that had been inserted would be a true positive and would
    // silently inflate the measured rate.
    const inserted = new Set(sim.currentState.inserted)
    const probeEvent = sim.frames.at(-1)?.event
    if (probeEvent?.kind !== 'measure') throw new Error('expected a measure event')
    for (const probe of probeEvent.probes) expect(inserted.has(probe)).toBe(false)
  })
})
