import test from 'node:test'
import assert from 'node:assert/strict'

const {
  BLANK_SANDBOX, normSandbox, sandboxConfigured, availableCodeLanguages, codeRunNote,
  e2bCreateRequest, e2bExecuteRequest, e2bDeleteRequest, pistonRequest, judge0Request, customRequest,
  parseE2bRun, parseE2bStream, parseE2bResponse, parsePistonRun, parseJudge0Run, parseCustomRun,
} = await import('./sandbox.ts')

const body = (req) => JSON.parse(String(req.init.body))
const headers = (req) => req.init.headers

test('sandbox settings normalise and fall back to local', () => {
  assert.equal(normSandbox(undefined).provider, 'local')
  assert.equal(normSandbox({ provider: 'nope' }).provider, 'local')
  assert.deepEqual(normSandbox(undefined).e2b, BLANK_SANDBOX.e2b)
})

test('capped fields cannot be smuggled into a request', () => {
  const s = normSandbox({
    provider: 'e2b',
    e2b: { apiKey: 'k'.repeat(900), base: 'javascript:alert(1)', ttlSec: 999999, template: '' },
    judge0: { pythonId: -4, javascriptId: 999 },
    custom: { base: 'file:///etc/passwd' },
  })
  assert.equal(s.e2b.apiKey.length, 500)
  assert.equal(s.e2b.base, 'https://api.e2b.app')
  assert.equal(s.e2b.ttlSec, 3600)
  assert.equal(s.e2b.template, 'code-interpreter-v1')
  assert.equal(s.judge0.pythonId, 1)
  assert.equal(s.judge0.javascriptId, 200)
  assert.equal(s.custom.base, '')
})

test('a remote provider needs its key or endpoint before it counts as ready', () => {
  assert.equal(sandboxConfigured(normSandbox({ provider: 'local' })), true)
  assert.equal(sandboxConfigured(normSandbox({ provider: 'e2b' })), false)
  assert.equal(sandboxConfigured(normSandbox({ provider: 'e2b', e2b: { apiKey: 'k' } })), true)
  assert.equal(availableCodeLanguages({ python: false, sandbox: { provider: 'e2b' } }).length, 0)
  assert.deepEqual(availableCodeLanguages({ python: false, sandbox: { provider: 'e2b', e2b: { apiKey: 'k' } } }), ['javascript', 'python'])
})

test('local languages follow the Python switch', () => {
  assert.deepEqual(availableCodeLanguages({ python: false }), ['javascript'])
  assert.deepEqual(availableCodeLanguages({ python: true }), ['javascript', 'python'])
})

test('the model is told which languages and that libraries are unavailable', () => {
  const js = codeRunNote({ on: true, python: false })
  assert.match(js, /You can run JavaScript only/)
  assert.match(js, /No third-party libraries are available/)
  const both = codeRunNote({ on: true, python: true })
  assert.match(both, /JavaScript and Python/)
  const off = codeRunNote({ on: false })
  assert.equal(off, '')
  const unconfigured = codeRunNote({ on: true, sandbox: { provider: 'custom' } })
  assert.match(unconfigured, /cannot execute code/)
})

test('E2B creates, executes and deletes with the documented shapes', () => {
  const p = normSandbox({ provider: 'e2b', e2b: { apiKey: 'secret', ttlSec: 60, internet: false } })
  const create = e2bCreateRequest(p.e2b)
  assert.equal(create.url, 'https://api.e2b.app/sandboxes')
  assert.equal(headers(create)['x-api-key'], 'secret')
  assert.deepEqual(body(create), {
    templateID: 'code-interpreter-v1',
    timeout: 60,
    secure: true,
    allow_internet_access: false,
    metadata: { source: 'byok-chat' },
  })

  const exec = e2bExecuteRequest(p.e2b, { id: 'sbx_1', token: 'tok', trafficToken: 'traffic' }, 'python', 'print(1)')
  assert.equal(exec.url, 'https://sandbox.e2b.app/execute')
  assert.equal(headers(exec)['E2b-Sandbox-Id'], 'sbx_1')
  assert.equal(headers(exec)['E2b-Sandbox-Port'], '49999')
  assert.equal(headers(exec)['X-Access-Token'], 'tok')
  assert.equal(headers(exec)['e2b-traffic-access-token'], 'traffic')
  assert.deepEqual(body(exec), { code: 'print(1)', language: 'python' })

  // A response that only carries one token must not send an empty header.
  const bare = e2bExecuteRequest(p.e2b, { id: 'sbx_2' }, 'python', 'print(1)')
  assert.equal(headers(bare)['X-Access-Token'], undefined)
  assert.equal(headers(bare)['e2b-traffic-access-token'], undefined)

  const del = e2bDeleteRequest(p.e2b, 'sbx_1')
  assert.equal(del.url, 'https://api.e2b.app/sandboxes/sbx_1')
  assert.equal(del.init.method, 'DELETE')
})

test('Piston sends one file and no key header when the key is empty', () => {
  const s = normSandbox({ provider: 'piston' })
  const req = pistonRequest(s.piston, 'javascript', 'console.log(1)', 4000)
  assert.equal(req.url, 'https://emkc.org/api/v2/piston/execute')
  assert.equal(headers(req).authorization, undefined)
  const sent = body(req)
  assert.equal(sent.language, 'javascript')
  assert.equal(sent.files[0].name, 'main.js')
  assert.equal(sent.run_timeout, 4000)
})

