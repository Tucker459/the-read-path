import { useState } from 'react'
import { ConceptStage } from '../../viz/ConceptStage'
import type { SimulationController } from '../../viz/useSimulation'
import {
  btreeModel,
  DEFAULT_MAX_KEYS,
  type BTreeCommand,
  type BTreeEvent,
  type BTreeState,
  type HighlightKind,
} from './model'
import { leafChain, page, type Page, type PageId, type Tree } from './tree'

type BTreeController = SimulationController<BTreeState, BTreeEvent, BTreeCommand>

const CELL = 30
const PAD = 7
const GAP = 16
const ROW = 74
const NODE_H = 28

interface Placed {
  id: PageId
  node: Page
  depth: number
  x: number
  width: number
}

function nodeWidth(node: Page): number {
  return Math.max(1, node.keys.length) * CELL + PAD * 2
}

/**
 * Lay the tree out bottom-up: leaves are placed left to right in chain order,
 * and every internal page centres itself over the children it points at.
 */
function layout(tree: Tree): { placed: Placed[]; width: number; height: number } {
  const placed = new Map<PageId, Placed>()
  const depthOf = new Map<PageId, number>()

  const measure = (id: PageId, depth: number): void => {
    depthOf.set(id, depth)
    const node = page(tree.pages, id)
    if (node.kind === 'internal') for (const child of node.children) measure(child, depth + 1)
  }
  measure(tree.rootId, 0)

  let cursor = 0
  for (const leaf of leafChain(tree.pages, tree.rootId)) {
    const width = nodeWidth(leaf)
    placed.set(leaf.id, {
      id: leaf.id,
      node: leaf,
      depth: depthOf.get(leaf.id) ?? 0,
      x: cursor + width / 2,
      width,
    })
    cursor += width + GAP
  }

  const centre = (id: PageId): number => {
    const existing = placed.get(id)
    if (existing) return existing.x
    const node = page(tree.pages, id)
    if (node.kind === 'leaf') return 0
    const childCentres = node.children.map(centre)
    const x = childCentres.reduce((sum, value) => sum + value, 0) / childCentres.length
    placed.set(id, { id, node, depth: depthOf.get(id) ?? 0, x, width: nodeWidth(node) })
    return x
  }
  centre(tree.rootId)

  const all = [...placed.values()]
  const maxDepth = Math.max(...all.map((entry) => entry.depth))
  return {
    placed: all,
    width: Math.max(cursor - GAP, 1),
    height: maxDepth * ROW + NODE_H + 24,
  }
}

