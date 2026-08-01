import { EventQueue } from './queue'
import { createRng, type Rng } from './rng'
import type { Frame, Model, SimContext } from './types'

export interface SimulationOptions {
  seed?: string | number
}

/**
 * Runs a model forward and records every state it passes through.
 *
 * Scrubbing is deliberately not a feature here — it is a consequence. Because
 * every state is retained in `frames`, moving backward in time is an array
 * index rather than an undo operation, and no model ever has to know how to
 * run in reverse.
 *
 * The simulation only ever moves forward. A cursor over `frames` is view
 * state, and belongs to the UI.
 */
export class Simulation<S, E, C> {
  readonly seed: string | number

  private readonly model: Model<S, E, C>
  private readonly queue = new EventQueue<E>()
  private rng: Rng
  private history: Frame<S, E>[] = []
  private clock = 0

  constructor(model: Model<S, E, C>, options: SimulationOptions = {}) {
    this.model = model
    this.seed = options.seed ?? 'default'
    this.rng = createRng(this.seed)
    this.history = [this.initialFrame()]
  }

  /** Every state the simulation has passed through, oldest first. */
  get frames(): readonly Frame<S, E>[] {
    return this.history
  }

  /** Current virtual time. */
  get now(): number {
    return this.clock
  }

  get currentState(): S {
    return (this.history[this.history.length - 1] as Frame<S, E>).state
  }

  /** Virtual time of the next pending event, or undefined when nothing is queued. */
  get nextEventTime(): number | undefined {
    return this.queue.peekTime()
  }

  /** True when no future work is scheduled, so advancing the clock changes nothing. */
  get isIdle(): boolean {
    return this.queue.isEmpty
  }

  /** Feed the model a user command from the sandbox. */
  dispatch(command: C): void {
    const pending: E[] = []
    this.model.onCommand(this.currentState, command, this.context(pending))
    this.drain(pending)
  }

  /**
   * Run every event scheduled at or before `time`, then leave the clock there.
   *
   * The clock advances even when nothing was queued, so an idle simulation
   * still tracks wall time during playback.
   */
  advanceTo(time: number): void {
    const pending: E[] = []
    for (;;) {
      const next = this.queue.peekTime()
      if (next === undefined || next > time) break
      const scheduled = this.queue.pop()
      if (scheduled === undefined) break
      this.apply(scheduled.event, scheduled.time, pending)
      this.drain(pending)
    }
    if (time > this.clock) this.clock = time
  }

  /** Discard all history and start over from the same seed. */
  reset(): void {
    this.queue.clear()
    this.rng = createRng(this.seed)
    this.clock = 0
    this.history = [this.initialFrame()]
  }

  private initialFrame(): Frame<S, E> {
    return {
      index: 0,
      time: 0,
      event: null,
      state: this.model.initialState(),
      label: 'initial state',
    }
  }

  /**
   * Apply queued immediate events until none remain.
   *
   * Events emitted while draining are appended to the same list rather than
   * recursed into, so a model that emits in a chain cannot blow the stack.
   */
  private drain(pending: E[]): void {
    while (pending.length > 0) {
      const event = pending.shift() as E
      this.apply(event, this.clock, pending)
    }
  }

  private apply(event: E, time: number, pending: E[]): void {
    this.clock = time
    const state = this.model.reduce(this.currentState, event)
    this.history.push({
      index: this.history.length,
      time,
      event,
      state,
      label: this.model.describe?.(event) ?? '',
    })
    this.model.onEvent?.(state, event, this.context(pending))
  }

  private context(pending: E[]): SimContext<E> {
    const context = {
      random: () => this.rng.next(),
      randomInt: (min: number, max: number) => this.rng.int(min, max),
      emit: (event: E) => {
        pending.push(event)
      },
      // A negative delay would let a model schedule into the past, which would
      // break the queue's ordering guarantee. Clamp it to "immediately".
      schedule: (delay: number, event: E) => {
        this.queue.push(this.clock + Math.max(0, delay), event)
      },
    }
    // `now` reads live rather than snapshotting, since a context outlives at
    // least one event application while immediate events drain.
    Object.defineProperty(context, 'now', { get: () => this.clock, enumerable: true })
    return context as SimContext<E>
  }
}
