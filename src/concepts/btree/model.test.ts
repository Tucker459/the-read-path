import { describe, expect, it } from 'vitest'
import { Simulation, createRng } from '../../sim'
import { btreeModel, DEFAULT_MAX_KEYS, type BTreeCommand, type BTreeEvent, type BTreeState } from './model'
import { leafChain, minKeys, page, scanAll, type InternalPage, type PageId, type Tree } from './tree'

function build(seed = 'btree-test') {
  return new Simulation<BTreeState, BTreeEvent, BTreeCommand>(btreeModel, { seed })
}

function settle(sim: Simulation<BTreeState, BTreeEvent, BTreeCommand>, guard = 20_000): void {
  let steps = 0
  while (!sim.isIdle && steps < guard) {
    const next = sim.nextEventTime
    if (next === undefined) break
    sim.advanceTo(next)
    steps += 1
  }
}

function get(sim: Simulation<BTreeState, BTreeEvent, BTreeCommand>, key: string): string | null {
  sim.dispatch({ kind: 'get', key })
  return sim.currentState.lastSearch?.found ?? null
}

/**
 * Assert every structural invariant a B+tree is supposed to hold.
 *
 * These are what make the tree worth using: without them a lookup would not be
 * bounded by the height, and range scans would miss keys. Checking them after
 * every operation is far more revealing than checking the final shape.
 */
function validate(tree: Tree, maxKeys: number): void {
  const depths: number[] = []
  const seen = new Set<PageId>()

  const walk = (id: PageId, depth: number, low: string | null, high: string | null, isRoot: boolean): void => {
    expect(seen.has(id)).toBe(false)
    seen.add(id)
    const node = page(tree.pages, id)

    // Keys are sorted and unique within a page.
    for (let i = 1; i < node.keys.length; i++) {
      expect((node.keys[i - 1] as string) < (node.keys[i] as string)).toBe(true)
    }

    // Every key sits inside the range its ancestors promised.
    for (const key of node.keys) {
      if (low !== null) expect(key >= low).toBe(true)
      if (high !== null) expect(key < high).toBe(true)
    }

    expect(node.keys.length).toBeLessThanOrEqual(maxKeys)
    // The root is exempt from the minimum; nothing else is.
    if (!isRoot) expect(node.keys.length).toBeGreaterThanOrEqual(minKeys(maxKeys))

    if (node.kind === 'leaf') {
      expect(node.values.length).toBe(node.keys.length)
      depths.push(depth)
      return
    }

    const internal = node as InternalPage
    expect(internal.children.length).toBe(internal.keys.length + 1)
    if (!isRoot) expect(internal.children.length).toBeGreaterThan(1)
    internal.children.forEach((childId, index) => {
      const childLow = index === 0 ? low : (internal.keys[index - 1] as string)
      const childHigh = index === internal.keys.length ? high : (internal.keys[index] as string)
      walk(childId, depth + 1, childLow, childHigh, false)
    })
  }

  walk(tree.rootId, 1, null, null, true)

  // Every leaf at the same depth — the property that makes lookups uniform.
  expect(new Set(depths).size).toBe(1)
  expect(depths[0]).toBe(tree.height)

  // The leaf chain visits every leaf, left to right, exactly once.
  const chain = leafChain(tree.pages, tree.rootId)
  expect(chain.length).toBe(depths.length)

  // And a scan along it comes out sorted.
  const scanned = scanAll(tree.pages, tree.rootId).map((entry) => entry.key)
  expect([...scanned].sort()).toEqual(scanned)
  expect(new Set(scanned).size).toBe(scanned.length)

  // No orphaned pages left behind by a merge.
  expect(Object.keys(tree.pages).length).toBe(seen.size)
}

