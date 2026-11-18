/* Remote code sandboxes (bring your own key).
 *
 * The local sandbox in codesandbox.ts runs in the browser. Some work needs a
 * real machine (packages preinstalled in a template, a Linux shell, more
 * memory), so the user can point `run_code` at a hosted runner instead. Every
 * provider here is BYOK: the key is stored in this browser with the rest of the
 * endpoint settings and is sent per request only, never to this app's server
 * (requests go direct, or through /api/proxy when the browser blocks CORS).
 *
 * Providers:
 *   e2b     - create a sandbox from a template, POST /execute to the code
 *             interpreter port, delete the sandbox afterwards.
 *   piston  - Piston's /execute API, public or self-hosted.
 *   judge0  - Judge0's submissions API (CE or RapidAPI), with configurable
 *             language ids because they differ between installs.
 *   custom  - any endpoint that accepts `{ language, code }` and answers with
 *             stdout/stderr-shaped JSON (Modal, Daytona, Riza, a home server).
 *
 * Everything is normalised and capped: a pasted config or an old store cannot
 * turn a key into an oversized header, a TTL into an immortal sandbox, or a
 * URL into a non-http scheme.
 */

import { providerFetch } from './net'

export type SandboxLang = 'javascript' | 'python'

export type SandboxProvider = 'local' | 'e2b' | 'piston' | 'judge0' | 'custom'

export const SANDBOX_PROVIDERS: { id: SandboxProvider; label: string; hint: string }[] = [
  { id: 'local', label: 'This browser', hint: 'A throwaway Web Worker for JavaScript and Pyodide for Python. Nothing leaves the device.' },
  { id: 'e2b', label: 'E2B', hint: 'A fresh E2B sandbox from your template for each run, deleted when the run ends.' },
  { id: 'piston', label: 'Piston', hint: 'Piston /execute, on the public instance or your own.' },
  { id: 'judge0', label: 'Judge0', hint: 'Judge0 submissions (CE or RapidAPI). Language ids are configurable.' },
  { id: 'custom', label: 'Custom endpoint', hint: 'Any HTTPS runner that accepts {language, code} and returns stdout/stderr.' },
]

export type SandboxPrefs = {
  provider: SandboxProvider
  e2b: { apiKey: string; base: string; host: string; template: string; ttlSec: number; internet: boolean }
  piston: { base: string; key: string; python: string; javascript: string }
  judge0: {
    base: string
    key: string
    keyHeader: Judge0KeyHeader
    rapidApiHost: string
    pythonId: number
    javascriptId: number
  }
  custom: { base: string; key: string }
}

export type Judge0KeyHeader = 'x-auth-token' | 'x-rapidapi-key'

export const E2B_DEFAULT_BASE = 'https://api.e2b.app'
export const E2B_DEFAULT_HOST = 'https://sandbox.e2b.app'
export const E2B_DEFAULT_TEMPLATE = 'code-interpreter-v1'
export const E2B_DEFAULT_TTL = 120
export const E2B_TTL_MIN = 10
export const E2B_TTL_MAX = 3_600
export const PISTON_DEFAULT_BASE = 'https://emkc.org/api/v2/piston'
export const PISTON_DEFAULT_PYTHON = 'python'
export const PISTON_DEFAULT_JAVASCRIPT = 'javascript'
export const JUDGE0_DEFAULT_BASE = 'https://ce.judge0.com'
export const JUDGE0_DEFAULT_PYTHON_ID = 71
export const JUDGE0_DEFAULT_JAVASCRIPT_ID = 63

const MAX_KEY = 500
const MAX_URL = 500
const MAX_NAME = 80

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** An http(s) base URL, stripped of trailing slashes; the fallback otherwise. */
const httpBase = (v: unknown, fallback: string): string => {
  const raw = text(v, MAX_URL)
  if (!/^https?:\/\/[^\s/]+/i.test(raw)) return fallback
  return raw.replace(/\/+$/, '')
}

const intIn = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback
}

const providerOf = (v: unknown): SandboxProvider =>
  SANDBOX_PROVIDERS.some((p) => p.id === v) ? v as SandboxProvider : 'local'

