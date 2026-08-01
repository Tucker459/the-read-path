import { describe, expect, it } from 'vitest'
import { Simulation } from './simulation'
import type { Model } from './types'

/**
 * A deliberately awkward test model: it counts, it schedules follow-up work,
 * it chains immediate events, and it draws randomness. Between them those
 * cover every path through the engine.
 */
type CounterState = { value: number; ticks: number }
type CounterEvent =
  | { kind: 'add'; amount: number }
  | { kind: 'tick' }
  | { kind: 'cascade'; remaining: number }
type CounterCommand =
  | { kind: 'add'; amount: number }
  | { kind: 'addLater'; amount: number; delay: number }
  | { kind: 'startTicking' }
  | { kind: 'cascade'; depth: number }
  | { kind: 'addRandom' }

const counterModel: Model<CounterState, CounterEvent, CounterCommand> = {
  initialState: () => ({ value: 0, ticks: 0 }),

  reduce(state, event) {
    switch (event.kind) {
      case 'add':
        return { ...state, value: state.value + event.amount }
      case 'tick':
        return { ...state, ticks: state.ticks + 1 }
      case 'cascade':
        return { ...state, value: state.value + 1 }
    }
  },

  onCommand(_state, command, ctx) {
    switch (command.kind) {
      case 'add':
        ctx.emit({ kind: 'add', amount: command.amount })
        break
      case 'addLater':
        ctx.schedule(command.delay, { kind: 'add', amount: command.amount })
        break
      case 'startTicking':
        ctx.schedule(10, { kind: 'tick' })
        break
      case 'cascade':
        ctx.emit({ kind: 'cascade', remaining: command.depth })
        break
      case 'addRandom':
        ctx.emit({ kind: 'add', amount: ctx.randomInt(1, 100) })
        break
    }
  },

  onEvent(_state, event, ctx) {
    // A repeating timer, the pattern background compaction will use.
    if (event.kind === 'tick') ctx.schedule(10, { kind: 'tick' })
    if (event.kind === 'cascade' && event.remaining > 1) {
      ctx.emit({ kind: 'cascade', remaining: event.remaining - 1 })
    }
  },

  describe: (event) => event.kind,
}

const build = (seed = 'test') => new Simulation(counterModel, { seed })

