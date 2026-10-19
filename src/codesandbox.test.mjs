import test from 'node:test'
import assert from 'node:assert/strict'

const {
  BLANK_CODE_RUN, CODE_MAX_CHARS, CODE_OUTPUT_DEFAULT, CODE_OUTPUT_MAX, CODE_OUTPUT_MIN,
  CODE_TIMEOUT_DEFAULT, CODE_TIMEOUT_MAX, CODE_TIMEOUT_MIN, PYODIDE_DEFAULT_URL,
  codeLangLabel, formatCodeResult, normCodeRun, pyodideIndexUrl, runCode,
} = await import('./codesandbox.ts')

test('code execution is off by default and normalizes limits', () => {
  assert.deepEqual(normCodeRun(undefined), BLANK_CODE_RUN)
  assert.equal(normCodeRun(undefined).on, false)
  assert.equal(normCodeRun(undefined).python, false)
  assert.equal(normCodeRun({ on: 1 }).on, false)
  assert.equal(normCodeRun({ on: true }).on, true)
  assert.equal(normCodeRun({ timeoutMs: 1 }).timeoutMs, CODE_TIMEOUT_MIN)
  assert.equal(normCodeRun({ timeoutMs: 999999 }).timeoutMs, CODE_TIMEOUT_MAX)
  assert.equal(normCodeRun({ timeoutMs: 'nope' }).timeoutMs, CODE_TIMEOUT_DEFAULT)
  assert.equal(normCodeRun({ maxOutput: 1 }).maxOutput, CODE_OUTPUT_MIN)
  assert.equal(normCodeRun({ maxOutput: 10 ** 9 }).maxOutput, CODE_OUTPUT_MAX)
  assert.equal(normCodeRun({ maxOutput: undefined }).maxOutput, CODE_OUTPUT_DEFAULT)
  assert.equal(normCodeRun({ python: 'yes' }).python, false)
  assert.equal(normCodeRun({ python: true }).python, true)
  assert.equal(normCodeRun(undefined).pyPackages, false)
  assert.equal(normCodeRun({ pyPackages: 'yes' }).pyPackages, false)
  assert.equal(normCodeRun({ pyPackages: true }).pyPackages, true)
})

test('the Pyodide URL accepts directories, links, and falls back safely', () => {
  assert.equal(pyodideIndexUrl(undefined), PYODIDE_DEFAULT_URL)
  assert.equal(pyodideIndexUrl('javascript:alert(1)'), PYODIDE_DEFAULT_URL)
  assert.equal(pyodideIndexUrl('https://cdn.example.com/pyodide/v1/full/'), 'https://cdn.example.com/pyodide/v1/full/')
  assert.equal(pyodideIndexUrl('https://cdn.example.com/pyodide/v1/full'), 'https://cdn.example.com/pyodide/v1/full/')
  assert.equal(pyodideIndexUrl('https://cdn.example.com/pyodide/v1/full/pyodide.js'), 'https://cdn.example.com/pyodide/v1/full/')
  // A stored link is normalized back to a directory on every read.
  assert.equal(normCodeRun({ pyodideUrl: 'https://cdn.example.com/pyodide.js' }).pyodideUrl, 'https://cdn.example.com/')
})

test('code results format stdout, values, errors, and timeouts for the model', () => {
  const base = { ok: true, logs: 'hello\n', value: '42', ms: 12, truncated: false }
  const text = formatCodeResult('javascript', base)
  assert.match(text, /^JavaScript · 12ms/)
  assert.match(text, /stdout:\nhello/)
  assert.match(text, /result: 42/)

  assert.match(formatCodeResult('python', { ...base, logs: '', value: null }), /\(no output\)/)
  assert.match(formatCodeResult('python', { ...base, ok: false, error: 'NameError: x', logs: 'partial' }), /error: NameError: x/)
  const timeout = formatCodeResult('javascript', { ...base, ok: false, logs: '', value: null, timedOut: true, ms: 5000 })
  assert.match(timeout, /stopped after 5000ms/)
  assert.match(timeout, /infinite loop/)
  assert.match(formatCodeResult('javascript', { ...base, logs: 'abc', truncated: true }), /output truncated/)
  assert.equal(codeLangLabel('python'), 'Python')
  assert.equal(codeLangLabel('javascript'), 'JavaScript')
})

test('runCode rejects configuration errors before starting a worker', async () => {
  const prefs = { ...BLANK_CODE_RUN, on: true }
  await assert.rejects(() => runCode('ruby', 'puts 1', prefs), /Unsupported language/)
  await assert.rejects(() => runCode('javascript', '   ', prefs), /Provide code/)
  await assert.rejects(() => runCode('javascript', 'x'.repeat(CODE_MAX_CHARS + 1), prefs), /too long/)
  await assert.rejects(
    () => runCode('python', 'print(1)', { ...prefs, python: false }),
    /Python is disabled/,
  )
})

test('runCode reports a clear error outside a browser worker environment', async () => {
  const prefs = { ...BLANK_CODE_RUN, on: true }
  // Node has no Web Worker global, so the sandbox cannot start here. The
  // browser path is exercised in the UI verification, not this unit test.
  if (typeof Worker !== 'undefined') return
  await assert.rejects(() => runCode('javascript', 'return 1 + 1', prefs), /Web Workers/)
})