export const BLANK_SANDBOX: SandboxPrefs = {
  provider: 'local',
  e2b: { apiKey: '', base: E2B_DEFAULT_BASE, host: E2B_DEFAULT_HOST, template: E2B_DEFAULT_TEMPLATE, ttlSec: E2B_DEFAULT_TTL, internet: false },
  piston: { base: PISTON_DEFAULT_BASE, key: '', python: PISTON_DEFAULT_PYTHON, javascript: PISTON_DEFAULT_JAVASCRIPT },
  judge0: { base: JUDGE0_DEFAULT_BASE, key: '', keyHeader: 'x-auth-token', rapidApiHost: '', pythonId: JUDGE0_DEFAULT_PYTHON_ID, javascriptId: JUDGE0_DEFAULT_JAVASCRIPT_ID },
  custom: { base: '', key: '' },
}

/** Sanitize stored/imported sandbox settings. Unknown providers fall back to
 *  local rather than leaving `run_code` pointing at a half-configured runner. */
export function normSandbox(v: any): SandboxPrefs {
  const o = v && typeof v === 'object' ? v : {}
  const e2b = o.e2b && typeof o.e2b === 'object' ? o.e2b : {}
  const piston = o.piston && typeof o.piston === 'object' ? o.piston : {}
  const judge0 = o.judge0 && typeof o.judge0 === 'object' ? o.judge0 : {}
  const custom = o.custom && typeof o.custom === 'object' ? o.custom : {}
  return {
    provider: providerOf(o.provider),
    e2b: {
      apiKey: text(e2b.apiKey, MAX_KEY),
      base: httpBase(e2b.base, E2B_DEFAULT_BASE),
      host: httpBase(e2b.host, E2B_DEFAULT_HOST),
      template: text(e2b.template, MAX_NAME) || E2B_DEFAULT_TEMPLATE,
      ttlSec: intIn(e2b.ttlSec, E2B_TTL_MIN, E2B_TTL_MAX, E2B_DEFAULT_TTL),
      internet: e2b.internet === true,
    },
    piston: {
      base: httpBase(piston.base, PISTON_DEFAULT_BASE),
      key: text(piston.key, MAX_KEY),
      python: text(piston.python, MAX_NAME) || PISTON_DEFAULT_PYTHON,
      javascript: text(piston.javascript, MAX_NAME) || PISTON_DEFAULT_JAVASCRIPT,
    },
    judge0: {
      base: httpBase(judge0.base, JUDGE0_DEFAULT_BASE),
      key: text(judge0.key, MAX_KEY),
      keyHeader: judge0.keyHeader === 'x-rapidapi-key' ? 'x-rapidapi-key' : 'x-auth-token',
      rapidApiHost: text(judge0.rapidApiHost, MAX_NAME),
      pythonId: intIn(judge0.pythonId, 1, 200, JUDGE0_DEFAULT_PYTHON_ID),
      javascriptId: intIn(judge0.javascriptId, 1, 200, JUDGE0_DEFAULT_JAVASCRIPT_ID),
    },
    custom: { base: httpBase(custom.base, ''), key: text(custom.key, MAX_KEY) },
  }
}

export const sandboxProviderLabel = (id: SandboxProvider): string =>
  SANDBOX_PROVIDERS.find((p) => p.id === id)?.label ?? 'This browser'

/** Whether the selected remote runner has what it needs to answer. Local is
 *  always available (JavaScript needs nothing). */
export function sandboxConfigured(sandbox: unknown): boolean {
  const s = normSandbox(sandbox)
  switch (s.provider) {
    case 'local': return true
    case 'e2b': return !!s.e2b.apiKey
    case 'piston': return !!s.piston.base
    case 'judge0': return !!s.judge0.base
    case 'custom': return !!s.custom.base
    default: return false
  }
}

/** Languages `run_code` can actually run with these settings. */
export function availableCodeLanguages(prefs: { python?: boolean; sandbox?: unknown }): SandboxLang[] {
  const sandbox = normSandbox((prefs as { sandbox?: unknown })?.sandbox)
  if (sandbox.provider === 'local') return prefs?.python === true ? ['javascript', 'python'] : ['javascript']
  return sandboxConfigured(sandbox) ? ['javascript', 'python'] : []
}

export const codeLangLabelOf = (lang: SandboxLang): string => (lang === 'python' ? 'Python' : 'JavaScript')

