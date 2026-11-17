/* Shared "lean" shaping for every saved copy of a conversation.
 *
 * A message carries two very different kinds of data:
 *
 *   1. what a reader sees — text, byline, model label, token counts, timings,
 *      the tool-call rows ("searched the web, 1.2s"), research narration;
 *   2. what only the device that produced the reply can use — uploaded file
 *      bytes and extracted text, the composed system prompt, raw request
 *      bodies, full tool arguments and results, retry alternatives and the
 *      evidence transcripts behind citations.
 *
 * The second kind is regularly 10-100x larger than the first and is almost
 * never read again. It is dropped from the persisted copy, the durable mirror
 * and anything uploaded, while every visible field survives. Shaping is pure
 * and idempotent, so it can run at each storage boundary without changing the
 * live in-memory message.
 *
 * No DOM, no store imports (persistence.ts and the sync modules both use it).
 */

type Obj = Record<string, unknown>

export type LeanMessageOptions = {
  /** Chars kept from each tool result. 0 (default) drops results entirely. */
  toolResultChars?: number
  /** Chars kept from each tool argument string. 0 (default) drops them. */
  toolArgChars?: number
  /** Chars kept from the reasoning summary. 0 drops it. */
  reasoningChars?: number
  /** Chars kept from research narration fields (note, steer, lead). */
  researchChars?: number
  /** Keep retry alternatives. Off by default: they duplicate reply text. */
  alternatives?: boolean
  /** Chars kept from a tool round's narration text. */
  toolTextChars?: number
  /** Keep the process log: the step rows behind "Process to answer". It is a
   *  local trace of how the reply was produced, so the saved copies keep it
   *  while sync payloads still drop it. */
  keepLog?: boolean
  /** Chars kept from each step's detail text (and its error). */
  logChars?: number
}

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const clip = (v: unknown, n: number): unknown => (typeof v === 'string' && v.length > n ? `${v.slice(0, n)}…` : v)

/** Fields that only ever meant something to the request that produced them. */
const REQUEST_ONLY = ['full', 'sys', 'log', 'fx', 'ctx', 'historyTokens', 'explicitTokens'] as const

const ATTACHMENT_META = ['name', 'kind', 'size', 'mime', 'source', 'pages', 'chars', 'truncated', 'modelName'] as const

/** Steps a single reply may carry in its saved process log. */
const MAX_LOG_STEPS = 120

/** One process-log row: what the panel draws, without paged payloads. */
function leanLogEntry(value: unknown, chars: number): unknown {
  if (!isObj(value)) return value
  const out: Obj = {}
  // Everything the panel and the usage/cost readouts draw, and nothing that
  // grows with the size of the request.
  for (const key of ['n', 'm', 'ms', 'at', 'tin', 'tout', 'contextTin', 'contextTout', 'cacheRead', 'cacheWrite', 'cost', 'errCode'] as const) {
    if (value[key] !== undefined) out[key] = value[key]
  }
  if (typeof value.detail === 'string' && chars > 0) out.detail = clip(value.detail, chars)
  if (typeof value.err === 'string') out.err = clip(value.err, Math.min(800, Math.max(200, chars)))
  return out
}

/** Attachment metadata without the file itself. */
export function leanAttachment(value: unknown): Obj | null {
  if (!isObj(value)) return null
  const out: Obj = {}
  for (const key of ATTACHMENT_META) if (value[key] !== undefined) out[key] = value[key]
  return out
}

/** A tool call as an indicator: which tool, whether it failed, how long it
 *  took. The arguments and the result are payloads, not indicators. */
export function leanCall(value: unknown, opts: LeanMessageOptions = {}): Obj | null {
  if (!isObj(value)) return null
  const out: Obj = {}
  for (const key of ['id', 'name', 'error', 'denied', 'ms', 'truncated'] as const) if (value[key] !== undefined) out[key] = value[key]
  const resultChars = Math.max(0, Number(opts.toolResultChars ?? 0) || 0)
  const argChars = Math.max(0, Number(opts.toolArgChars ?? 0) || 0)
  if (resultChars > 0 && typeof value.result === 'string') out.result = clip(value.result, resultChars)
  if (argChars > 0 && typeof value.arguments === 'string') out.arguments = clip(value.arguments, argChars)
  return out
}

function leanResearch(value: unknown, opts: LeanMessageOptions): unknown {
  if (!isObj(value)) return value
  const chars = Math.max(0, Number(opts.researchChars ?? 2000) || 0)
  const out: Obj = {}
  for (const key of ['id', 'query', 'tier', 'status', 'startedAt', 'finishedAt', 'mode'] as const) if (value[key] !== undefined) out[key] = value[key]
  if (typeof value.summary === 'string') out.summary = clip(value.summary, chars)
  if (typeof value.note === 'string') out.note = clip(value.note, chars)
  if (typeof value.reasoning === 'string') out.reasoning = clip(value.reasoning, chars)
  if (typeof value.steer === 'string') out.steer = clip(value.steer, Math.min(chars, 800))
  if (isObj(value.plan)) {
    const plan = value.plan
    out.plan = {
      ...(plan.title !== undefined ? { title: clip(plan.title, 200) } : {}),
      ...(plan.intro !== undefined ? { intro: clip(plan.intro, 600) } : {}),
      ...(Array.isArray(plan.steps) ? {
        steps: (plan.steps as unknown[]).slice(0, 12).map((step) => isObj(step)
          ? { ...step, label: clip(step.label, 200), items: Array.isArray(step.items) ? step.items.slice(0, 12).map((item) => clip(item, 300)) : undefined }
          : step),
      } : {}),
    }
  }
  if (Array.isArray(value.steps)) {
    out.steps = (value.steps as unknown[]).slice(-120).map((step) => isObj(step)
      ? {
        ...step,
        label: clip(step.label, 200),
        lead: typeof step.lead === 'string' ? clip(step.lead, chars) : step.lead,
        queries: Array.isArray(step.queries) ? step.queries.slice(0, 8).map((query) => clip(query, 300)) : undefined,
      }
      : step)
  }
  // Delegated agents: keep the small, user-facing identity and their source
  // list; their briefs, answers and follow-up transcripts are payloads.
  if (Array.isArray(value.agents)) {
    out.agents = (value.agents as unknown[]).slice(-24).map((agent) => isObj(agent) ? {
      id: agent.id, label: agent.label, name: agent.name, status: agent.status, error: clip(agent.error, 300),
      ...(Array.isArray(agent.sources) ? { sources: agent.sources.slice(0, 40) } : {}),
    } : agent)
  }
  return out
}

