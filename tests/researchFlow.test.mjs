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
const { collectMessageSources, citationCoverage, mergeSources } = await import('../src/citations.ts')
const { agentSources } = await import('../src/research.ts')

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
    eps: [{ id: 'e1', name: 'Test', type: 'openai', url: 'https://api.test/v1', key: 'k', model: 'm1', models: ['m1'], modelsMode: 'separate', prices: { m1: { input: 1, output: 2 } }, on: true }],
    sel: { k: 'ep', id: 'e1', model: 'm1' },
    chats: [], chat: '', busy: false, queued: {}, notice: null, researchRounds: 3,
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

test('a thorough run delegates a team, asks a follow-up, and merges agent sources', async () => {
  const seen = { agentSearches: 0, followups: 0, steerSet: false, steerInjected: false }
  globalThis.fetch = async (url, init) => {
    const u = String(url)
    if (u.includes('/chat/completions')) {
      const body = JSON.parse(init.body)
      const sys = body.messages[0]?.content ?? ''
      const msgs = body.messages
      const toolMsgs = msgs.filter((m) => m.role === 'tool')
      const lastUser = [...msgs].reverse().find((m) => m.role === 'user' && typeof m.content === 'string')
      if (sys.includes('You draft a deep-research plan')) return openai({ content: PLAN })
      // A delegated subagent: search once, then return a dense cited report. The
      // follow-up answers from that same evidence without searching again.
      if (sys.includes('You are a research subagent')) {
        if (sys.includes('Follow-up from the lead researcher')) {
          seen.followups++
          return openai({ content: '## Findings\n- The 2025 milestone is the best-evidenced one [S1].\n\n## Sources\n[S1] Source 1 — https://s1.test/p' })
        }
        if (!toolMsgs.length) {
          seen.agentSearches++
          return openai({ content: 'Starting the assignment.', tool_calls: [{ id: 'as1', type: 'function', function: { name: 'search', arguments: JSON.stringify({ query: 'fusion agent research' }) } }] })
        }
        return openai({ content: '## Findings\n- Milestone reached in 2025 [S1].\n- Second fact [S2].\n\n## Conflicts and caveats\n- None.\n\n## Sources\n[S1] Source 1 — https://s1.test/p\n[S2] Source 2 — https://s2.test/p' })
      }
      if (typeof lastUser?.content === 'string' && lastUser.content.includes('Now write the final report')) {
        return openai({ content: '## Summary\nFusion is progressing [S1].\n\n## Key findings\n- Milestone [S1].\n- Follow-up [S1].\n\n## Evidence\nSupported [S1].\n\n## Limitations\nSmall sample.\n\n## Sources note\nPrimary sources agree.' })
      }
      // The lead's search phase: delegate one round, ask one follow-up, close.
      const hasSubagent = toolMsgs.some((m) => String(m.content).includes('[Subagent'))
      const hasFollowUp = toolMsgs.some((m) => String(m.content).includes('[Follow-up with subagent'))
      if (msgs.some((m) => m.role === 'user' && String(m.content).includes('Prioritize the 2022 ignition result'))) seen.steerInjected = true
      if (!hasSubagent) {
        return openai({ content: 'Delegating two independent angles.', tool_calls: [{ id: 'd1', type: 'function', function: {
          name: 'delegate_research',
          arguments: JSON.stringify({ tasks: [
            { label: 'Milestones', brief: 'List fusion milestones since 2020.', avoid: 'Costs and funding' },
            { label: 'Projects', brief: 'Identify the leading fusion projects.', avoid: 'History before 2020' },
          ] }),
        } }] })
      }
      if (!hasFollowUp) {
        // The user adds a focus while the run is in flight. It must arrive on
        // a later lead round, without restarting or entering the chat history.
        if (!seen.steerSet) {
          const running = msgsOf().find((m) => m.research?.status === 'running')
          if (running) { useS.getState().steerResearch(running.id, 'Prioritize the 2022 ignition result'); seen.steerSet = true }
        }
        return openai({ content: 'Checking one thin point with the agent that owns it.', tool_calls: [{ id: 'f1', type: 'function', function: { name: 'ask_research_agent', arguments: JSON.stringify({ agent: 'Milestones', question: 'Which milestone is best evidenced?' }) } }] })
      }
      return openai({ content: 'The team established a clear timeline and a confirmed milestone.' })
    }
    return baseFetch(url, init)
  }
  searchN = 0
  resetStore()
  await useS.getState().send('@research[thorough](fusion team)', [])
  const pick = lastResearch()
  useS.getState().chooseResearchTier(pick.id, 'thorough')
  assert.equal(await wait(() => msgById(pick.id).research.status === 'plan', 10000), true, 'plan should be ready')
  useS.getState().startResearch(pick.id)
  assert.equal(await wait(() => msgById(pick.id).research.status === 'done', 20000), true, 'run should finish')
  const done = msgById(pick.id)
  const agents = done.research.agents ?? []
  assert.equal(agents.length, 2, 'both delegated agents are kept on the run')
  assert.ok(agents.every((a) => a.status === 'done'))
  assert.equal(agents[0].followUps.length, 1, 'the follow-up is stored on the agent')
  assert.ok(agents.every((a) => a.costUsd > 0), 'each subagent records its own spend for the round estimate')
  assert.ok(done.research.usage && done.research.usage.input > 0 && done.research.usage.output > 0, 'measured prompt and reply tokens are recorded for the run')
  assert.equal(seen.agentSearches, 2, 'each subagent searched once')
  assert.equal(seen.followups, 1, 'the follow-up answered from existing evidence')
  assert.equal(seen.steerInjected, true, 'a mid-run focus reaches the lead on its next round')
  assert.equal(done.research.steer, 'Prioritize the 2022 ignition result')
  assert.ok(msgsOf().every((m) => !(m.r === 'user' && String(m.t ?? '').includes('Mid-run update'))), 'the focus stays out of the visible chat')
  // Only one of the two parallel searches hit the provider because the second
  // agent's identical query was served from the search cache; both were billed
  // to their own agent budgets either way.
  const delegateCall = done.toolRounds.flatMap((r) => r.calls).find((c) => c.name === 'delegate_research')
  assert.ok(delegateCall && !delegateCall.error)
  assert.match(delegateCall.result, /\[Subagent Milestones/)
  const followCall = done.toolRounds.flatMap((r) => r.calls).find((c) => c.name === 'ask_research_agent')
  assert.ok(followCall && String(followCall.result).includes('[Follow-up with subagent Milestones'))
  const merged = mergeSources(collectMessageSources(done.toolRounds), agentSources(agents))
  assert.ok(merged.length >= 2, 'subagent sources reach the report source list')
  assert.deepEqual(citationCoverage(done.toolFinal ?? done.t, merged).unknown, [])
})

test('messages sent while a reply is running queue and dispatch after it', async () => {
  let release = () => {}
  const gate = new Promise((resolve) => { release = resolve })
  let gated = false
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/chat/completions')) {
      if (!gated) { gated = true; await gate }
      return openai({ content: 'Answer from the model.' })
    }
    return baseFetch(url, init)
  }
  resetStore()
  assert.equal(await useS.getState().send('first message', []), true)
  const chatId = useS.getState().chat
  assert.equal(await wait(() => useS.getState().busyChats?.[chatId] === true), true, 'the first reply is running')
  assert.equal(await useS.getState().send('queued message', []), true, 'a send while busy is accepted')
  assert.equal(useS.getState().queued[chatId]?.length, 1, 'the second message waits in the queue')
  release()
  assert.equal(await wait(() => (useS.getState().chats.find((c) => c.id === chatId)?.msgs ?? []).filter((m) => m.r === 'user').length === 2), true, 'the queued message is dispatched')
  assert.equal(await wait(() => useS.getState().busyChats?.[chatId] !== true && (useS.getState().queued[chatId]?.length ?? 0) === 0), true, 'the queue drains and the chat settles')
  const chat = useS.getState().chats.find((c) => c.id === chatId)
  assert.ok(chat.msgs.filter((m) => m.r === 'assistant' && String(m.t).includes('Answer from the model.')).length >= 2)
})