/** A system-prompt paragraph that tells the model exactly what it can run,
 *  and what the sandbox cannot do. Empty when `run_code` is not offered. */
export function codeRunNote(prefs: {
  on?: boolean
  python?: boolean
  pyPackages?: boolean
  sandbox?: unknown
}): string {
  if (prefs?.on !== true) return ''
  const sandbox = normSandbox((prefs as { sandbox?: unknown }).sandbox)
  const langs = availableCodeLanguages(prefs)
  if (!langs.length) {
    return '## Code execution\n- `run_code` is switched on, but its sandbox is not configured, so you cannot execute code. Do not claim that you ran anything; say the sandbox needs a key or an endpoint in Settings → Tools → Code execution.'
  }
  const both = langs.length > 1
  const only = both ? `${codeLangLabelOf(langs[0])} and ${codeLangLabelOf(langs[1])}` : codeLangLabelOf(langs[0])
  const place = sandbox.provider === 'local'
    ? 'a throwaway Web Worker on the user’s device'
    : `a remote ${sandboxProviderLabel(sandbox.provider)} sandbox`
  const libraries = sandbox.provider === 'local' && prefs.pyPackages === true && langs.includes('python')
    ? `No third-party JavaScript libraries are available, and Python gets only the packages Pyodide can fetch on demand. Do not assume any other package is installed.`
    : 'No third-party libraries are available. Use only the language’s standard library; a package install command cannot run.'
  return [
    '## Code execution',
    `- \`run_code\` runs in ${place}. You can run ${only}${both ? ' — pick the language per call' : ' only; do not offer the other one'}.`,
    `- ${libraries} The sandbox has no access to the user’s files and each run starts fresh, so pass data in the snippet and print everything the answer needs.`,
    '- Results are text: stdout, the final value, and any error. Numbers, dates and transformations are better verified with a snippet than guessed.',
  ].join('\n')
}

/* ---- request builders -------------------------------------------------- */

export type RemoteRequest = { url: string; init: RequestInit }

const jsonInit = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
})

/** E2B platform call that creates the sandbox. `secure` turns on the tokens the
 *  code interpreter port then requires: envd wants `X-Access-Token`, and the
 *  shared sandbox host also wants the traffic token from the create response. */
export function e2bCreateRequest(p: SandboxPrefs['e2b']): RemoteRequest {
  return {
    url: `${p.base}/sandboxes`,
    init: jsonInit({
      templateID: p.template,
      timeout: p.ttlSec,
      secure: true,
      allow_internet_access: p.internet,
      metadata: { source: 'byok-chat' },
    }, { 'x-api-key': p.apiKey }),
  }
}

export type E2bAccess = { id: string; token?: string; trafficToken?: string }

export function e2bExecuteRequest(
  p: SandboxPrefs['e2b'],
  sandbox: E2bAccess,
  lang: SandboxLang,
  code: string,
): RemoteRequest {
  const headers: Record<string, string> = {
    'E2b-Sandbox-Id': sandbox.id,
    'E2b-Sandbox-Port': '49999',
  }
  // A secure sandbox answers 403 without these: envd checks X-Access-Token,
  // and the shared sandbox host checks the traffic token as well.
  if (sandbox.token) headers['X-Access-Token'] = sandbox.token
  if (sandbox.trafficToken) headers['e2b-traffic-access-token'] = sandbox.trafficToken
  return {
    url: `${p.host}/execute`,
    /* The code-interpreter `/execute` body is exactly code, language and the
     * optional context/env; the run's time limit comes from the sandbox's own
     * lifetime set at creation. */
    init: jsonInit({
      code,
      language: lang === 'python' ? 'python' : 'javascript',
    }, headers),
  }
}

export function e2bDeleteRequest(p: SandboxPrefs['e2b'], id: string): RemoteRequest {
  return {
    url: `${p.base}/sandboxes/${encodeURIComponent(id)}`,
    init: { method: 'DELETE', headers: { 'x-api-key': p.apiKey } },
  }
}

/** Piston: `/execute` takes the runtime name and a single file. The timeout is
 *  sent in milliseconds and covers compile plus run. */