test('Judge0 keeps configurable ids and the chosen key header', () => {
  const s = normSandbox({ provider: 'judge0', judge0: { key: 'k', keyHeader: 'x-rapidapi-key', rapidApiHost: 'judge0-ce.p.rapidapi.com', pythonId: 71 } })
  const req = judge0Request(s.judge0, 'python', 'print(2)', 3000)
  assert.match(req.url, /\/submissions\?base64_encoded=false&wait=true$/)
  assert.equal(headers(req)['x-rapidapi-key'], 'k')
  assert.equal(headers(req)['x-rapidapi-host'], 'judge0-ce.p.rapidapi.com')
  assert.equal(body(req).language_id, 71)
})

test('a custom runner gets a bearer key only when one is set', () => {
  const s = normSandbox({ provider: 'custom', custom: { base: 'https://runner.test/run' } })
  const req = customRequest(s.custom, 'python', 'print(3)', 2000)
  assert.equal(req.url, 'https://runner.test/run')
  assert.equal(headers(req).authorization, undefined)
  assert.equal(body(req).language, 'python')
})

test('E2B results read stdout, results and errors', () => {
  const ok = parseE2bRun({ logs: { stdout: ['42\n'], stderr: [] }, results: [{ text: '42' }], error: null })
  assert.equal(ok.ok, true)
  assert.equal(ok.logs, '42\n')
  assert.equal(ok.value, '42')

  const bad = parseE2bRun({ logs: { stdout: [], stderr: ['boom'] }, results: [], error: { name: 'NameError', value: 'x is not defined' } })
  assert.equal(bad.ok, false)
  assert.match(bad.error, /NameError: x is not defined/)
})

test('E2B /execute is read as an NDJSON event stream', () => {
  const raw = [
    { type: 'stdout', text: 'Sandbox is working!\n' },
    { type: 'stdout', text: '4\n' },
    { type: 'stderr', text: 'a warning\n' },
    { type: 'result', text: '4', is_main_result: true },
    { type: 'result', json: { ok: true } },
    { type: 'number_of_executions', execution_count: 1 },
    { type: 'end_of_execution' },
  ].map((event) => JSON.stringify(event)).join('\n') + '\n'
  const run = parseE2bStream(raw)
  assert.equal(run.ok, true)
  assert.equal(run.logs, 'Sandbox is working!\n4\na warning\n')
  assert.equal(run.value, '4\n{"ok":true}')

  const failed = parseE2bStream([
    { type: 'stderr', text: 'Traceback\n' },
    { type: 'error', name: 'NameError', value: 'x is not defined', traceback: '…' },
    { type: 'end_of_execution' },
  ].map((event) => JSON.stringify(event)).join('\n'))
  assert.equal(failed.ok, false)
  assert.equal(failed.logs, 'Traceback\n')
  assert.match(failed.error, /NameError: x is not defined/)

  // SSE framing and no newlines must not hide the events behind them.
  const sse = 'event: message\ndata: {"type":"stdout","text":"hi\\n"}\n\ndata: {"type":"end_of_execution"}\n'
  assert.equal(parseE2bStream(sse).logs, 'hi\n')
  const glued = '{"type":"stdout","text":"a"}{"type":"stdout","text":"b"}'
  assert.equal(parseE2bStream(glued).logs, 'ab')

  // A body that carries no event is not a run, so the caller can say so.
  assert.equal(parseE2bStream('<html>proxy error page</html>'), null)
})

test('E2B also accepts the single-document SDK shape', () => {
  const run = parseE2bResponse(JSON.stringify({ logs: { stdout: ['hi\n'], stderr: [] }, results: [{ text: 'hi' }], error: null }))
  assert.equal(run.logs, 'hi\n')
  assert.equal(run.value, 'hi')
})

test('Piston results read the run block', () => {
  const ok = parsePistonRun({ language: 'python', run: { stdout: 'hi\n', stderr: '', output: 'hi\n', code: 0 } })
  assert.equal(ok.ok, true)
  assert.equal(ok.logs, 'hi\n')
  const bad = parsePistonRun({ run: { stdout: '', stderr: 'Traceback', code: 1 } })
  assert.equal(bad.ok, false)
  assert.match(bad.error, /Traceback/)
})

test('Judge0 results use the status id', () => {
  const ok = parseJudge0Run({ stdout: '2\n', stderr: '', status: { id: 3, description: 'Accepted' } })
  assert.equal(ok.ok, true)
  assert.equal(parseJudge0Run({ status: { id: 6, description: 'Compilation Error' }, compile_output: 'bad syntax' }).ok, false)
})

test('a custom runner accepts the usual shapes', () => {
  assert.equal(parseCustomRun({ stdout: 'ok', exit_code: 0 }).logs, 'ok')
  assert.equal(parseCustomRun({ output: 'ok' }).logs, 'ok')
  assert.equal(parseCustomRun({ logs: { stdout: ['ok\n'], stderr: [] }, error: null }).logs, 'ok\n')
  assert.equal(parseCustomRun({ stdout: 'x', exit_code: 2 }).ok, false)
  assert.equal(parseCustomRun({ error: 'nope' }).error, 'nope')
})