test('a finished report can be re-run as a fresh card', async () => {
  globalThis.fetch = baseFetch
  searchN = 0
  resetStore()
  await useS.getState().send('@research[quick](rerun test)', [])
  const pick = lastResearch()
  useS.getState().chooseResearchTier(pick.id, 'quick')
  assert.equal(await wait(() => msgById(pick.id).research.status === 'plan'), true, 'plan should be ready')
  useS.getState().startResearch(pick.id)
  assert.equal(await wait(() => msgById(pick.id).research.status === 'done'), true, 'the original run finishes')
  const oldIds = new Set(msgsOf().filter((m) => m.research).map((m) => m.id))
  useS.getState().rerunResearch(pick.id)
  assert.equal(await wait(() => msgsOf().some((m) => m.research && !oldIds.has(m.id) && m.research.status === 'done'), 15000), true, 'the re-run finishes as a new card')
  assert.equal(msgById(pick.id).research.status, 'done', 'the original report is kept')
  const fresh = msgsOf().find((m) => m.research && !oldIds.has(m.id))
  assert.equal(fresh.research.plan.title, 'Fusion Power')
  assert.equal(fresh.research.query, 'rerun test')
})

test('a prose planning reply is repaired into a usable plan', async () => {
  let repairs = 0
  globalThis.fetch = async (url, init) => {
    const u = String(url)
    if (u.includes('/api/search')) return json({ query: 'fusion', results: [{ id: 'S1', title: 'Src', url: 'https://s1.test/p', snippet: 'snippet' }], searchedAt: 'now', provider: 'tinyfish' })
    if (u.includes('/api/extract')) return json({ url: 'https://s1.test/p', title: 'Page', text: 'body' })
    if (u.includes('/chat/completions')) {
      const body = JSON.parse(init.body)
      const lastUser = [...body.messages].reverse().find((m) => m.role === 'user' && typeof m.content === 'string')?.content ?? ''
      if (String(lastUser).includes('previous reply did not contain a usable plan')) {
        repairs++
        return openai({ content: PLAN })
      }
      return openai({ content: 'I need to look into this. I will outline the work in prose for now.' })
    }
    throw new Error('unexpected fetch ' + u)
  }
  resetStore()
  await useS.getState().send('@research[quick](repair test)', [])
  const pick = lastResearch()
  useS.getState().chooseResearchTier(pick.id, 'quick')
  assert.equal(await wait(() => msgById(pick.id).research.status === 'plan'), true, 'the plan is ready after repair')
  assert.equal(repairs, 1, 'the planning reply was repaired once')
  assert.equal(msgById(pick.id).research.plan.title, 'Fusion Power')
  assert.equal(msgById(pick.id).research.error, undefined, 'no fallback warning is shown')
})

