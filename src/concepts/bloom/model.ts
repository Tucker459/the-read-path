import type { Model } from '../../sim'
import {
  bloomAdd,
  bloomGet,
  bloomPositions,
  createBloom,
  emptyBloom,
  type Bloom,
} from '../../lib/bloom'

export type Verdict = 'true-positive' | 'false-positive' | 'negative'

export type BloomAction =
  | { kind: 'insert'; key: string; positions: number[]; wereAlreadySet: boolean[] }
  | { kind: 'query'; key: string; positions: number[]; areSet: boolean[]; verdict: Verdict }

export interface BloomStats {
  inserts: number
  queries: number
  truePositives: number
  falsePositives: number
  negatives: number
}

export interface Measurement {
  trials: number
  falsePositives: number
}

export interface BloomState {
  filter: Bloom
  /**
   * The keys actually inserted.
   *
   * A real Bloom filter stores nothing of the sort — that is the entire point
   * of it. This list exists only so the visualization can tell a false
   * positive from a true one, and so that changing the filter's size can
   * rehash the keys. Treat it as an oracle standing outside the structure, not
   * as part of it.
   */
  inserted: string[]
  lastAction: BloomAction | null
  measurement: Measurement | null
  stats: BloomStats
}

export type BloomEvent =
  | { kind: 'insert'; key: string }
  | { kind: 'query'; key: string }
  | { kind: 'resize'; bits?: number; hashes?: number }
  | { kind: 'measure'; probes: string[] }
  | { kind: 'clear' }

export type BloomCommand =
  | { kind: 'insert'; key: string }
  | { kind: 'query'; key: string }
  | { kind: 'insertMany'; count: number }
  | { kind: 'setBits'; bits: number }
  | { kind: 'setHashes'; hashes: number }
  | { kind: 'measure'; trials: number }
  | { kind: 'clear' }

export const DEFAULT_BITS = 128
export const DEFAULT_HASHES = 3

const initialStats = (): BloomStats => ({
  inserts: 0,
  queries: 0,
  truePositives: 0,
  falsePositives: 0,
  negatives: 0,
})

/** Keys the demo inserts. Shaped like real record ids rather than k00-style. */
export function sampleKey(n: number): string {
  return `user:${String(n).padStart(4, '0')}`
}

export const bloomModel: Model<BloomState, BloomEvent, BloomCommand> = {
  initialState: () => ({
    filter: emptyBloom(DEFAULT_BITS, DEFAULT_HASHES),
    inserted: [],
    lastAction: null,
    measurement: null,
    stats: initialStats(),
  }),

  reduce(state, event) {
    switch (event.kind) {
      case 'insert': {
        const positions = bloomPositions(state.filter, event.key)
        // Captured before the write, so the visualization can show which bits
        // this key actually claimed and which were already spoken for.
        const wereAlreadySet = positions.map((position) => bloomGet(state.filter, position))
        const already = state.inserted.includes(event.key)
        return {
          ...state,
          filter: bloomAdd(state.filter, event.key),
          inserted: already ? state.inserted : [...state.inserted, event.key],
          lastAction: { kind: 'insert', key: event.key, positions, wereAlreadySet },
          // Re-inserting a key changes nothing, which is worth not counting.
          stats: { ...state.stats, inserts: state.stats.inserts + (already ? 0 : 1) },
          measurement: null,
        }
      }

      case 'query': {
        const positions = bloomPositions(state.filter, event.key)
        const areSet = positions.map((position) => bloomGet(state.filter, position))
        const says = areSet.every(Boolean)
        const truly = state.inserted.includes(event.key)
        const verdict: Verdict = !says ? 'negative' : truly ? 'true-positive' : 'false-positive'

        return {
          ...state,
          lastAction: { kind: 'query', key: event.key, positions, areSet, verdict },
          stats: {
            ...state.stats,
            queries: state.stats.queries + 1,
            truePositives: state.stats.truePositives + (verdict === 'true-positive' ? 1 : 0),
            falsePositives: state.stats.falsePositives + (verdict === 'false-positive' ? 1 : 0),
            negatives: state.stats.negatives + (verdict === 'negative' ? 1 : 0),
          },
        }
      }

      case 'resize': {
        // Every bit position depends on m, so changing the size means rehashing
        // every key. A real filter has no key list to rehash from, which is why
        // a Bloom filter cannot be resized in place — you size it up front or
        // you rebuild it from the source data.
        const bits = event.bits ?? state.filter.bits
        const hashes = event.hashes ?? state.filter.hashes
        return {
          ...state,
          filter: createBloom(state.inserted, bits, hashes),
          lastAction: null,
          measurement: null,
        }
      }

      case 'measure': {
        // Probe keys arrive in the event rather than being drawn here, so that
        // replaying the log reproduces the same measurement exactly.
        let falsePositives = 0
        for (const probe of event.probes) {
          const says = bloomPositions(state.filter, probe).every((position) => bloomGet(state.filter, position))
          if (says) falsePositives += 1
        }
        return {
          ...state,
          measurement: { trials: event.probes.length, falsePositives },
        }
      }

      case 'clear':
        return {
          ...state,
          filter: emptyBloom(state.filter.bits, state.filter.hashes),
          inserted: [],
          lastAction: null,
          measurement: null,
          stats: initialStats(),
        }
    }
  },

  onCommand(state, command, ctx) {
    switch (command.kind) {
      case 'insert':
        ctx.emit({ kind: 'insert', key: command.key })
        break

      case 'query':
        ctx.emit({ kind: 'query', key: command.key })
        break

      case 'insertMany':
        for (let i = 0; i < command.count; i++) {
          ctx.emit({ kind: 'insert', key: sampleKey(ctx.randomInt(0, 10_000)) })
        }
        break

      case 'setBits':
        ctx.emit({ kind: 'resize', bits: command.bits })
        break

      case 'setHashes':
        ctx.emit({ kind: 'resize', hashes: command.hashes })
        break

      case 'measure': {
        // Probes must be keys that were definitely never inserted, or a hit
        // would be a true positive and would not belong in the count.
        const absent = new Set(state.inserted)
        const probes: string[] = []
        let guard = 0
        while (probes.length < command.trials && guard < command.trials * 20) {
          const probe = `absent:${ctx.randomInt(0, 1_000_000)}`
          if (!absent.has(probe)) probes.push(probe)
          guard += 1
        }
        ctx.emit({ kind: 'measure', probes })
        break
      }

      case 'clear':
        ctx.emit({ kind: 'clear' })
        break
    }
  },

  describe(event) {
    switch (event.kind) {
      case 'insert':
        return `insert ${event.key}`
      case 'query':
        return `query ${event.key}`
      case 'resize':
        return event.bits !== undefined ? `resize to ${event.bits} bits — rehash all` : `k = ${event.hashes} — rehash all`
      case 'measure':
        return `probe ${event.probes.length} absent keys`
      case 'clear':
        return 'cleared'
    }
  },
}
