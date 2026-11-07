import test from 'node:test'
import assert from 'node:assert/strict'
import { executeTool, MAX_TOOL_RESULT_CHARS } from './engine.ts'

const call = { id: 't1', name: 'calc', arguments: '{"expression":"1+1"}' }

test('a tool result at the limit is not flagged or rewritten', async () => {
  const text = 'x'.repeat(MAX_TOOL_RESULT_CHARS)
  const result = await executeTool(call, { calc: true }, { calc: () => text })
  assert.equal(result.error, undefined)
  assert.equal(result.truncated, undefined)
  assert.equal(result.result, text)
})

test('an oversized tool result is capped and flagged for the process log', async () => {
  const raw = 'y'.repeat(MAX_TOOL_RESULT_CHARS + 250)
  const result = await executeTool(call, { calc: true }, { calc: () => raw })
  assert.equal(result.truncated, true)
  assert.equal(result.result.startsWith('y'.repeat(MAX_TOOL_RESULT_CHARS)), true)
  assert.match(result.result, /Result cut at 100,000 characters/)
  assert.ok(result.result.length < raw.length)
})

test('a failing tool call stays an error and is never marked truncated', async () => {
  const result = await executeTool(call, { calc: false })
  assert.equal(result.error, true)
  assert.equal(result.truncated, undefined)
})
