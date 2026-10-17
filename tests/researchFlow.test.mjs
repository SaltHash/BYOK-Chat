/* End-to-end deep research flow against a mocked provider: plan generation,
 * the search/read tool loop, report writing, and citation verification.
 * These use the real store + engine with a fake fetch, so they cover the
 * orchestration that the pure research.ts tests cannot. */
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

const PLAN = JSON.stringify({
  title: 'Fusion Power',
  intro: 'Assess the state of fusion power.',
  steps: [
    { kind: 'search', label: 'Research Websites', items: ['(1) Find recent fusion milestones.', '(2) Identify leading projects.'] },
    { kind: 'analyze', label: 'Analyze Results', items: ['(3) Cross-check the claims.'] },
    { kind: 'report', label: 'Create Report', items: ['(4) Write the cited report.'] },
  ],
})

const json = (obj) => new Response(JSON.stringify(obj), { headers: { 'content-type': 'application/json' } })
const openai = (message) => json({ choices: [{ message }], usage: { prompt_tokens: 20, completion_tokens: 10 } })

let searchN = 0
const realFetch = globalThis.fetch
const baseFetch = async (url, init) => {
  const u = String(url)
  if (u.includes('/api/search')) {
    searchN++
    return json({ query: 'fusion', results: [
      { id: `S${searchN}`, title: `Source ${searchN}`, url: `https://s${searchN}.test/p`, snippet: `snippet ${searchN}` },
      { id: `S${searchN}b`, title: `Source ${searchN}b`, url: `https://s${searchN}b.test/p`, snippet: `snippet ${searchN}b` },
    ], searchedAt: 'now', provider: 'tinyfish' })
  }
  if (u.includes('/api/extract')) return json({ url: 'https://s1.test/p', title: 'Page', text: 'A long page body about fusion.', truncated: false })
  if (u.includes('/chat/completions')) {
    const body = JSON.parse(init.body)
    const sys = body.messages[0]?.content ?? ''
    const msgs = body.messages
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user' && typeof m.content === 'string')
    if (sys.includes('You draft a deep-research plan')) return openai({ content: PLAN })
    if (typeof lastUser?.content === 'string' && lastUser.content.includes('do not exist in the evidence')) {
      return openai({ content: '## Summary\nCited [S1] after repair.' })
    }
    if (typeof lastUser?.content === 'string' && lastUser.content.includes('Now write the final report')) {
      return openai({ content: '## Summary\nFusion is progressing.\n\n## Key findings\n- Net energy gain reported [S1].\n\n## Evidence\nClaim supported [S1].\n\n## Limitations\nSmall sample.\n\n## Sources note\nPrimary sources agree.' })
    }
    if (!msgs.some((m) => m.role === 'tool')) {
      return openai({ content: 'Kicking off.', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search', arguments: JSON.stringify({ query: 'fusion progress' }) } }] })
    }
    if (!msgs.some((m) => m.role === 'tool' && String(m.content).includes('<page_excerpt>'))) {
      return openai({ content: 'Reading the best result.', tool_calls: [{ id: 'c2', type: 'function', function: { name: 'fetch_page', arguments: JSON.stringify({ url: 'https://s1.test/p' }) } }] })
    }
    return openai({ content: 'Fusion progress is real. The report will cover milestones, projects, and caveats.' })
  }
  throw new Error('unexpected fetch ' + u)
}

const { useS } = await import('../src/store.ts')
const { collectMessageSources, citationCoverage } = await import('../src/citations.ts')

const msgsOf = () => {
  const s = useS.getState()
  return s.chats.find((c) => c.id === s.chat)?.msgs ?? []
}
const lastResearch = () => [...msgsOf()].reverse().find((m) => m.research)
const msgById = (id) => msgsOf().find((m) => m.id === id)
const wait = async (fn, ms = 5000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 10)) }
  return false
}

const resetStore = () => {
  const s = useS.getState()
  useS.setState({
    eps: [{ id: 'e1', name: 'Test', type: 'openai', url: 'https://api.test/v1', key: 'k', model: 'm1', models: ['m1'], modelsMode: 'separate', on: true }],
    sel: { k: 'ep', id: 'e1', model: 'm1' },
    chats: [], chat: '', busy: false, notice: null,
    search: { ...s.search, provider: 'tinyfish', keys: { tinyfish: 'k', you: '', exa: '', firecrawl: '', brightdata: '' }, reader: true },
    tools: { ...s.tools, search: true, fetch_page: true },
    features: { ...s.features, tools: true, playlists: false },
    params: { ...s.params, def: true },
    widgetPrefs: { ...s.widgetPrefs, charsPerToken: 4, contextLimit: 128000 },
  })
}