describe('Simulation', () => {
  it('starts with a single initial frame', () => {
    const sim = build()
    expect(sim.frames).toHaveLength(1)
    expect(sim.frames[0]?.event).toBeNull()
    expect(sim.frames[0]?.state).toEqual({ value: 0, ticks: 0 })
    expect(sim.now).toBe(0)
    expect(sim.isIdle).toBe(true)
  })

  it('records a frame per applied event', () => {
    const sim = build()
    sim.dispatch({ kind: 'add', amount: 5 })
    sim.dispatch({ kind: 'add', amount: 3 })
    expect(sim.frames).toHaveLength(3)
    expect(sim.currentState.value).toBe(8)
  })

  it('keeps every intermediate state addressable', () => {
    const sim = build()
    sim.dispatch({ kind: 'add', amount: 5 })
    sim.dispatch({ kind: 'add', amount: 3 })
    // This is what makes the scrubber work: the past is still there.
    expect(sim.frames.map((frame) => frame.state.value)).toEqual([0, 5, 8])
  })

  it('never mutates a recorded state', () => {
    const sim = build()
    sim.dispatch({ kind: 'add', amount: 1 })
    const snapshot = sim.frames[1]?.state
    sim.dispatch({ kind: 'add', amount: 1 })
    expect(snapshot).toEqual({ value: 1, ticks: 0 })
  })

  it('does not fire scheduled events before their time', () => {
    const sim = build()
    sim.dispatch({ kind: 'addLater', amount: 7, delay: 100 })
    expect(sim.nextEventTime).toBe(100)
    expect(sim.isIdle).toBe(false)

    sim.advanceTo(99)
    expect(sim.currentState.value).toBe(0)
    expect(sim.now).toBe(99)

    sim.advanceTo(100)
    expect(sim.currentState.value).toBe(7)
    expect(sim.isIdle).toBe(true)
  })

  it('applies a scheduled event at its own time, not the requested time', () => {
    const sim = build()
    sim.dispatch({ kind: 'addLater', amount: 1, delay: 50 })
    sim.advanceTo(500)
    expect(sim.frames[1]?.time).toBe(50)
    expect(sim.now).toBe(500)
  })

  it('advances the clock even with nothing queued', () => {
    const sim = build()
    sim.advanceTo(250)
    expect(sim.now).toBe(250)
    expect(sim.frames).toHaveLength(1)
  })

  it('never moves the clock backward', () => {
    const sim = build()
    sim.advanceTo(100)
    sim.advanceTo(50)
    expect(sim.now).toBe(100)
  })

  it('runs a repeating timer at a steady period', () => {
    const sim = build()
    sim.dispatch({ kind: 'startTicking' })
    sim.advanceTo(55)
    expect(sim.currentState.ticks).toBe(5)
    expect(sim.frames.slice(1).map((frame) => frame.time)).toEqual([10, 20, 30, 40, 50])
  })

  it('fires events in time order across separate schedules', () => {
    const sim = build()
    sim.dispatch({ kind: 'addLater', amount: 1, delay: 30 })
    sim.dispatch({ kind: 'addLater', amount: 2, delay: 10 })
    sim.dispatch({ kind: 'addLater', amount: 3, delay: 20 })
    sim.advanceTo(100)
    expect(sim.frames.slice(1).map((frame) => frame.time)).toEqual([10, 20, 30])
  })

  it('drains chained immediate events without recursing', () => {
    const sim = build()
    sim.dispatch({ kind: 'cascade', depth: 5000 })
    expect(sim.currentState.value).toBe(5000)
    expect(sim.now).toBe(0)
  })

  it('labels frames with the model description', () => {
    const sim = build()
    sim.dispatch({ kind: 'add', amount: 1 })
    expect(sim.frames[1]?.label).toBe('add')
  })

  it('replays identically from the same seed and commands', () => {
    const run = () => {
      const sim = build('replay')
      sim.dispatch({ kind: 'addRandom' })
      sim.dispatch({ kind: 'startTicking' })
      sim.advanceTo(35)
      sim.dispatch({ kind: 'addRandom' })
      sim.advanceTo(70)
      return sim.frames.map((frame) => ({ time: frame.time, state: frame.state }))
    }
    expect(run()).toEqual(run())
  })

  it('diverges on a different seed', () => {
    const run = (seed: string) => {
      const sim = build(seed)
      sim.dispatch({ kind: 'addRandom' })
      return sim.currentState.value
    }
    expect(run('one')).not.toBe(run('two'))
  })

  it('reset returns to the seed and reproduces the same run', () => {
    const sim = build('reset')
    sim.dispatch({ kind: 'addRandom' })
    sim.dispatch({ kind: 'startTicking' })
    sim.advanceTo(40)
    const before = sim.frames.map((frame) => frame.state)

    sim.reset()
    expect(sim.frames).toHaveLength(1)
    expect(sim.now).toBe(0)
    expect(sim.isIdle).toBe(true)
    expect(sim.currentState).toEqual({ value: 0, ticks: 0 })

    sim.dispatch({ kind: 'addRandom' })
    sim.dispatch({ kind: 'startTicking' })
    sim.advanceTo(40)
    expect(sim.frames.map((frame) => frame.state)).toEqual(before)
  })

  it('treats a negative delay as immediate rather than as time travel', () => {
    const sim = build()
    sim.advanceTo(100)
    sim.dispatch({ kind: 'addLater', amount: 1, delay: -50 })
    expect(sim.nextEventTime).toBe(100)
    sim.advanceTo(100)
    expect(sim.currentState.value).toBe(1)
  })
})
