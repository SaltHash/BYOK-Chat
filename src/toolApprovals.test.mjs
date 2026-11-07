import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_TOOL_APPROVAL,
  DEFAULT_TOOL_MODE,
  cancelToolApprovals,
  decideToolApproval,
  effectiveTools,
  modeInfo,
  needsToolApproval,
  normToolApproval,
  normToolMode,
  requestToolApproval,
  resetToolApprovals,
  settleToolApprovals,
  useApprovals,
} from './toolApprovals.ts'
import { executeToolCalls } from './engine.ts'

test.beforeEach(() => resetToolApprovals())

test('mode policy is explicit and defaults to standard', () => {
  assert.equal(DEFAULT_TOOL_MODE, 'standard')
  assert.equal(needsToolApproval('full', { location: true }, 'location'), false)
  assert.equal(needsToolApproval('standard', { location: true }, 'location'), true)
  assert.equal(needsToolApproval('standard', { location: false }, 'location'), false)
  assert.equal(needsToolApproval('restricted', {}, 'anything'), true)
  assert.equal(needsToolApproval('off', { location: true }, 'location'), false)
  assert.equal(normToolMode('nonsense'), 'standard')
  assert.equal(modeInfo('restricted').label, 'Restricted')
  assert.equal(DEFAULT_TOOL_APPROVAL.location, true)
})

test('disabled mode removes every tool schema; other modes pass the map through', () => {
  const tools = { calc: true, search: true }
  assert.deepEqual(effectiveTools(tools, 'off'), {})
  assert.deepEqual(effectiveTools(tools, 'standard'), tools)
  assert.deepEqual(effectiveTools(tools, 'restricted'), tools)
})

test('approval flags survive only as explicit booleans', () => {
  assert.deepEqual(normToolApproval({ calc: true, search: 'yes', location: false }), { calc: true })
  assert.deepEqual(normToolApproval(null), {})
})

test('allow resolves the pending request and clears the card', async () => {
  const pending = requestToolApproval({ chatId: 'c1', name: 'location', args: '{}' })
  assert.equal(useApprovals.getState().queue.length, 1)
  assert.equal(useApprovals.getState().queue[0].name, 'location')
  assert.equal(decideToolApproval(useApprovals.getState().queue[0].id, true), true)
  assert.equal(await pending, true)
  assert.equal(useApprovals.getState().queue.length, 0)
  assert.equal(decideToolApproval('missing', true), false)
})

test('deny resolves false and cancel refuses a chat without touching others', async () => {
  const denied = requestToolApproval({ chatId: 'c2', name: 'clipboard', args: '{}' })
  decideToolApproval(useApprovals.getState().queue[0].id, false)
  assert.equal(await denied, false)

  const a = requestToolApproval({ chatId: 'c3', name: 'calc', args: '{}' })
  const b = requestToolApproval({ chatId: 'c4', name: 'date', args: '{}' })
  cancelToolApprovals('c3')
  assert.equal(await a, false)
  assert.equal(useApprovals.getState().queue.length, 1)
  assert.equal(useApprovals.getState().queue[0].chatId, 'c4')
  decideToolApproval(useApprovals.getState().queue[0].id, true)
  assert.equal(await b, true)
})

test('changing access settles pending approvals for the current chat', async () => {
  const a = requestToolApproval({ chatId: 'c6', name: 'location', args: '{}' })
  const b = requestToolApproval({ chatId: 'c6', name: 'clipboard', args: '{}' })
  const other = requestToolApproval({ chatId: 'c7', name: 'date', args: '{}' })
  assert.equal(useApprovals.getState().queue.length, 3)

  settleToolApprovals('c6', true)
  assert.equal(await a, true)
  assert.equal(await b, true)
  assert.equal(useApprovals.getState().queue.length, 1)
  assert.equal(useApprovals.getState().queue[0].chatId, 'c7')
  decideToolApproval(useApprovals.getState().queue[0].id, false)
  assert.equal(await other, false)
})

test('Stop aborts a pending approval and clears it', async () => {
  const ctl = new AbortController()
  const pending = requestToolApproval({ chatId: 'c5', name: 'workspace_upsert', args: '{}' }, ctl.signal)
  assert.equal(useApprovals.getState().queue.length, 1)
  ctl.abort()
  await assert.rejects(pending, (err) => err?.name === 'AbortError')
  assert.equal(useApprovals.getState().queue.length, 0)
})

test('an approval callback can block a tool before its handler runs', async () => {
  let ran = false
  const calls = await executeToolCalls(
    [{ id: 't1', name: 'calc', arguments: '{"expression":"1+1"}' }],
    { calc: true },
    { calc: () => { ran = true; return '2' } },
    { approve: () => false },
  )
  assert.equal(ran, false)
  assert.equal(calls[0].denied, true)
  assert.equal(calls[0].error, true)
  assert.match(calls[0].result, /denied/i)
})

test('an approved tool still runs normally', async () => {
  const calls = await executeToolCalls(
    [{ id: 't2', name: 'calc', arguments: '{"expression":"2+2"}' }],
    { calc: true },
    { calc: () => '4' },
    { approve: async () => true },
  )
  assert.equal(calls[0].denied, undefined)
  assert.equal(calls[0].result, '4')
})
