import { Simulation, type Rng } from '../../sim'
import {
  lsmModel,
  traceRead,
  type LsmCommand,
  type LsmEvent,
  type LsmState,
} from '../lsm/model'
import { btreeModel, type BTreeCommand, type BTreeEvent, type BTreeState } from '../btree/model'
import { pathToLeaf } from '../btree/tree'

export type EngineId = 'lsm' | 'btree'

export interface RumConfig {
  /** Total operations in the workload. */
  ops: number
  /** Share of operations that are reads, 0–1. */
  readShare: number
  /** Share of the non-read operations that are deletes, 0–1. */
  deleteShare: number
  /** Distinct keys the workload draws from. Fewer keys means more overwrites. */
  keySpace: number
  /** LSM: entries the memtable holds before sealing. */
  memtableLimit: number
  /** B+tree: keys per page. */
  maxKeys: number
}

export const DEFAULT_RUM_CONFIG: RumConfig = {
  ops: 400,
  readShare: 0.3,
  deleteShare: 0.15,
  keySpace: 60,
  memtableLimit: 6,
  maxKeys: 4,
}

/**
 * The three axes of the RUM conjecture, each expressed as an overhead ratio:
 * how much work or space was actually spent per unit the workload asked for.
 * One is the floor; nothing can do better.
 */
export interface RumSample {
  /** Operations applied so far. */
  op: number
  /** Records read from storage per record the lookup asked for. */
  read: number
  /**
   * Storage reads per lookup — pages for a B+tree, tables opened for an LSM.
   *
   * Reported alongside `read` because the two disagree, and the disagreement
   * is the point. A wider page needs fewer seeks but fetches more data at each
   * one. Real hardware weights the seek far more heavily than the transfer,
   * which is why production fanouts are enormous even though it costs volume.
   */
  readIos: number
  /** Records written to storage per record the workload wrote. */
  update: number
  /** Record slots occupied per live record. */
  memory: number
}

export interface RumResult {
  lsm: RumSample[]
  btree: RumSample[]
  /** Keys alive at the end, for context. */
  liveKeys: number
}

type Op = { kind: 'put'; key: string; value: string } | { kind: 'get'; key: string } | { kind: 'delete'; key: string }

function key(index: number): string {
  return `k${String(index).padStart(3, '0')}`
}

export function buildWorkload(config: RumConfig, rng: Rng): Op[] {
  const ops: Op[] = []
  for (let i = 0; i < config.ops; i++) {
    const target = key(rng.int(0, config.keySpace))
    if (rng.next() < config.readShare) {
      ops.push({ kind: 'get', key: target })
    } else if (rng.next() < config.deleteShare) {
      ops.push({ kind: 'delete', key: target })
    } else {
      ops.push({ kind: 'put', key: target, value: `v${i}` })
    }
  }
  return ops
}

function settle(sim: Simulation<LsmState, LsmEvent, LsmCommand>, guard = 5000): void {
  let steps = 0
  while (!sim.isIdle && steps < guard) {
    const next = sim.nextEventTime
    if (next === undefined) break
    sim.advanceTo(next)
    steps += 1
  }
}

/**
 * Measure read overhead by probing, rather than by trusting a running counter.
 *
 * The probe set is fixed across engines and sample points, so the number moves
 * only when the structure changes.
 */
function probeKeys(config: RumConfig): string[] {
  const keys: string[] = []
  for (let i = 0; i < Math.min(30, config.keySpace); i++) {
    keys.push(key(Math.floor((i * config.keySpace) / Math.min(30, config.keySpace))))
  }
  return keys
}

function lsmSample(sim: Simulation<LsmState, LsmEvent, LsmCommand>, op: number, probes: string[]): RumSample {
  const state = sim.currentState

  // Read: records pulled off storage per record wanted. A table that is opened
  // costs all of its entries, since that is what a block read fetches. Tables
  // excluded by a Bloom filter or a key range cost nothing, and the memtable
  // is free because it is already in memory.
  const tablesById = new Map(state.levels.flat().map((table) => [table.id, table]))
  let recordsRead = 0
  let opened = 0
  for (const probe of probes) {
    for (const step of traceRead(state, probe).steps) {
      if (step.tableId === undefined) continue
      if (step.outcome === 'bloom-skip' || step.outcome === 'range-skip') continue
      recordsRead += tablesById.get(step.tableId)?.entries.length ?? 0
      opened += 1
    }
  }
  const read = probes.length === 0 ? 0 : recordsRead / probes.length
  const readIos = probes.length === 0 ? 0 : opened / probes.length

  // Update: every record the engine wrote, including every rewrite during
  // compaction, over the records the workload asked to store.
  const userRecords = state.nextSeq - 1
  const update = userRecords === 0 ? 0 : state.stats.recordsWritten / userRecords

  // Memory: slots occupied over live keys. An LSM packs its tables full, so its
  // overhead is entirely redundancy — superseded versions and tombstones that
  // compaction has not yet reclaimed.
  const stored =
    state.levels.flat().reduce((total, table) => total + table.entries.length, 0) +
    state.sealed.reduce((total, entries) => total + entries.length, 0) +
    state.memtable.length

  const live = new Set<string>()
  for (const probeKey of allKeys(state)) {
    if (traceRead(state, probeKey).found !== null) live.add(probeKey)
  }
  const memory = live.size === 0 ? 0 : stored / live.size

  return { op, read, readIos, update, memory }
}

