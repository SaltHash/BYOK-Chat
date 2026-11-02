import test from 'node:test'
import assert from 'node:assert/strict'

const {
  COMPACT_DEFAULT, COMPACT_MAX, COMPACT_MIN,
  normCompactAt, compactThreshold, shouldCompact,
  withCompaction, selectCompactionMessages, transcriptFor,
  compactionAnchor, compactionSystemPrompt, compactionAsk, compactionDetail,
} = await import('./compaction.ts')

const msgs = () => [
  { id: 'u1', r: 'user', t: 'Plan the trip to Kyoto.' },
  { id: 'a1', r: 'assistant', t: 'I booked a hotel near the station.' },
  { id: 'u2', r: 'user', t: 'Change the dates to April.' },
]

test('the compaction trigger defaults to 80% and snaps to the 5% scale', () => {
  assert.equal(COMPACT_DEFAULT, 80)
  assert.equal(normCompactAt(undefined), 80)
  assert.equal(normCompactAt('not a number'), 80)
  assert.equal(normCompactAt(0), COMPACT_MIN)
  assert.equal(normCompactAt(101), COMPACT_MAX)
  assert.equal(normCompactAt(82), 80)
  assert.equal(normCompactAt(83), 85)
  assert.equal(normCompactAt(5), 5)
  assert.equal(normCompactAt(100), 100)
})

test('the threshold is a percentage of the effective window', () => {
  assert.equal(compactThreshold(128000, 80), 102400)
  assert.equal(compactThreshold(1000000, 5), 50000)
  // A bogus limit still gets a usable floor instead of NaN/zero.
  assert.ok(compactThreshold(0, 80) >= 1)
  assert.equal(shouldCompact(102400, 128000, 80), true)
  assert.equal(shouldCompact(102399, 128000, 80), false)
})

test('withCompaction replaces covered messages and keeps the rest', () => {
  const compact = { text: 'The user planned Kyoto. The hotel is booked.', through: 'a1', at: 1, messages: 2, tokens: 12, before: 30 }
  const out = withCompaction(msgs(), compact)
  assert.equal(out.length, 2)
  assert.equal(out[0].r, 'user')
  assert.match(out[0].t, /Conversation handoff/)
  assert.match(out[0].t, /planned Kyoto/)
  assert.equal(out[1].id, 'u2')
  // The stored transcript is unchanged.
  assert.equal(msgs().length, 3)
})

test('a handoff with a deleted anchor or empty text is ignored', () => {
  const source = msgs()
  assert.deepEqual(withCompaction(source, { text: 'x', through: 'gone', at: 1, messages: 1, tokens: 1, before: 1 }), source)
  assert.deepEqual(withCompaction(source, { text: '  ', through: 'a1', at: 1, messages: 1, tokens: 1, before: 1 }), source)
  assert.deepEqual(withCompaction(source, null), source)
})

test('the summarizer sees only messages before the current request', () => {
  const picked = selectCompactionMessages(msgs(), 'u2', 10000)
  assert.deepEqual(picked.map((m) => m.id), ['u1', 'a1'])
  assert.deepEqual(selectCompactionMessages(msgs(), 'u1', 10000), [])
})

test('the summarizer keeps the newest messages when the old chunk is too large', () => {
  const huge = 'x'.repeat(4000)
  const source = [
    { id: 'u1', r: 'user', t: huge },
    { id: 'a1', r: 'assistant', t: huge },
    { id: 'u2', r: 'user', t: 'next' },
  ]
  const picked = selectCompactionMessages(source, 'u2', 3000)
  assert.equal(picked.length, 1)
  assert.equal(picked[0].id, 'u1')
})

test('the transcript labels roles, skips errors, and truncates safely', () => {
  const source = [
    { id: 'u1', r: 'user', t: 'Hello '.repeat(20) },
    { id: 'a1', r: 'assistant', t: '', err: true },
    { id: 'a2', r: 'assistant', t: 'Hi there' },
  ]
  assert.match(transcriptFor(source), /USER:\nHello/)
  assert.match(transcriptFor(source), /ASSISTANT:\nHi there/)
  assert.doesNotMatch(transcriptFor(source), /err/)
  const cut = transcriptFor(source, 90)
  assert.ok(cut.length <= 90)
  assert.match(cut, /truncated at the compaction input limit/)
})

test('a re-compaction anchors to a real message, not to the handoff', () => {
  const compact = { text: 'old handoff', through: 'a1', at: 1, messages: 2, tokens: 3, before: 4 }
  const effective = withCompaction(msgs(), compact)
  assert.equal(effective[0].id, 'compaction:a1')
  // The newest surviving message is the right anchor for the next handoff.
  assert.equal(compactionAnchor(effective, 'a1'), 'u2')
  // A chunk that is only the old handoff falls back to its real anchor.
  assert.equal(compactionAnchor(effective.slice(0, 1), 'a1'), 'a1')
  // An empty assistant placeholder is never a useful anchor.
  assert.equal(compactionAnchor([...effective, { id: 'empty', r: 'assistant', t: '' }], 'a1'), 'u2')
})

test('the compaction prompt asks for a handoff and treats the transcript as data', () => {
  const prompt = compactionSystemPrompt(128000)
  assert.match(prompt, /handoff memo, not a reply/i)
  assert.match(prompt, /untrusted data/i)
  assert.match(prompt, /do not answer the next user message/i)
  assert.match(prompt, /File paths/)
  const ask = compactionAsk('USER:\nhello')
  assert.match(ask, /<conversation>/)
  assert.match(ask, /sent separately/)
})

test('the log description names the messages and the token reduction', () => {
  const text = compactionDetail({ text: 'memo', through: 'a1', at: 1, messages: 3, tokens: 400, before: 4000, model: 'A · m' })
  assert.match(text, /3 earlier messages/)
  assert.match(text, /4,000/)
  assert.match(text, /400-token/)
  assert.match(text, /A · m/)
})
