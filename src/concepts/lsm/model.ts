import type { Model, SimContext } from '../../sim'
import { bloomMightContain, createBloom, type Bloom } from '../../lib/bloom'

/** A tombstone is a value of null — a delete is a write, not an erasure. */
export interface LsmEntry {
  key: string
  value: string | null
  seq: number
}

export interface SSTable {
  id: number
  level: number
  /** Sorted by key, one entry per key. Immutable once written. */
  entries: LsmEntry[]
  bloom: Bloom
  bytes: number
}

export type ReadOutcome = 'hit' | 'tombstone' | 'miss' | 'bloom-skip' | 'range-skip'

export interface ReadStep {
  where: string
  tableId?: number
  outcome: ReadOutcome
}

export interface ReadTrace {
  key: string
  steps: ReadStep[]
  found: string | null
  /** Tables actually opened and scanned. */
  tablesRead: number
  /** Tables the Bloom filter let us skip without reading. */
  bloomSkips: number
}

export interface LsmConfig {
  /** Entries the memtable holds before it is flushed. */
  memtableLimit: number
  /** L0 table count that triggers a merge into L1. */
  l0Trigger: number
  /** Each level holds this many times more than the one above. */
  levelRatio: number
  maxLevel: number
}

export interface LsmStats {
  /** Bytes the user asked to write. */
  userBytes: number
  /** Bytes actually written to disk, across flushes and every compaction. */
  diskBytes: number
  /**
   * Records written to storage, counting every rewrite.
   *
   * Bytes and records tell the same story here, but records are the unit a
   * B+tree can be compared against — see the RUM concept.
   */
  recordsWritten: number
  flushes: number
  compactions: number
  reads: number
  tablesRead: number
  bloomSkips: number
}

export interface LsmState {
  nextSeq: number
  nextTableId: number
  /** Sorted by key, one entry per key. */
  memtable: LsmEntry[]
  /**
   * Memtables that are full and awaiting write-out, oldest first. Still
   * readable — sealing removes the right to write, not the right to read.
   */
  sealed: LsmEntry[][]
  /** levels[0] is L0, whose tables may overlap. Deeper levels never overlap. */
  levels: SSTable[][]
  /** Table ids currently being merged, for the animation. */
  compacting: number[]
  config: LsmConfig
  stats: LsmStats
  lastRead: ReadTrace | null
}

/**
 * Events carry no identity of their own.
 *
 * Table ids and sequence numbers are assigned in `reduce`, never at the point
 * an event is created. Two operations in flight at once — a flush finishing
 * while a compaction is planned — would otherwise both read the same
 * `nextTableId` and mint colliding ids, and a later removal by id would take
 * out the wrong table.
 */
export type LsmEvent =
  | { kind: 'put'; key: string; value: string | null }
  | { kind: 'flushStart' }
  | { kind: 'flushEnd' }
  | { kind: 'compactStart'; level: number; tableIds: number[] }
  | { kind: 'compactEnd'; level: number; removedIds: number[]; groups: LsmEntry[][] }
  | { kind: 'read'; trace: ReadTrace }
  | { kind: 'config'; patch: Partial<LsmConfig> }

export type LsmCommand =
  | { kind: 'put'; key: string; value: string }
  | { kind: 'delete'; key: string }
  | { kind: 'get'; key: string }
  | { kind: 'putMany'; count: number }
  | { kind: 'setConfig'; patch: Partial<LsmConfig> }

const FLUSH_DELAY = 20
const COMPACT_DELAY = 30

export const DEFAULT_CONFIG: LsmConfig = {
  memtableLimit: 6,
  l0Trigger: 3,
  levelRatio: 3,
  maxLevel: 4,
}

export function entryBytes(entry: LsmEntry): number {
  return entry.key.length + (entry.value?.length ?? 0) + 8
}

function tableBytes(entries: readonly LsmEntry[]): number {
  return entries.reduce((total, entry) => total + entryBytes(entry), 0)
}

export function minKey(table: SSTable): string {
  return (table.entries[0] as LsmEntry).key
}

export function maxKey(table: SSTable): string {
  return (table.entries[table.entries.length - 1] as LsmEntry).key
}

function covers(table: SSTable, key: string): boolean {
  return minKey(table) <= key && key <= maxKey(table)
}

function rangesOverlap(a: SSTable, b: SSTable): boolean {
  return minKey(a) <= maxKey(b) && minKey(b) <= maxKey(a)
}

