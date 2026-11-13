/* Localhost-only test model endpoint. It speaks the OpenAI streaming shape the
 * app already parses, but every token is generated here: no provider, key or
 * network call is involved. The route refuses non-loopback hosts so a deployed
 * Worker can never expose it. */
import { jsonResult, readBodyText, requestHost } from './http.mjs'

const BODY_LIMIT = 256 * 1024

const isLoopbackHost = (host) => {
  const name = String(host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase()
  return name === 'localhost' || name === '127.0.0.1' || name === '::1'
}

const sse = (payload) => `data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`
const delta = (content) => ({ id: 'mock', object: 'chat.completion.chunk', model: 'mock', choices: [{ index: 0, delta: { content } }] })
const usage = (tin, tout) => ({ id: 'mock', object: 'chat.completion.chunk', model: 'mock', choices: [], usage: { prompt_tokens: tin, completion_tokens: tout, total_tokens: tin + tout } })
const finish = (reason = 'stop') => ({ id: 'mock', object: 'chat.completion.chunk', model: 'mock', choices: [{ index: 0, delta: {}, finish_reason: reason }] })

/** Turn a piece of text into a few streamed SSE chunks. */
function streamText(text) {
  const chunks = String(text).match(/[\s\S]{1,240}/g) ?? []
  return [
    ...chunks.map((part) => sse(delta(part))),
    sse(finish()),
    sse(usage(Math.max(40, Math.ceil(String(text).length / 4)), Math.max(20, Math.ceil(String(text).length / 8)))),
    sse('[DONE]'),
  ]
}

function streamToolCall(name, args) {
  return [
    sse({ id: 'mock', object: 'chat.completion.chunk', model: 'mock', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_mock_1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] }),
    sse(finish('tool_calls')),
    sse(usage(60, 18)),
    sse('[DONE]'),
  ]
}

const markdownReply = () => `## Mock markdown stream

This reply comes from the **local test endpoint**, so no API key or provider request was used. It exists to exercise Markdown rendering, streaming and copy controls.

### What this checks

- Headings, **bold**, *italic* and \`inline code\`
- Ordered and unordered lists
- Block quotes and tables
- Fenced code and inline math

> A test model should be obvious, deterministic and safe to run offline.

| Feature | Covered | Notes |
| --- | :---: | --- |
| Streaming | Yes | Sent as OpenAI-style SSE chunks |
| Markdown | Yes | Tables, code, math and links |
| Provider calls | No | Everything is generated locally |

\`\`\`ts
type LocalMock = { model: string; streamed: true }
const reply: LocalMock = { model: 'mock-markdown', streamed: true }
console.log(reply)
\`\`\`

The context-free energy of the mock universe is $E = mc^2$ (approximately). See the [local test notes](https://example.com/mock-research/brief) for the fictional source behind this demo.

**Next:** try the **Tool caller** or **Deep research** model in the same endpoint.`

function toolReply(messages) {
  const result = [...messages].reverse().find((m) => m?.role === 'tool')
  const text = typeof result?.content === 'string' ? result.content.slice(0, 500) : ''
  return `### Tool call completed

The local test model called a real app tool, and the tool loop returned:

\`\`\`text
${text || 'No tool result was returned.'}
\`\`\`

This confirms that tool schemas, tool calls, tool results and the follow-up round all work without contacting a provider.

- The call was **generated locally**.
- The tool itself ran in the app, not on a server.
- The follow-up reply was rebuilt from the tool result.`
}

function researchPlan() {
  return JSON.stringify({
    title: 'Mock local deep research',
    intro: 'Demonstrate the full deep-research flow using canned local evidence.',
    startNow: true,
    steps: [
      { kind: 'search', label: 'Gather mock evidence', items: ['Collect the three fictional sources from the local dataset', 'Compare the brief with the independent field notes'] },
      { kind: 'analyze', label: 'Weigh the evidence', items: ['Identify where the sources agree and where they conflict', 'Separate sourced findings from inference'] },
      { kind: 'report', label: 'Write the report', items: ['Lead with a TL;DR verdict and cite the mock sources'] },
    ],
  })
}

const cleanTopic = (system, prompt) => {
  const fromSystem = /You are doing deep research on:\s*([^\n]+)/i.exec(system)?.[1]
  const fromPrompt = /Topic:\s*([^\n]+)/i.exec(prompt)?.[1]
  return String(fromSystem || fromPrompt || prompt || 'the request').replace(/\s+/g, ' ').trim().slice(0, 160)
}

