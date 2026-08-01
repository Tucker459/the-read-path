import type { Model } from '../../sim'

export interface WalRecord {
  lsn: number
  key: string
  value: string
}

export interface WalState {
  nextLsn: number
  /** Written, but only to memory. A crash here loses everything. */
  buffer: WalRecord[]
  /** Flushed to disk. Survives a crash. */
  durable: WalRecord[]
  fsyncs: number
  /** Records moved by the most recent fsync — zero means a wasted syscall. */
  lastFlushed: number
  crashes: number
  lastCrashLost: number
}

export type WalEvent =
  | { kind: 'append'; record: WalRecord }
  | { kind: 'fsync' }
  | { kind: 'crash' }

export type WalCommand =
  | { kind: 'put'; key: string; value: string }
  | { kind: 'fsyncNow' }
  | { kind: 'crash' }

/** How long the background flush waits before firing, in ticks. */
const FSYNC_DELAY = { min: 30, max: 70 }

/**
 * A write-ahead log: the smallest honest example of the durability trade-off
 * that runs through every storage engine on the roadmap.
 *
 * An append is fast because it only touches memory, and worthless on its own
 * because memory does not survive a crash. The fsync is what makes it real,
 * and it is slow. Everything else — group commit, the LSM's memtable, a
 * replica's acknowledgement — is a variation on deciding how long to wait.
 */
export const walModel: Model<WalState, WalEvent, WalCommand> = {
  initialState: () => ({
    nextLsn: 1,
    buffer: [],
    durable: [],
    fsyncs: 0,
    lastFlushed: 0,
    crashes: 0,
    lastCrashLost: 0,
  }),

  reduce(state, event) {
    switch (event.kind) {
      case 'append':
        return {
          ...state,
          nextLsn: state.nextLsn + 1,
          buffer: [...state.buffer, event.record],
        }

      case 'fsync':
        return {
          ...state,
          durable: [...state.durable, ...state.buffer],
          buffer: [],
          fsyncs: state.fsyncs + 1,
          lastFlushed: state.buffer.length,
        }

      case 'crash':
        return {
          ...state,
          buffer: [],
          crashes: state.crashes + 1,
          lastCrashLost: state.buffer.length,
        }
    }
  },

  onCommand(state, command, ctx) {
    switch (command.kind) {
      case 'put':
        ctx.emit({
          kind: 'append',
          record: { lsn: state.nextLsn, key: command.key, value: command.value },
        })
        break
      case 'fsyncNow':
        ctx.emit({ kind: 'fsync' })
        break
      case 'crash':
        ctx.emit({ kind: 'crash' })
        break
    }
  },

  onEvent(state, event, ctx) {
    // The append that made the buffer non-empty starts the flush timer, so
    // writes that arrive together get one fsync between them rather than one
    // each. That is group commit, in three lines.
    if (event.kind === 'append' && state.buffer.length === 1) {
      ctx.schedule(ctx.randomInt(FSYNC_DELAY.min, FSYNC_DELAY.max), { kind: 'fsync' })
    }
  },

  describe(event) {
    switch (event.kind) {
      case 'append':
        return `append lsn ${event.record.lsn} · ${event.record.key}`
      case 'fsync':
        return 'fsync'
      case 'crash':
        return 'crash'
    }
  },
}
