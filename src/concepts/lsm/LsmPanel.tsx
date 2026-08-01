import { useState } from 'react'
import { ConceptStage } from '../../viz/ConceptStage'
import type { SimulationController } from '../../viz/useSimulation'
import {
  DEFAULT_CONFIG,
  levelCapacity,
  lsmModel,
  maxKey,
  minKey,
  writeAmplification,
  type LsmCommand,
  type LsmEvent,
  type LsmState,
  type ReadOutcome,
  type SSTable,
} from './model'

type LsmController = SimulationController<LsmState, LsmEvent, LsmCommand>

const OUTCOME_LABEL: Record<ReadOutcome, string> = {
  hit: 'found',
  tombstone: 'tombstone',
  miss: 'not here',
  'bloom-skip': 'bloom said no',
  'range-skip': 'out of range',
}

function Table({ table, compacting, touched }: { table: SSTable; compacting: boolean; touched?: ReadOutcome }) {
  const classes = ['sst']
  if (compacting) classes.push('compacting')
  if (touched) classes.push(`touched-${touched}`)

  return (
    <div className={classes.join(' ')} title={`${table.entries.length} entries · ${table.bytes} bytes`}>
      <span className="sst-id">#{table.id}</span>
      <span className="sst-range">
        {minKey(table)}–{maxKey(table)}
      </span>
      <span className="sst-count">{table.entries.length}</span>
    </div>
  )
}

function LsmCanvas({ state }: { state: LsmState }) {
  const compacting = new Set(state.compacting)
  const touched = new Map<number, ReadOutcome>()
  for (const step of state.lastRead?.steps ?? []) {
    if (step.tableId !== undefined) touched.set(step.tableId, step.outcome)
  }

  const memtableFill = Math.min(1, state.memtable.length / state.config.memtableLimit)

  return (
    <div className="lsm">
      <section className="lsm-mem">
        <header>
          <h3>Memtable</h3>
          <span className="mono dim">
            {state.memtable.length} / {state.config.memtableLimit}
          </span>
        </header>
        <div className="fill-bar">
          <div className="fill" style={{ width: `${memtableFill * 100}%` }} />
        </div>
        <ul className="keys">
          {state.memtable.map((entry) => (
            <li key={entry.key} className={entry.value === null ? 'key tombstone' : 'key'}>
              {entry.key}
              {entry.value === null ? ' ✕' : ''}
            </li>
          ))}
          {state.memtable.length === 0 ? <li className="dim mono">empty</li> : null}
        </ul>
      </section>

      {state.sealed.length > 0 ? (
        <section className="lsm-sealed">
          <header>
            <h3>Sealed, waiting to flush</h3>
            <span className="tag warn">{state.sealed.length} queued</span>
          </header>
          <div className="sealed-row">
            {state.sealed.map((entries, index) => (
              <div key={index} className="sealed-box">
                {entries.length} entries
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="lsm-levels">
        {state.levels.slice(0, state.config.maxLevel + 1).map((tables, level) => (
          <div key={level} className="level">
            <div className="level-label">
              <span className="mono">L{level}</span>
              <span className="dim mono">
                {tables.length}/{levelCapacity(state.config, level)}
              </span>
            </div>
            <div className="level-tables">
              {tables.length === 0 ? (
                <span className="dim mono empty-level">—</span>
              ) : (
                tables.map((table) => (
                  <Table
                    key={table.id}
                    table={table}
                    compacting={compacting.has(table.id)}
                    {...(touched.has(table.id) ? { touched: touched.get(table.id) as ReadOutcome } : {})}
                  />
                ))
              )}
            </div>
          </div>
        ))}
      </section>

      {state.lastRead ? (
        <section className="read-trace">
          <header>
            <h3>
              Last read: <code>{state.lastRead.key}</code>
            </h3>
            <span className={state.lastRead.found === null ? 'tag warn' : 'tag good'}>
              {state.lastRead.found === null ? 'not found' : state.lastRead.found}
            </span>
          </header>
          <ol className="steps">
            {state.lastRead.steps.map((step, index) => (
              <li key={index} className={`step ${step.outcome}`}>
                <span className="step-where">{step.where}</span>
                <span className="step-outcome">{OUTCOME_LABEL[step.outcome]}</span>
              </li>
            ))}
          </ol>
          <p className="dim mono trace-summary">
            {state.lastRead.tablesRead} table(s) opened · {state.lastRead.bloomSkips} skipped by bloom filter
          </p>
        </section>
      ) : null}

      <dl className="lsm-stats">
        <div>
          <dt>write amplification</dt>
          <dd className={writeAmplification(state.stats) > 3 ? 'bad' : undefined}>
            {writeAmplification(state.stats).toFixed(2)}×
          </dd>
        </div>
        <div>
          <dt>flushes</dt>
          <dd>{state.stats.flushes}</dd>
        </div>
        <div>
          <dt>compactions</dt>
          <dd>{state.stats.compactions}</dd>
        </div>
        <div>
          <dt>tables / read</dt>
          <dd>{state.stats.reads === 0 ? '—' : (state.stats.tablesRead / state.stats.reads).toFixed(1)}</dd>
        </div>
      </dl>
    </div>
  )
}

function LsmControls({ controller }: { controller: LsmController }) {
  // A key the seeded demo workload actually writes, so the first `get` shows a
  // full descent ending in a hit rather than being pruned away by range checks.
  const [key, setKey] = useState('k23')
  const [value, setValue] = useState('hello')
  const config = controller.frame.state.config

  return (
    <div className="controls">
      <div className="control-group">
        <label>
          key
          <input value={key} onChange={(event) => setKey(event.target.value)} spellCheck={false} />
        </label>
        <label>
          value
          <input value={value} onChange={(event) => setValue(event.target.value)} spellCheck={false} />
        </label>
        <button type="button" className="primary" onClick={() => controller.dispatch({ kind: 'put', key, value })}>
          put
        </button>
        <button type="button" onClick={() => controller.dispatch({ kind: 'get', key })}>
          get
        </button>
        <button type="button" className="danger" onClick={() => controller.dispatch({ kind: 'delete', key })}>
          delete
        </button>
      </div>

      <div className="control-group">
        <button type="button" onClick={() => controller.dispatch({ kind: 'putMany', count: 40 })}>
          write 40 keys
        </button>
      </div>

      <div className="control-group">
        <label>
          memtable limit — {config.memtableLimit}
          <input
            type="range"
            min={2}
            max={14}
            value={config.memtableLimit}
            onChange={(event) =>
              controller.dispatch({ kind: 'setConfig', patch: { memtableLimit: Number(event.target.value) } })
            }
          />
        </label>
        <label>
          L0 trigger — {config.l0Trigger}
          <input
            type="range"
            min={2}
            max={8}
            value={config.l0Trigger}
            onChange={(event) =>
              controller.dispatch({ kind: 'setConfig', patch: { l0Trigger: Number(event.target.value) } })
            }
          />
        </label>
      </div>
    </div>
  )
}

const INIT: LsmCommand[] = [{ kind: 'putMany', count: 40 }]

export function LsmPanel() {
  return (
    <ConceptStage
      model={lsmModel}
      seed="lsm-demo"
      framesPerSecond={4}
      init={INIT}
      controls={(controller) => <LsmControls controller={controller} />}
    >
      {(controller) => <LsmCanvas state={controller.frame.state} />}
    </ConceptStage>
  )
}

export { DEFAULT_CONFIG }