function TreeSvg({ state }: { state: BTreeState }) {
  const { placed, width, height } = layout(state.tree)
  const byId = new Map(placed.map((entry) => [entry.id, entry]))

  const highlighted = new Map<PageId, HighlightKind>()
  for (const id of state.highlight?.pages ?? []) highlighted.set(id, state.highlight?.kind ?? 'read')

  const onPath = new Set(state.op?.path ?? [])
  const leaves = leafChain(state.tree.pages, state.tree.rootId)

  return (
    <div className="tree-scroll">
      <svg viewBox={`-8 -8 ${width + 16} ${height + 16}`} className="tree-svg" role="img" aria-label="B+tree structure">
        {/* Parent-to-child edges. */}
        {placed.map((entry) =>
          entry.node.kind === 'internal'
            ? entry.node.children.map((childId, index) => {
                const child = byId.get(childId)
                if (!child) return null
                const fromX = entry.x - entry.width / 2 + PAD + index * CELL
                return (
                  <line
                    key={`${entry.id}-${childId}`}
                    x1={fromX}
                    y1={entry.depth * ROW + NODE_H}
                    x2={child.x}
                    y2={child.depth * ROW}
                    className={onPath.has(childId) && onPath.has(entry.id) ? 'edge active' : 'edge'}
                  />
                )
              })
            : null,
        )}

        {/* The leaf chain — the reason a range scan does not touch the root. */}
        {leaves.map((leaf, index) => {
          const from = byId.get(leaf.id)
          const to = index + 1 < leaves.length ? byId.get(leaves[index + 1]?.id as PageId) : undefined
          if (!from || !to) return null
          const y = from.depth * ROW + NODE_H / 2
          return (
            <line
              key={`chain-${leaf.id}`}
              x1={from.x + from.width / 2}
              y1={y}
              x2={to.x - to.width / 2}
              y2={y}
              className="leaf-link"
            />
          )
        })}

        {placed.map((entry) => {
          const kind = highlighted.get(entry.id)
          const classes = ['node', entry.node.kind]
          if (kind) classes.push(`hl-${kind}`)
          else if (onPath.has(entry.id)) classes.push('hl-path')

          return (
            <g key={entry.id} transform={`translate(${entry.x - entry.width / 2}, ${entry.depth * ROW})`}>
              <rect width={entry.width} height={NODE_H} rx={5} className={classes.join(' ')} />
              {entry.node.keys.map((key, index) => (
                <text key={key} x={PAD + index * CELL + CELL / 2} y={NODE_H / 2 + 4} className="node-key">
                  {key.replace(/^k/, '')}
                </text>
              ))}
              {entry.node.keys.length === 0 ? (
                <text x={entry.width / 2} y={NODE_H / 2 + 4} className="node-key empty">
                  ·
                </text>
              ) : null}
              <text x={entry.width / 2} y={-5} className="node-id">
                p{entry.id}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function fillFactor(state: BTreeState): number {
  const pages = Object.values(state.tree.pages)
  if (pages.length === 0) return 0
  const used = pages.reduce((total, node) => total + node.keys.length, 0)
  return used / (pages.length * state.maxKeys)
}

function BTreeCanvas({ state }: { state: BTreeState }) {
  const search = state.lastSearch

  return (
    <div className="btree">
      <TreeSvg state={state} />

      {search ? (
        <section className="read-trace">
          <header>
            <h3>
              Last search: <code>{search.key}</code>
            </h3>
            <span className={search.found === null ? 'tag warn' : 'tag good'}>{search.found ?? 'not found'}</span>
          </header>
          <ol className="steps">
            {search.path.map((id, index) => (
              <li key={id} className="step hit">
                <span className="step-where">p{id}</span>
                <span className="step-outcome">{index === search.path.length - 1 ? 'leaf' : `level ${index + 1}`}</span>
              </li>
            ))}
          </ol>
          <p className="dim mono trace-summary">
            {search.path.length} page read(s) — one per level, which is the entire argument for a wide page
          </p>
        </section>
      ) : null}

      <dl className="lsm-stats">
        <div>
          <dt>height</dt>
          <dd>{state.tree.height}</dd>
        </div>
        <div>
          <dt>pages</dt>
          <dd>{Object.keys(state.tree.pages).length}</dd>
        </div>
        <div>
          <dt>fill factor</dt>
          <dd className={fillFactor(state) < 0.5 ? 'bad' : undefined}>{(fillFactor(state) * 100).toFixed(0)}%</dd>
        </div>
        <div>
          <dt>splits / merges</dt>
          <dd>
            {state.stats.splits} / {state.stats.merges}
          </dd>
        </div>
        <div>
          <dt>page reads</dt>
          <dd>{state.stats.pageReads}</dd>
        </div>
        <div>
          <dt>page writes</dt>
          <dd>{state.stats.pageWrites}</dd>
        </div>
      </dl>
    </div>
  )
}

function BTreeControls({ controller }: { controller: BTreeController }) {
  // A key the seeded demo actually writes, so the first `get` traces a real
  // descent to a hit rather than reporting nothing found.
  const [key, setKey] = useState('k22')
  const [value, setValue] = useState('hello')
  const maxKeys = controller.frame.state.maxKeys

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
        <button type="button" onClick={() => controller.dispatch({ kind: 'putMany', count: 30 })}>
          write 30 keys
        </button>
      </div>

      <div className="control-group">
        <label>
          keys per page — {maxKeys}
          <input
            type="range"
            min={2}
            max={8}
            value={maxKeys}
            onChange={(event) => controller.dispatch({ kind: 'setMaxKeys', maxKeys: Number(event.target.value) })}
          />
        </label>
      </div>
    </div>
  )
}

const INIT: BTreeCommand[] = [{ kind: 'putMany', count: 24 }]

export function BTreePanel() {
  return (
    <ConceptStage
      model={btreeModel}
      seed="btree-demo"
      framesPerSecond={5}
      init={INIT}
      controls={(controller) => <BTreeControls controller={controller} />}
    >
      {(controller) => <BTreeCanvas state={controller.frame.state} />}
    </ConceptStage>
  )
}

export { DEFAULT_MAX_KEYS }
