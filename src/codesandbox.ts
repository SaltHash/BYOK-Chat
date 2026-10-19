/* Local code execution for the model's `run_code` tool.
 *
 * Everything runs in a throwaway Web Worker created from a blob, so the page's
 * DOM, localStorage, IndexedDB and the app's keys are out of reach. The worker
 * is terminated on timeout, which is the only reliable way to stop an infinite
 * loop (a busy loop cannot be interrupted from the main thread).
 *
 * JavaScript needs nothing but the browser. Python is compiled to WebAssembly
 * by Pyodide, which is fetched from a configurable CDN only when the user
 * enables Python: the interpreter is far too large to bundle and the app has no
 * server-side runtime. The first Python run downloads roughly 10 MB, cached by
 * the browser afterwards.
 *
 * This is a resource guard, not a security boundary against the user's own
 * machine: a worker has no DOM access, network APIs are shadowed out for
 * JavaScript, and code cannot import modules, but JavaScript is not otherwise
 * memory-capped. Python can reach the network through Pyodide's JS bridge, so
 * Python stays off by default and is opt-in.
 */

export type CodeLang = 'javascript' | 'python'

export type CodeRunPrefs = {
  /** Master switch. Off by default: the tool does not exist while off. */
  on: boolean
  /** Wall-clock budget for each run, including Python boot on first use. */
  timeoutMs: number
  /** Maximum characters of captured stdout + result. */
  maxOutput: number
  /** Allow Python (downloads the Pyodide runtime from `pyodideUrl`). */
  python: boolean
  /** Base URL containing pyodide.js and its data files. */
  pyodideUrl: string
  /** Let Pyodide fetch prebuilt wheels (numpy, pandas, …) when code imports
   *  them. Off by default because a package can be tens of megabytes. */
  pyPackages: boolean
}

/** Pinned latest release. Users can point this at a self-hosted copy. */
export const PYODIDE_DEFAULT_URL = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/'
export const CODE_TIMEOUT_MIN = 1000
export const CODE_TIMEOUT_MAX = 30000
export const CODE_TIMEOUT_DEFAULT = 5000
export const CODE_OUTPUT_MIN = 2000
export const CODE_OUTPUT_MAX = 100000
export const CODE_OUTPUT_DEFAULT = 20000
export const CODE_MAX_CHARS = 20000

export const BLANK_CODE_RUN: CodeRunPrefs = {
  on: false,
  timeoutMs: CODE_TIMEOUT_DEFAULT,
  maxOutput: CODE_OUTPUT_DEFAULT,
  python: false,
  pyodideUrl: PYODIDE_DEFAULT_URL,
  pyPackages: false,
}

const clampInt = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback
}

/** Base URL for Pyodide. Accepts a directory, a trailing-slash URL, or a full
 *  `.../pyodide.js` link, and falls back to the pinned CDN when unusable. */
export function pyodideIndexUrl(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!/^https?:\/\//i.test(value)) return PYODIDE_DEFAULT_URL
  if (value.endsWith('/')) return value
  if (/\.js(\?.*)?$/i.test(value)) return value.replace(/[^/]*$/, '')
  return `${value}/`
}

export function normCodeRun(v: any): CodeRunPrefs {
  return {
    on: v?.on === true,
    timeoutMs: clampInt(v?.timeoutMs, CODE_TIMEOUT_MIN, CODE_TIMEOUT_MAX, CODE_TIMEOUT_DEFAULT),
    maxOutput: clampInt(v?.maxOutput, CODE_OUTPUT_MIN, CODE_OUTPUT_MAX, CODE_OUTPUT_DEFAULT),
    python: v?.python === true,
    pyodideUrl: pyodideIndexUrl(v?.pyodideUrl),
    pyPackages: v?.pyPackages === true,
  }
}

/** Run results carry text only: the model sees stdout and the value, never the
 *  worker's internals. */