/** Insert or replace, keeping the array sorted by key. */
function upsert(entries: readonly LsmEntry[], entry: LsmEntry): LsmEntry[] {
  const next = entries.filter((existing) => existing.key !== entry.key)
  next.push(entry)
  next.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  return next
}

function makeTable(id: number, level: number, entries: LsmEntry[]): SSTable {
  return {
    id,
    level,
    entries,
    bloom: createBloom(entries.map((entry) => entry.key)),
    bytes: tableBytes(entries),
  }
}

/**
 * Merge tables into new sorted runs, returned as entry groups so that `reduce`
 * can assign the ids.
 *
 * Two details carry most of the teaching weight. The newest sequence number
 * wins, which is how an overwrite becomes visible without anything being
 * edited in place. And tombstones are only dropped at the bottom level — drop
 * one earlier and an older value sitting in a deeper level would rise from the
 * dead on the next read.
 */
export function mergeEntries(
  tables: readonly SSTable[],
  isBottom: boolean,
  maxEntriesPerTable: number,
): LsmEntry[][] {
  const byKey = new Map<string, LsmEntry>()
  for (const table of tables) {
    for (const entry of table.entries) {
      const existing = byKey.get(entry.key)
      if (existing === undefined || entry.seq > existing.seq) byKey.set(entry.key, entry)
    }
  }

  const merged = [...byKey.values()]
    .filter((entry) => !(isBottom && entry.value === null))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))

  const groups: LsmEntry[][] = []
  for (let i = 0; i < merged.length; i += maxEntriesPerTable) {
    groups.push(merged.slice(i, i + maxEntriesPerTable))
  }
  return groups
}

/** How many tables a level may hold before it has to spill downward. */
export function levelCapacity(config: LsmConfig, level: number): number {
  if (level === 0) return config.l0Trigger
  return config.l0Trigger * Math.pow(config.levelRatio, level - 1)
}

/** Walk the read path, recording every table consulted and every one skipped. */
export function traceRead(state: LsmState, key: string): ReadTrace {
  const steps: ReadStep[] = []
  let tablesRead = 0
  let bloomSkips = 0

  const finish = (value: string | null): ReadTrace => ({ key, steps, found: value, tablesRead, bloomSkips })

  const inMemtable = state.memtable.find((entry) => entry.key === key)
  if (inMemtable) {
    steps.push({ where: 'memtable', outcome: inMemtable.value === null ? 'tombstone' : 'hit' })
    return finish(inMemtable.value)
  }
  steps.push({ where: 'memtable', outcome: 'miss' })

  // Newest sealed memtable first — the queue holds them oldest first.
  for (let i = state.sealed.length - 1; i >= 0; i--) {
    const entries = state.sealed[i] ?? []
    const found = entries.find((entry) => entry.key === key)
    const where = `sealed #${i + 1}`
    if (found) {
      steps.push({ where, outcome: found.value === null ? 'tombstone' : 'hit' })
      return finish(found.value)
    }
    steps.push({ where, outcome: 'miss' })
  }

  for (let level = 0; level < state.levels.length; level++) {
    // L0 tables overlap, so every one of them has to be considered, newest
    // first. Deeper levels are sorted runs, so at most one table can hold the
    // key — that difference is the whole reason L0 is special.
    const tables = state.levels[level] ?? []

    for (const table of tables) {
      const where = `L${level} #${table.id}`
      if (!covers(table, key)) {
        steps.push({ where, tableId: table.id, outcome: 'range-skip' })
        continue
      }
      if (!bloomMightContain(table.bloom, key)) {
        bloomSkips += 1
        steps.push({ where, tableId: table.id, outcome: 'bloom-skip' })
        continue
      }
      tablesRead += 1
      const found = table.entries.find((entry) => entry.key === key)
      if (found) {
        steps.push({ where, tableId: table.id, outcome: found.value === null ? 'tombstone' : 'hit' })
        return finish(found.value)
      }
      // The filter said maybe and was wrong. This is a false positive, and the
      // cost of it is exactly this wasted read.
      steps.push({ where, tableId: table.id, outcome: 'miss' })
    }
  }

  return finish(null)
}

