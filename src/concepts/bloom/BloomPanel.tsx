import { useState } from 'react'
import { ConceptStage } from '../../viz/ConceptStage'
import type { SimulationController } from '../../viz/useSimulation'
import { bloomFill, bloomGet, expectedFalsePositiveRate, optimalHashes } from '../../lib/bloom'
import {
  bloomModel,
  sampleKey,
  type BloomCommand,
  type BloomEvent,
  type BloomState,
  type Verdict,
} from './model'

type BloomController = SimulationController<BloomState, BloomEvent, BloomCommand>

const VERDICT_LABEL: Record<Verdict, string> = {
  'true-positive': 'probably present — and it really is',
  'false-positive': 'probably present — but it is not there',
  negative: 'definitely absent',
}

const BIT_SIZE_OPTIONS = [32, 64, 128, 256, 512]

function BitGrid({ state }: { state: BloomState }) {
  const action = state.lastAction
  const touched = new Map<number, 'probe-set' | 'probe-unset' | 'claimed' | 'already'>()

  if (action?.kind === 'query') {
    action.positions.forEach((position, index) => {
      touched.set(position, action.areSet[index] ? 'probe-set' : 'probe-unset')
    })
  } else if (action?.kind === 'insert') {
    action.positions.forEach((position, index) => {
      touched.set(position, action.wereAlreadySet[index] ? 'already' : 'claimed')
    })
  }

  return (
    <div className="bit-grid" style={{ gridTemplateColumns: `repeat(32, 1fr)` }}>
      {Array.from({ length: state.filter.bits }, (_, index) => {
        const on = bloomGet(state.filter, index)
        const mark = touched.get(index)
        const classes = ['bit']
        if (on) classes.push('on')
        if (mark) classes.push(mark)
        return <span key={index} className={classes.join(' ')} title={`bit ${index}${on ? ' — set' : ''}`} />
      })}
    </div>
  )
}

function BloomCanvas({ state }: { state: BloomState }) {
  const { filter, inserted, measurement, lastAction } = state
  const n = inserted.length
  const predicted = expectedFalsePositiveRate(filter.bits, filter.hashes, n)
  const measured = measurement === null ? null : measurement.falsePositives / measurement.trials
  const best = optimalHashes(filter.bits, n)

  return (
    <div className="bloom">
      <section>
        <header className="bloom-head">
          <h3>
            {filter.bits} bits · k = {filter.hashes} · {n} key{n === 1 ? '' : 's'}
          </h3>
          <span className="dim mono">{(bloomFill(filter) * 100).toFixed(0)}% set</span>
        </header>
        <BitGrid state={state} />
        <div className="bit-legend">
          <span className="swatch on" /> set
          <span className="swatch claimed" /> claimed by this insert
          <span className="swatch probe-set" /> probed, was set
          <span className="swatch probe-unset" /> probed, was clear
        </div>
      </section>

      {lastAction ? (
        <section className={`bloom-action ${lastAction.kind === 'query' ? lastAction.verdict : 'insert'}`}>
          <header>
            <h3>
              {lastAction.kind === 'insert' ? 'Inserted' : 'Queried'} <code>{lastAction.key}</code>
            </h3>
            {lastAction.kind === 'query' ? (
              <span className={lastAction.verdict === 'false-positive' ? 'tag warn' : 'tag good'}>
                {VERDICT_LABEL[lastAction.verdict]}
              </span>
            ) : null}
          </header>
          <ol className="steps">
            {lastAction.positions.map((position, index) => {
              const state_ =
                lastAction.kind === 'query'
                  ? lastAction.areSet[index]
                    ? 'set'
                    : 'clear'
                  : lastAction.wereAlreadySet[index]
                    ? 'already set'
                    : 'newly set'
              const bad = lastAction.kind === 'query' && !lastAction.areSet[index]
              return (
                <li key={index} className={`step ${bad ? 'tombstone' : 'hit'}`}>
                  <span className="step-where">h{index} → bit {position}</span>
                  <span className="step-outcome">{state_}</span>
                </li>
              )
            })}
          </ol>
          {lastAction.kind === 'query' && lastAction.verdict === 'negative' ? (
            <p className="dim mono trace-summary">
              One clear bit is enough. No key that sets that bit was ever inserted, so this answer is certain.
            </p>
          ) : null}
          {lastAction.kind === 'query' && lastAction.verdict === 'false-positive' ? (
            <p className="dim mono trace-summary">
              Every bit was set — but by other keys. This is the cost: a wasted lookup for a key that was never here.
            </p>
          ) : null}
        </section>
      ) : null}

      <dl className="lsm-stats">
        <div>
          <dt>bits per key</dt>
          <dd>{n === 0 ? '—' : (filter.bits / n).toFixed(1)}</dd>
        </div>
        <div>
          <dt>predicted FP rate</dt>
          <dd>{(predicted * 100).toFixed(1)}%</dd>
        </div>
        <div>
          <dt>measured FP rate</dt>
          <dd className={measured !== null && measured > 0.2 ? 'bad' : undefined}>
            {measured === null ? '—' : `${(measured * 100).toFixed(1)}%`}
          </dd>
        </div>
        <div>
          <dt>best k here</dt>
          <dd className={best !== filter.hashes ? 'bad' : undefined}>{best}</dd>
        </div>
      </dl>
      {measurement !== null ? (
        <p className="dim mono trace-summary">
          {measurement.falsePositives} of {measurement.trials} never-inserted keys came back &ldquo;probably
          present&rdquo;. Formula predicted {(predicted * measurement.trials).toFixed(0)}.
        </p>
      ) : null}
    </div>
  )
}

