import type { SimulationController } from './useSimulation'

const SPEEDS = [0.5, 1, 2, 4]

interface TransportProps<S, E, C> {
  controller: SimulationController<S, E, C>
}

/** Play, pause, step, and speed — the controls that make a run inspectable. */
export function Transport<S, E, C>({ controller }: TransportProps<S, E, C>) {
  const { isPlaying, togglePlay, stepBack, stepForward, toEnd, reset, cursor, frames, isIdle, speed, setSpeed } =
    controller

  const atStart = cursor === 0
  const nothingLeft = cursor >= frames.length - 1 && isIdle

  return (
    <div className="transport">
      <div className="transport-buttons">
        <button type="button" onClick={reset} disabled={frames.length === 1} title="Reset to the beginning">
          ⏮
        </button>
        <button type="button" onClick={stepBack} disabled={atStart} title="Step back one event">
          ◀
        </button>
        <button
          type="button"
          className="primary"
          onClick={togglePlay}
          disabled={nothingLeft}
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? '❚❚' : '▶'}
        </button>
        <button type="button" onClick={stepForward} disabled={nothingLeft} title="Step forward one event">
          ▶❙
        </button>
        <button type="button" onClick={toEnd} disabled={isIdle} title="Run until nothing is pending">
          ⏭
        </button>
      </div>

      <div className="transport-speed">
        {SPEEDS.map((option) => (
          <button
            key={option}
            type="button"
            className={option === speed ? 'speed active' : 'speed'}
            onClick={() => setSpeed(option)}
          >
            {option}×
          </button>
        ))}
      </div>
    </div>
  )
}
