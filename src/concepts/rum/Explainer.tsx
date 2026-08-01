export function RumExplainer() {
  return (
    <>
      <p>
        Every access method spends resources on three things: <strong>reading</strong> more data than was asked for,{' '}
        <strong>updating</strong> storage with more writes than the change required, and holding data in more{' '}
        <strong>memory</strong> or space than it strictly needs. The RUM conjecture says you may drive down any two of
        those, and the third will rise. There is no design that minimises all three.
      </p>
      <p>
        This page is the same workload — identical operations, identical order — run through both storage engines built
        earlier on this site, with all three overheads measured as it goes. Nothing here is a benchmark of a real
        system; it is the same trade the books describe, made countable.
      </p>

      <h3>Reading the numbers</h3>
      <p>
        Every figure is a multiple of the theoretical floor. <strong>1.00× means no waste</strong> — exactly one record
        read per record wanted, one record written per record stored, one slot occupied per live key.
      </p>
      <p>
        Read and memory cannot go below 1.00×: you must fetch at least the record you asked for, and it must occupy at
        least one slot. <strong>Update can</strong>, and watching it happen is worth the trip. Drag the key space down
        so the workload keeps overwriting the same handful of keys, and the LSM&rsquo;s update overhead collapses toward
        1.00× — sometimes below it — while the B+tree&rsquo;s stays several times higher.
      </p>
      <p>
        The memtable is absorbing those overwrites in memory, replacing each entry in place, so superseded versions are
        discarded before ever reaching disk. The engine genuinely writes fewer records than it was handed. A B+tree has
        nothing equivalent, because it writes through to a page every time. Push it further — a key space small enough
        to fit inside the memtable — and the LSM reports <strong>0.00×</strong>: the memtable never fills, nothing is
        ever flushed, and the disk is not touched at all. Degenerate, but not wrong, and it is the same mechanism that
        makes LSM-trees suit update-heavy workloads in practice.
      </p>
      <ul>
        <li>
          <strong>Read</strong> counts records fetched from storage per record actually wanted. A B+tree reads every
          page along the root-to-leaf path, whole. An LSM reads whole tables, but only the ones a Bloom filter or key
          range failed to rule out.
        </li>
        <li>
          <strong>Update</strong> counts records written per record the workload stored. A B+tree rewrites an entire
          page to change one key in it. An LSM writes sequentially, then rewrites the same records again at every
          compaction.
        </li>
        <li>
          <strong>Memory</strong> counts slots occupied per live key. The two engines waste space for opposite reasons —
          an LSM keeps superseded versions and tombstones that compaction has not yet reclaimed, while a B+tree stores
          each key exactly once but deliberately leaves its pages part-empty.
        </li>
      </ul>

      <h3>The knobs, and what they cost</h3>
      <p>
        Shrink the <strong>LSM memtable</strong> and it flushes sooner: smaller tables, more of them, more compaction to
        merge them away. Update overhead climbs. In exchange, less data sits unflushed in memory, so a crash loses less
        and recovery is shorter. Memory bought with updates.
      </p>
      <p>
        Widen the <strong>B+tree page</strong> and something more interesting happens — read cost moves in two
        directions at once. The tree gets shallower, so a lookup needs fewer seeks; but each page fetched is bigger, so
        it pulls more records. The <em>Read</em> bar rises while <em>Seeks per lookup</em> in the table falls.
      </p>
      <p>
        Both are real costs, and which one dominates is a fact about hardware rather than about algorithms. A disk seek
        costs milliseconds while the transfer costs microseconds, so real engines take the trade eagerly and use pages
        holding hundreds of keys. On a device where the seek is nearly free, the calculus changes — which is exactly why
        storage engines designed for NVMe look different from ones designed for spinning disks.
      </p>
      <p>
        Shrink the <strong>key space</strong> and the same keys get overwritten constantly. Watch LSM memory overhead
        climb as superseded versions accumulate faster than compaction reclaims them, while the B+tree — updating in
        place — barely moves. That is the clearest single demonstration on this page of two engines paying for the same
        workload on completely different axes.
      </p>

      <h3>Why this is a conjecture and not a theorem</h3>
      <p>
        The RUM conjecture was named by Athanassoulis and colleagues in 2016, and the word is deliberate. There is no
        proof that the three overheads must trade off; there is a long empirical record of every design doing so, and
        good reason to think the tension is fundamental rather than a failure of imagination.
      </p>
      <p>
        The practical value is not the impossibility claim but the framing. When a system claims to be faster, the
        question stops being <em>whether</em> and becomes <em>on which axis, and what did it give up</em>. An LSM is not
        faster than a B+tree; it is cheaper to write and more expensive to read, and whether that is a good deal depends
        entirely on the workload you are going to run.
      </p>

      <h3>What this model simplifies</h3>
      <p>
        Reads are measured by probing the structures directly rather than by dispatching operations, so measurement
        cannot itself distort the result. But records are treated as uniform in size, caching is ignored entirely — a
        real B+tree keeps its upper levels permanently in memory, which makes its true read cost much closer to one page
        than to its height — and concurrency does not exist here. The shape of the trade is faithful; the magnitudes are
        not a prediction about any real system.
      </p>
    </>
  )
}