const researchReport = (query) => `## TL;DR

This is a **local deep-research demonstration**. The mock evidence supports a clear three-part finding: the synthetic brief and the dataset documentation agree on scope and method, while the independent field notes contest one conclusion. Because every source here is fictional, the result demonstrates the research flow, citations and report layout rather than making a factual claim about “${String(query || 'the topic').slice(0, 120)}”.

## What the evidence shows

The demonstration dataset is deliberately small but internally consistent. The [S1] brief defines the question, names its sample and states the limits of the fictional data. The [S2] field notes corroborate the definitions and the method, but disagree with the brief's strongest conclusion. The [S3] dataset documentation is the closest thing to a primary source: it records the method, revision history and known gaps.

- **Agreement:** all three sources describe the same synthetic scope and warn against generalizing from it.
- **Disagreement:** the field notes treat the headline finding as provisional; the brief presents it as settled.
- **Best-supported reading:** treat the finding as provisional, because the source closest to the data documents known gaps.

## How much to trust this

This is not real evidence. The source names, URLs and findings are fabricated by the local test endpoint so the app can exercise planning, search, citations, synthesis and the report panel offline. In a real run, the same structure would carry genuine sources and credibility notes.

## Leads for further research

- Test a real question through the same flow and compare the citation coverage.
- Try a Thorough run to see the larger search and read budgets in the research card.
- Inspect how contested sources are surfaced when the report cites more than one side.

## Sources

- **[S1]** [Mock Research Brief: Local Demonstration Dataset](https://example.com/mock-research/brief): Defines the fictional scope and headline finding. *Relevance:* frames the question. *Credibility:* secondary and synthetic, but internally consistent.
- **[S2]** [Mock Field Notes: Secondary Analysis](https://example.com/mock-research/field-notes): Corroborates the method and disputes the strongest conclusion. *Relevance:* supplies the counterpoint. *Credibility:* independent within the fiction, explicitly provisional.
- **[S3]** [Mock Dataset Documentation](https://example.com/mock-research/dataset): Method notes, definitions and revision history. *Relevance:* grounds the analysis. *Credibility:* primary-source style for this fictional dataset, with known gaps disclosed.`

/** POST /api/mock/chat/completions, GET /api/mock/models */
export async function apiMock(req, env = process.env) {
  if (!isLoopbackHost(requestHost(req))) return jsonResult(404, { error: 'Not found' })
  const pathname = (() => { try { return new URL(req.url ?? '', 'http://localhost').pathname } catch { return '' } })()
  if (req.method === 'GET' && /\/models\/?$/.test(pathname)) {
    return jsonResult(200, { object: 'list', data: ['mock-markdown', 'mock-tools', 'mock-deep-research'].map((id) => ({ id, object: 'model', owned_by: 'local-test-models' })) })
  }
  if (req.method !== 'POST') return jsonResult(405, { error: 'Method not allowed' }, { allow: 'POST' })
  const raw = await readBodyText(req, BODY_LIMIT)
  if (raw === null) return jsonResult(413, { error: 'Request is too large' })
  let body
  try { body = JSON.parse(raw) } catch { return jsonResult(400, { error: 'Expected a JSON chat request' }) }
  const model = String(body?.model ?? 'mock-markdown')
  const messages = Array.isArray(body?.messages) ? body.messages : []
  const tools = Array.isArray(body?.tools) ? body.tools : []
  const system = messages.filter((m) => m?.role === 'system').map((m) => String(m.content ?? '')).join('\n\n')
  const prompt = messages.filter((m) => m?.role === 'user').map((m) => String(m.content ?? '')).join('\n\n')
  let chunks

  if (model === 'mock-tools') {
    const usedTool = messages.some((m) => m?.role === 'tool')
    const toolNames = tools.map((t) => String(t?.function?.name ?? '')).filter(Boolean)
    const callable = ['date', 'time', 'count', 'calc'].find((name) => toolNames.includes(name))
    if (!usedTool && callable) chunks = streamToolCall(callable, callable === 'calc' ? { expression: '2+2' } : callable === 'count' ? { text: 'local mock tool call' } : {})
    else chunks = [...streamText(usedTool ? toolReply(messages) : `### No tool schema was available\n\nThe **Tool caller** test model needs at least one enabled tool so it can demonstrate a real tool round. Enable a tool in Settings → Tools, then send the message again.\n\n- Reply generated locally by \`mock-tools\`.\n- No provider request was made.`)]
  } else if (model === 'mock-deep-research') {
    if (/You draft a deep-research plan/.test(system)) chunks = streamText(researchPlan())
    else {
      const hasEvidence = messages.some((m) => m?.role === 'tool' && /search_evidence|<search_evidence>|Source S\d+/i.test(String(m.content ?? '')))
      const toolNames = tools.map((t) => String(t?.function?.name ?? '')).filter(Boolean)
      const isResearch = /You are doing deep research|research subagent/i.test(system)
      if (isResearch && !hasEvidence && toolNames.includes('search')) {
        const topic = (prompt.match(/Topic:\s*(.+)/)?.[1] ?? prompt.slice(0, 120) ?? 'local mock research').trim()
        chunks = streamToolCall('search', { query: `mock local research: ${topic.slice(0, 120)}` })
      } else {
        chunks = streamText(researchReport(cleanTopic(system, prompt)))
      }
    }
  } else {
    chunks = streamText(markdownReply())
  }

  return {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'private, no-store',
      'x-accel-buffering': 'no',
    },
    body: null,
    sseChunks: chunks,
  }
}