/** Shape one message for storage. Never mutates the input. */
export function leanMessage(value: unknown, opts: LeanMessageOptions = {}): unknown {
  if (!isObj(value)) return value
  const out: Obj = { ...value }
  for (const key of REQUEST_ONLY) {
    if (key === 'log' && opts.keepLog) continue
    delete out[key]
  }
  if (opts.keepLog && Array.isArray(out.log)) {
    const shaped = (out.log as unknown[]).slice(-MAX_LOG_STEPS).map((step) => leanLogEntry(step, Math.max(0, Number(opts.logChars ?? 2000) || 0)))
    // An empty log would draw an empty "Process to answer" panel after reload.
    if (shaped.length) out.log = shaped
    else delete out.log
  }
  if (typeof out.t === 'string') out.t = clip(out.t, 600_000)
  // `toolFinal` is the reply text shown when a tool-heavy turn ended; it is
  // also the second copy of `t` in most messages, so keep one copy only.
  if (typeof out.toolFinal === 'string') {
    if (out.toolFinal === out.t) delete out.toolFinal
    else out.toolFinal = clip(out.toolFinal, 600_000)
  }
  const reasoningChars = Math.max(0, Number(opts.reasoningChars ?? 4000) || 0)
  if (typeof out.reasoning === 'string') {
    if (reasoningChars === 0) delete out.reasoning
    else out.reasoning = clip(out.reasoning, reasoningChars)
  }
  if (Array.isArray(out.att)) out.att = (out.att as unknown[]).map(leanAttachment).filter(Boolean)
  if (Array.isArray(out.toolRounds)) {
    const textChars = Math.max(0, Number(opts.toolTextChars ?? 4000) || 0)
    out.toolRounds = (out.toolRounds as unknown[]).slice(0, 64).map((round) => isObj(round)
      ? {
        ...round,
        text: typeof round.text === 'string' ? clip(round.text, textChars) : round.text,
        calls: arr(round.calls).map((call) => leanCall(call, opts)).filter(Boolean),
      }
      : round)
  }
  if (isObj(out.research)) out.research = leanResearch(out.research, opts)
  if (Array.isArray(out.alts)) {
    if (!opts.alternatives) delete out.alts
    else out.alts = (out.alts as unknown[]).map((alt) => {
      if (!isObj(alt)) return alt
      const { att: _att, toolRounds: _rounds, log: _log, full: _full, sys: _sys, ...keep } = alt
      return leanMessage(keep, opts)
    })
  }
  if (isObj(out.fork)) {
    out.fork = {
      ai: typeof out.fork.ai === 'number' ? out.fork.ai : 0,
      paths: arr(out.fork.paths).slice(0, 32).map((path) => arr(path).slice(0, 500).map((msg) => leanMessage(msg, opts))),
    }
  }
  return out
}

/** Shape a compaction handoff: the memo is user-facing, everything else is
 *  bookkeeping and small. */
function leanCompact(value: unknown): unknown {
  if (!isObj(value)) return value
  return {
    ...value,
    ...(typeof value.text === 'string' ? { text: clip(value.text, 60_000) } : {}),
  }
}

export type LeanChatOptions = LeanMessageOptions & {
  /** Keep per-chat bookmarks and other id lists. Default true. */
  keepMeta?: boolean
}

/** Shape a whole chat for storage (messages, handoff, nested forks). */
export function leanChat(value: unknown, opts: LeanChatOptions = {}): unknown {
  if (!isObj(value)) return value
  const out: Obj = { ...value }
  if (Array.isArray(out.msgs)) out.msgs = (out.msgs as unknown[]).map((msg) => leanMessage(msg, opts))
  if (out.compact !== undefined) out.compact = leanCompact(out.compact)
  if (isObj(out.fork)) {
    out.fork = {
      ai: typeof out.fork.ai === 'number' ? out.fork.ai : 0,
      paths: arr(out.fork.paths).slice(0, 32).map((path) => arr(path).slice(0, 500).map((msg) => leanMessage(msg, opts))),
    }
  }
  if (opts.keepMeta === false) {
    delete out.pin
    delete out.titleAuto
  }
  return out
}

/** Project context files are extracted file text. The name, size and mime
 *  type are enough to show the file; the text stays on the device that
 *  imported it. */
export function leanProject(value: unknown): unknown {
  if (!isObj(value)) return value
  const out: Obj = { ...value }
  if (Array.isArray(out.context)) {
    out.context = (out.context as unknown[]).map((file) => {
      if (!isObj(file)) return file
      const meta: Obj = {}
      for (const key of ['id', 'name', 'size', 'mime'] as const) if (file[key] !== undefined) meta[key] = file[key]
      return meta
    })
  }
  return out
}
