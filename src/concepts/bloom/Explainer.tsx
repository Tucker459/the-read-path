export function BloomExplainer() {
  return (
    <>
      <p>
        A Bloom filter answers one question — <em>have you seen this key?</em> — and it answers it in two very different
        ways. &ldquo;No&rdquo; is certain. &ldquo;Yes&rdquo; means <em>probably</em>, and might be wrong. In exchange
        for that asymmetry it stores no keys at all, just a row of bits, and answers in constant time no matter how much
        has gone into it.
      </p>
      <p>
        The mechanism is almost too simple. Hash the key k different ways, and set the k bits those hashes point at. To
        test a key, hash it the same k ways and look. If <strong>any</strong> of those bits is clear, the key was
        definitely never inserted — setting a bit is the only thing an insert does, and bits are never unset, so a clear
        bit is proof. If they are <strong>all</strong> set, the key was probably inserted; or those bits were set by
        several other keys that happen to overlap it.
      </p>
      <p>
        Press <strong>insert</strong> and watch which bits get claimed. Press <strong>query</strong> on the same key and
        watch the same bits get checked. Then <strong>query a random key</strong> a few times — most come back
        &ldquo;definitely absent&rdquo; on the first clear bit found, but keep going and one will come back
        &ldquo;probably present&rdquo; when it never was. That is a false positive, and the cost of it is exactly one
        wasted lookup.
      </p>

      <h3>Why one-sided error is the whole point</h3>
      <p>
        A structure that is sometimes wrong sounds useless until you notice which way it is wrong. Put a Bloom filter in
        front of an expensive lookup and a &ldquo;no&rdquo; lets you skip that lookup entirely, with no risk. A
        &ldquo;yes&rdquo; costs you the lookup you were going to do anyway. The filter can never cause a wrong answer,
        only occasional wasted work — so you get to trade a small, tunable amount of wasted work for a large amount of
        avoided I/O.
      </p>
      <p>
        That is exactly how the LSM-tree on this site uses one. Every SSTable carries a filter over its keys, and a read
        that would otherwise open the file gets to skip it on a negative. Watch the read trace there and you will see
        the same steps as here, embedded in a larger machine.
      </p>

      <h3>The three numbers</h3>
      <p>
        Everything about a Bloom filter is a relationship between <strong>m</strong> (bits), <strong>n</strong> (keys
        inserted), and <strong>k</strong> (hash functions). Add keys without adding bits and the array fills up; once
        nearly every bit is set, every query returns &ldquo;probably present&rdquo; and the filter has stopped being
        useful without ever becoming incorrect. Watch the fill percentage climb as you insert.
      </p>
      <p>
        The false-positive rate works out to (1 − e^(−kn/m))^k, and the <strong>measure FP rate</strong> button tests
        that claim rather than asking you to take it on faith: it probes thousands of keys that were definitely never
        inserted and counts how many come back positive. Compare the two readouts. They track closely, but not exactly —
        the formula assumes perfectly independent hash functions, and this implementation uses one hash function with
        different seeds, which is a good approximation rather than a true one. Real implementations use the same trick.
      </p>
      <p>
        The <strong>k</strong> slider is the surprising one. More hashes is not better. Too few and a query is easy to
        satisfy by chance; too many and each insert sets so many bits that the filter saturates. The optimum is
        (m/n)·ln2, shown as <strong>best k here</strong>, and the readout updates as you insert because the best k
        depends on how loaded the filter is. Set k to 1 and then to 10 and measure both — the middle wins.
      </p>
      <p>
        Turned around, this gives the number worth memorising: about <strong>10 bits per key buys roughly a 1% false
        positive rate</strong>, and every additional 5 bits per key divides that rate by about ten. Ten bits per key is
        nothing compared to storing the keys themselves.
      </p>

      <h3>What it cannot do</h3>
      <ul>
        <li>
          <strong>No deletion.</strong> Clearing a key&rsquo;s bits would clear bits other keys rely on, and that would
          create a false negative — the one error a Bloom filter is not allowed to make. Counting Bloom filters replace
          each bit with a small counter to get deletion back, at several times the space.
        </li>
        <li>
          <strong>No resizing.</strong> Every bit position is computed modulo m, so changing m invalidates every
          position. The size buttons here rebuild by rehashing all the keys, which is only possible because this page
          keeps the key list. A real filter has no such list — that is the point of it — so you size it up front from an
          expected n, or rebuild it from the source data.
        </li>
        <li>
          <strong>No enumeration and no counting.</strong> You cannot ask what is in it, or how many times something was
          added. Insert the same key twice here and watch: the second insert claims no new bits at all.
        </li>
      </ul>

      <h3>In a real system</h3>
      <p>
        RocksDB and LevelDB put a filter on every SSTable, defaulting to about 10 bits per key. Cassandra does the same
        and exposes the target false-positive rate as a per-table setting, trading memory against read amplification.
        Postgres has had a Bloom index type since 9.6 for multi-column equality filtering.
      </p>
      <p>
        The same shape recurs across the reading list under other names. HyperLogLog answers &ldquo;how many distinct
        things have I seen&rdquo; with the same bounded-error-for-bounded-space bargain; Merkle trees let two replicas
        find their differences without exchanging their contents. Approximation with a provable error bound is one of
        the field&rsquo;s recurring moves, and this is its clearest example.
      </p>
    </>
  )
}