export type CodeResult = {
  ok: boolean
  logs: string
  value?: string | null
  error?: string
  ms: number
  truncated: boolean
  timedOut?: boolean
}

export const codeLangLabel = (lang: CodeLang): string => (lang === 'python' ? 'Python' : 'JavaScript')

const clipText = (s: unknown, max: number): string => {
  const text = typeof s === 'string' ? s : String(s ?? '')
  return text.length > max ? text.slice(0, max) : text
}

/* One-line summary the model can act on: stdout first, then the returned value,
 * then an error or timeout notice. Kept under the output budget. */
export function formatCodeResult(lang: CodeLang, r: CodeResult): string {
  const head = `${codeLangLabel(lang)} · ${r.ms}ms`
  const parts: string[] = [head]
  const logs = r.logs.trimEnd()
  if (logs) parts.push(`stdout:\n${logs}`)
  if (r.value != null && String(r.value).length) parts.push(`result: ${r.value}`)
  if (r.timedOut) parts.push(`stopped after ${r.ms}ms: the code did not finish, which usually means an infinite loop`)
  else if (!r.ok) parts.push(`error: ${r.error || 'the code failed'}`)
  else if (!logs && (r.value == null || !String(r.value).length)) parts.push('(no output)')
  if (r.truncated) parts.push(`[output truncated at ${r.logs.length.toLocaleString()} characters]`)
  return parts.join('\n\n')
}

const workerUnavailable = (): boolean =>
  typeof Worker === 'undefined' ||
  typeof Blob === 'undefined' ||
  typeof URL === 'undefined' ||
  typeof URL.createObjectURL !== 'function'

/* ---- JavaScript ---- */

/* The harness captures `postMessage` before removing it from the global scope,
 * so a snippet cannot forge a result for the parent. */
const jsWorkerSource = (maxOutput: number): string => `/* Generated sandbox harness. */
const MAX = ${Math.max(CODE_OUTPUT_MIN, maxOutput)}
const post = self.postMessage.bind(self)
let used = 0
let truncated = false
const out = []
const push = (s) => {
  if (used >= MAX) { truncated = true; return }
  const room = MAX - used
  const text = String(s)
  out.push(text.slice(0, room))
  used += Math.min(text.length, room)
  if (text.length > room) truncated = true
}
const fmt = (v) => {
  try {
    if (typeof v === 'string') return v
    if (typeof v === 'function') return '[function ' + (v.name || 'anonymous') + ']'
    if (typeof v === 'bigint') return String(v) + 'n'
    if (v instanceof Error) return v.stack || (v.name + ': ' + v.message)
    if (v && typeof v === 'object') {
      const seen = new WeakSet()
      return JSON.stringify(v, (key, value) => {
        if (typeof value === 'bigint') return String(value) + 'n'
        if (typeof value === 'function') return '[function]'
        if (value && typeof value === 'object') {
          if (seen.has(value)) return '[circular]'
          seen.add(value)
        }
        return value
      }, 2)
    }
    return String(v)
  } catch { return Object.prototype.toString.call(v) }
}
const log = (...args) => push(args.map(fmt).join(' ') + '\\n')
const noop = () => {}
try {
  for (const k of ['log', 'info', 'warn', 'error', 'debug', 'trace', 'table', 'dir', 'group', 'groupCollapsed', 'groupEnd']) self.console[k] = log
  self.console.time = noop
  self.console.timeEnd = noop
  self.console.assert = (cond, ...rest) => { if (!cond) log('Assertion failed:', ...rest) }
} catch { /* keep the native console if it cannot be replaced */ }
/* The worker has no DOM, but it does inherit network APIs: shadow them so a
 * snippet cannot call out, load scripts, or use storage. */
const blocked = (what) => { throw new Error(what + ' is disabled in the code sandbox.') }
for (const k of ['postMessage', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'Worker', 'SharedWorker', 'BroadcastChannel', 'RTCPeerConnection', 'webkitRTCPeerConnection', 'navigator']) {
  try { self[k] = undefined } catch { /* non-writable on some engines */ }
}
try { self.fetch = () => blocked('Network access') } catch { /* ignore */ }
try { self.importScripts = () => blocked('Loading external scripts') } catch { /* ignore */ }
try { self.XMLHttpRequest = function () { blocked('Network access') } } catch { /* ignore */ }
try { self.WebSocket = function () { blocked('Network access') } } catch { /* ignore */ }
self.onmessage = async (event) => {
  const { id, code } = event.data || {}
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
    const fn = new AsyncFunction('"use strict";\\n' + code)
    const value = await fn()
    post({ id, ok: true, logs: out.join(''), value: value === undefined ? null : fmt(value), truncated })
  } catch (err) {
    const detail = err && err.stack ? err.stack : String(err)
    post({ id, ok: false, logs: out.join(''), error: detail.slice(0, 4000), truncated })
  }
}
`