function BloomControls({ controller }: { controller: BloomController }) {
  const [key, setKey] = useState('user:0007')
  const { filter } = controller.frame.state

  return (
    <div className="controls">
      <div className="control-group">
        <label>
          key
          <input value={key} onChange={(event) => setKey(event.target.value)} spellCheck={false} />
        </label>
        <button type="button" className="primary" onClick={() => controller.dispatch({ kind: 'insert', key })}>
          insert
        </button>
        <button type="button" onClick={() => controller.dispatch({ kind: 'query', key })}>
          query
        </button>
        <button
          type="button"
          onClick={() => controller.dispatch({ kind: 'query', key: sampleKey(Math.floor(Math.random() * 10_000)) })}
        >
          query a random key
        </button>
      </div>

      <div className="control-group">
        <button type="button" onClick={() => controller.dispatch({ kind: 'insertMany', count: 20 })}>
          insert 20 keys
        </button>
        <button type="button" onClick={() => controller.dispatch({ kind: 'measure', trials: 4000 })}>
          measure FP rate
        </button>
        <button type="button" className="danger" onClick={() => controller.dispatch({ kind: 'clear' })}>
          clear
        </button>
      </div>

      <div className="control-group">
        <label>
          bits (m)
          <span className="seg-row">
            {BIT_SIZE_OPTIONS.map((bits) => (
              <button
                key={bits}
                type="button"
                className={bits === filter.bits ? 'speed active' : 'speed'}
                onClick={() => controller.dispatch({ kind: 'setBits', bits })}
              >
                {bits}
              </button>
            ))}
          </span>
        </label>
        <label>
          hashes (k) — {filter.hashes}
          <input
            type="range"
            min={1}
            max={10}
            value={filter.hashes}
            onChange={(event) => controller.dispatch({ kind: 'setHashes', hashes: Number(event.target.value) })}
          />
        </label>
      </div>
    </div>
  )
}

const INIT: BloomCommand[] = [{ kind: 'insertMany', count: 20 }]

export function BloomPanel() {
  return (
    <ConceptStage
      model={bloomModel}
      seed="bloom-demo"
      framesPerSecond={4}
      init={INIT}
      controls={(controller) => <BloomControls controller={controller} />}
    >
      {(controller) => <BloomCanvas state={controller.frame.state} />}
    </ConceptStage>
  )
}
