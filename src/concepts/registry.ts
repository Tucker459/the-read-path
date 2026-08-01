import type { ComponentType } from 'react'
import { WalPanel } from './wal/WalPanel'
import { WalExplainer } from './wal/Explainer'
import { LsmPanel } from './lsm/LsmPanel'
import { LsmExplainer } from './lsm/Explainer'

export interface Concept {
  id: string
  title: string
  blurb: string
  phase: string
  /** Where this sits in the reading roadmap. */
  reading: string
  /** The Elasticsearch or Lucene counterpart, where one exists. */
  elastic?: string
  Panel?: ComponentType
  Explainer?: ComponentType
}

/**
 * Every concept in the project, built and unbuilt.
 *
 * Unbuilt entries are listed deliberately: the roadmap is part of what the
 * site has to say, and a concept with no panel yet is still a claim about
 * where this is going. Adding a real one means writing a model, a panel, and
 * an explainer, then filling in the two fields below.
 */
export const CONCEPTS: Concept[] = [
  {
    id: 'write-ahead-log',
    title: 'Write-ahead log',
    blurb: 'Why an append is fast, why it guarantees nothing, and what an fsync buys.',
    phase: 'Storage engines',
    reading: 'DDIA ch. 4 · Database Internals, recovery',
    elastic: 'The translog',
    Panel: WalPanel,
    Explainer: WalExplainer,
  },
  {
    id: 'lsm-tree',
    title: 'LSM-tree and SSTables',
    blurb: 'Memtable, flush, leveled compaction, and where write amplification comes from.',
    phase: 'Storage engines',
    reading: 'DDIA ch. 4 · Database Internals part I',
    elastic: 'The segment lifecycle',
    Panel: LsmPanel,
    Explainer: LsmExplainer,
  },
  {
    id: 'b-plus-tree',
    title: 'B+tree',
    blurb: 'Splits, merges, fanout, and what a page-oriented update costs against an append.',
    phase: 'Storage engines',
    reading: 'Database Internals, B-trees',
  },
  {
    id: 'bloom-filter',
    title: 'Bloom filter',
    blurb: 'False positives against size and hash count — the LSM read path’s short-circuit.',
    phase: 'Storage engines',
    reading: 'Probability and Computing',
  },
  {
    id: 'inverted-index',
    title: 'Inverted index and segment merging',
    blurb: 'Postings construction, immutable segments, deletes as tombstones, tiered merges.',
    phase: 'Search internals',
    reading: 'IR book ch. 1–2 · Lucene Wrapped',
    elastic: 'Lucene segments',
  },
  {
    id: 'shard-routing',
    title: 'Shard routing',
    blurb: 'Document id to shard by hash, and why shards go hot.',
    phase: 'Search internals',
    reading: 'DDIA ch. 7 · the MurmurHash3 post',
    elastic: 'MurmurHash3 routing',
  },
  {
    id: 'bm25',
    title: 'TF-IDF to BM25',
    blurb: 'Term weighting from first principles, with term saturation and length normalization live.',
    phase: 'Search internals',
    reading: 'IR book ch. 6 and 11',
    elastic: 'Lucene’s default scorer',
  },
  {
    id: 'retrieval-evaluation',
    title: 'Retrieval evaluation',
    blurb: 'Precision, recall, MAP, and nDCG moving as you reorder a result list.',
    phase: 'Search internals',
    reading: 'IR book ch. 8',
  },
  {
    id: 'replication',
    title: 'Replication',
    blurb: 'Single-leader, multi-leader, and leaderless quorums with W + R > N adjustable.',
    phase: 'Distributed systems',
    reading: 'DDIA ch. 6 · Database Internals part II',
    elastic: 'Cross-cluster replication',
  },
  {
    id: 'partitioning',
    title: 'Partitioning and consistent hashing',
    blurb: 'Key ranges against hashing, virtual nodes, and rebalancing on join and leave.',
    phase: 'Distributed systems',
    reading: 'DDIA ch. 7',
    elastic: 'Shard allocation',
  },
  {
    id: 'raft',
    title: 'Raft',
    blurb: 'Leader election and log replication, with the network partitionable on demand.',
    phase: 'Distributed systems',
    reading: 'DDIA ch. 10 · the Raft paper',
  },
  {
    id: 'gossip',
    title: 'Gossip and anti-entropy',
    blurb: 'Dissemination without a coordinator, and Merkle tree reconciliation.',
    phase: 'Distributed systems',
    reading: 'Database Internals part II · the Dynamo paper',
  },
  {
    id: 'clocks',
    title: 'Clocks and ordering',
    blurb: 'Lamport timestamps, vector clocks, and TrueTime’s uncertainty window.',
    phase: 'Distributed systems',
    reading: 'DDIA ch. 9 · the Spanner paper',
  },
  {
    id: 'isolation',
    title: 'Transaction isolation',
    blurb: 'Dirty reads, lost updates, write skew, and phantoms as executable schedules.',
    phase: 'Distributed systems',
    reading: 'DDIA ch. 8',
  },
  {
    id: 'hnsw',
    title: 'HNSW',
    blurb: 'Layered graph construction and greedy traversal — what ef and M actually do.',
    phase: 'Vector search',
    reading: 'The HNSW paper',
    elastic: 'Dense vector fields',
  },
  {
    id: 'filtered-hnsw',
    title: 'Filtered HNSW',
    blurb: 'Why a filter predicate breaks naive traversal, and how ACORN-1 fixes it.',
    phase: 'Vector search',
    reading: 'The filtered HNSW post',
  },
  {
    id: 'quantization',
    title: 'Scalar quantization and BBQ',
    blurb: 'Quantization error drawn on the vectors themselves — memory against recall.',
    phase: 'Vector search',
    reading: 'The BBQ posts · DDIA ch. 5',
    elastic: 'BBQ',
  },
  {
    id: 'product-quantization',
    title: 'Product quantization',
    blurb: 'Subspace splitting and per-subspace codebooks.',
    phase: 'Vector search',
    reading: 'Jégou et al.',
  },
  {
    id: 'rrf',
    title: 'Reciprocal rank fusion',
    blurb: 'Two ranked lists merging, with k adjustable and the reordering animated.',
    phase: 'Hybrid retrieval',
    reading: 'The RRF API reference',
    elastic: 'RRF',
  },
  {
    id: 'reranking',
    title: 'Reranking pipeline',
    blurb: 'Cheap first-stage retrieval feeding an expensive cross-encoder.',
    phase: 'Hybrid retrieval',
    reading: 'Sentence-BERT · semantic reranking',
  },
  {
    id: 'streams',
    title: 'Stream processing',
    blurb: 'The log as source of truth, change data capture, windowing, and stream joins.',
    phase: 'Derived data',
    reading: 'DDIA ch. 11–13',
  },
  {
    id: 'cluster-sizing',
    title: 'Cluster sizing',
    blurb: 'Shard count against heap pressure, tier transitions, and what breaks first.',
    phase: 'Operations',
    reading: 'The sizing and shard guides',
    elastic: 'ILM and shard sizing',
  },
]

export const PHASES = [
  'Storage engines',
  'Search internals',
  'Distributed systems',
  'Vector search',
  'Hybrid retrieval',
  'Derived data',
  'Operations',
]

export function findConcept(id: string): Concept | undefined {
  return CONCEPTS.find((concept) => concept.id === id)
}