/* ---- Python (Pyodide) ---- */

const pyBoot = (mode: 'module' | 'classic'): string => mode === 'module'
  ? `await import(INDEX + 'pyodide.js')
    const load = globalThis.loadPyodide
    /* Older Pyodide builds declare loadPyodide as a module-scoped var, so
     * importing them works but leaves the global undefined: retry in a
     * classic worker, where importScripts installs the global. */
    if (typeof load !== 'function') { post({ type: 'boot-fallback' }); return }
    py = await load({ indexURL: INDEX })`
  : `py = await loadPyodide({ indexURL: INDEX })`

const pyWorkerSource = (indexUrl: string, maxOutput: number, mode: 'module' | 'classic', packages: boolean): string => `/* Generated Pyodide sandbox harness (${mode} worker). */
const INDEX = ${JSON.stringify(indexUrl)}
const PACKAGES = ${packages ? 'true' : 'false'}
const MAX = ${Math.max(CODE_OUTPUT_MIN, maxOutput)}
const post = self.postMessage.bind(self)
let used = 0
let truncated = false
const out = []
const push = (s) => {
  if (used >= MAX) { truncated = true; return }
  const room = MAX - used
  const text = String(s)
  out.push(text.slice(0, room))
  used += Math.min(text.length, room)
  if (text.length > room) truncated = true
}
let py = null
const blocked = (what) => { throw new Error(what + ' is disabled in the code sandbox.') }
const blockNetwork = () => {
  try { self.fetch = () => blocked('Network access') } catch { /* ignore */ }
  try { self.XMLHttpRequest = function () { blocked('Network access') } } catch { /* ignore */ }
}
self.onmessage = async (event) => {
  const { id, code } = event.data || {}
  if (!py) { post({ id, ok: false, logs: '', error: 'The Python runtime is still loading.', truncated }); return }
  try {
    /* Prebuilt wheels come from the Pyodide index (numpy, pandas, scipy, …).
     * This is the only network use after boot, and it ends before user code
     * runs. */
    if (PACKAGES) {
      try { await py.loadPackagesFromImports(code) } catch (err) {
        post({ id, ok: false, logs: out.join(''), error: 'Could not load Python packages: ' + String((err && err.message) || err) + '. Check the Pyodide URL and your network connection.', truncated })
        return
      }
      blockNetwork()
      post({ type: 'packages-ready' })
    }
    const value = await py.runPythonAsync(code)
    let result = null
    if (value !== undefined && value !== null) {
      try { result = String(value) } catch { result = '(result could not be printed)' }
    }
    post({ id, ok: true, logs: out.join(''), value: result, truncated })
  } catch (err) {
    let detail = err && err.stack ? err.stack : String(err)
    if (!PACKAGES && /ModuleNotFoundError/.test(detail)) {
      /* Keep the hint inside the error budget: Pyodide tracebacks are long. */
      detail = detail.slice(0, 3400) + String.fromCharCode(10, 10) + 'This sandbox has the Python standard library only. Enable Load Python packages in Settings → Tools → Code execution to use numpy, pandas, and other Pyodide packages.'
    }
    post({ id, ok: false, logs: out.join(''), error: detail.slice(0, 4000), truncated })
  }
}
${mode === 'classic' ? "importScripts(INDEX + 'pyodide.js')" : ''}
;(async () => {
  try {
    ${pyBoot(mode)}
    py.setStdout({ batched: (s) => push(String(s) + '\\n') })
    py.setStderr({ batched: (s) => push(String(s) + '\\n') })
    try { py.setStdin({ stdin: () => null }) } catch { /* older builds */ }
    /* Close the JS bridge's network paths once the runtime is loaded: fetches
     * needed to boot have finished, and user code should stay offline. With
     * PACKAGES on, the run handler blocks them after the wheel download. */
    if (!PACKAGES) blockNetwork()
    try { self.importScripts = () => blocked('Loading external scripts') } catch { /* ignore */ }
    post({ type: 'ready' })
  } catch (err) {
    post({ type: 'boot-error', error: String((err && err.message) || err).slice(0, 800) })
  }
})()
`