/** Decide what to compact next, if anything. */
function planCompaction(state: LsmState): { level: number; tableIds: number[] } | null {
  const l0 = state.levels[0] ?? []
  if (l0.length >= state.config.l0Trigger) {
    const l1 = state.levels[1] ?? []
    // Every L0 table goes, plus any L1 table whose range they touch.
    const overlapping = l1.filter((table) => l0.some((source) => rangesOverlap(source, table)))
    return { level: 0, tableIds: [...l0.map((t) => t.id), ...overlapping.map((t) => t.id)] }
  }

  for (let level = 1; level < state.config.maxLevel; level++) {
    const tables = state.levels[level] ?? []
    if (tables.length <= levelCapacity(state.config, level)) continue
    const victim = tables[0]
    if (victim === undefined) continue
    const below = state.levels[level + 1] ?? []
    const overlapping = below.filter((table) => rangesOverlap(victim, table))
    return { level, tableIds: [victim.id, ...overlapping.map((t) => t.id)] }
  }

  return null
}

/**
 * Begin a compaction if one is due.
 *
 * `compactStart` is emitted immediately rather than scheduled. Scheduling it
 * would leave a window in which a second flush could plan a second compaction
 * over the same tables, because nothing in the state would yet record that one
 * was already on its way. Applying the event now closes that window: the very
 * next check sees a non-empty `compacting`.
 */
function beginCompaction(state: LsmState, ctx: SimContext<LsmEvent>): void {
  if (state.compacting.length > 0) return
  const plan = planCompaction(state)
  if (plan === null) return
  ctx.emit({ kind: 'compactStart', level: plan.level, tableIds: plan.tableIds })
}

/**
 * Seal the memtable if it is full, for the same reason, in the same way.
 *
 * Sealing is never blocked on an earlier flush still being in flight. Writes
 * can outrun write-out, and when they do the sealed queue grows rather than
 * one enormous memtable — which is what a real engine does, and what makes
 * "flushes cannot keep up" visible instead of invisible.
 */
function beginFlush(state: LsmState, ctx: SimContext<LsmEvent>): void {
  if (state.memtable.length < state.config.memtableLimit) return
  ctx.emit({ kind: 'flushStart' })
}

