import type { SimulationController } from './useSimulation'

interface ScrubberProps<S, E, C> {
  controller: SimulationController<S, E, C>
}

/**
 * The timeline. Every recorded event is a position on it, so moving backward
 * is a seek rather than an undo.
 */
export function Scrubber<S, E, C>({ controller }: ScrubberProps<S, E, C>) {
  const { frames, cursor, seek, frame } = controller
  const lastIndex = Math.max(0, frames.length - 1)

  return (
    <div className="scrubber">
      <input
        type="range"
        min={0}
        max={lastIndex}
        value={cursor}
        onChange={(event) => seek(Number(event.target.value))}
        disabled={lastIndex === 0}
        aria-label="Timeline position"
      />
      <div className="scrubber-readout">
        <span className="scrubber-position">
          {cursor} / {lastIndex}
        </span>
        <span className="scrubber-label">{frame.label || 'initial state'}</span>
        <span className="scrubber-time">t={frame.time}</span>
      </div>
    </div>
  )
}