type WorkerOutcome = Omit<CodeResult, 'ms'>

const makeWorker = (source: string, type?: 'module'): { worker: Worker; revoke: () => void } => {
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
  const worker = type ? new Worker(url, { type }) : new Worker(url)
  return { worker, revoke: () => URL.revokeObjectURL(url) }
}

function runJavascript(code: string, timeoutMs: number, maxOutput: number): Promise<CodeResult> {
  return new Promise((resolve) => {
    const started = performance.now()
    const { worker, revoke } = makeWorker(jsWorkerSource(maxOutput))
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (r: WorkerOutcome) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      worker.terminate()
      revoke()
      resolve({ ...r, ms: Math.round(performance.now() - started) })
    }
    worker.onmessage = (e) => {
      const d = e.data || {}
      if (typeof d !== 'object' || !('ok' in d)) return
      finish({ ok: !!d.ok, logs: clipText(d.logs, maxOutput + 2000), value: d.value == null ? null : clipText(d.value, maxOutput), error: d.error, truncated: !!d.truncated })
    }
    worker.onerror = (e) => {
      e.preventDefault?.()
      finish({ ok: false, logs: '', error: String(e.message || 'The JavaScript sandbox failed to start.'), truncated: false })
    }
    timer = setTimeout(() => finish({ ok: false, logs: '', error: 'Timed out', timedOut: true, truncated: false }), timeoutMs)
    worker.postMessage({ id: 1, code })
  })
}

type PyAttempt =
  | { kind: 'done'; result: CodeResult }
  | { kind: 'fallback' }
  | { kind: 'failed'; error: string }

/* One attempt at booting Pyodide. A module worker is the modern path (current
 * Pyodide refuses to boot in classic workers); when the URL holds an older
 * build whose module import leaves no global, the caller retries classic. */
