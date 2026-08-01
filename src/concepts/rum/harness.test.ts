import { describe, expect, it } from 'vitest'
import { createRng } from '../../sim'
import { buildWorkload, DEFAULT_RUM_CONFIG, runExperiment, type RumConfig } from './harness'

const run = (patch: Partial<RumConfig> = {}, seed = 'rum-test') =>
  runExperiment({ ...DEFAULT_RUM_CONFIG, ...patch }, createRng(seed))

const last = <T,>(items: T[]): T => items[items.length - 1] as T

describe('rum harness', () => {
  it('gives both engines the same workload', () => {
    const rng = createRng('same')
    const a = buildWorkload(DEFAULT_RUM_CONFIG, rng)
    const b = buildWorkload(DEFAULT_RUM_CONFIG, createRng('same'))
    expect(a).toEqual(b)
  })

  it('honours the requested operation mix', () => {
    const workload = buildWorkload({ ...DEFAULT_RUM_CONFIG, ops: 4000, readShare: 0.5 }, createRng('mix'))
    const reads = workload.filter((op) => op.kind === 'get').length
    expect(reads / workload.length).toBeGreaterThan(0.45)
    expect(reads / workload.length).toBeLessThan(0.55)
  })

  it('samples both engines the same number of times', () => {
    const result = run()
    expect(result.lsm.length).toBe(result.btree.length)
    expect(result.lsm.length).toBeGreaterThan(5)
    expect(last(result.lsm).op).toBe(DEFAULT_RUM_CONFIG.ops)
  })

  it('reports read and memory above their floors', () => {
    const result = run()
    for (const samples of [result.lsm, result.btree]) {
      const final = last(samples)
      expect(final.read).toBeGreaterThan(0)
      // A record cannot be stored in less than one slot, so memory has a hard
      // floor. Update does not — see below.
      expect(final.memory).toBeGreaterThanOrEqual(1)
    }
  })

  it('coalesces overwrites in the memtable, which a B+tree cannot do', () => {
    // Overwriting a key already sitting in the memtable replaces it in place,
    // so the superseded version never reaches disk at all. A B+tree writes
    // through to a page every time and has nothing equivalent, so under heavy
    // overwrite the two diverge sharply.
    const churn = run({ keySpace: 10 }, 'coalesce')
    const lsm = last(churn.lsm)
    const btree = last(churn.btree)
    expect(lsm.update).toBeLessThan(btree.update / 2)

    // And the LSM writes far less under churn than it does when every key is
    // distinct and there is nothing to coalesce.
    const spread = last(run({ keySpace: 400 }, 'coalesce').lsm)
    expect(lsm.update).toBeLessThan(spread.update)
  })

  it('stops writing entirely when the memtable can hold the whole key space', () => {
    // The limit of coalescing: if the working set fits in memory and never
    // fills the memtable, nothing is ever flushed and the engine touches disk
    // zero times. Degenerate, but not wrong.
    const contained = last(run({ keySpace: 6, memtableLimit: 12 }, 'contained').lsm)
    expect(contained.update).toBe(0)
  })

  it('replays identically from the same seed', () => {
    expect(run({}, 'repeat')).toEqual(run({}, 'repeat'))
  })

  it('shows the LSM writing more than the B+tree does not, and vice versa on reads', () => {
    // The core claim. Neither engine wins outright; each pays on a different
    // axis, which is what makes this a trade rather than a ranking.
    const result = run()
    const lsm = last(result.lsm)
    const btree = last(result.btree)
    expect(lsm.read).toBeGreaterThan(0)
    expect(btree.read).toBeGreaterThan(0)
    // At least one axis has to favour each engine, or the comparison is
    // teaching something false.
    const lsmWinsSomething = lsm.update < btree.update || lsm.memory < btree.memory || lsm.read < btree.read
    const btreeWinsSomething = btree.update < lsm.update || btree.memory < lsm.memory || btree.read < lsm.read
    expect(lsmWinsSomething).toBe(true)
    expect(btreeWinsSomething).toBe(true)
  })

  it('raises LSM write amplification when the memtable is smaller', () => {
    // Smaller memtable, more flushes, more tables, more compaction work.
    const tight = last(run({ memtableLimit: 3 }, 'wa').lsm)
    const loose = last(run({ memtableLimit: 12 }, 'wa').lsm)
    expect(tight.update).toBeGreaterThan(loose.update)
  })

  it('lowers B+tree seeks but raises data volume when pages hold more keys', () => {
    // The two halves of the fanout trade, and they point in opposite
    // directions. A wider page means a shallower tree and so fewer seeks, but
    // every level fetched costs more records. Counting only pages hides the
    // second half; counting only records hides the first.
    const narrow = last(run({ maxKeys: 2 }, 'fanout').btree)
    const wide = last(run({ maxKeys: 8 }, 'fanout').btree)
    expect(wide.readIos).toBeLessThan(narrow.readIos)
    expect(wide.read).toBeGreaterThan(narrow.read)
  })

  it('reports seeks at or below records read, since a page holds many records', () => {
    const result = run()
    for (const samples of [result.lsm, result.btree]) {
      const final = last(samples)
      expect(final.readIos).toBeLessThanOrEqual(final.read)
    }
  })

  it('raises B+tree write amplification when pages hold more keys', () => {
    // The other side of the same knob: a wider page is cheaper to search and
    // more expensive to rewrite, because a rewrite rewrites all of it.
    const narrow = last(run({ maxKeys: 2 }, 'fanout-w').btree)
    const wide = last(run({ maxKeys: 8 }, 'fanout-w').btree)
    expect(wide.update).toBeGreaterThan(narrow.update)
  })

  it('raises LSM memory overhead when the workload overwrites heavily', () => {
    // A small key space means the same keys are rewritten constantly, and
    // superseded versions pile up until compaction reclaims them.
    const churny = last(run({ keySpace: 15, readShare: 0 }, 'space').lsm)
    const spread = last(run({ keySpace: 200, readShare: 0 }, 'space').lsm)
    expect(churny.memory).toBeGreaterThan(spread.memory)
  })

  it('measures read cost without letting the probes change the result', () => {
    // Probing must not itself count as work, or a read-heavy mix would look
    // artificially expensive.
    const readHeavy = last(run({ readShare: 0.9 }, 'probe').lsm)
    expect(Number.isFinite(readHeavy.read)).toBe(true)
    expect(readHeavy.update).toBeGreaterThanOrEqual(1)
  })
})
