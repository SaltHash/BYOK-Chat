import test from 'node:test'
import assert from 'node:assert/strict'

const {
  chatAttemptLogs, lastReplyBy, lastLogMessage, allAttemptLogs, allAttemptAts,
  deriveUsage, groupUsage, usageRange, SESSION_START, NO_LOGS,
} = await import('./usage.ts')

const log1 = [{ n: 'A', m: 'a-model', tin: 100, tout: 20, at: 1000 }]
const log2 = [{ n: 'A', m: 'a-model', tin: 300, tout: 40, at: 2000 }]
const chat = {
  id: 'c1',
  msgs: [
    { id: 'u1', r: 'user', t: 'hi', at: 900 },
    { id: 'a1', r: 'assistant', t: 'yo', by: 'A', log: log1, at: 1000 },
    { id: 'a2', r: 'assistant', t: 'streaming...', at: 1500 },
    { id: 'a3', r: 'assistant', t: 'done', by: 'A', log: log2, at: 2000 },
  ],
}
const chats = [chat, { id: 'c2', msgs: [{ id: 'b1', r: 'assistant', t: '', log: [{ n: 'B', m: 'b-model', err: 'nope', at: 3000 }], at: 3000 }] }]

test('chatAttemptLogs returns only completed attempt logs, oldest first', () => {
  const logs = chatAttemptLogs(chats, 'c1')
  assert.equal(logs.length, 2)
  assert.equal(logs[0], log1)
  assert.equal(logs[1], log2)
  assert.equal(chatAttemptLogs(chats, 'missing'), NO_LOGS)
  assert.equal(chatAttemptLogs(chats, null), NO_LOGS)
})

test('lastReplyBy and lastLogMessage track the newest reporting message', () => {
  assert.equal(lastReplyBy(chats, 'c1'), 'A')
  assert.equal(lastLogMessage(chats, 'c1').id, 'a3')
  assert.equal(lastReplyBy([chat], 'nope'), '')
  assert.equal(lastLogMessage([chat], 'nope'), undefined)
})

test('allAttemptLogs/allAttemptAts stay index-aligned across chats', () => {
  const logs = allAttemptLogs(chats)
  const ats = allAttemptAts(chats)
  assert.equal(logs.length, 3)
  assert.deepEqual(ats, [1000, 2000, 3000])
  assert.equal(logs[2], chats[1].msgs[0].log)
})

test('usageRange maps periods to windows', () => {
  const now = 10 * 86400000
  assert.deepEqual(usageRange({ period: 'day', now }), { start: now - 86400000, end: Infinity })
  assert.deepEqual(usageRange({ period: 'week', now }), { start: now - 7 * 86400000, end: Infinity })
  assert.deepEqual(usageRange({ period: 'all', now }), { start: 0, end: Infinity })
  assert.deepEqual(usageRange({ period: 'session', now }), { start: SESSION_START, end: Infinity })
  assert.deepEqual(usageRange({ period: 'custom', from: '1970-01-02', to: '1970-01-03', now }), { start: 86400000, end: 3 * 86400000 })
  assert.deepEqual(usageRange({ period: 'custom', from: '', to: '', now }), { start: 0, end: Infinity })
})

test('groupUsage filters by window and groups per endpoint or model', () => {
  const logs = allAttemptLogs(chats)
  const ats = allAttemptAts(chats)
  const all = groupUsage(logs, ats, undefined, { start: 0, end: Infinity })
  assert.deepEqual(all.map((g) => g.key).sort(), ['A', 'B'])
  const a = all.find((g) => g.key === 'A')
  assert.deepEqual({ ok: a.ok, bad: a.bad, tin: a.tin, tout: a.tout }, { ok: 2, bad: 0, tin: 400, tout: 60 })
  const b = all.find((g) => g.key === 'B')
  assert.deepEqual({ ok: b.ok, bad: b.bad }, { ok: 0, bad: 1 })

  const recent = groupUsage(logs, ats, undefined, { start: 2500, end: Infinity })
  assert.deepEqual(recent.map((g) => g.key), ['B'])

  const byModel = groupUsage(allAttemptLogs(chats), ats, 'model', { start: 0, end: Infinity })
  assert.deepEqual(byModel.map((g) => g.key).sort(), ['A · a-model', 'B · b-model'])
})

test('groupUsage falls back to the owning message timestamp', () => {
  const noAt = [[{ n: 'engine', m: '', err: 'boom' }]]
  assert.deepEqual(groupUsage(noAt, [5000], undefined, { start: 6000, end: Infinity }), [])
  assert.equal(groupUsage(noAt, [5000], undefined, { start: 4000, end: Infinity })[0].bad, 1)
})

test('deriveUsage resolves the context limit and reports reply/chat cost', () => {
  const eps = [{ id: 'e1', name: 'A', on: true, url: 'https://x', model: 'a-model', modelContext: { 'a-model': 2000 }, prices: { 'a-model': { input: 1, output: 2 } } }]
  const u = deriveUsage({ logs: chatAttemptLogs(chats, 'c1'), lastBy: lastReplyBy(chats, 'c1'), eps, sel: null, manualLimit: 128000 })
  assert.equal(u.hasReply, true)
  assert.equal(u.tin, 300)
  assert.equal(u.tout, 40)
  assert.equal(u.tok, 340)
  assert.equal(u.limit, 2000)
  assert.equal(u.over, false)
  // No provider-reported cost: falls back to the price table.
  assert.equal(u.replyCost, (300 * 1 + 40 * 2) / 1e6)
  // Chat cost spans every logged entry, including the earlier reply.
  assert.equal(u.chatCost, (100 * 1 + 20 * 2) / 1e6 + (300 * 1 + 40 * 2) / 1e6)
  assert.equal(u.modelLabel, 'A Model')
})

test('deriveUsage prefers provider-reported cost and the selection limit', () => {
  const reported = [[{ n: 'A', m: 'a-model', tin: 10, tout: 5, cost: 0.5, at: 1 }]]
  const eps = [
    { id: 'e1', name: 'A', on: true, url: 'https://x', model: 'a-model' },
    { id: 'e2', name: 'B', on: true, url: 'https://y', model: 'b-model', modelContext: { 'b-model': 64000 } },
  ]
  const u = deriveUsage({ logs: reported, lastBy: 'A', eps, sel: { k: 'ep', id: 'e2', model: 'b-model' }, manualLimit: 128000 })
  assert.equal(u.replyCost, 0.5, 'reported spend wins')
  assert.equal(u.chatCost, 0.5)
  assert.equal(u.limit, 64000, 'selection model context applies when the reply has none')
})

test('deriveUsage with no logs reports an empty meter at the manual limit', () => {
  const u = deriveUsage({ logs: NO_LOGS, lastBy: '', eps: [], sel: null, manualLimit: 40000 })
  assert.equal(u.hasReply, false)
  assert.equal(u.tok, 0)
  assert.equal(u.limit, 40000)
  assert.equal(u.pct, 0)
  assert.equal(u.chatCost, 0)
})

test('uncached input never goes negative when cache reads exceed input', () => {
  const logs = [[{ n: 'A', m: 'm', tin: 10, tout: 1, cacheRead: 100, cacheWrite: 5, at: 1 }]]
  const u = deriveUsage({ logs, lastBy: '', eps: [], sel: null, manualLimit: 1000 })
  assert.equal(u.uncached, 0)
})