function runPythonWorker(
  source: string,
  type: 'module' | 'classic',
  code: string,
  timeoutMs: number,
  maxOutput: number,
  packages: boolean,
): Promise<PyAttempt> {
  return new Promise((resolve) => {
    const started = performance.now()
    const { worker, revoke } = makeWorker(source, type === 'module' ? 'module' : undefined)
    let settled = false
    let execTimer: ReturnType<typeof setTimeout> | undefined
    let packageTimer: ReturnType<typeof setTimeout> | undefined
    const bootTimer = setTimeout(() => finish({ ok: false, logs: '', error: 'The Python runtime did not finish loading. Check the Pyodide URL and your network connection.', truncated: false }), 60000)
    const finish = (r: WorkerOutcome | PyAttempt) => {
      if (settled) return
      settled = true
      clearTimeout(bootTimer)
      if (packageTimer) clearTimeout(packageTimer)
      if (execTimer) clearTimeout(execTimer)
      worker.terminate()
      revoke()
      if ('kind' in r) resolve(r)
      else resolve({ kind: 'done', result: { ...r, ms: Math.round(performance.now() - started) } })
    }
    /* The time limit covers user code, not downloads: runtime boot has its own
     * 60 s guard and package wheels get their own 60 s guard. */
    const startExec = () => {
      if (execTimer) return
      execTimer = setTimeout(() => finish({ ok: false, logs: '', error: 'Timed out', timedOut: true, truncated: false }), timeoutMs)
    }
    worker.onmessage = (e) => {
      const d = e.data || {}
      if (d.type === 'boot-fallback') { finish({ kind: 'fallback' }); return }
      if (d.type === 'boot-error') { finish({ kind: 'failed', error: String(d.error || 'The Python runtime failed to load.') }); return }
      if (d.type === 'ready') {
        if (packages) {
          packageTimer = setTimeout(() => finish({ ok: false, logs: '', error: 'Python packages did not finish downloading. Check the Pyodide URL and your network connection.', truncated: false }), 60000)
        } else startExec()
        worker.postMessage({ id: 1, code })
        return
      }
      if (d.type === 'packages-ready') { if (packageTimer) clearTimeout(packageTimer); startExec(); return }
      if (typeof d !== 'object' || !('ok' in d)) return
      finish({ ok: !!d.ok, logs: clipText(d.logs, maxOutput + 2000), value: d.value == null ? null : clipText(d.value, maxOutput), error: d.error, truncated: !!d.truncated })
    }
    worker.onerror = (e) => {
      e.preventDefault?.()
      // A module that cannot even be parsed reports an empty message here, so
      // the caller decides between surfacing this error and retrying classic.
      finish({ kind: 'failed', error: String(e.message || '') })
    }
  })
}

async function runPython(code: string, timeoutMs: number, maxOutput: number, indexUrl: string, packages: boolean): Promise<CodeResult> {
  const modern = await runPythonWorker(pyWorkerSource(indexUrl, maxOutput, 'module', packages), 'module', code, timeoutMs, maxOutput, packages)
  if (modern.kind === 'done') return modern.result
  const legacy = await runPythonWorker(pyWorkerSource(indexUrl, maxOutput, 'classic', packages), 'classic', code, timeoutMs, maxOutput, packages)
  if (legacy.kind === 'done') return legacy.result
  const error = (modern.kind === 'failed' && modern.error)
    || (legacy.kind === 'failed' && legacy.error)
    || 'The Python runtime at that URL could not be started. Check the Pyodide URL and try again.'
  return { ok: false, logs: '', error, ms: 0, truncated: false }
}

/** Execute one snippet. Throws only for configuration problems (unsupported
 *  language, oversized code); execution failures come back as a CodeResult so
 *  the model can read stdout plus the error and try a fix. */
export async function runCode(lang: CodeLang, code: string, prefs: CodeRunPrefs): Promise<CodeResult> {
  const p = normCodeRun(prefs)
  if (lang !== 'javascript' && lang !== 'python') throw Error(`Unsupported language: ${String(lang)}. Use javascript or python.`)
  if (lang === 'python' && !p.python) throw Error('Python is disabled. Enable Python in Settings → Tools → Code execution (it downloads the Pyodide runtime).')
  const source = String(code ?? '')
  if (!source.trim()) throw Error('Provide code to run.')
  if (source.length > CODE_MAX_CHARS) throw Error(`Code is too long (${source.length.toLocaleString()} characters). The limit is ${CODE_MAX_CHARS.toLocaleString()}.`)
  if (workerUnavailable()) throw Error('Code execution needs a browser with Web Workers and Blob URLs.')
  return lang === 'python'
    ? runPython(source, p.timeoutMs, p.maxOutput, pyodideIndexUrl(p.pyodideUrl), p.pyPackages)
    : runJavascript(source, p.timeoutMs, p.maxOutput)
}
