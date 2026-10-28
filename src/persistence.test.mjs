import test from 'node:test'
import assert from 'node:assert/strict'

const { pruneChatForPersist, createPersistMapper, planPersistShards, joinPersistShards, compactChatForQuota, CHAT_SHARD_PREFIX } = await import('./persistence.ts')

const chat = (id, t) => ({ id, title: id, msgs: [{ id: `${id}-1`, r: 'user', t }] })
const persist = (chats) => JSON.stringify({ version: 22, state: { prefs: { showBy: true }, chats } })

test('persisted chats are split into per-chat shards and only changed chats are rewritten', () => {
  const prev = new Map()
  const first = planPersistShards(persist([chat('a', 'one'), chat('b', 'two')]), prev)
  assert.equal(first.writes.length, 2)
  for (const w of first.writes) prev.set(w.key, w.value)
  assert.ok(prev.has(`${CHAT_SHARD_PREFIX}a`))
  assert.equal(JSON.parse(first.main).state.chats.length, 0)
  assert.deepEqual(JSON.parse(first.main).state.__byokChatIds, ['a', 'b'])

  const second = planPersistShards(persist([chat('a', 'one'), chat('b', 'two changed')]), prev)
  assert.deepEqual(second.writes.map((w) => w.key), [`${CHAT_SHARD_PREFIX}b`])
})

test('sharded persistence reassembles the exact state and deletes removed chats', () => {
  const prev = new Map()
  const plan = planPersistShards(persist([chat('a', 'one'), chat('b', 'two')]), prev)
  for (const w of plan.writes) prev.set(w.key, w.value)
  const read = (k) => prev.get(k) ?? null
  const joined = JSON.parse(joinPersistShards(plan.main, read))
  assert.deepEqual(joined.state.chats.map((c) => c.id), ['a', 'b'])
  assert.equal(joined.state.prefs.showBy, true)
  assert.equal(joined.version, 22)

  const removed = planPersistShards(persist([chat('a', 'one')]), prev)
  assert.deepEqual(removed.deletes, [`${CHAT_SHARD_PREFIX}b`])
})

test('boot blocks queued writes until recovery completes', async () => {
  const { spawnSync } = await import('node:child_process')
  const script = `
    globalThis.window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
    const values = new Map([['byok.v1', 'original']]);
    globalThis.localStorage = { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k), key: i => [...values.keys()][i] ?? null, get length() { return values.size } };
    const { persistStorage, allowPersistWritesAfterBoot } = await import('./src/persistence.ts');
    persistStorage.setItem('byok.v1', { version: 22, state: { chats: [] } });
    persistStorage.flush();
    if (values.get('byok.v1') !== 'original') throw Error('boot overwrote original');
    allowPersistWritesAfterBoot();
    persistStorage.setItem('byok.v1', { version: 22, state: { chats: [] } });
    persistStorage.flush();
    if (!JSON.parse(values.get('byok.v1')).state.__byokSharded) throw Error('write did not resume');
  `
  const result = spawnSync(process.execPath, ['--import', './tests/register-loader.mjs', '--input-type=module', '-e', script], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
})

test('quota compaction keeps the newest visible messages and drops regenerable payloads', () => {
  const c = { id: 'a', msgs: Array.from({ length: 120 }, (_, i) => ({ id: `m${i}`, r: 'user', t: `t${i}`, toolRounds: [{ calls: [] }], reasoning: 'x' })) }
  const small = compactChatForQuota(c, 80)
  assert.equal(small.msgs.length, 80)
  assert.equal(small.msgs[0].t, 't40')
  assert.equal('toolRounds' in small.msgs[0], false)
  assert.equal('reasoning' in small.msgs[0], false)
})

test('pruneChatForPersist drops empty assistant placeholders and keeps real messages', () => {
  const chat = {
    id: 'c1',
    msgs: [
      { id: 'u1', r: 'user', t: 'hello' },
      { id: 'a1', r: 'assistant', t: '' },
      { id: 'a2', r: 'assistant', t: '', err: true },
      { id: 'a3', r: 'assistant', t: '', research: { id: 'r' } },
      { id: 'a4', r: 'assistant', t: 'answer' },
    ],
  }
  const out = pruneChatForPersist(chat)
  assert.deepEqual(out.msgs.map((m) => m.id), ['u1', 'a2', 'a3', 'a4'])
})

test('pruneChatForPersist strips attachment bytes but keeps metadata', () => {
  const chat = {
    id: 'c1',
    msgs: [{ id: 'u1', r: 'user', t: 'see file', att: [{ name: 'a.pdf', kind: 'pdf', size: '2 KB', mime: 'application/pdf', source: 'upload', pages: 3, data: 'BASE64BYTES', text: 'extracted' }] }],
  }
  const [m] = pruneChatForPersist(chat).msgs
  assert.deepEqual(m.att, [{ name: 'a.pdf', kind: 'pdf', size: '2 KB', mime: 'application/pdf', source: 'upload', pages: 3 }])
  assert.equal('data' in m.att[0], false)
  assert.equal('text' in m.att[0], false)
})

test('persist mapper reuses the mapped copy for unchanged chats', () => {
  const map = createPersistMapper()
  const a = { id: 'a', msgs: [{ id: 'm', r: 'user', t: 'x' }] }
  const b = { id: 'b', msgs: [{ id: 'm', r: 'user', t: 'y' }] }
  const first = map([a, b])
  // A store write replaces only the chat that changed.
  const a2 = { ...a, msgs: [...a.msgs, { id: 'm2', r: 'assistant', t: 'z' }] }
  const second = map([a2, b])
  assert.equal(second[1], first[1], 'unchanged chat keeps its mapped copy')
  assert.notEqual(second[0], first[0], 'changed chat is re-mapped')
  assert.equal(second[0].msgs.length, 2)
})

test('persist mapper output is stable state, not mutated by later writes', () => {
  const map = createPersistMapper()
  const a = { id: 'a', msgs: [{ id: 'm', r: 'user', t: 'x' }] }
  const out = map([a])
  const a2 = { ...a, msgs: [] }
  map([a2])
  assert.equal(out[0].msgs.length, 1)
})