describe('the invariant checker itself', () => {
  // A validator that cannot fail proves nothing about the code it guards, so
  // each invariant gets a deliberately corrupted tree to reject.
  const grow = () => {
    const sim = build('negative-control')
    for (let i = 0; i < 40; i++) sim.dispatch({ kind: 'put', key: `k${String(i).padStart(2, '0')}`, value: 'v' })
    return sim.currentState
  }

  it('rejects a leaf whose keys are out of order', () => {
    const state = grow()
    const leaf = leafChain(state.tree.pages, state.tree.rootId)[0]
    if (leaf === undefined || leaf.keys.length < 2) throw new Error('need a multi-key leaf')
    const swapped = { ...leaf, keys: [leaf.keys[1] as string, leaf.keys[0] as string, ...leaf.keys.slice(2)] }
    expect(() => validate({ ...state.tree, pages: { ...state.tree.pages, [leaf.id]: swapped } }, state.maxKeys)).toThrow()
  })

  it('rejects a key on the wrong side of its separator', () => {
    const state = grow()
    const leaf = leafChain(state.tree.pages, state.tree.rootId)[0]
    if (leaf === undefined) throw new Error('need a leaf')
    const outOfRange = { ...leaf, keys: [...leaf.keys.slice(0, -1), 'zzz'] }
    expect(() =>
      validate({ ...state.tree, pages: { ...state.tree.pages, [leaf.id]: outOfRange } }, state.maxKeys),
    ).toThrow()
  })

  it('rejects an orphaned page', () => {
    const state = grow()
    const orphanId = state.tree.nextPageId
    const pages = { ...state.tree.pages, [orphanId]: { kind: 'leaf' as const, id: orphanId, keys: [], values: [], next: null } }
    expect(() => validate({ ...state.tree, pages }, state.maxKeys)).toThrow()
  })
})

