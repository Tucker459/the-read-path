import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Simulation } from '../sim'
import type { Frame, Model } from '../sim'

export interface UseSimulationOptions {
  seed?: string | number
  /** Events shown per second at speed 1. */
  framesPerSecond?: number
}

export interface SimulationController<S, E, C> {
  frames: readonly Frame<S, E>[]
  /** The frame being displayed — not necessarily the newest one. */
  frame: Frame<S, E>
  cursor: number
  /** True when the cursor is on the newest frame. */
  atHead: boolean
  /** True when no further events are pending, so history is complete. */
  isIdle: boolean
  now: number

  seek(index: number): void
  stepForward(): void
  stepBack(): void
  toEnd(): void

  isPlaying: boolean
  play(): void
  pause(): void
  togglePlay(): void

  speed: number
  setSpeed(speed: number): void

  dispatch(command: C): void
  reset(): void
}

/**
 * Drives a Simulation and exposes a cursor over its history.
 *
 * Playback is paced by event rather than by virtual time. Time-paced playback
 * reads better in principle, but events that share a timestamp — an LSM flush
 * and the compaction it triggers, a broadcast to five replicas — would all land
 * on one screen frame and become invisible. Giving every event equal screen
 * time costs faithful relative pacing and buys the ability to actually watch
 * each step, which is the entire point.
 */
export function useSimulation<S, E, C>(
  model: Model<S, E, C>,
  options: UseSimulationOptions = {},
): SimulationController<S, E, C> {
  const { seed = 'default', framesPerSecond = 4 } = options

  const simRef = useRef<Simulation<S, E, C> | null>(null)
  if (simRef.current === null) {
    simRef.current = new Simulation(model, { seed })
  }
  const sim = simRef.current

  const [, forceRender] = useReducer((n: number) => n + 1, 0)
  const [cursor, setCursor] = useState(0)
  const [isPlaying, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)

  const frames = sim.frames
  const lastIndex = frames.length - 1

  // The animation loop reads the cursor outside of React's render cycle, so it
  // needs a ref that is always current rather than a captured state value.
  const cursorRef = useRef(0)
  cursorRef.current = cursor

  /**
   * Show one more event, generating it first if history has run out.
   * Returns false when there is nothing left to show.
   */
  const advanceOneFrame = useCallback((): boolean => {
    if (cursorRef.current >= sim.frames.length - 1) {
      const next = sim.nextEventTime
      if (next === undefined) return false
      sim.advanceTo(next)
    }
    if (cursorRef.current >= sim.frames.length - 1) return false
    cursorRef.current += 1
    setCursor(cursorRef.current)
    forceRender()
    return true
  }, [sim])

  useEffect(() => {
    if (!isPlaying) return
    let raf = 0
    let last = performance.now()
    let debt = 0

    const tick = (time: number) => {
      const elapsed = (time - last) / 1000
      last = time
      debt += elapsed * framesPerSecond * speed

      while (debt >= 1) {
        debt -= 1
        if (!advanceOneFrame()) {
          setPlaying(false)
          return
        }
      }
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [isPlaying, speed, framesPerSecond, advanceOneFrame])

  const seek = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(index, sim.frames.length - 1))
      cursorRef.current = clamped
      setCursor(clamped)
    },
    [sim],
  )

  const dispatch = useCallback(
    (command: C) => {
      // Commands always apply to the newest state. You cannot change the past,
      // so issuing one from a scrubbed-back position jumps forward first.
      sim.dispatch(command)
      cursorRef.current = sim.frames.length - 1
      setCursor(cursorRef.current)
      forceRender()
    },
    [sim],
  )

  const reset = useCallback(() => {
    sim.reset()
    setPlaying(false)
    cursorRef.current = 0
    setCursor(0)
    forceRender()
  }, [sim])

  const toEnd = useCallback(() => {
    // Run the simulation out until nothing is pending, with a ceiling so a
    // model with a self-perpetuating timer cannot hang the tab.
    let guard = 0
    while (!sim.isIdle && guard < 10_000) {
      const next = sim.nextEventTime
      if (next === undefined) break
      sim.advanceTo(next)
      guard += 1
    }
    cursorRef.current = sim.frames.length - 1
    setCursor(cursorRef.current)
    forceRender()
  }, [sim])

  const stepForward = useCallback(() => {
    setPlaying(false)
    advanceOneFrame()
  }, [advanceOneFrame])

  const stepBack = useCallback(() => {
    setPlaying(false)
    seek(cursorRef.current - 1)
  }, [seek])

  const frame = (frames[Math.min(cursor, lastIndex)] ?? frames[0]) as Frame<S, E>

  return useMemo(
    () => ({
      frames,
      frame,
      cursor,
      atHead: cursor >= lastIndex,
      isIdle: sim.isIdle,
      now: frame.time,
      seek,
      stepForward,
      stepBack,
      toEnd,
      isPlaying,
      play: () => setPlaying(true),
      pause: () => setPlaying(false),
      togglePlay: () => setPlaying((playing) => !playing),
      speed,
      setSpeed,
      dispatch,
      reset,
    }),
    [
      frames,
      frame,
      cursor,
      lastIndex,
      sim.isIdle,
      seek,
      stepForward,
      stepBack,
      toEnd,
      isPlaying,
      speed,
      dispatch,
      reset,
    ],
  )
}
