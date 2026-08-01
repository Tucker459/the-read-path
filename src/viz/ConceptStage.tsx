import { useEffect, type ReactNode } from 'react'
import type { Model } from '../sim'
import { Scrubber } from './Scrubber'
import { Transport } from './Transport'
import { useSimulation, type SimulationController } from './useSimulation'

interface ConceptStageProps<S, E, C> {
  model: Model<S, E, C>
  seed?: string
  framesPerSecond?: number
  /** Commands dispatched once on mount, to give the model something to do. */
  init?: readonly C[]
  /** Sandbox controls — the buttons and inputs that drive the model. */
  controls?: (controller: SimulationController<S, E, C>) => ReactNode
  /** The visualization itself. */
  children: (controller: SimulationController<S, E, C>) => ReactNode
}

/**
 * Wires any model to the shared transport, scrubber, and layout.
 *
 * Concepts supply a model and a way to draw a state; everything about running,
 * pausing, stepping, and seeking is handled once, here.
 */
export function ConceptStage<S, E, C>({
  model,
  seed = 'default',
  framesPerSecond,
  init,
  controls,
  children,
}: ConceptStageProps<S, E, C>) {
  const controller = useSimulation(model, { seed, ...(framesPerSecond ? { framesPerSecond } : {}) })
  const { dispatch, reset, frames } = controller

  useEffect(() => {
    if (!init || init.length === 0) return
    // Only seed a fresh run, so a reset does not stack a second set of timers.
    if (frames.length > 1) return
    for (const command of init) dispatch(command)
  }, [init, dispatch, frames.length])

  return (
    <div className="stage">
      <div className="stage-canvas">{children(controller)}</div>

      <div className="stage-timeline">
        <Transport controller={controller} />
        <Scrubber controller={controller} />
      </div>

      {controls ? <div className="stage-controls">{controls(controller)}</div> : null}

      <div className="stage-meta">
        <span>seed: {seed}</span>
        <span>events: {frames.length - 1}</span>
        <button type="button" className="link" onClick={reset}>
          reset
        </button>
      </div>
    </div>
  )
}
