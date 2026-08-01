# The Read Path

**An interactive visualizer for how data systems actually work** — storage
engines, search and retrieval, and distributed systems, all running live in the
browser.

Read about an LSM-tree and you get a diagram of one moment. Here you drive it:
put keys until the memtable spills, watch the flush, let compaction run on its
own clock, then scrub backward and watch it again. Every visualization runs a
real implementation rather than replaying a canned animation.

## Why "the read path"

It is the route a query takes from request to answer — through a bloom filter,
into the right segment, down a B-tree, or across a graph of neighbors. It is one
of the few terms that means something precise in storage engines, in search, and
in distributed systems alike, which is exactly the ground this project covers.

## What's here

Roughly two dozen visualizations, built in sequence:

- **Storage engines** — LSM-trees and SSTables, B+trees, bloom filters, and the
  read/update/memory trade-off that no engine escapes
- **Search internals** — inverted indexes, segment merging, shard routing, and
  BM25 scoring built up from TF-IDF
- **Distributed systems** — replication, partitioning, Raft, gossip, vector
  clocks, and transaction isolation, over a simulated network you can partition
  on demand
- **Vector search** — HNSW construction and traversal, filtered search, and what
  quantization actually costs you in recall

Where a concept has a concrete counterpart in Elasticsearch or Lucene, the
visualization says so — segment merging is compaction, shard routing is
MurmurHash3, cross-cluster replication is leader-follower replication.

## Design

Three things at once — a timeline scrubber, a sandbox you type commands into,
and a simulation that runs on its own clock — turn out to be a single
requirement. Everything is a deterministic discrete-event simulation that emits
an event log, with rendering as a pure function of replayed state. Seeded
randomness throughout, so any run is reproducible and shareable as a link.

See [`PLAN.md`](PLAN.md) for the architecture and [`ROADMAP.md`](ROADMAP.md) for
the build sequence.

## Status

Planning complete. Engine next.

## Running it

```sh
npm install
npm run dev
```
