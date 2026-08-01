export function WalExplainer() {
  return (
    <>
      <p>
        An append to a write-ahead log is fast for an uninteresting reason: it does not touch the disk. It appends to a
        buffer in memory and returns. That is why it is fast, and also why, on its own, it guarantees nothing at all —
        pull the power cord and the buffer is gone.
      </p>
      <p>
        The <code>fsync</code> is what turns a write into a promise. It is also expensive, on the order of milliseconds
        rather than nanoseconds, which sets up the trade every storage engine has to make: sync on every write and be
        durable but slow, or wait and batch and be fast but exposed.
      </p>
      <p>
        Press <strong>append</strong> a few times quickly and watch what happens. The first append starts a flush timer;
        the ones that follow join the same pending flush rather than starting their own. When it fires, they all become
        durable together. That is <strong>group commit</strong>, and it is why a busy database can often do more writes
        per second than it can do fsyncs per second.
      </p>
      <p>
        Then press <strong>crash</strong> while records are still sitting in the buffer. Everything above the line
        vanishes; everything below it survives. Scrub backward and watch it happen again — the past is still recorded,
        so you can replay the moment the data was lost as many times as you like.
      </p>

      <h3>What to notice</h3>
      <ul>
        <li>
          The flush delay is randomized, but the run is not random. The seed fixes it, so the same sequence of clicks
          always produces the same history. Reset and repeat to confirm.
        </li>
        <li>
          An fsync that fires on an empty buffer still costs a syscall and flushes nothing. Crash mid-window and you can
          watch one happen.
        </li>
        <li>
          Nothing here is undone when you scrub backward. Every state is retained, so moving back in time is a seek, not
          a reversal.
        </li>
      </ul>

      <h3>In a real system</h3>
      <p>
        PostgreSQL calls this the WAL and lets you tune exactly this trade with <code>synchronous_commit</code>. In
        Elasticsearch it is the translog, flushed every <code>index.translog.sync_interval</code> — five seconds by
        default, which is a deliberate and well-documented window of acceptable loss. An LSM-tree, the next concept on
        the roadmap, puts a WAL in front of its memtable for precisely this reason: the memtable is the buffer above,
        and it is just as volatile.
      </p>
    </>
  )
}
