import { useState } from 'react'
import { ConceptStage } from '../../viz/ConceptStage'
import type { SimulationController } from '../../viz/useSimulation'
import { walModel, type WalCommand, type WalEvent, type WalRecord, type WalState } from './model'

type WalController = SimulationController<WalState, WalEvent, WalCommand>

const SAMPLE_KEYS = ['user:1042', 'order:88', 'cart:7', 'session:a91', 'doc:314', 'user:2001']

function RecordChip({ record, tone }: { record: WalRecord; tone: 'volatile' | 'durable' }) {
  return (
    <li className={`record ${tone}`}>
      <span className="record-lsn">{record.lsn}</span>
      <span className="record-key">{record.key}</span>
      <span className="record-value">{record.value}</span>
    </li>
  )
}

function WalCanvas({ state }: { state: WalState }) {
  return (
    <div className="wal">
      <section className="wal-region volatile">
        <header>
          <h3>Memory buffer</h3>
          <span className="tag warn">volatile</span>
        </header>
        {state.buffer.length === 0 ? (
          <p className="empty">empty — nothing at risk</p>
        ) : (
          <ul className="records">
            {state.buffer.map((record) => (
              <RecordChip key={record.lsn} record={record} tone="volatile" />
            ))}
          </ul>
        )}
        <footer>{state.buffer.length} record(s) would be lost by a crash right now</footer>
      </section>

      <div className="wal-arrow" aria-hidden="true">
        <span>fsync</span>
        <span className="arrow">↓</span>
      </div>

      <section className="wal-region durable">
        <header>
          <h3>Durable log</h3>
          <span className="tag good">on disk</span>
        </header>
        {state.durable.length === 0 ? (
          <p className="empty">nothing has been flushed yet</p>
        ) : (
          <ul className="records">
            {state.durable.map((record) => (
              <RecordChip key={record.lsn} record={record} tone="durable" />
            ))}
          </ul>
        )}
        <footer>{state.durable.length} record(s) would survive a crash</footer>
      </section>

      <dl className="wal-stats">
        <div>
          <dt>fsyncs</dt>
          <dd>{state.fsyncs}</dd>
        </div>
        <div>
          <dt>last flush</dt>
          <dd>{state.lastFlushed} rec</dd>
        </div>
        <div>
          <dt>crashes</dt>
          <dd>{state.crashes}</dd>
        </div>
        <div>
          <dt>lost to crash</dt>
          <dd className={state.lastCrashLost > 0 ? 'bad' : undefined}>{state.lastCrashLost} rec</dd>
        </div>
      </dl>
    </div>
  )
}

function WalControls({ controller }: { controller: WalController }) {
  const [key, setKey] = useState('user:1042')
  const [value, setValue] = useState('alice')

  const put = () => controller.dispatch({ kind: 'put', key, value })

  const putRandom = () => {
    const nextKey = SAMPLE_KEYS[Math.floor(Math.random() * SAMPLE_KEYS.length)] as string
    setKey(nextKey)
    controller.dispatch({ kind: 'put', key: nextKey, value })
  }

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
        <button type="button" className="primary" onClick={put}>
          append
        </button>
        <button type="button" onClick={putRandom}>
          append random
        </button>
      </div>

      <div className="control-group">
        <button type="button" onClick={() => controller.dispatch({ kind: 'fsyncNow' })}>
          fsync now
        </button>
        <button type="button" className="danger" onClick={() => controller.dispatch({ kind: 'crash' })}>
          crash
        </button>
      </div>
    </div>
  )
}

export function WalPanel() {
  return (
    <ConceptStage
      model={walModel}
      seed="wal-demo"
      framesPerSecond={3}
      controls={(controller) => <WalControls controller={controller} />}
    >
      {(controller) => <WalCanvas state={controller.frame.state} />}
    </ConceptStage>
  )
}