export const lsmModel: Model<LsmState, LsmEvent, LsmCommand> = {
  initialState: () => ({
    nextSeq: 1,
    nextTableId: 1,
    memtable: [],
    sealed: [],
    levels: [[], [], [], [], []],
    compacting: [],
    config: DEFAULT_CONFIG,
    stats: {
      userBytes: 0,
      diskBytes: 0,
      recordsWritten: 0,
      flushes: 0,
      compactions: 0,
      reads: 0,
      tablesRead: 0,
      bloomSkips: 0,
    },
    lastRead: null,
  }),

  reduce(state, event) {
    switch (event.kind) {
      case 'put': {
        const entry: LsmEntry = { key: event.key, value: event.value, seq: state.nextSeq }
        return {
          ...state,
          nextSeq: state.nextSeq + 1,
          memtable: upsert(state.memtable, entry),
          stats: { ...state.stats, userBytes: state.stats.userBytes + entryBytes(entry) },
        }
      }

      case 'flushStart':
        // Sealing nothing is meaningless, and an empty sealed memtable would
        // become an empty SSTable with no key range. Guarded here rather than
        // at the call site because emitted events queue behind ones already
        // pending: several puts in one batch can each ask for a flush, and
        // only the first of those requests finds anything to seal.
        if (state.memtable.length === 0) return state
        // The memtable is sealed rather than emptied: writes continue into a
        // fresh one while this waits to be written, and reads still see both.
        return { ...state, memtable: [], sealed: [...state.sealed, state.memtable] }

      case 'flushEnd': {
        // Oldest sealed memtable first, so L0 stays ordered newest to oldest.
        const [oldest, ...rest] = state.sealed
        if (oldest === undefined) return state
        const table = makeTable(state.nextTableId, 0, oldest)
        const levels = state.levels.map((tables) => [...tables])
        levels[0] = [table, ...(levels[0] ?? [])]
        return {
          ...state,
          sealed: rest,
          nextTableId: state.nextTableId + 1,
          levels,
          stats: {
            ...state.stats,
            flushes: state.stats.flushes + 1,
            diskBytes: state.stats.diskBytes + table.bytes,
            recordsWritten: state.stats.recordsWritten + table.entries.length,
          },
        }
      }

      case 'compactStart':
        return { ...state, compacting: event.tableIds }

      case 'compactEnd': {
        const removed = new Set(event.removedIds)
        const levels = state.levels.map((tables) => tables.filter((table) => !removed.has(table.id)))
        const target = event.level + 1
        const added = event.groups.map((entries, index) => makeTable(state.nextTableId + index, target, entries))
        levels[target] = [...(levels[target] ?? []), ...added].sort((a, b) =>
          minKey(a) < minKey(b) ? -1 : minKey(a) > minKey(b) ? 1 : 0,
        )
        return {
          ...state,
          levels,
          compacting: [],
          nextTableId: state.nextTableId + added.length,
          stats: {
            ...state.stats,
            compactions: state.stats.compactions + 1,
            diskBytes: state.stats.diskBytes + added.reduce((total, table) => total + table.bytes, 0),
            recordsWritten:
              state.stats.recordsWritten + added.reduce((total, table) => total + table.entries.length, 0),
          },
        }
      }

      case 'read':
        return {
          ...state,
          lastRead: event.trace,
          stats: {
            ...state.stats,
            reads: state.stats.reads + 1,
            tablesRead: state.stats.tablesRead + event.trace.tablesRead,
            bloomSkips: state.stats.bloomSkips + event.trace.bloomSkips,
          },
        }

      case 'config':
        return { ...state, config: { ...state.config, ...event.patch } }
    }
  },

  onCommand(state, command, ctx) {
    switch (command.kind) {
      case 'put':
        ctx.emit({ kind: 'put', key: command.key, value: command.value })
        break

      case 'delete':
        ctx.emit({ kind: 'put', key: command.key, value: null })
        break

      case 'get':
        ctx.emit({ kind: 'read', trace: traceRead(state, command.key) })
        break

      case 'putMany':
        // Spread over time rather than emitted at one instant. A burst that
        // all lands on the same tick outruns every flush, and the result is
        // one enormous memtable instead of the steady flush-and-compact
        // rhythm this is meant to show.
        for (let i = 0; i < command.count; i++) {
          ctx.schedule(i * 6, { kind: 'put', key: `k${String(ctx.randomInt(0, 60)).padStart(2, '0')}`, value: `v${i}` })
        }
        break

      case 'setConfig':
        ctx.emit({ kind: 'config', patch: command.patch })
        break
    }
  },

  onEvent(state, event, ctx) {
    switch (event.kind) {
      case 'put':
        beginFlush(state, ctx)
        break

      case 'flushStart':
        // Writing the table out is the slow part, so only this is scheduled.
        ctx.schedule(FLUSH_DELAY, { kind: 'flushEnd' })
        break

      case 'flushEnd':
        // A flush can leave the memtable already over its limit again, if
        // writes kept arriving while it was sealed.
        beginFlush(state, ctx)
        beginCompaction(state, ctx)
        break

      case 'compactStart': {
        const ids = new Set(event.tableIds)
        const sources = state.levels.flat().filter((table) => ids.has(table.id))
        if (sources.length === 0) {
          // The tables went away before the merge began. Finish the compaction
          // as a no-op rather than returning: `compacting` is set, and leaving
          // it set would block every future compaction forever.
          ctx.emit({ kind: 'compactEnd', level: event.level, removedIds: [], groups: [] })
          break
        }
        const isBottom = event.level + 1 >= state.config.maxLevel
        ctx.schedule(COMPACT_DELAY, {
          kind: 'compactEnd',
          level: event.level,
          removedIds: event.tableIds,
          groups: mergeEntries(sources, isBottom, state.config.memtableLimit),
        })
        break
      }

      case 'compactEnd':
        // Compaction cascades: filling L1 can overflow it into L2, and so on.
        beginCompaction(state, ctx)
        break

      case 'read':
      case 'config':
        break
    }
  },

  describe(event) {
    switch (event.kind) {
      case 'put':
        return event.value === null ? `delete ${event.key}` : `put ${event.key}`
      case 'flushStart':
        return 'memtable sealed'
      case 'flushEnd':
        return 'flush → L0'
      case 'compactStart':
        return `compact L${event.level} → L${event.level + 1} (${event.tableIds.length} tables)`
      case 'compactEnd':
        return `compaction done → ${event.groups.length} table(s)`
      case 'read':
        return `get ${event.trace.key} → ${event.trace.found ?? 'not found'}`
      case 'config':
        return 'config changed'
    }
  },
}

/** Write amplification: bytes on disk per byte the user asked to store. */
export function writeAmplification(stats: LsmStats): number {
  if (stats.userBytes === 0) return 0
  return stats.diskBytes / stats.userBytes
}
