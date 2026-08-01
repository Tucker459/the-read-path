/**
 * What a model may do while reacting to a command or to an event it just
 * applied: read the clock, draw randomness, and cause more events.
 *
 * Note what is missing — there is no way to touch state. State changes happen
 * only in `reduce`, which is what keeps history replayable.
 */
export interface SimContext<E> {
  /** Current virtual time. */
  readonly now: number
  /** Uniform in [0, 1). */
  random(): number
  /** Uniform integer in [min, max). */
  randomInt(min: number, max: number): number
  /** Apply an event immediately, at the current time. */
  emit(event: E): void
  /** Apply an event `delay` ticks from now. */
  schedule(delay: number, event: E): void
}

/**
 * A simulated system: an LSM-tree, a Raft cluster, an HNSW index.
 *
 * The split between `reduce` and the two handlers is the core discipline of
 * this engine. `reduce` is pure and total, so any state is reachable by
 * replaying events from the start. The handlers are where time and randomness
 * live, and they run once, during forward simulation only.
 */
export interface Model<S, E, C> {
  initialState(): S

  /**
   * The only place state changes. Must be pure: no clock, no randomness, no
   * mutation of `state`. Given the same event log, this must always rebuild
   * the same states.
   */
  reduce(state: S, event: E): S

  /** React to a user command by emitting or scheduling events. */
  onCommand(state: S, command: C, ctx: SimContext<E>): void

  /**
   * React to an event that was just applied, typically to schedule follow-up
   * work — a compaction that finishes later, the next tick of a timer.
   */
  onEvent?(state: S, event: E, ctx: SimContext<E>): void

  /** Short human-readable label for the timeline. */
  describe?(event: E): string
}

/** One step of history: the event, and the state it produced. */
export interface Frame<S, E> {
  /** Index into the simulation's frame list. */
  index: number
  /** Virtual time at which the event was applied. */
  time: number
  /** The event that produced this state, or null for the initial frame. */
  event: E | null
  state: S
  label: string
}
