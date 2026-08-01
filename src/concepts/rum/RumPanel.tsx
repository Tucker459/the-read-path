import { ConceptStage } from '../../viz/ConceptStage'
import type { SimulationController } from '../../viz/useSimulation'
import { rumModel, type RumCommand, type RumEvent, type RumState } from './model'
import type { RumSample } from './harness'

type RumController = SimulationController<RumState, RumEvent, RumCommand>

/**
 * Two series, validated against the dark chart surface for lightness, chroma,
 * contrast, and colour-vision separation rather than picked by eye. Both stay
 * in the site's amber/teal families so the chart still belongs to the page.
 */
const LSM_COLOR = '#c2751f'
const BTREE_COLOR = '#0f9d92'

type Axis = { key: 'read' | 'update' | 'memory'; label: string; caption: string }

const AXES: Axis[] = [
  { key: 'read', label: 'Read', caption: 'records fetched per record wanted' },
  { key: 'update', label: 'Update', caption: 'records written per record stored' },
  { key: 'memory', label: 'Memory', caption: 'slots occupied per live record' },
]

const last = <T,>(items: T[]): T | undefined => items[items.length - 1]

function GroupedBars({ lsm, btree }: { lsm: RumSample; btree: RumSample }) {
  const rows = AXES.map((axis) => ({ axis, lsm: lsm[axis.key], btree: btree[axis.key] }))
  const max = Math.max(1, ...rows.flatMap((row) => [row.lsm, row.btree]))

  return (
    <div className="rum-bars">
      {rows.map((row) => (
        <div key={row.axis.key} className="rum-row">
          <div className="rum-row-head">
            <span className="rum-axis">{row.axis.label}</span>
            <span className="dim mono rum-caption">{row.axis.caption}</span>
          </div>
          {[
            { id: 'lsm', label: 'LSM-tree', value: row.lsm, color: LSM_COLOR },
            { id: 'btree', label: 'B+tree', value: row.btree, color: BTREE_COLOR },
          ].map((series) => (
            <div key={series.id} className="rum-bar-line">
              <span className="rum-bar-label mono">{series.label}</span>
              <div className="rum-track">
                <div
                  className="rum-bar"
                  style={{ width: `${(series.value / max) * 100}%`, background: series.color }}
                  title={`${series.label} — ${row.axis.label} ${series.value.toFixed(2)}×`}
                />
              </div>
              <span className="rum-value mono">{series.value.toFixed(2)}×</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/**
 * `max` is passed in rather than derived per series: both engines share one
 * scale, or the two lines could not be compared against each other at all.
 */
function Sparkline({ series, max, colour, label }: { series: number[]; max: number; colour: string; label: string }) {
  if (series.length < 2) return null
  const points = series
    .map((value, index) => `${(index / (series.length - 1)) * 100},${30 - (value / max) * 28 - 1}`)
    .join(' ')
  return (
    <polyline points={points} fill="none" stroke={colour} strokeWidth={2} vectorEffect="non-scaling-stroke">
      <title>{label}</title>
    </polyline>
  )
}

function OverTime({ state }: { state: RumState }) {
  if (state.lsm.length < 2) return null

  return (
    <div className="rum-multiples">
      {AXES.map((axis) => {
        const lsmSeries = state.lsm.map((sample) => sample[axis.key])
        const btreeSeries = state.btree.map((sample) => sample[axis.key])
        const peak = Math.max(...lsmSeries, ...btreeSeries, 1)
        return (
          <figure key={axis.key} className="rum-multiple">
            <figcaption>
              {axis.label} <span className="dim mono">peak {peak.toFixed(1)}×</span>
            </figcaption>
            <svg viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label={`${axis.label} over time`}>
              <Sparkline series={lsmSeries} max={peak} colour={LSM_COLOR} label="LSM-tree" />
              <Sparkline series={btreeSeries} max={peak} colour={BTREE_COLOR} label="B+tree" />
            </svg>
          </figure>
        )
      })}
    </div>
  )
}

function RumCanvas({ state }: { state: RumState }) {
  const lsm = last(state.lsm)
  const btree = last(state.btree)

  if (lsm === undefined || btree === undefined) {
    return (
      <div className="rum">
        <p className="empty">Press run to put both engines through the same workload.</p>
      </div>
    )
  }

  return (
    <div className="rum">
      <div className="rum-legend">
        <span className="legend-item">
          <span className="legend-swatch" style={{ background: LSM_COLOR }} /> LSM-tree
        </span>
        <span className="legend-item">
          <span className="legend-swatch" style={{ background: BTREE_COLOR }} /> B+tree
        </span>
        <span className="dim mono rum-progress">
          after {lsm.op} operations · {state.liveKeys} keys live
        </span>
      </div>

      <GroupedBars lsm={lsm} btree={btree} />
      <OverTime state={state} />

      <table className="rum-table">
        <caption className="dim mono">
          Overheads as multiples of the theoretical floor. 1.00× means no waste at all.
        </caption>
        <thead>
          <tr>
            <th scope="col">Engine</th>
            {AXES.map((axis) => (
              <th key={axis.key} scope="col">
                {axis.label}
              </th>
            ))}
            <th scope="col">Seeks / lookup</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">LSM-tree</th>
            {AXES.map((axis) => (
              <td key={axis.key}>{lsm[axis.key].toFixed(2)}×</td>
            ))}
            <td>{lsm.readIos.toFixed(2)}</td>
          </tr>
          <tr>
            <th scope="row">B+tree</th>
            {AXES.map((axis) => (
              <td key={axis.key}>{btree[axis.key].toFixed(2)}×</td>
            ))}
            <td>{btree.readIos.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function RumControls({ controller }: { controller: RumController }) {
  const { config } = controller.frame.state
  const set = (patch: Partial<typeof config>) => controller.dispatch({ kind: 'setConfig', patch })

  return (
    <div className="controls">
      <div className="control-group">
        <button type="button" className="primary" onClick={() => controller.dispatch({ kind: 'run' })}>
          run workload
        </button>
      </div>

      <div className="control-group">
        <label>
          reads — {Math.round(config.readShare * 100)}%
          <input
            type="range"
            min={0}
            max={90}
            step={10}
            value={Math.round(config.readShare * 100)}
            onChange={(event) => set({ readShare: Number(event.target.value) / 100 })}
          />
        </label>
        <label>
          key space — {config.keySpace}
          <input
            type="range"
            min={10}
            max={200}
            step={10}
            value={config.keySpace}
            onChange={(event) => set({ keySpace: Number(event.target.value) })}
          />
        </label>
      </div>

      <div className="control-group">
        <label>
          LSM memtable — {config.memtableLimit}
          <input
            type="range"
            min={2}
            max={16}
            value={config.memtableLimit}
            onChange={(event) => set({ memtableLimit: Number(event.target.value) })}
          />
        </label>
        <label>
          B+tree page — {config.maxKeys}
          <input
            type="range"
            min={2}
            max={10}
            value={config.maxKeys}
            onChange={(event) => set({ maxKeys: Number(event.target.value) })}
          />
        </label>
      </div>
    </div>
  )
}

const INIT: RumCommand[] = [{ kind: 'run' }]

export function RumPanel() {
  return (
    <ConceptStage
      model={rumModel}
      seed="rum-demo"
      framesPerSecond={6}
      init={INIT}
      controls={(controller) => <RumControls controller={controller} />}
    >
      {(controller) => <RumCanvas state={controller.frame.state} />}
    </ConceptStage>
  )
}