test.after(() => { globalThis.fetch = realFetch })

test('evidence gathered before an endpoint failure survives the failover', async () => {
  // Endpoint A runs one search, then dies. Endpoint B must continue from that
  // evidence (so the report still cites the source A gathered) instead of
  // starting the search phase from zero.
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
      // Only research-phase calls take part in the scripted failure; title or
      // helper calls must not consume the first "search" step. The phase is
      // keyed on this request's own history, so a stray in-flight request from
      // an earlier test can never shift it.
      if (!sys.includes('You are doing deep research on')) return openai({ content: 'ok' })
      if (!body.messages.some((m) => m.role === 'tool')) {
        return openai({ content: 'Searching.', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search', arguments: JSON.stringify({ query: 'fusion progress' }) } }] })
      }
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
  assert.ok(sources.length >= 1, `the failed endpoint's evidence is preserved (attempts: ${JSON.stringify((done.log ?? []).map((l) => `${l.n}/${l.m}${l.err ? ` ERR ${l.err}` : ''}`))})`)
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

test('the shown estimate blends candidate prices instead of assuming the priciest failover', async () => {
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
  const blended = { input: (1 + 100) / 2 * 1.08, output: (1 + 200) / 2 * 1.08 }
  const expected = estimateResearchUsage(tierOf('quick'), blended).costUsd
  const cheap = estimateResearchUsage(tierOf('quick'), { input: 1, output: 1 }).costUsd
  const pricey = estimateResearchUsage(tierOf('quick'), { input: 100, output: 200 }).costUsd
  assert.ok(cheap < expected && expected < pricey, 'the estimate blends the candidate prices')
  assert.equal(msgById(pick.id).research.estimate.costUsd, expected, 'the shown cost uses the blended price')
})

test('failed searches and unreadable pages never spend the research budget', async () => {
  // Every search before the eighth one fails with a permanent error, so the
  // old accounting would exhaust the quick tier's 8 searches before a single
  // result arrived and the run would close with no evidence.
  globalThis.fetch = async (url, init) => {
    const u = String(url)
    if (u.includes('/api/search')) {
      const q = String(JSON.parse(init.body).query ?? '')
      if (q.startsWith('fail')) return new Response('bad query', { status: 400 })
      searchN++
      return json({ query: 'fusion', results: [{ id: `S${searchN}`, title: `Source ${searchN}`, url: `https://s${searchN}.test/p`, snippet: `snippet ${searchN}` }], searchedAt: 'now', provider: 'tinyfish' })
    }
    if (u.includes('/api/extract')) {
      if (String(init.body).includes('fail.test')) return new Response('unreadable', { status: 400 })
      return json({ url: 'https://s1.test/p', title: 'Page', text: 'A long page body about fusion.', truncated: false })
    }
    if (u.includes('/chat/completions')) {
      const body = JSON.parse(init.body)
      const sys = body.messages[0]?.content ?? ''
      const lastUser = [...body.messages].reverse().find((m) => m.role === 'user' && typeof m.content === 'string')
      if (sys.includes('You draft a deep-research plan')) return openai({ content: PLAN })
      if (typeof lastUser?.content === 'string' && lastUser.content.includes('Now write the final report')) {
        return openai({ content: '## Summary\nFusion is progressing.\n\n## Key findings\n- Net energy gain reported [S1].\n\n## Evidence\nClaim supported [S1].\n\n## Limitations\nSmall sample.\n\n## Sources note\nPrimary sources agree.' })
      }
      const rounds = body.messages.filter((m) => m.role === 'tool').length
      const call = (name, args) => openai({ content: 'Continuing.', tool_calls: [{ id: `c${rounds}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
      if (rounds < 8) return call('search', { query: `fail ${rounds}` })
      if (rounds === 8) return call('search', { query: 'fusion one' })
      if (rounds === 9) return call('search', { query: 'fusion two' })
      if (rounds === 10) return call('fetch_page', { url: 'https://fail.test/p' })
      if (rounds === 11) return call('fetch_page', { url: 'https://s1.test/p' })
      return openai({ content: 'Fusion progress is real. The report will cover milestones, projects, and caveats.' })
    }
    return baseFetch(url, init)
  }
  searchN = 0
  resetStore()
  await useS.getState().send('@research[quick](failed attempts)', [])
  const pick = lastResearch()
  useS.getState().chooseResearchTier(pick.id, 'quick')
  await wait(() => msgById(pick.id).research.status === 'plan')
  useS.getState().startResearch(pick.id)
  assert.equal(await wait(() => msgById(pick.id).research.status === 'done', 20000), true, 'run should finish')
  const { countedSteps } = await import('../src/research.ts')
  const steps = msgById(pick.id).research.steps
  const failedSearch = steps.filter((s) => s.kind === 'search' && s.state === 'error')
  const goodSearch = steps.filter((s) => s.kind === 'search' && s.state === 'done')
  const failedRead = steps.filter((s) => s.kind === 'read' && s.state === 'error')
  const goodRead = steps.filter((s) => s.kind === 'read' && s.state === 'done')
  assert.equal(failedSearch.length, 8, 'all eight failures stay visible')
  assert.equal(goodSearch.length, 2, 'both searches after the failures still ran')
  assert.equal(failedRead.length, 1)
  assert.equal(goodRead.length, 1)
  assert.ok(failedSearch.every((s) => s.label === 'Search failed'))
  assert.ok(failedRead.every((s) => s.label === 'Read failed'))
  assert.equal(countedSteps(steps, 'search'), 2)
  assert.equal(countedSteps(steps, 'read'), 1)
})

test('a failed follow-up is recorded and returned as a tool error', async () => {
  let followAttempted = false
  let sawToolError = false
  globalThis.fetch = async (url, init) => {
    const u = String(url)
    if (u.includes('/chat/completions')) {
      const body = JSON.parse(init.body)
      const sys = body.messages[0]?.content ?? ''
      const msgs = body.messages
      const lastUser = [...msgs].reverse().find((m) => m.role === 'user' && typeof m.content === 'string')
      if (sys.includes('You draft a deep-research plan')) return openai({ content: PLAN })
      if (sys.includes('You are a research subagent')) {
        if (sys.includes('Follow-up from the lead researcher')) {
          followAttempted = true
          return openai({ content: '' })
        }
        if (!msgs.some((m) => m.role === 'tool')) {
          return openai({ content: 'Starting.', tool_calls: [{ id: 's1', type: 'function', function: { name: 'search', arguments: JSON.stringify({ query: 'solo research' }) } }] })
        }
        return openai({ content: '## Findings\n- The milestone is confirmed [S1].\n\n## Sources\n[S1] Source 1 — https://s1.test/p' })
      }
      if (typeof lastUser?.content === 'string' && lastUser.content.includes('Now write the final report')) {
        return openai({ content: '## Summary\nThe evidence is limited [S1].\n\n## Key findings\n- One fact [S1].\n\n## Evidence\nSupported [S1].\n\n## Limitations\nA follow-up failed.\n\n## Sources note\nOne source.' })
      }
      if (msgs.some((m) => m.role === 'tool' && String(m.content).includes('follow-up with Solo failed'))) {
        sawToolError = true
        return openai({ content: 'The follow-up failed, so I am closing with what the team established.' })
      }
      if (!msgs.some((m) => m.role === 'tool' && String(m.content).includes('[Subagent Solo'))) {
        return openai({ content: 'Delegating one focused angle.', tool_calls: [{ id: 'd1', type: 'function', function: {
          name: 'delegate_research',
          arguments: JSON.stringify({ tasks: [{ label: 'Solo', brief: 'Find the confirmed milestone.', depth: 'scan', avoid: 'Unrelated policy' }] }),
        } }] })
      }
      return openai({ content: 'Checking the thin point with Solo.', tool_calls: [{ id: 'f1', type: 'function', function: { name: 'ask_research_agent', arguments: JSON.stringify({ agent: 'Solo', question: 'Which milestone is confirmed?' }) } }] })
    }
    return baseFetch(url, init)
  }
  searchN = 0
  resetStore()
  await useS.getState().send('@research[thorough](failed follow-up)', [])
  const pick = lastResearch()
  useS.getState().chooseResearchTier(pick.id, 'thorough')
  assert.equal(await wait(() => msgById(pick.id).research.status === 'plan', 10000), true, 'plan should be ready')
  useS.getState().startResearch(pick.id)
  assert.equal(await wait(() => msgById(pick.id).research.status === 'done', 20000), true, 'run should finish')
  const done = msgById(pick.id)
  const agent = done.research.agents[0]
  assert.equal(followAttempted, true, 'the follow-up was attempted')
  assert.equal(sawToolError, true, 'the lead received a real tool error')
  assert.ok(agent.followUpErrors?.length, 'the failed follow-up is stored on the agent')
  assert.match(agent.followUpErrors[0], /empty response|no answer/i)
  const followCall = done.toolRounds.flatMap((r) => r.calls).find((c) => c.name === 'ask_research_agent')
  assert.equal(followCall.error, true)
  assert.match(followCall.result, /follow-up with Solo failed/i)
})