export function pistonRequest(p: SandboxPrefs['piston'], lang: SandboxLang, code: string, timeoutMs: number): RemoteRequest {
  const runtime = lang === 'python' ? p.python : p.javascript
  return {
    url: `${p.base}/execute`,
    init: jsonInit({
      language: runtime,
      version: '*',
      files: [{ name: lang === 'python' ? 'main.py' : 'main.js', content: code }],
      stdin: '',
      run_timeout: Math.max(1000, Math.round(timeoutMs)),
      compile_timeout: Math.max(1000, Math.round(timeoutMs)),
    }, p.key ? { authorization: `Bearer ${p.key}` } : {}),
  }
}

export function judge0Request(p: SandboxPrefs['judge0'], lang: SandboxLang, code: string, timeoutMs: number): RemoteRequest {
  const headers: Record<string, string> = {}
  if (p.key) headers[p.keyHeader] = p.key
  if (p.keyHeader === 'x-rapidapi-key' && p.rapidApiHost) headers['x-rapidapi-host'] = p.rapidApiHost
  return {
    url: `${p.base}/submissions?base64_encoded=false&wait=true`,
    init: jsonInit({
      source_code: code,
      language_id: lang === 'python' ? p.pythonId : p.javascriptId,
      stdin: '',
      // Judge0's own ceiling is per submission; keep the request short so a
      // queued run cannot hold the reply loop open.
      cpu_time_limit: Math.max(1, Math.min(20, Math.ceil(timeoutMs / 1000))),
    }, headers),
  }
}

export function customRequest(p: SandboxPrefs['custom'], lang: SandboxLang, code: string, timeoutMs: number): RemoteRequest {
  return {
    url: p.base,
    init: jsonInit({ language: lang, code, timeout_ms: Math.max(1000, Math.round(timeoutMs)) },
      p.key ? { authorization: `Bearer ${p.key}` } : {}),
  }
}

/* ---- response parsing -------------------------------------------------- */

const lineText = (v: unknown): string => (typeof v === 'string' ? v : '')

export type SandboxRun = { ok: boolean; logs: string; value: string | null; error?: string }

const lines = (v: unknown): string => {
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : String(x ?? ''))).join('')
  return typeof v === 'string' ? v : ''
}

/** E2B code interpreter result: `{ logs: { stdout, stderr }, results, error }`. */
export function parseE2bRun(data: any): SandboxRun {
  const stdout = lines(data?.logs?.stdout)
  const stderr = lines(data?.logs?.stderr)
  const values: string[] = []
  for (const item of Array.isArray(data?.results) ? data.results : []) {
    if (!item || typeof item !== 'object') continue
    for (const key of ['text', 'json', 'markdown']) {
      const v = (item as Record<string, unknown>)[key]
      if (typeof v === 'string' && v.trim()) values.push(v)
      else if (v != null && key === 'json') values.push(JSON.stringify(v))
    }
    if ((item as { png?: unknown }).png) values.push('[image output omitted]')
  }
  const err = data?.error
  const error = err && typeof err === 'object'
    ? [err.name, err.value].filter((x) => typeof x === 'string' && x.trim()).join(': ') || 'the snippet failed'
    : ''
  const logs = [stdout, stderr].filter(Boolean).join('\n')
  const ok = !error && !(typeof data?.error === 'string' && data.error.trim())
  return {
    ok,
    logs,
    value: values.length ? values.join('\n') : null,
    ...(ok ? {} : { error: error || String(data?.error) }),
  }
}

/** Every complete JSON object in a response body, whatever framing it arrived
 *  in: bare NDJSON lines, SSE `data:` lines, one concatenated blob, or a mix
 *  with keep-alive noise. A strict per-line parse found nothing in the last
 *  two, which is how a working run still looked unreadable. */
function jsonObjectsIn(raw: string): any[] {
  const out: any[] = []
  let from = 0
  while (from < raw.length) {
    const start = raw.indexOf('{', from)
    if (start < 0) break
    let depth = 0
    let inString = false
    let escaped = false
    let end = -1
    for (let i = start; i < raw.length; i++) {
      const c = raw[i]
      if (inString) {
        if (escaped) escaped = false
        else if (c === '\\') escaped = true
        else if (c === '"') inString = false
        continue
      }
      if (c === '"') inString = true
      else if (c === '{') depth++
      else if (c === '}' && --depth === 0) { end = i; break }
    }
    if (end < 0) break
    try {
      const value = JSON.parse(raw.slice(start, end + 1))
      if (Array.isArray(value)) out.push(...value.filter((x) => x && typeof x === 'object' && !Array.isArray(x)))
      else if (value && typeof value === 'object') out.push(value)
    } catch { /* not JSON after all */ }
    from = end + 1
  }
  return out
}

