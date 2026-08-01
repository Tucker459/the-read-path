# Visualization Roadmap

Sequenced against the reading roadmap's 12 steps, so the tool stays roughly in
step with the reading rather than running ahead of it. Steps 1–3 are marked
in-progress on the reading list, which is why the storage-engine phase comes
first.

Each entry notes the reading item it serves and, where one exists, the
Elasticsearch counterpart that anchors it.

## Phase 0 — Engine

No visualizations. Vite/TS/React/Vitest setup, the deterministic simulation core
(clock, event queue, seeded PRNG, event log), the app shell with transport
controls and scrubber, the concept registry, and the Pages deploy workflow.

Everything downstream depends on this being right, and it is the only part that
is genuinely painful to retrofit.

## Phase 1 — Storage engines · reading steps 1–2

The current reading position, and the natural place for the tool to begin.

1. **LSM-tree + SSTables** — memtable, WAL, flush, leveled compaction, tombstones,
   write amplification readout. Sandbox `put`/`get`/`delete` with tunable memtable
   size and level ratio; real-time mode runs compaction autonomously.
   *DDIA ch. 4, DB Internals Part I. Elastic: the segment lifecycle, previewed.*
2. **B+tree** — node splits and merges, fanout, page layout, leaf chaining, and
   what a page-oriented update costs versus an append.
   *DB Internals ch. on B-trees. The other half of DDIA's central comparison.*
3. **RUM conjecture explorer** — run the same workload against both engines above
   and watch read, update, and memory costs trade against each other. Requires 1
   and 2 to share a workload interface, which is a good constraint on both.
   *DB Internals' RUM chapter — the "no free lunch" idea made concrete.*
4. **Bloom filter** — bit array, hash functions, false-positive rate against size
   and k. Small, and it pays off immediately as the LSM read path's short-circuit.
   *Ties to the parallel math track: Probability and Computing.*

## Phase 2 — Lucene segments · reading step 3

Reuses the LSM machinery almost wholesale — immutable segments are compaction
under a different name, which is the point worth showing.

5. **Inverted index + segment merging** — index-time term dictionary and postings
   construction, immutable segments, deletes as tombstones, tiered merge policy.
   *Lucene wrapped posts, IR book ch. 1–2. Elastic: the actual segment lifecycle.*
6. **MurmurHash3 shard routing** — document ID to shard, and why shards go hot.
   Small and directly reproducible from the post.
   *The named Elastic post; also the mechanism under DDIA ch. 7.*

## Phase 3 — Information retrieval · reading step 4

7. **TF-IDF → BM25 scoring** — term weighting built up from first principles, with
   live `k1` and `b` sliders showing term-frequency saturation and length
   normalization. The sliders are the whole lesson.
   *IR book ch. 6 and 11. Elastic: Lucene's default scorer.*
8. **Retrieval evaluation playground** — a ranked list against relevance
   judgments, with precision, recall, MAP, and nDCG updating as you reorder.
   Makes obvious why nDCG and MAP disagree.
   *IR book ch. 8 — the prerequisite for trusting any benchmark in step 10.*

## Phase 4 — Distributed data · reading steps 5–6

The network simulation layer lands here: latency, reordering, drops, and
partitions, all deterministic under a seed. It is built once and serves
everything below.

9. **Replication** — single-leader, multi-leader, and leaderless quorums with
   `W + R > N` made adjustable. Replication lag, read-your-writes, and the
   anomalies that follow from getting it wrong.
   *DDIA ch. 6, DB Internals Part II. Elastic: cross-cluster replication.*
10. **Partitioning + consistent hashing** — key ranges versus hashing, virtual
    nodes, and rebalancing on join and leave. Pairs directly with #6.
    *DDIA ch. 7. Elastic: shard allocation.*
11. **Raft** — leader election, log replication, and partition handling, with the
    ability to partition the network at a chosen tick and watch the outcome.
    The centerpiece of this phase and the payoff for the engine work.
    *DDIA ch. 10, DB Internals, and the Raft paper in step 12.*
12. **Gossip and anti-entropy** — dissemination without a coordinator, plus Merkle
    tree reconciliation.
    *DB Internals Part II. The Dynamo paper in step 12.*
13. **Clocks and ordering** — Lamport timestamps, vector clocks, and TrueTime's
    uncertainty window.
    *DDIA ch. 9. The Spanner paper in step 12.*
14. **Transaction isolation** — a schedule visualizer for dirty reads, lost
    updates, write skew, and phantoms, with 2PC across shards.
    *DDIA ch. 8, DB Internals distributed transactions.*

## Phase 5 — Vector search · reading step 7

Neither book covers any of this, so the visualizations carry more of the
teaching load than elsewhere.

15. **HNSW** — layered graph construction and greedy traversal with a beam,
    showing what `ef` and `M` actually do to recall and hops.
    *The HNSW paper in step 12; every Elastic HNSW post depends on it.*
16. **Filtered HNSW (ACORN-1)** — why a filter predicate breaks naive graph
    traversal, and how filtering during traversal fixes it.
17. **Scalar quantization and BBQ** — vectors in a 2D projection with quantization
    error drawn on top, trading memory against recall.
    *Echoes DDIA ch. 5 on encoding, applied to floats.*
18. **Product quantization** — subspace splitting and per-subspace codebooks.
    *The Jégou et al. paper in step 12.*

## Phase 6 — Hybrid retrieval · reading step 8

Mostly a product-architecture step, so only the two mechanical pieces visualize
well. That is fine — the rest of that step is reading, not watching.

19. **Reciprocal rank fusion** — two ranked lists merging, with `k` adjustable and
    the resulting reordering animated.
    *The RRF API reference. The one formula worth knowing cold.*
20. **Reranking pipeline** — cheap first-stage retrieval feeding an expensive
    cross-encoder, showing the latency and quality trade at each stage.
    *Bi-encoder versus cross-encoder, from Sentence-BERT in step 4.*

## Phase 7 — Derived data · reading step 9

21. **Stream processing** — a log as the source of truth, change data capture,
    windowing, and stream joins.
    *DDIA ch. 11–13.*

## Phase 8 — Operations at scale · reading step 11

22. **Cluster sizing simulator** — shard count against heap pressure, the
    thousand-shards-per-node ceiling, ILM tier transitions, and what breaks
    first. The most directly job-applicable visualization on this list.
    *The sizing guides, shard-sizing posts, and ILM docs.*

## Step 12 — Papers

No new visualizations. Every paper on that list maps onto something already
built: Raft to #11, Dynamo to #9 and #12, Bigtable to #1, Spanner to #13, HNSW
to #15, product quantization to #18. Reaching that step should feel like reading
the source for things already understood — which is a good argument for the
sequencing above.

## Deliberately not visualized

Reading steps 10 (benchmarking rigor) and the ethics half of step 9 are prose
and judgment, not mechanism. Step 8's platform architecture is largely product
surface. Forcing animations onto these would produce decoration rather than
teaching.
