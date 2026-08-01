/** An event waiting to fire at a virtual time. */
export interface Scheduled<E> {
  time: number
  /** Insertion order, used to break ties so equal times fire deterministically. */
  seq: number
  event: E
}

/**
 * A binary min-heap of pending events, ordered by virtual time.
 *
 * The tie-break on insertion order is the whole reason this exists rather than
 * a sorted array: two events scheduled for the same tick must fire in a fixed
 * order every run, or replaying a seed stops reproducing the same history.
 */
export class EventQueue<E> {
  private heap: Scheduled<E>[] = []
  private counter = 0

  get size(): number {
    return this.heap.length
  }

  get isEmpty(): boolean {
    return this.heap.length === 0
  }

  push(time: number, event: E): void {
    this.heap.push({ time, seq: this.counter++, event })
    this.siftUp(this.heap.length - 1)
  }

  /** Virtual time of the earliest pending event, or undefined when empty. */
  peekTime(): number | undefined {
    return this.heap[0]?.time
  }

  pop(): Scheduled<E> | undefined {
    const top = this.heap[0]
    if (top === undefined) return undefined
    const last = this.heap.pop() as Scheduled<E>
    if (this.heap.length > 0) {
      this.heap[0] = last
      this.siftDown(0)
    }
    return top
  }

  clear(): void {
    this.heap = []
    this.counter = 0
  }

  private before(a: Scheduled<E>, b: Scheduled<E>): boolean {
    return a.time !== b.time ? a.time < b.time : a.seq < b.seq
  }

  private siftUp(start: number): void {
    let index = start
    const node = this.heap[index] as Scheduled<E>
    while (index > 0) {
      const parent = (index - 1) >> 1
      const parentNode = this.heap[parent] as Scheduled<E>
      if (!this.before(node, parentNode)) break
      this.heap[index] = parentNode
      index = parent
    }
    this.heap[index] = node
  }

  private siftDown(start: number): void {
    let index = start
    const node = this.heap[index] as Scheduled<E>
    const length = this.heap.length
    for (;;) {
      const left = index * 2 + 1
      if (left >= length) break
      const right = left + 1
      let child = left
      if (right < length && this.before(this.heap[right] as Scheduled<E>, this.heap[left] as Scheduled<E>)) {
        child = right
      }
      const childNode = this.heap[child] as Scheduled<E>
      if (!this.before(childNode, node)) break
      this.heap[index] = childNode
      index = child
    }
    this.heap[index] = node
  }
}