/** The code-interpreter `/execute` endpoint streams events: `{ type: 'stdout',
 *  text }`, `{ type: 'stderr', text }`, `{ type: 'result', text, json,
 *  markdown, png, … }`, `{ type: 'error', name, value, traceback }` and
 *  `{ type: 'end_of_execution' }`. Reading the whole body as one JSON document
 *  is what made every run look unreadable. Returns null when no event was
 *  found. */
export function parseE2bStream(raw: string): SandboxRun | null {
  return runFromEvents(jsonObjectsIn(raw))
}

/** Fold a list of E2B events into one run result. */
function runFromEvents(events: any[]): SandboxRun | null {
  const stdout: string[] = []
  const stderr: string[] = []
  const values: string[] = []
  let error = ''
  let seen = false
  for (const event of events) {
    if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.type !== 'string') continue
    seen = true
    switch (event.type) {
      case 'stdout':
        stdout.push(lineText(event.text))
        break
      case 'stderr':
        stderr.push(lineText(event.text))
        break
      case 'result': {
        const value = lineText(event.text).trim() ? lineText(event.text)
          : typeof event.json === 'string' ? event.json
          : event.json != null ? JSON.stringify(event.json)
          : lineText(event.markdown).trim() ? lineText(event.markdown)
          : ''
        if (value) values.push(value)
        if (event.png || event.jpeg || event.pdf) values.push('[image output omitted]')
        break
      }
      case 'error':
        error = [event.name, event.value].filter((x) => typeof x === 'string' && x.trim()).join(': ') || 'the snippet failed'
        break
      case 'unexpected_end_of_execution':
        if (!error) error = 'The sandbox stopped before the snippet finished.'
        break
      default:
        // number_of_executions, end_of_execution and any future event type.
        break
    }
  }
  if (!seen) return null
  // stderr follows stdout on its own line, without inventing a blank line when
  // stdout already ended with one.
  const out = stdout.join('')
  const err = stderr.join('')
  const logs = !out ? err : !err ? out : out.endsWith('\n') ? out + err : `${out}\n${err}`
  return { ok: !error, logs, value: values.length ? values.join('\n') : null, ...(error ? { error } : {}) }
}

/** Accept either shape E2B can answer with: the NDJSON event stream, or the
 *  single `{ logs, results, error }` document the SDK serialises. */
export function parseE2bResponse(raw: string): SandboxRun | null {
  let single: any = null
  try { single = raw.trim() ? JSON.parse(raw) : null } catch { /* an event stream */ }
  if (Array.isArray(single)) return runFromEvents(single)
  if (single && typeof single === 'object' && (single.logs || single.results || 'error' in single)) {
    return parseE2bRun(single)
  }
  return parseE2bStream(raw)
}

/** Piston: `{ run: { stdout, stderr, output, code }, compile? }`. */
export function parsePistonRun(data: any): SandboxRun {
  const compile = typeof data?.compile?.output === 'string' ? data.compile.output : ''
  const stdout = typeof data?.run?.stdout === 'string' ? data.run.stdout : ''
  const stderr = typeof data?.run?.stderr === 'string' ? data.run.stderr : ''
  const code = Number(data?.run?.code)
  const failed = (Number.isFinite(code) && code !== 0) || !!data?.message
  const logs = [compile, stdout, stderr].filter(Boolean).join('\n')
  return {
    ok: !failed,
    logs,
    value: null,
    ...(failed ? { error: stderr.trim() || compile.trim() || String(data?.message || `the process exited with code ${data?.run?.code}`) } : {}),
  }
}

