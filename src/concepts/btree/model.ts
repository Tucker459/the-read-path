import type { Model } from '../../sim'
import {
  emptyTree,
  isOverfull,
  isUnderfull,
  leafValue,
  nextChild,
  page,
  rebalancePath,
  removeFromLeaf,
  splitPath,
  writeToLeaf,
  type PageId,
  type Tree,
} from './tree'

export type OpKind = 'insert' | 'delete' | 'search'

export interface ActiveOp {
  kind: OpKind
  key: string
  value?: string
  /** Root-to-current page trail. Splits and merges walk back up it. */
  path: PageId[]
}

export interface SearchTrace {
  key: string
  path: PageId[]
  found: string | null
}

export interface BTreeStats {
  inserts: number
  deletes: number
  searches: number
  /** Pages fetched. In a real engine, the thing that costs you. */
  pageReads: number
  /** Pages written back. */
  pageWrites: number
  splits: number
  merges: number
  borrows: number
}

export type HighlightKind = 'read' | 'write' | 'split' | 'merge' | 'borrow'

export interface BTreeState {
  tree: Tree
  maxKeys: number
  op: ActiveOp | null
  stats: BTreeStats
  lastSearch: SearchTrace | null
  highlight: { pages: PageId[]; kind: HighlightKind } | null
}

export type BTreeEvent =
  | { kind: 'opBegin'; op: OpKind; key: string; value?: string }
  | { kind: 'descend' }
  | { kind: 'apply' }
  | { kind: 'split' }
  | { kind: 'rebalance' }
  | { kind: 'finish' }
  | { kind: 'setMaxKeys'; maxKeys: number }

export type BTreeCommand =
  | { kind: 'put'; key: string; value: string }
  | { kind: 'get'; key: string }
  | { kind: 'delete'; key: string }
  | { kind: 'putMany'; count: number }
  | { kind: 'setMaxKeys'; maxKeys: number }

export const DEFAULT_MAX_KEYS = 4

const initialStats = (): BTreeStats => ({
  inserts: 0,
  deletes: 0,
  searches: 0,
  pageReads: 0,
  pageWrites: 0,
  splits: 0,
  merges: 0,
  borrows: 0,
})

function tail(path: readonly PageId[]): PageId {
  return path[path.length - 1] as PageId
}

/**
 * Decide the next step of the operation in flight.
 *
 * Every structural step is its own event, so a split that ripples from a leaf
 * to the root is several frames rather than one — which is the only way to
 * actually watch it happen.
 */
function nextStep(state: BTreeState): BTreeEvent | null {
  const op = state.op
  if (op === null) return null
  if (op.path.length === 0) return { kind: 'finish' }

  const current = page(state.tree.pages, tail(op.path))
  if (current.kind === 'internal') return { kind: 'descend' }
  return { kind: 'apply' }
}

