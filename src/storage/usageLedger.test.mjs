import test from 'node:test'
import assert from 'node:assert/strict'

const { readUsageLedger, writeUsageLedger, usageLedgerExists, USAGE_LEDGER_KEY } = await import('./usageLedger.ts')

const originalStorage = globalThis.localStorage
/* A quota-limited localStorage stand-in: setItem throws once the value is
 * larger than the limit, exactly like the browser's QuotaExceededError. */
const memoryStorage = (limit = Infinity) => {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      const text = String(value)
      if (text.length > limit) {
        const error = new Error('quota')
        error.name = 'QuotaExceededError'
        throw error
      }
      values.set(key, text)
    },
    removeItem: (key) => values.delete(key),
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size },
  }
}

const row = (at) => ({ at, chatId: 'c1', messageId: 'm1', endpoint: 'Alpha', model: 'm1', tin: 10, tout: 1, cacheRead: 0, cacheWrite: 0, cost: 0 })

test('the kept ledger round-trips, validates and clears through an empty write', () => {
  globalThis.localStorage = memoryStorage()
  try {
    assert.equal(usageLedgerExists(), false)
    assert.deepEqual(readUsageLedger(), { rows: [], titles: {} })

    const rows = [row(5), { ...row(6), failed: true }]
    assert.deepEqual(writeUsageLedger(rows, { c1: 'Kept chat' }), rows)
    assert.equal(usageLedgerExists(), true)
    assert.deepEqual(readUsageLedger(), { rows, titles: { c1: 'Kept chat' } })

    // Clearing writes an empty ledger instead of deleting the key: a missing
    // key means "never seeded" and would re-adopt the chats on the next boot.
    assert.deepEqual(writeUsageLedger([], {}), [])
    assert.equal(usageLedgerExists(), true)
    assert.deepEqual(readUsageLedger(), { rows: [], titles: {} })
  } finally { globalThis.localStorage = originalStorage }
})

test('unreadable ledger data is ignored instead of breaking the dashboard', () => {
  globalThis.localStorage = memoryStorage()
  try {
    localStorage.setItem(USAGE_LEDGER_KEY, '{not json')
    assert.deepEqual(readUsageLedger(), { rows: [], titles: {} })
    localStorage.setItem(USAGE_LEDGER_KEY, JSON.stringify({ v: 1, rows: 'nope', titles: [] }))
    assert.deepEqual(readUsageLedger(), { rows: [], titles: {} })
  } finally { globalThis.localStorage = originalStorage }
})

test('a quota-limited write keeps the newest half rather than failing outright', () => {
  const rows = Array.from({ length: 10 }, (_, i) => row(i))
  const full = JSON.stringify({ v: 1, rows, titles: {} })
  globalThis.localStorage = memoryStorage(full.length - 1)
  try {
    const saved = writeUsageLedger(rows, {})
    assert.equal(saved.length, 5)
    assert.equal(saved[saved.length - 1].at, 9, 'the oldest attempts are dropped first')
    assert.deepEqual(readUsageLedger().rows, saved)
  } finally { globalThis.localStorage = originalStorage }
})

test('a ledger that cannot be written at all keeps the rows in memory', () => {
  globalThis.localStorage = memoryStorage(1)
  try {
    const rows = [row(1), row(2)]
    assert.deepEqual(writeUsageLedger(rows, {}), rows)
    assert.deepEqual(readUsageLedger(), { rows: [], titles: {} })
  } finally { globalThis.localStorage = originalStorage }
})
