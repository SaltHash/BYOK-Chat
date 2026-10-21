/* End-to-end citation flow for a normal (non-research) chat: the standing
 * citation rule in the system prompt, run-wide citation ids across several
 * searches, and citable page reads. These use the real store + engine with a
 * fake fetch, so they cover the orchestration the pure citations.ts tests
 * cannot. */
import test from 'node:test'
import assert from 'node:assert/strict'

// --- minimal browser shims the store/engine expect -------------------------
const storeMap = new Map()
globalThis.localStorage = {
  get length() { return storeMap.size },
  key: (i) => [...storeMap.keys()][i] ?? null,
  getItem: (k) => (storeMap.has(k) ? storeMap.get(k) : null),
  setItem: (k, v) => { storeMap.set(k, String(v)) },
  removeItem: (k) => { storeMap.delete(k) },
}
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0)
globalThis.cancelAnimationFrame = (id) => clearTimeout(id)

const json = (obj) => new Response(JSON.stringify(obj), { headers: { 'content-type': 'application/json' } })
const openai = (message) => json({ choices: [{ message }], usage: { prompt_tokens: 20, completion_tokens: 10 } })

let searchN = 0
/* The system prompt of every provider round that belongs to the reply (the
 * title generator is a separate call and is skipped). */
let systems = []

const realFetch = globalThis.fetch
const mockFetch = async (url, init) => {
  const u = String(url)
  if (u.includes('/api/search')) {
    searchN++
    // The server numbers every response from S1, so two searches would both
    // start at S1 — the app has to renumber them for the reply.
    return json({ query: 'fusion', results: [
      { id: 'S1', title: `A${searchN}`, url: `https://a${searchN}.test/p`, snippet: `snippet a${searchN}` },
      { id: 'S2', title: `B${searchN}`, url: `https://b${searchN}.test/p`, snippet: `snippet b${searchN}` },
    ], searchedAt: 'now', provider: 'tinyfish' })
  }
  if (u.includes('/api/extract')) return json({ url: 'https://extra.test/p', title: 'Extra page', text: 'A page body about fusion.', truncated: false })
  if (u.includes('/chat/completions')) {
    const body = JSON.parse(init.body)
    const sys = body.messages[0]?.content ?? ''
    if (sys.startsWith('Create a brief, specific topic label')) return openai({ content: 'Fusion Progress' })
    systems.push(sys)
    const toolMsgs = body.messages.filter((m) => m.role === 'tool')
    if (toolMsgs.length === 0) return openai({ content: 'Searching.', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search', arguments: JSON.stringify({ query: 'first' }) } }] })
    if (toolMsgs.length === 1) return openai({ content: 'More searching.', tool_calls: [{ id: 'c2', type: 'function', function: { name: 'search', arguments: JSON.stringify({ query: 'second' }) } }] })
    if (toolMsgs.length === 2) return openai({ content: 'Reading a page.', tool_calls: [{ id: 'c3', type: 'function', function: { name: 'fetch_page', arguments: JSON.stringify({ url: 'https://extra.test/p' }) } }] })
    return openai({ content: 'Fusion improves [S1], and the page confirms it [S5].' })
  }
  throw new Error('unexpected fetch ' + u)
}

const { useS } = await import('../src/store.ts')
const { collectMessageSources, citationCoverage } = await import('../src/citations.ts')

const lastAssistant = () => {
  const s = useS.getState()
  const c = s.chats.find((x) => x.id === s.chat)
  return [...(c?.msgs ?? [])].reverse().find((m) => m.r === 'assistant')
}
const wait = async (fn, ms = 5000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 10)) }
  return false
}
const replied = () => !useS.getState().busy && !!lastAssistant()?.t

const resetStore = (search = {}) => {
  const s = useS.getState()
  useS.setState({
    eps: [{ id: 'e1', name: 'Test', type: 'openai', url: 'https://api.test/v1', key: 'k', model: 'm1', models: ['m1'], modelsMode: 'separate', on: true }],
    sel: { k: 'ep', id: 'e1', model: 'm1' },
    chats: [], chat: '', busy: false, notice: null,
    search: { ...s.search, provider: 'tinyfish', keys: { tinyfish: 'k', you: '', exa: '', firecrawl: '', brightdata: '' }, reader: true, ...search },
    tools: { ...s.tools, search: true, fetch_page: true },
    features: { ...s.features, tools: true, playlists: false },
    params: { ...s.params, def: true },
    widgetPrefs: { ...s.widgetPrefs, charsPerToken: 4, contextLimit: 128000 },
  })
}

test.after(() => { globalThis.fetch = realFetch })

test('the citation rule is re-sent in every round of a grounded chat', async () => {
  globalThis.fetch = mockFetch
  searchN = 0
  systems = []
  resetStore()
  assert.equal(await useS.getState().send('what is happening with fusion?', []), true)
  assert.equal(await wait(replied), true, 'the reply should finish')

  // One round per tool call plus the round that writes the answer.
  assert.ok(systems.length >= 4, `expected at least 4 rounds, saw ${systems.length}`)
  for (const sys of systems) {
    assert.match(sys, /Cite every factual claim you take from that evidence inline/, 'every round carries the standing rule')
    assert.match(sys, /never invent an id/i)
  }
  // The rule is in the system prompt, not only inside a tool result.
  assert.doesNotMatch(systems[0], /Web search evidence/)
})

test('citations in a grounded chat resolve to the source the model was shown', async () => {
  globalThis.fetch = mockFetch
  searchN = 0
  systems = []
  resetStore()
  await useS.getState().send('what is happening with fusion?', [])
  assert.equal(await wait(replied), true, 'the reply should finish')
  const m = lastAssistant()
  const rounds = m.toolRounds ?? []
  assert.equal(rounds.length, 3, 'one round per tool call')

  // The second search continues the numbering instead of repeating S1/S2.
  assert.match(rounds[0].calls[0].result, /\[Source S1\]/)
  assert.match(rounds[0].calls[0].result, /\[Source S2\]/)
  assert.match(rounds[1].calls[0].result, /\[Source S3\]/)
  assert.match(rounds[1].calls[0].result, /\[Source S4\]/)
  assert.doesNotMatch(rounds[1].calls[0].result, /\[Source S1\]/)

  // A page read is a source like any other: it carries its own id and says
  // how to cite it.
  const page = rounds[2].calls[0].result
  assert.match(page, /\[Source S5\]/)
  assert.match(page, /Cite this page as \[S5\]/)

  // The reply's citations all point at a source the model was shown.
  const sources = collectMessageSources(m.toolRounds)
  assert.deepEqual(sources.map((s) => s.citeId), ['S1', 'S2', 'S3', 'S4', 'S5'])
  assert.deepEqual(citationCoverage(m.toolFinal ?? m.t, sources).unknown, [])
})

test('with inline citations off the model is told not to add markers', async () => {
  globalThis.fetch = mockFetch
  searchN = 0
  systems = []
  resetStore({ citeStyle: 'off' })
  await useS.getState().send('what is happening with fusion?', [])
  assert.equal(await wait(replied), true, 'the reply should finish')
  for (const sys of systems) assert.match(sys, /do not put \[S1\]/)
  const m = lastAssistant()
  // The page is still a listed source, it just is not cited inline.
  assert.match(m.toolRounds[2].calls[0].result, /\[Source S5\]/)
  assert.doesNotMatch(m.toolRounds[2].calls[0].result, /Cite this page as/)
  const sources = collectMessageSources(m.toolRounds)
  assert.deepEqual(sources.map((s) => s.citeId), ['S1', 'S2', 'S3', 'S4', 'S5'])
})
