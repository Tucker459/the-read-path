import type { Model } from '../../sim'
import { DEFAULT_RUM_CONFIG, runExperiment, type RumConfig, type RumSample } from './harness'

export interface RumState {
  config: RumConfig
  /** Samples revealed so far, oldest first. */
  lsm: RumSample[]
  btree: RumSample[]
  liveKeys: number
}

export type RumEvent =
  | { kind: 'sample'; lsm: RumSample; btree: RumSample; liveKeys: number }
  | { kind: 'config'; patch: Partial<RumConfig> }
  | { kind: 'reset' }

export type RumCommand = { kind: 'run' } | { kind: 'setConfig'; patch: Partial<RumConfig> }

/**
 * A recorder rather than a simulator.
 *
 * The experiment runs both engines to completion when the command is
 * dispatched, and the samples are then emitted one at a time. That keeps
 * `reduce` trivially pure while still giving the timeline something real to
 * scrub: each frame is the state of the comparison after a slice of the
 * workload, so you can watch the three costs diverge as load accumulates
 * rather than only seeing where they ended up.
 */
export const rumModel: Model<RumState, RumEvent, RumCommand> = {
  initialState: () => ({ config: DEFAULT_RUM_CONFIG, lsm: [], btree: [], liveKeys: 0 }),

  reduce(state, event) {
    switch (event.kind) {
      case 'sample':
        return {
          ...state,
          lsm: [...state.lsm, event.lsm],
          btree: [...state.btree, event.btree],
          liveKeys: event.liveKeys,
        }
      case 'config':
        return { ...state, config: { ...state.config, ...event.patch }, lsm: [], btree: [], liveKeys: 0 }
      case 'reset':
        return { ...state, lsm: [], btree: [], liveKeys: 0 }
    }
  },

  onCommand(state, command, ctx) {
    switch (command.kind) {
      case 'run': {
        const result = runExperiment(state.config, {
          next: () => ctx.random(),
          int: (min, max) => ctx.randomInt(min, max),
          float: (min, max) => min + ctx.random() * (max - min),
          chance: (probability) => ctx.random() < probability,
          pick: (items) => items[Math.floor(ctx.random() * items.length)] as never,
        })
        ctx.emit({ kind: 'reset' })
        result.lsm.forEach((lsm, index) => {
          const btree = result.btree[index]
          if (btree === undefined) return
          ctx.emit({ kind: 'sample', lsm, btree, liveKeys: result.liveKeys })
        })
        break
      }
      case 'setConfig':
        ctx.emit({ kind: 'config', patch: command.patch })
        break
    }
  },

  describe(event) {
    switch (event.kind) {
      case 'sample':
        return `after ${event.lsm.op} operations`
      case 'config':
        return 'workload changed'
      case 'reset':
        return 'cleared'
    }
  },
}
