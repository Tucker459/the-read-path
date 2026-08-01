import { describe, expect, it } from 'vitest'
import { EventQueue } from './queue'
import { createRng } from './rng'

function drain<E>(queue: EventQueue<E>): E[] {
  const out: E[] = []
  for (;;) {
    const next = queue.pop()
    if (next === undefined) break
    out.push(next.event)
  }
  return out
}

describe('EventQueue', () => {
  it('pops in time order regardless of insertion order', () => {
    const queue = new EventQueue<string>()
    queue.push(30, 'c')
    queue.push(10, 'a')
    queue.push(20, 'b')
    expect(drain(queue)).toEqual(['a', 'b', 'c'])
  })

  it('breaks ties by insertion order', () => {
    const queue = new EventQueue<string>()
    queue.push(5, 'first')
    queue.push(5, 'second')
    queue.push(5, 'third')
    expect(drain(queue)).toEqual(['first', 'second', 'third'])
  })

  it('reports the earliest pending time', () => {
    const queue = new EventQueue<string>()
    expect(queue.peekTime()).toBeUndefined()
    queue.push(9, 'late')
    queue.push(2, 'early')
    expect(queue.peekTime()).toBe(2)
    queue.pop()
    expect(queue.peekTime()).toBe(9)
  })

  it('tracks size and emptiness', () => {
    const queue = new EventQueue<number>()
    expect(queue.isEmpty).toBe(true)
    queue.push(1, 1)
    queue.push(2, 2)
    expect(queue.size).toBe(2)
    expect(queue.isEmpty).toBe(false)
    queue.clear()
    expect(queue.isEmpty).toBe(true)
    expect(queue.pop()).toBeUndefined()
  })

  it('handles interleaved pushes and pops', () => {
    const queue = new EventQueue<number>()
    queue.push(10, 10)
    queue.push(20, 20)
    expect(queue.pop()?.event).toBe(10)
    queue.push(5, 5)
    queue.push(15, 15)
    expect(drain(queue)).toEqual([5, 15, 20])
  })

  it('matches a sorted reference under random load', () => {
    const rng = createRng('heap')
    const queue = new EventQueue<number>()
    const reference: { time: number; seq: number }[] = []

    for (let i = 0; i < 2000; i++) {
      // Deliberately few distinct times, so ties are common and the
      // insertion-order tie-break gets a real workout.
      const time = rng.int(0, 25)
      queue.push(time, i)
      reference.push({ time, seq: i })
    }

    reference.sort((a, b) => (a.time !== b.time ? a.time - b.time : a.seq - b.seq))
    expect(drain(queue)).toEqual(reference.map((entry) => entry.seq))
  })
})
