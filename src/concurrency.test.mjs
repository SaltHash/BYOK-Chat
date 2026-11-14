import test from 'node:test'
import assert from 'node:assert/strict'
import { runPool, withDeadline } from './concurrency.ts'

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('runPool never exceeds its limit and runs every item', async () => {
  let active = 0
  let peak = 0
  const done = []
  await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
    active++
    peak = Math.max(peak, active)
    await wait(5)
    active--
    done.push(n)
  })
  assert.deepEqual(done.slice().sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7])
  assert.ok(peak <= 3, `peak concurrency was ${peak}`)
  assert.ok(peak > 1, 'items must actually overlap')
})

test('a slow item does not hold back the ones behind it', async () => {
  const done = []
  await runPool([1, 2, 3, 4, 5], 2, async (n) => {
    // The first item is the slowest by far; the pool is expected to keep
    // working through the rest while it waits.
    await wait(n === 1 ? 40 : 5)
    done.push(n)
  })
  assert.equal(done[done.length - 1], 1, 'the slow item must finish last')
  assert.deepEqual(done.slice(0, -1), [2, 3, 4, 5])
})

test('a limit above the item count just runs them all', async () => {
  const seen = []
  await runPool(['a', 'b'], 10, async (x) => { seen.push(x) })
  assert.deepEqual(seen, ['a', 'b'])
})

test('runPool of nothing settles immediately', async () => {
  await runPool([], 4, async () => { throw Error('never called') })
})

test('withDeadline resolves a prompt answer and rejects a silent one', async () => {
  assert.equal(await withDeadline(Promise.resolve('ok'), 100), 'ok')
  await assert.rejects(withDeadline(new Promise(() => {}), 20, 'The provider'), /The provider did not answer within 1 s/)
})