/** Judge0: `{ stdout, stderr, compile_output, message, status }`. */
export function parseJudge0Run(data: any): SandboxRun {
  const status = data?.status && typeof data.status === 'object' ? data.status : {}
  const id = Number(status.id)
  const description = typeof status.description === 'string' ? status.description : ''
  const accepted = Number.isFinite(id) ? id === 3 : !data?.message
  const stdout = typeof data?.stdout === 'string' ? data.stdout : ''
  const stderr = typeof data?.stderr === 'string' ? data.stderr : ''
  const compile = typeof data?.compile_output === 'string' ? data.compile_output : ''
  const logs = [stdout, stderr, compile].filter(Boolean).join('\n')
  const note = typeof data?.message === 'string' ? data.message : ''
  return {
    ok: accepted,
    logs,
    value: null,
    ...(accepted ? {} : { error: [compile, stderr, note, description].map((x) => (x ?? '').trim()).filter(Boolean).join('\n') || 'the runner reported a failure' }),
  }
}

/** Custom runner: accept the common shapes instead of one invented schema. */
export function parseCustomRun(data: any): SandboxRun {
  if (data && typeof data === 'object' && data.logs && typeof data.logs === 'object' && !Array.isArray(data.logs)) {
    return parseE2bRun(data)
  }
  const stdout = typeof data?.stdout === 'string' ? data.stdout : typeof data?.output === 'string' ? data.output : lines(data?.logs)
  const stderr = typeof data?.stderr === 'string' ? data.stderr : ''
  const value = typeof data?.result === 'string' ? data.result : typeof data?.value === 'string' ? data.value : null
  const error = typeof data?.error === 'string' ? data.error : ''
  const exit = Number(data?.exit_code ?? data?.code)
  const failed = !!error || (Number.isFinite(exit) && exit !== 0)
  return {
    ok: !failed,
    logs: [stdout, stderr].filter(Boolean).join('\n'),
    value,
    ...(failed ? { error: error || stderr || `the runner exited with code ${data?.exit_code ?? data?.code}` } : {}),
  }
}

/* ---- transport --------------------------------------------------------- */

export class SandboxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SandboxError'
  }
}

type FetchLike = typeof fetch

type RawBody = { raw: string; status: number; contentType: string }

/** One transport for every runner: the same timeout handling and error
 *  wording, whether the body is a single JSON document or an event stream. */
async function callRaw(req: RemoteRequest, timeoutMs: number, fetchFn: FetchLike, what: string): Promise<RawBody> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetchFn(req.url, { ...req.init, signal: ac.signal })
    let raw: string
    try { raw = await res.text() } catch (error: any) {
      // A decode failure is not an empty answer: name it instead of letting
      // the caller report "unreadable" with nothing to go on.
      throw new SandboxError(`${what} sent a body that could not be read (${String(error?.message ?? error)}).`)
    }
    if (!res.ok) {
      let detail = raw
      try {
        const body = raw ? JSON.parse(raw) : null
        detail = String(body?.message || body?.error || raw)
      } catch { /* a non-JSON error body is reported as written */ }
      detail = detail.replace(/\s+/g, ' ').slice(0, 300)
      throw new SandboxError(`${what} returned HTTP ${res.status}${detail ? `: ${detail}` : ''}.`)
    }
    return { raw, status: res.status, contentType: res.headers.get('content-type') ?? '' }
  } catch (error: any) {
    if (error instanceof SandboxError) throw error
    const reason = error?.name === 'AbortError' ? `timed out after ${Math.round(timeoutMs / 1000)}s` : String(error?.message ?? error)
    throw new SandboxError(`${what} could not be reached (${reason}). Check the endpoint, the key and the network.`)
  } finally {
    clearTimeout(timer)
  }
}

async function callJson(req: RemoteRequest, timeoutMs: number, fetchFn: FetchLike, what: string): Promise<any> {
  const { raw } = await callRaw(req, timeoutMs, fetchFn, what)
  let data: any = null
  try { data = raw ? JSON.parse(raw) : null } catch { /* reported below */ }
  if (!data || typeof data !== 'object') throw new SandboxError(`${what} sent an unreadable response.`)
  return data
}

export type RemoteCodeResult = {
  ok: boolean
  logs: string
  value?: string | null
  error?: string
  ms: number
  truncated: boolean
}

/** Run one snippet on the configured remote runner. Configuration problems
 *  throw (the model reads the message and stops), execution failures come back
 *  as `ok: false` so it can fix the code and try again. */
