# Distributed Systems & Database Internals Visualizer — Plan

An interactive, in-browser visualizer for data structures, storage engines, and
distributed systems concepts. Built as supplemental learning material, deployed
publicly, and designed to keep growing.

## Decisions

| Question | Decision |
| --- | --- |
| Stack | React + TypeScript + Vite, entirely client-side |
| Rendering | SVG (declarative, animatable, inspectable); Canvas only if perf forces it |
| Interaction | Timeline scrubber + user-driven sandbox + autonomous real-time simulation |
| First concept | LSM-tree + SSTables |
| Authoring | Claude implements models and visualizations; user reads, runs, and tinkers |
| Deployment | GitHub Pages, auto-deployed from `main` via GitHub Actions |
| Framing | Portfolio piece — visual polish and written explanations both matter |
| Prose | Substantial: per-concept explainer, annotated callouts, "what real systems do" notes |
| Sequencing | **Pending** — driven by the user's reading list |
| Scope / abstraction level | **Pending** — driven by the breadth of that reading list |

## The architectural constraint

Wanting all three of scrubbing, sandboxing, and autonomous simulation is not
three features — it is one requirement, and it dictates the core design.

A scrubber means every visual state must be *addressable by index*, so the
simulation cannot be a pile of `setTimeout` calls that mutate React state.
An autonomous sim means time must advance on its own. A sandbox means user
commands must interleave with that autonomous time. The only design that
satisfies all three is a **deterministic discrete-event simulation that emits an
event log**, with rendering as a pure function of a replayed state.

This is the one thing that is genuinely painful to retrofit, so it gets built
first, before any LSM-tree code.

### Core model

```
commands + seed  ──▶  Simulation  ──▶  Event[]  ──▶  reduce()  ──▶  State[]  ──▶  React/SVG
                        (pure)                        (pure)                       (dumb)
```

Four properties fall out of this:

- **Deterministic.** A seeded PRNG (never `Math.random`) threads through the
  whole simulation. The same seed and command list always produce the same run.
- **Scrubbable.** The timeline is an array index. Stepping backward is free
  because nothing mutates; it just renders `states[i - 1]`.
- **Shareable.** A run is fully described by `(seed, commands)`, so it encodes
  into a URL. "Look at this exact compaction" becomes a link.
- **Testable.** Models are pure TypeScript with no DOM, so correctness is
  ordinary unit testing.

### Simulated clock

A priority queue of `(virtualTime, event)`. Real-time playback advances virtual
time against `requestAnimationFrame` at a controllable rate; pausing simply stops
advancing it. The same mechanism serves both halves of the project: an LSM's
background compaction fires at a virtual timestamp, and later, a Raft message
arrives at `t + latency`. Building it once for the LSM means the distributed
concepts get network simulation nearly for free.

### Layers

```
src/
  sim/         clock, event queue, seeded PRNG, timeline, command dispatch  (no DOM)
  models/      lsm/, btree/, ... — pure algorithm implementations that emit events
  viz/         shared React/SVG primitives: scrubber, control bar, transport,
               animated node/edge/table, layout helpers, color scales
  concepts/    one folder per concept: model wiring + renderer + explainer prose
  registry.ts  the list of concepts; adding one means one folder and one line
```

The boundary that matters: `models/` must never import from `viz/`. An algorithm
that knows about pixels cannot be unit tested, and cannot be reused by a second
visualization of the same structure.

### Correctness as a prerequisite

A visualization of a wrong LSM-tree teaches the wrong thing, confidently. Every
model gets a Vitest suite asserting real behavior — a `get` after N puts, a
flush, and a compaction must return the value a correct LSM would return — plus
randomized differential tests against a plain `Map` as the reference
implementation. This is not ceremony; it is the difference between a teaching
tool and a plausible-looking animation.

## Build order

1. **Foundation** — Vite + TS + React, Vitest, ESLint/Prettier, GitHub Pages workflow.
2. **`sim/` core** — clock, event queue, seeded PRNG, event log, timeline reducer.
3. **`viz/` shell** — app layout, transport controls (play/pause/step/speed), the
   scrubber, and the concept registry with routing.
4. **LSM-tree end to end** — memtable, WAL, SSTable flush, leveled compaction,
   bloom filters; sandbox commands (`put`, `get`, `delete`, tunable memtable size
   and level ratios); real-time mode with autonomous background compaction.
5. **Explainer layer** — prose, annotated callouts, write-amplification readout.
6. **Concept 2 onward** — sequenced against the reading list.

Step 4 is deliberately the second thing built rather than the first. The LSM is
demanding enough — background work on a timer, multi-level state, structures
that appear and disappear — that it will expose any weakness in the engine while
the engine is still cheap to change.

## Open items

Both are waiting on the reading list:

- **Sequencing** of concepts after the LSM-tree, to track the reading order.
- **Scope** — how much shared abstraction is justified on day one. A list that
  runs through consensus and replication justifies building the network
  simulation layer early; a list focused on storage engines does not.
