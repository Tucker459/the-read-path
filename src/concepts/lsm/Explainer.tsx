export function LsmExplainer() {
  return (
    <>
      <p>
        A B-tree updates data where it already lives. That means finding the right page, reading it, changing it, and
        writing it back — a random write, at whatever position on disk the key happens to map to. An LSM-tree refuses to
        do that. Every write goes into a sorted structure in memory, and memory is flushed out as a whole file, in one
        sequential pass, never modified again.
      </p>
      <p>
        The consequence is that writes get very cheap and the mess gets deferred rather than avoided. Nothing is ever
        updated in place, so an overwrite does not replace the old value — it simply buries it under a newer one. A
        delete does not remove anything either; it writes a <strong>tombstone</strong>, a marker that says the key is
        gone. Reads pay for this, and compaction is the background work that keeps the bill from growing without bound.
      </p>

      <h3>Watch the write path</h3>
      <p>
        Press <strong>put</strong> until the memtable bar fills. At the limit it is <strong>sealed</strong> — not
        emptied. Writes immediately continue into a fresh memtable while the sealed one waits its turn to be written
        out, and reads still see both. That distinction matters: a sealed memtable has lost the right to be written to,
        not the right to be read from.
      </p>
      <p>
        Now press <strong>write 40 keys</strong> and watch the sealed queue. If writes arrive faster than flushes
        complete, memtables stack up. A real engine will eventually refuse to accept more writes rather than let that
        queue grow forever — a <em>write stall</em>, and one of the more confusing things to debug in production,
        because throughput collapses while nothing appears to be wrong.
      </p>

      <h3>Watch the read path</h3>
      <p>
        Press <strong>get</strong> and read the trace. A lookup checks the memtable, then each sealed memtable newest
        first, then L0, then deeper. It stops at the first answer it finds, because the first answer is by construction
        the newest one.
      </p>
      <p>
        Notice how differently L0 behaves from everything below it. <strong>Every</strong> L0 table has to be considered,
        because each one is a separate memtable flush and their key ranges overlap freely — a key could be in any of
        them. From L1 down, tables are non-overlapping sorted runs, so at most one table per level can possibly hold the
        key. That single structural difference is why an L0 that is allowed to grow destroys read performance, and why
        engines compact it aggressively.
      </p>
      <p>
        Two things spare the read path from opening files it does not need. A key outside a table&rsquo;s min–max range
        is dismissed for free. Inside the range, the <strong>bloom filter</strong> gets consulted, and a negative answer
        is trustworthy enough to skip the table entirely. A positive answer is only a maybe — watch for a step marked
        &ldquo;not here&rdquo; after the filter let a read through. That is a false positive, and the wasted read is
        exactly what it costs.
      </p>
      <p>
        The difference is worth seeing directly. Get <code>k23</code> and the read walks down to a real hit. Get{' '}
        <code>k07</code> and every step reads &ldquo;out of range&rdquo; — that key falls in a gap between two
        tables&rsquo; ranges, so nothing is opened and no filter is even consulted. The cheapest lookup is the one
        answered by two comparisons against a min and a max.
      </p>

      <h3>Watch the cost</h3>
      <p>
        The <strong>write amplification</strong> readout is bytes written to disk per byte you asked to store. It climbs
        past 1 immediately and keeps climbing, because every byte is rewritten each time it is merged into a deeper
        level. This is the trade in its plainest form: sequential, cheap writes bought with the promise to rewrite the
        same data repeatedly, forever, in the background.
      </p>
      <p>
        Drag the <strong>memtable limit</strong> and watch what moves. A smaller memtable flushes sooner, producing more
        and smaller tables — more compaction work, higher amplification, but less data at risk in memory and a shorter
        recovery. A larger one does the opposite. There is no setting that wins; there is only which cost you would
        rather pay, which is the RUM conjecture arriving in practical form.
      </p>

      <h3>What to notice</h3>
      <ul>
        <li>
          Delete a key you have written, then keep writing until compaction runs. The tombstone survives until it
          reaches the bottom level. Drop it any earlier and the older value sitting in a deeper level would become
          visible again — a deleted record returning from the dead.
        </li>
        <li>
          Overwrite a key several times and scrub back. Every version is still on disk, in different tables. Only the
          sequence number decides which one a read sees.
        </li>
        <li>
          Compaction cascades. Filling L1 spills into L2, which can spill into L3. One flush can set off a chain.
        </li>
      </ul>

      <h3>In a real system</h3>
      <p>
        This is the shape of RocksDB and LevelDB, and of Cassandra and ScyllaDB. In Elasticsearch the same structure
        appears under different names: a Lucene segment is an immutable sorted file written once and never edited, an
        index refresh is a flush, and segment merging is compaction. Deleted documents are tombstoned and only truly
        removed when a merge rewrites the segment — which is why disk usage in Elasticsearch does not drop the moment
        you delete, and why forcing a merge is a heavy operation rather than a tidy-up.
      </p>
      <p>
        The model here is real: puts, gets, deletes, flushes, and compactions all run for real over a simulated clock,
        and a differential test checks its answers against a plain map across hundreds of random operations. What is
        simplified is scale and the fidelity of the file format — entries are counted rather than serialized, and the
        bloom filters are 64 bits rather than sized per table.
      </p>
    </>
  )
}