describe('b+tree', () => {
  it('exercises borrow and merge on both leaves and internal pages', () => {
    const rng = createRng('rebalance-coverage')
    const sim = build('rebalance-coverage')
    const keys = Array.from({ length: 60 }, (_, i) => `k${String(i).padStart(2, '0')}`)
    for (const key of keys) sim.dispatch({ kind: 'put', key, value: 'v' })
    for (let i = 0; i < 400; i++) {
      const key = rng.pick(keys)
      if (rng.chance(0.6)) sim.dispatch({ kind: 'delete', key })
      else sim.dispatch({ kind: 'put', key, value: 'v' })
    }
    // Without this, a churn workload could pass while never touching the
    // borrow path at all, leaving half the rebalancing code unproven.
    expect(sim.currentState.stats.borrows).toBeGreaterThan(0)
    expect(sim.currentState.stats.merges).toBeGreaterThan(0)
    expect(sim.currentState.stats.splits).toBeGreaterThan(0)
    validate(sim.currentState.tree, sim.currentState.maxKeys)
  })

  it('starts as a single empty leaf', () => {
    const state = build().currentState
    expect(state.tree.height).toBe(1)
    expect(scanAll(state.tree.pages, state.tree.rootId)).toEqual([])
    validate(state.tree, state.maxKeys)
  })

  it('reads back what it wrote', () => {
    const sim = build()
    sim.dispatch({ kind: 'put', key: 'k10', value: 'a' })
    expect(get(sim, 'k10')).toBe('a')
  })

  it('returns null for an absent key', () => {
    expect(get(build(), 'nope')).toBeNull()
  })

  it('overwrites in place without growing', () => {
    const sim = build()
    sim.dispatch({ kind: 'put', key: 'k10', value: 'first' })
    const pagesBefore = Object.keys(sim.currentState.tree.pages).length
    sim.dispatch({ kind: 'put', key: 'k10', value: 'second' })
    expect(get(sim, 'k10')).toBe('second')
    expect(Object.keys(sim.currentState.tree.pages).length).toBe(pagesBefore)
  })

  it('splits a full leaf and grows a root', () => {
    const sim = build()
    for (let i = 0; i <= DEFAULT_MAX_KEYS; i++) {
      sim.dispatch({ kind: 'put', key: `k${String(i).padStart(2, '0')}`, value: 'v' })
    }
    expect(sim.currentState.tree.height).toBe(2)
    expect(sim.currentState.stats.splits).toBe(1)
    validate(sim.currentState.tree, sim.currentState.maxKeys)
  })

  it('keeps a split leaf key present in a leaf, since leaves hold the data', () => {
    const sim = build()
    const keys = ['k00', 'k01', 'k02', 'k03', 'k04']
    for (const key of keys) sim.dispatch({ kind: 'put', key, value: key })
    // A leaf split copies its separator up rather than moving it, so every
    // original key must still be reachable.
    for (const key of keys) expect(get(sim, key)).toBe(key)
  })

  it('grows taller only from the root, keeping every leaf level', () => {
    const sim = build()
    for (let i = 0; i < 60; i++) {
      sim.dispatch({ kind: 'put', key: `k${String(i).padStart(2, '0')}`, value: 'v' })
      validate(sim.currentState.tree, sim.currentState.maxKeys)
    }
    expect(sim.currentState.tree.height).toBeGreaterThan(2)
  })

  it('records a root-to-leaf path of exactly the tree height', () => {
    const sim = build()
    for (let i = 0; i < 40; i++) sim.dispatch({ kind: 'put', key: `k${String(i).padStart(2, '0')}`, value: 'v' })
    sim.dispatch({ kind: 'get', key: 'k20' })
    expect(sim.currentState.lastSearch?.path).toHaveLength(sim.currentState.tree.height)
  })

  it('deletes a key and keeps the rest intact', () => {
    const sim = build()
    for (let i = 0; i < 20; i++) sim.dispatch({ kind: 'put', key: `k${String(i).padStart(2, '0')}`, value: `v${i}` })
    sim.dispatch({ kind: 'delete', key: 'k07' })
    expect(get(sim, 'k07')).toBeNull()
    for (let i = 0; i < 20; i++) {
      if (i === 7) continue
      expect(get(sim, `k${String(i).padStart(2, '0')}`)).toBe(`v${i}`)
    }
    validate(sim.currentState.tree, sim.currentState.maxKeys)
  })

  it('deleting an absent key changes nothing', () => {
    const sim = build()
    for (let i = 0; i < 12; i++) sim.dispatch({ kind: 'put', key: `k${String(i).padStart(2, '0')}`, value: 'v' })
    const before = scanAll(sim.currentState.tree.pages, sim.currentState.tree.rootId)
    sim.dispatch({ kind: 'delete', key: 'absent' })
    expect(scanAll(sim.currentState.tree.pages, sim.currentState.tree.rootId)).toEqual(before)
    validate(sim.currentState.tree, sim.currentState.maxKeys)
  })

  it('borrows or merges on underflow, and shrinks back to one leaf', () => {
    const sim = build()
    const keys = Array.from({ length: 40 }, (_, i) => `k${String(i).padStart(2, '0')}`)
    for (const key of keys) sim.dispatch({ kind: 'put', key, value: 'v' })
    expect(sim.currentState.tree.height).toBeGreaterThan(2)

    for (const key of keys) {
      sim.dispatch({ kind: 'delete', key })
      validate(sim.currentState.tree, sim.currentState.maxKeys)
    }

    // Emptied completely, the tree must collapse back to a single leaf rather
    // than leaving a stack of empty internal pages behind.
    expect(sim.currentState.tree.height).toBe(1)
    expect(Object.keys(sim.currentState.tree.pages)).toHaveLength(1)
    expect(sim.currentState.stats.merges).toBeGreaterThan(0)
  })

  it('empties correctly in reverse order too', () => {
    const sim = build()
    const keys = Array.from({ length: 40 }, (_, i) => `k${String(i).padStart(2, '0')}`)
    for (const key of keys) sim.dispatch({ kind: 'put', key, value: 'v' })
    for (const key of [...keys].reverse()) {
      sim.dispatch({ kind: 'delete', key })
      validate(sim.currentState.tree, sim.currentState.maxKeys)
    }
    expect(sim.currentState.tree.height).toBe(1)
  })

  it('holds its invariants at every page capacity', () => {
    for (const maxKeys of [2, 3, 4, 5, 8]) {
      const sim = build(`cap-${maxKeys}`)
      sim.dispatch({ kind: 'setMaxKeys', maxKeys })
      for (let i = 0; i < 50; i++) {
        sim.dispatch({ kind: 'put', key: `k${String((i * 17) % 50).padStart(2, '0')}`, value: `v${i}` })
        validate(sim.currentState.tree, maxKeys)
      }
      for (let i = 0; i < 25; i++) {
        sim.dispatch({ kind: 'delete', key: `k${String((i * 13) % 50).padStart(2, '0')}` })
        validate(sim.currentState.tree, maxKeys)
      }
    }
  })

  it('agrees with a plain Map across a long random workload', () => {
    // Same standard the LSM-tree is held to. Both are elaborate maps, and the
    // only thing that ultimately matters is that they behave like one.
    const rng = createRng('btree-differential')
    const sim = build('btree-differential')
    const reference = new Map<string, string>()
    const keys = Array.from({ length: 45 }, (_, i) => `k${String(i).padStart(2, '0')}`)

    for (let step = 0; step < 700; step++) {
      const key = rng.pick(keys)
      const roll = rng.next()

      if (roll < 0.55) {
        const value = `v${step}`
        sim.dispatch({ kind: 'put', key, value })
        reference.set(key, value)
      } else if (roll < 0.75) {
        sim.dispatch({ kind: 'delete', key })
        reference.delete(key)
      } else {
        expect(get(sim, key)).toBe(reference.get(key) ?? null)
      }

      if (step % 25 === 0) validate(sim.currentState.tree, sim.currentState.maxKeys)
    }

    validate(sim.currentState.tree, sim.currentState.maxKeys)
    for (const key of keys) expect(get(sim, key)).toBe(reference.get(key) ?? null)

    // A range scan along the leaf chain must agree with the map as well.
    const scanned = scanAll(sim.currentState.tree.pages, sim.currentState.tree.rootId)
    expect(scanned.map((entry) => entry.key)).toEqual([...reference.keys()].sort())
  })

  it('counts one page read per level of the tree', () => {
    const sim = build()
    for (let i = 0; i < 50; i++) sim.dispatch({ kind: 'put', key: `k${String(i).padStart(2, '0')}`, value: 'v' })
    const before = sim.currentState.stats.pageReads
    sim.dispatch({ kind: 'get', key: 'k25' })
    // This is the whole argument for high fanout: lookup cost is the height,
    // and the height is what a wide page keeps small.
    expect(sim.currentState.stats.pageReads - before).toBe(sim.currentState.tree.height)
  })

  it('keeps a shallower tree when pages hold more keys', () => {
    const heightFor = (maxKeys: number) => {
      const sim = build(`h-${maxKeys}`)
      sim.dispatch({ kind: 'setMaxKeys', maxKeys })
      for (let i = 0; i < 60; i++) sim.dispatch({ kind: 'put', key: `k${String(i).padStart(2, '0')}`, value: 'v' })
      return sim.currentState.tree.height
    }
    expect(heightFor(2)).toBeGreaterThan(heightFor(8))
  })

  it('runs one operation at a time when writes are batched', () => {
    const sim = build('batched')
    sim.dispatch({ kind: 'putMany', count: 30 })
    settle(sim)
    // Interleaved descents would corrupt the tree; the invariants would not
    // survive it.
    validate(sim.currentState.tree, sim.currentState.maxKeys)
    expect(sim.currentState.op).toBeNull()
    expect(sim.currentState.stats.inserts).toBe(30)
  })

  it('replays identically from the same seed', () => {
    const run = () => {
      const sim = build('btree-replay')
      sim.dispatch({ kind: 'putMany', count: 25 })
      settle(sim)
      return scanAll(sim.currentState.tree.pages, sim.currentState.tree.rootId)
    }
    expect(run()).toEqual(run())
  })

  it('leaves no operation half-finished', () => {
    const sim = build()
    for (let i = 0; i < 30; i++) {
      sim.dispatch({ kind: 'put', key: `k${String(i).padStart(2, '0')}`, value: 'v' })
      expect(sim.currentState.op).toBeNull()
    }
  })
})