export const btreeModel: Model<BTreeState, BTreeEvent, BTreeCommand> = {
  initialState: () => ({
    tree: emptyTree(),
    maxKeys: DEFAULT_MAX_KEYS,
    op: null,
    stats: initialStats(),
    lastSearch: null,
    highlight: null,
  }),

  reduce(state, event) {
    switch (event.kind) {
      case 'opBegin': {
        const op: ActiveOp = {
          kind: event.op,
          key: event.key,
          path: [state.tree.rootId],
          ...(event.value === undefined ? {} : { value: event.value }),
        }
        return {
          ...state,
          op,
          highlight: { pages: [state.tree.rootId], kind: 'read' },
          stats: { ...state.stats, pageReads: state.stats.pageReads + 1 },
        }
      }

      case 'descend': {
        const op = state.op
        if (op === null) return state
        const child = nextChild(state.tree.pages, tail(op.path), op.key)
        return {
          ...state,
          op: { ...op, path: [...op.path, child] },
          highlight: { pages: [child], kind: 'read' },
          stats: { ...state.stats, pageReads: state.stats.pageReads + 1 },
        }
      }

      case 'apply': {
        const op = state.op
        if (op === null) return state
        const leafId = tail(op.path)

        if (op.kind === 'search') {
          const leaf = page(state.tree.pages, leafId)
          const found = leaf.kind === 'leaf' ? leafValue(leaf, op.key) : null
          return {
            ...state,
            lastSearch: { key: op.key, path: [...op.path], found },
            highlight: { pages: [leafId], kind: 'read' },
            stats: { ...state.stats, searches: state.stats.searches + 1 },
          }
        }

        const pages =
          op.kind === 'insert'
            ? writeToLeaf(state.tree.pages, leafId, op.key, op.value ?? '')
            : removeFromLeaf(state.tree.pages, leafId, op.key)

        return {
          ...state,
          tree: { ...state.tree, pages },
          highlight: { pages: [leafId], kind: 'write' },
          stats: {
            ...state.stats,
            pageWrites: state.stats.pageWrites + 1,
            inserts: state.stats.inserts + (op.kind === 'insert' ? 1 : 0),
            deletes: state.stats.deletes + (op.kind === 'delete' ? 1 : 0),
          },
        }
      }

      case 'split': {
        const op = state.op
        if (op === null) return state
        const result = splitPath(state.tree, op.path, state.maxKeys)
        return {
          ...state,
          tree: { pages: result.pages, rootId: result.rootId, nextPageId: result.nextPageId, height: result.height },
          // Step back up: the parent is where any further overflow now lives.
          op: { ...op, path: op.path.slice(0, -1) },
          highlight: { pages: result.written, kind: 'split' },
          stats: {
            ...state.stats,
            splits: state.stats.splits + 1,
            pageWrites: state.stats.pageWrites + result.written.length,
          },
        }
      }

      case 'rebalance': {
        const op = state.op
        if (op === null) return state
        const result = rebalancePath(state.tree, op.path, state.maxKeys)
        const borrowed = result.kind === 'borrow-left' || result.kind === 'borrow-right'
        const merged = result.kind === 'merge-left' || result.kind === 'merge-right'
        return {
          ...state,
          tree: { pages: result.pages, rootId: result.rootId, nextPageId: result.nextPageId, height: result.height },
          op: { ...op, path: op.path.slice(0, -1) },
          highlight: { pages: result.written, kind: borrowed ? 'borrow' : 'merge' },
          stats: {
            ...state.stats,
            merges: state.stats.merges + (merged ? 1 : 0),
            borrows: state.stats.borrows + (borrowed ? 1 : 0),
            pageWrites: state.stats.pageWrites + result.written.length,
          },
        }
      }

      case 'finish':
        return { ...state, op: null }

      case 'setMaxKeys':
        return { ...state, maxKeys: event.maxKeys }
    }
  },

  onCommand(_state, command, ctx) {
    switch (command.kind) {
      case 'put':
        ctx.emit({ kind: 'opBegin', op: 'insert', key: command.key, value: command.value })
        break
      case 'get':
        ctx.emit({ kind: 'opBegin', op: 'search', key: command.key })
        break
      case 'delete':
        ctx.emit({ kind: 'opBegin', op: 'delete', key: command.key })
        break
      case 'putMany':
        // Spread across time so each operation runs to completion before the
        // next begins. Emitting them together would interleave their descents,
        // since an emitted event queues behind everything already pending.
        for (let i = 0; i < command.count; i++) {
          const key = `k${String(ctx.randomInt(0, 60)).padStart(2, '0')}`
          ctx.schedule(i * 10 + 1, { kind: 'opBegin', op: 'insert', key, value: `v${i}` })
        }
        break
      case 'setMaxKeys':
        ctx.emit({ kind: 'setMaxKeys', maxKeys: command.maxKeys })
        break
    }
  },

  onEvent(state, event, ctx) {
    const op = state.op
    if (op === null) return

    switch (event.kind) {
      case 'opBegin':
      case 'descend': {
        const step = nextStep(state)
        if (step !== null) ctx.emit(step)
        break
      }

      case 'apply': {
        if (op.kind === 'search') {
          ctx.emit({ kind: 'finish' })
          break
        }
        const leaf = page(state.tree.pages, tail(op.path))
        if (isOverfull(leaf, state.maxKeys)) ctx.emit({ kind: 'split' })
        else if (op.path.length > 1 && isUnderfull(leaf, state.maxKeys)) ctx.emit({ kind: 'rebalance' })
        else ctx.emit({ kind: 'finish' })
        break
      }

      case 'split': {
        // The path was popped, so this looks at the parent that just absorbed
        // a separator. Overflow propagates upward one level at a time.
        if (op.path.length === 0) {
          ctx.emit({ kind: 'finish' })
          break
        }
        const parent = page(state.tree.pages, tail(op.path))
        if (isOverfull(parent, state.maxKeys)) ctx.emit({ kind: 'split' })
        else ctx.emit({ kind: 'finish' })
        break
      }

      case 'rebalance': {
        if (op.path.length === 0) {
          ctx.emit({ kind: 'finish' })
          break
        }
        const parent = page(state.tree.pages, tail(op.path))
        // A merge removed a separator from the parent, which may have left it
        // underfull in turn — the mirror image of a split rippling up.
        const rootEmptied = op.path.length === 1 && parent.kind === 'internal' && parent.keys.length === 0
        const parentUnderfull = op.path.length > 1 && isUnderfull(parent, state.maxKeys)
        if (rootEmptied || parentUnderfull) ctx.emit({ kind: 'rebalance' })
        else ctx.emit({ kind: 'finish' })
        break
      }

      case 'finish':
      case 'setMaxKeys':
        break
    }
  },

  describe(event) {
    switch (event.kind) {
      case 'opBegin':
        return `${event.op} ${event.key} — read root`
      case 'descend':
        return 'follow separator to child'
      case 'apply':
        return 'write leaf'
      case 'split':
        return 'split — promote separator'
      case 'rebalance':
        return 'rebalance — borrow or merge'
      case 'finish':
        return 'done'
      case 'setMaxKeys':
        return `page capacity → ${event.maxKeys} keys`
    }
  },
}