test('deep research drafts a plan, runs, and reports with verified citations', async () => {
  globalThis.fetch = baseFetch
  searchN = 0
  resetStore()
  const ok = await useS.getState().send('@research[quick](fusion power)', [])
  assert.equal(ok, true)
  const pick = lastResearch()
  assert.equal(pick.research.status, 'tier-pick')

  useS.getState().chooseResearchTier(pick.id, 'quick')
  assert.equal(await wait(() => msgById(pick.id).research.status === 'plan'), true, 'plan should be ready')
  const planning = msgById(pick.id).research
  assert.equal(planning.plan.steps.length, 3)
  assert.equal(planning.plan.title, 'Fusion Power')
  assert.equal(planning.plan.steps[0].kind, 'search')
  assert.ok(planning.estimate.inputTokens > 0)
  // Nothing has run yet.
  assert.equal(planning.steps.length, 0)
  // A deep-research-first chat is named after the report's plan title, not the
  // raw request the user typed.
  const chat = useS.getState().chats.find((c) => c.id === useS.getState().chat)
  assert.equal(chat.title, 'Fusion Power')

  useS.getState().startResearch(pick.id)
  assert.equal(await wait(() => msgById(pick.id).research.status === 'done'), true, 'run should finish')
  const done = msgById(pick.id)
  assert.match(done.t, /## Summary/)
  assert.match(done.t, /\[S1\]/)
  const sources = collectMessageSources(done.toolRounds)
  assert.ok(sources.length >= 2)
  assert.deepEqual(citationCoverage(done.toolFinal ?? done.t, sources).unknown, [])
  assert.ok(done.research.steps.some((s) => s.kind === 'search' && s.state === 'done'))
  assert.ok(done.research.steps.some((s) => s.kind === 'read'))
  assert.equal(done.research.plan.title, 'Fusion Power')
})

test('an invented citation is repaired and any leftover stripped', async () => {
  // The report cites S99 (never returned); the repair pass keeps misbehaving.
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/chat/completions')) {
      const body = JSON.parse(init.body)
      const sys = body.messages[0]?.content ?? ''
      const lastUser = [...body.messages].reverse().find((m) => m.role === 'user' && typeof m.content === 'string')
      if (sys.includes('You draft a deep-research plan')) return openai({ content: PLAN })
      if (typeof lastUser?.content === 'string' && lastUser.content.includes('do not exist in the evidence')) return openai({ content: '## Summary\nStill bad [S99].' })
      if (typeof lastUser?.content === 'string' && lastUser.content.includes('Now write the final report')) return openai({ content: '## Summary\nCited [S99] and [S1].' })
      if (!body.messages.some((m) => m.role === 'tool')) {
        return openai({ content: 'search', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search', arguments: JSON.stringify({ query: 'fusion progress' }) } }] })
      }
      return openai({ content: 'Done searching, writing the report now.' })
    }
    return baseFetch(url, init)
  }
  searchN = 0
  resetStore()
  await useS.getState().send('@research[quick](fusion citations)', [])
  const pick = lastResearch()
  useS.getState().chooseResearchTier(pick.id, 'quick')
  await wait(() => msgById(pick.id).research.status === 'plan')
  useS.getState().startResearch(pick.id)
  assert.equal(await wait(() => msgById(pick.id).research.status === 'done'), true, 'run should finish')
  const done = msgById(pick.id)
  assert.doesNotMatch(done.t, /S99/)
  assert.ok(done.t.trim().length > 0)
  assert.ok((done.log ?? []).some((l) => l.n === 'Citations' && /S99/.test(l.detail ?? '')), 'the stripped id should be logged')
})

test('stopping a run keeps its work and offers a resume', async () => {
  // Streaming is no longer artificially paced, so each provider round must be
  // delayed here to keep the run genuinely in flight when we stop it.
  const slowFetch = async (url, init) => { await new Promise((r) => setTimeout(r, 50)); return baseFetch(url, init) }
  globalThis.fetch = slowFetch
  searchN = 0
  resetStore()
  await useS.getState().send('@research[quick](fusion stop)', [])
  const pick = lastResearch()
  useS.getState().chooseResearchTier(pick.id, 'quick')
  await wait(() => msgById(pick.id).research.status === 'plan')
  useS.getState().startResearch(pick.id)
  assert.equal(await wait(() => msgById(pick.id).research.steps.length >= 1), true, 'should start searching')
  useS.getState().stopResearch(pick.id)
  assert.equal(await wait(() => msgById(pick.id).research.status === 'stopped'), true, 'should stop')
  // The plan and steps survive the stop, so the work is not stranded.
  assert.equal(msgById(pick.id).research.plan.title, 'Fusion Power')
  assert.ok(msgById(pick.id).research.steps.length >= 1)
  const before = msgById(pick.id).research.steps.length

  // Resume keeps the prior steps (and their evidence) and finishes the run.
  useS.getState().resumeResearch(pick.id)
  assert.equal(await wait(() => msgById(pick.id).research.status === 'done'), true, 'resumed run should finish')
  assert.match(msgById(pick.id).t, /## Summary/)
  assert.ok(msgById(pick.id).research.steps.length >= before)
  assert.deepEqual(citationCoverage(msgById(pick.id).toolFinal ?? msgById(pick.id).t, collectMessageSources(msgById(pick.id).toolRounds)).unknown, [])
})

test('planning scopes the topic with a few context searches before the plan', async () => {
  // The planning call searches for context (capped at PLAN_SCOPE_MAX) and only
  // then returns the plan JSON.
  globalThis.fetch = async (url, init) => {
    const u = String(url)
    if (u.includes('/chat/completions')) {
      const body = JSON.parse(init.body)
      const sys = body.messages[0]?.content ?? ''
      if (sys.includes('You draft a deep-research plan')) {
        const done = body.messages.filter((m) => m.role === 'tool').length
        if (done < 3) return openai({ content: 'Getting context.', tool_calls: [{ id: `ctx${done}`, type: 'function', function: { name: 'search', arguments: JSON.stringify({ query: `context ${done}` }) } }] })
        return openai({ content: PLAN })
      }
      return openai({ content: '## Summary\nDone.' })
    }
    return baseFetch(url, init)
  }
  searchN = 0
  resetStore()
  await useS.getState().send('@research[quick](scoping test)', [])
  const pick = lastResearch()
  useS.getState().chooseResearchTier(pick.id, 'quick')
  assert.equal(await wait(() => msgById(pick.id).research.status === 'plan'), true, 'plan should be ready')
  // The model searched 2-4 times for basic context before drafting the plan.
  assert.ok(searchN >= 2 && searchN <= 4, `expected 2-4 context searches, saw ${searchN}`)
  assert.equal(msgById(pick.id).research.plan.title, 'Fusion Power')
})

test.after(() => { globalThis.fetch = realFetch })

test('evidence gathered before an endpoint failure survives the failover', async () => {
  // Endpoint A runs one search, then dies. Endpoint B must continue from that
  // evidence (so the report still cites the source A gathered) instead of
  // starting the search phase from zero.
  const a = { calls: 0 }
  globalThis.fetch = async (url, init) => {
    const u = String(url)
    if (u.includes('/api/search')) return json({ query: 'fusion', results: [{ id: 'S1', title: 'Src', url: 'https://s1.test/p', snippet: 'snippet' }], searchedAt: 'now', provider: 'tinyfish' })
    if (u.includes('/api/extract')) return json({ url: 'https://s1.test/p', title: 'Page', text: 'body' })
    if (u.includes('api2.test')) {
      const body = JSON.parse(init.body)
      const lastUser = [...body.messages].reverse().find((m) => m.role === 'user' && typeof m.content === 'string')
      if (typeof lastUser?.content === 'string' && lastUser.content.includes('Now write the final report')) return openai({ content: '## Summary\nFusion improves [S1].' })
      return openai({ content: 'Abstract: fusion is progressing.' })
    }
    if (u.includes('api.test')) {
      const body = JSON.parse(init.body)
      const sys = body.messages[0]?.content ?? ''
      if (sys.includes('You draft a deep-research plan')) return openai({ content: PLAN })
      a.calls++
      if (a.calls === 1) return openai({ content: 'Searching.', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search', arguments: JSON.stringify({ query: 'fusion progress' }) } }] })
      return new Response('upstream exploded', { status: 500 })
    }
    throw new Error('unexpected fetch ' + u)
  }
  searchN = 0
  resetStore()
  useS.setState({
    eps: [
      { id: 'e1', name: 'A', type: 'openai', url: 'https://api.test/v1', key: 'k', model: 'm1', models: ['m1'], modelsMode: 'separate', on: true },
      { id: 'e2', name: 'B', type: 'openai', url: 'https://api2.test/v1', key: 'k', model: 'm2', models: ['m2'], modelsMode: 'separate', on: true },
    ],
    sel: null,
  })
  await useS.getState().send('@research[quick](fusion failover)', [])
  const pick = lastResearch()
  useS.getState().chooseResearchTier(pick.id, 'quick')
  assert.equal(await wait(() => msgById(pick.id).research.status === 'plan'), true, 'plan should be ready')
  useS.getState().startResearch(pick.id)
  assert.equal(await wait(() => msgById(pick.id).research.status === 'done'), true, 'run should finish on the second endpoint')
  const done = msgById(pick.id)
  const sources = collectMessageSources(done.toolRounds)
  assert.ok(sources.length >= 1, 'the failed endpoint\u2019s evidence is preserved')
  assert.match(done.t, /\[S1\]/, 'the report cites the source gathered before the failure')
  assert.deepEqual(citationCoverage(done.toolFinal ?? done.t, sources).unknown, [])
})

test('a report that cites nothing is repaired with the run\u2019s sources', async () => {
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/chat/completions')) {
      const body = JSON.parse(init.body)
      const sys = body.messages[0]?.content ?? ''
      const lastUser = [...body.messages].reverse().find((m) => m.role === 'user' && typeof m.content === 'string')
      if (sys.includes('You draft a deep-research plan')) return openai({ content: PLAN })
      if (typeof lastUser?.content === 'string' && lastUser.content.includes('cites no sources')) return openai({ content: '## Summary\nNow cited [S1].' })
      if (typeof lastUser?.content === 'string' && lastUser.content.includes('Now write the final report')) return openai({ content: '## Summary\nFusion is real but uncited.' })
      if (!body.messages.some((m) => m.role === 'tool')) return openai({ content: 'searching', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search', arguments: JSON.stringify({ query: 'fusion' }) } }] })
      return openai({ content: 'Abstract done.' })
    }
    return baseFetch(url, init)
  }
  searchN = 0
  resetStore()
  await useS.getState().send('@research[quick](uncited test)', [])
  const pick = lastResearch()
  useS.getState().chooseResearchTier(pick.id, 'quick')
  await wait(() => msgById(pick.id).research.status === 'plan')
  useS.getState().startResearch(pick.id)
  assert.equal(await wait(() => msgById(pick.id).research.status === 'done'), true, 'run should finish')
  const done = msgById(pick.id)
  assert.match(done.t, /\[S1\]/, 'the repaired citation is present')
  assert.ok((done.log ?? []).some((l) => /cited no sources/.test(l.detail ?? '')), 'the uncited repair is logged')
})

test('a run that closes after a single search is nudged to keep researching', async () => {
  let nudges = 0
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/chat/completions')) {
      const body = JSON.parse(init.body)
      const sys = body.messages[0]?.content ?? ''
      const lastUser = [...body.messages].reverse().find((m) => m.role === 'user' && typeof m.content === 'string')
      if (sys.includes('You draft a deep-research plan')) return openai({ content: PLAN })
      if (typeof lastUser?.content === 'string' && lastUser.content.includes('only run 1 search')) {
        nudges++
        return nudges === 1
          ? openai({ content: 'Extra search.', tool_calls: [{ id: 'c2', type: 'function', function: { name: 'search', arguments: JSON.stringify({ query: 'fusion deeper' }) } }] })
          : openai({ content: 'Closing after the nudge.' })
      }
      if (typeof lastUser?.content === 'string' && lastUser.content.includes('Now write the final report')) return openai({ content: '## Summary\nCited [S1].' })
      if (!body.messages.some((m) => m.role === 'tool')) return openai({ content: 'One search.', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search', arguments: JSON.stringify({ query: 'fusion' }) } }] })
      return openai({ content: 'Closing after one search.' })
    }
    return baseFetch(url, init)
  }
  searchN = 0
  resetStore()
  await useS.getState().send('@research[quick](min search test)', [])
  const pick = lastResearch()
  useS.getState().chooseResearchTier(pick.id, 'quick')
  await wait(() => msgById(pick.id).research.status === 'plan')
  useS.getState().startResearch(pick.id)
  assert.equal(await wait(() => msgById(pick.id).research.status === 'done'), true, 'run should finish')
  assert.ok(nudges >= 1, 'the run was nudged after a single search')
  const done = msgById(pick.id)
  assert.ok(done.research.steps.filter((s) => s.kind === 'search').length >= 2, 'the nudge produced a second search')
})

test('the shown estimate uses the most expensive candidate price, not just the first', async () => {
  globalThis.fetch = baseFetch
  searchN = 0
  resetStore()
  useS.setState({
    eps: [
      { id: 'e1', name: 'Cheap', type: 'openai', url: 'https://api.test/v1', key: 'k', model: 'm1', models: ['m1'], modelsMode: 'separate', prices: { m1: { input: 1, output: 1 } }, on: true },
      { id: 'e2', name: 'Pricey', type: 'openai', url: 'https://api.test/v1', key: 'k', model: 'm2', models: ['m2'], modelsMode: 'separate', prices: { m2: { input: 100, output: 200 } }, on: true },
    ],
    sel: null,
  })
  await useS.getState().send('@research[quick](price ceiling)', [])
  const pick = lastResearch()
  useS.getState().chooseResearchTier(pick.id, 'quick')
  assert.equal(await wait(() => msgById(pick.id).research.status === 'plan'), true, 'plan should be ready')
  const { estimateResearchUsage, tierOf } = await import('../src/research.ts')
  const expected = estimateResearchUsage(tierOf('quick'), { input: 100, output: 200 }).costUsd
  assert.ok(expected > 0)
  assert.equal(msgById(pick.id).research.estimate.costUsd, expected, 'the ceiling reflects the priciest candidate')
})