export async function runRemoteCode(
  sandbox: SandboxPrefs,
  lang: SandboxLang,
  code: string,
  opts: { timeoutMs: number; fetchFn?: FetchLike } = { timeoutMs: 20_000 },
): Promise<RemoteCodeResult> {
  const s = normSandbox(sandbox)
  const fetchFn = opts.fetchFn ?? ((input, init) => providerFetch(input, init))
  const timeoutMs = Math.max(1000, Math.round(opts.timeoutMs || 20_000))
  const started = Date.now()
  const done = (r: SandboxRun): RemoteCodeResult => ({
    ok: r.ok,
    logs: r.logs,
    value: r.value,
    ...(r.error ? { error: r.error } : {}),
    ms: Date.now() - started,
    truncated: false,
  })

  if (s.provider === 'local') throw new SandboxError('Local execution is handled by the browser sandbox.')

  if (s.provider === 'e2b') {
    if (!s.e2b.apiKey) throw new SandboxError('Add an E2B API key in Settings → Tools → Code execution.')
    const created = await callJson(e2bCreateRequest(s.e2b), Math.max(timeoutMs, 30_000), fetchFn, 'E2B')
    const id = typeof created.sandboxID === 'string' ? created.sandboxID : ''
    if (!id) throw new SandboxError('E2B did not return a sandbox id, so the run was stopped.')
    const token = typeof created.envdAccessToken === 'string' ? created.envdAccessToken : ''
    // Secure sandboxes are reached through the shared host, which refuses a
    // request that carries only the envd token.
    const trafficToken = typeof created.trafficAccessToken === 'string' ? created.trafficAccessToken : ''
    try {
      /* `/execute` streams its output, so it is the one runner whose body is
       * not a single JSON document. */
      const body = await callRaw(e2bExecuteRequest(s.e2b, { id, token, trafficToken }, lang, code), timeoutMs + 15_000, fetchFn, 'The E2B sandbox')
      const run = parseE2bResponse(body.raw)
      if (!run) {
        // Say what actually came back: a proxy page, an empty body and an
        // unknown event shape need different fixes, and "unreadable" alone
        // gave nothing to act on.
        const type = body.contentType || 'no content type'
        const sample = body.raw.replace(/\s+/g, ' ').trim().slice(0, 160)
        throw new SandboxError(`The E2B sandbox answered with something this app could not read (HTTP ${body.status}, ${type}, ${body.raw.length} characters)${sample ? `: ${sample}` : '.'}`)
      }
      return done(run)
    } catch (error: any) {
      // The usual cause is an older platform API that did not return the
      // traffic token this build expected; say so instead of leaving the raw
      // 403 to be read as a bad key.
      if (!trafficToken && /traffic[- ]access[- ]token/i.test(String(error?.message ?? ''))) {
        throw new SandboxError('E2B created a secure sandbox but returned no traffic access token, so the run could not be authorised. Check the Platform API URL in Settings → Tools → Code execution (it should be https://api.e2b.app).')
      }
      throw error
    } finally {
      // Leaving sandboxes behind costs the user money, so clean up even when
      // the run timed out. A failed delete must not mask the run's own result.
      void callJson(e2bDeleteRequest(s.e2b, id), 8000, fetchFn, 'E2B cleanup').catch(() => {})
    }
  }

  if (s.provider === 'piston') {
    const data = await callJson(pistonRequest(s.piston, lang, code, timeoutMs), timeoutMs + 15_000, fetchFn, 'Piston')
    return done(parsePistonRun(data))
  }

  if (s.provider === 'judge0') {
    const data = await callJson(judge0Request(s.judge0, lang, code, timeoutMs), timeoutMs + 15_000, fetchFn, 'Judge0')
    return done(parseJudge0Run(data))
  }

  if (s.provider === 'custom') {
    if (!s.custom.base) throw new SandboxError('Add the endpoint URL for your code runner in Settings → Tools → Code execution.')
    const data = await callJson(customRequest(s.custom, lang, code, timeoutMs), timeoutMs + 15_000, fetchFn, 'The code runner')
    return done(parseCustomRun(data))
  }

  throw new SandboxError('That code sandbox is not supported.')
}
