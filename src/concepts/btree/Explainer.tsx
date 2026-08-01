export function BTreeExplainer() {
  return (
    <>
      <p>
        A B+tree is the answer to a question about hardware rather than about algorithms. A binary search tree needs
        roughly log₂(n) comparisons, which is fine in memory and ruinous on disk — every step is a separate fetch, and a
        fetch costs the same whether you read four bytes or four kilobytes. So you stop making binary decisions and
        start making hundred-way ones. Read a whole page, compare against every separator in it at once, and follow one
        pointer down.
      </p>
      <p>
        Press <strong>get</strong> and count the highlighted pages. The number is the tree&rsquo;s height, and nothing
        else. That is the entire design: lookup cost is the number of levels, and a wide page is what keeps the number
        of levels small. A real engine with 4KB pages fits hundreds of separators in each one, which is how a table of
        hundreds of millions of rows is still only four levels deep.
      </p>
      <p>
        Drag <strong>keys per page</strong> down to 2 and watch the tree stretch upward; drag it to 8 and watch it
        flatten. Nothing about the data changed — only how much of it fits in one read.
      </p>

      <h3>Watch a split</h3>
      <p>
        Insert keys until a leaf overflows. The split is animated one step at a time, so you can watch it propagate: the
        leaf divides, a separator is pushed into the parent, and if that parent is now overfull it splits too. Keep
        going and eventually the root itself splits.
      </p>
      <p>
        That last case is the one worth pausing on. A B+tree grows <em>from the top</em>, never from the bottom. Splitting
        the root is the only operation that adds a level, and because it adds that level above everything, every leaf
        stays at exactly the same depth. The tree cannot become lopsided — that is what &ldquo;balanced&rdquo; means
        here, and it is what makes the height an honest cost estimate rather than an average.
      </p>
      <p>
        The two kinds of split differ in a way that is easy to miss. A leaf split <strong>copies</strong> its separator
        upward — every key must remain in some leaf, because leaves hold the actual data. An internal split{' '}
        <strong>moves</strong> the middle key upward instead; separators are signposts, not data, so removing one loses
        nothing.
      </p>

      <h3>Watch a delete</h3>
      <p>
        Deletion is the mirror image, and it is the part most explanations skip. Remove enough keys and a page drops
        below half full. It first tries to <strong>borrow</strong> from a neighbour, which touches three pages and stops
        there. If neither neighbour has a key to spare, it <strong>merges</strong> — and a merge removes a separator
        from the parent, which can leave the parent underfull, which can cascade all the way up. Empty the tree
        completely and it collapses back to the single leaf it started as.
      </p>
      <p>
        This is why the <strong>fill factor</strong> readout matters. A B+tree does not pack pages tightly; it keeps
        them between half and completely full, so a real one hovers around 70%. That slack is what buys the ability to
        insert without reorganising, and it is a real cost — roughly a third of your index is deliberately empty space.
      </p>

      <h3>Against an LSM-tree</h3>
      <p>
        Compare the counters here with the ones on the LSM-tree page. A B+tree read touches one page per level and stops.
        An LSM read may consult several tables before finding anything, and needs Bloom filters to keep that bounded.
        Reads are what a B+tree is good at.
      </p>
      <p>
        Writes are where it pays. Every insert here writes a page <em>in place</em> — a random write to wherever that
        page lives on disk — and a split writes three. The LSM never does a random write at all; it batches everything
        into sequential file writes and pays later, in the background, through compaction. Neither is better. They are
        the same trade seen from opposite sides, which is what the RUM conjecture formalises: read cost, update cost,
        and memory overhead, and you may optimise for two.
      </p>

      <h3>In a real system</h3>
      <p>
        This is the shape of the default index in PostgreSQL, MySQL&rsquo;s InnoDB, SQL Server, and Oracle, and of
        embedded stores like LMDB and BoltDB. When you read that an index &ldquo;is a B-tree,&rdquo; it is almost always
        a B+tree specifically — the variant that keeps all data in the leaves and chains them together, so a range scan
        walks sideways along the leaves instead of climbing back through the root for every row.
      </p>
      <p>
        Two simplifications here. Real engines do not rebalance nearly this eagerly: deletes usually just mark space
        free and leave underfull pages alone, because a page that is half empty today is likely to be filled again
        tomorrow, and merging costs writes now for a benefit that may never arrive. And concurrency is absent entirely —
        the hardest part of a production B-tree is letting many readers and writers move through it at once without
        latching the whole thing, which is a subject of its own.
      </p>
    </>
  )
}