function allKeys(state: LsmState): string[] {
  const keys = new Set<string>()
  for (const entry of state.memtable) keys.add(entry.key)
  for (const entries of state.sealed) for (const entry of entries) keys.add(entry.key)
  for (const table of state.levels.flat()) for (const entry of table.entries) keys.add(entry.key)
  return [...keys]
}

function btreeSample(
  sim: Simulation<BTreeState, BTreeEvent, BTreeCommand>,
  op: number,
  probes: string[],
  writtenRecords: number,
  userRecords: number,
): RumSample {
  const state = sim.currentState

  // Read: same unit as the LSM — records fetched per record wanted. Every page
  // on the path is read whole, so a wider page means fewer levels but more
  // records pulled at each one. That tension is the fanout trade, and it is
  // invisible if you count pages instead of records.
  let recordsRead = 0
  let pagesRead = 0
  for (const probe of probes) {
    for (const pageId of pathToLeaf(state.tree.pages, state.tree.rootId, probe)) {
      recordsRead += state.tree.pages[pageId]?.keys.length ?? 0
      pagesRead += 1
    }
  }
  const read = probes.length === 0 ? 0 : recordsRead / probes.length
  const readIos = probes.length === 0 ? 0 : pagesRead / probes.length

  const update = userRecords === 0 ? 0 : writtenRecords / userRecords

  // Memory: a B+tree stores each key exactly once, so its overhead is not
  // redundancy but reserved-and-empty slots — the flip side of the fill factor
  // that lets it absorb inserts without reorganising.
  const pageCount = Object.keys(state.tree.pages).length
  const liveKeys = countLeafKeys(state)
  const memory = liveKeys === 0 ? 0 : (pageCount * state.maxKeys) / liveKeys

  return { op, read, readIos, update, memory }
}

function countLeafKeys(state: BTreeState): number {
  let total = 0
  for (const node of Object.values(state.tree.pages)) {
    if (node.kind === 'leaf') total += node.keys.length
  }
  return total
}

/**
 * Run one workload against both engines, sampling as it goes.
 *
 * Both see exactly the same operations in the same order, which is the only
 * way the comparison means anything.
 */
export function runExperiment(config: RumConfig, rng: Rng, samples = 24): RumResult {
  const workload = buildWorkload(config, rng)
  const probes = probeKeys(config)
  const interval = Math.max(1, Math.floor(workload.length / samples))

  const lsm = new Simulation<LsmState, LsmEvent, LsmCommand>(lsmModel, { seed: 'rum' })
  lsm.dispatch({ kind: 'setConfig', patch: { memtableLimit: config.memtableLimit } })

  const btree = new Simulation<BTreeState, BTreeEvent, BTreeCommand>(btreeModel, { seed: 'rum' })
  btree.dispatch({ kind: 'setMaxKeys', maxKeys: config.maxKeys })

  const lsmSamples: RumSample[] = []
  const btreeSamples: RumSample[] = []
  let userRecords = 0

  workload.forEach((op, index) => {
    switch (op.kind) {
      case 'put':
        lsm.dispatch({ kind: 'put', key: op.key, value: op.value })
        btree.dispatch({ kind: 'put', key: op.key, value: op.value })
        userRecords += 1
        break
      case 'delete':
        lsm.dispatch({ kind: 'delete', key: op.key })
        btree.dispatch({ kind: 'delete', key: op.key })
        userRecords += 1
        break
      case 'get':
        // Reads are measured by probing, not by dispatching, so that the
        // read mix changes the structure's shape without polluting counters.
        break
    }

    // Let the LSM's background work land. Without this the comparison would
    // flatter it — compaction is exactly the cost being measured.
    settle(lsm)

    if ((index + 1) % interval === 0 || index === workload.length - 1) {
      lsmSamples.push(lsmSample(lsm, index + 1, probes))
      btreeSamples.push(btreeSample(btree, index + 1, probes, btree.currentState.stats.recordsWritten, userRecords))
    }
  })

  return { lsm: lsmSamples, btree: btreeSamples, liveKeys: countLeafKeys(btree.currentState) }
}
