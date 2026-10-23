import test from 'node:test'
import assert from 'node:assert/strict'

const { planRequest } = await import('./chatPlan.ts')

const ep = { id: 'e1', name: 'Test', type: 'openai', url: 'https://x.test/v1', key: 'k', model: 'm', models: ['m'], modelsMode: 'separate', prices: {}, on: true }

const state = (over = {}) => ({
  eps: [ep], pls: [], cmds: [],
  prompts: [{ id: 'p1', name: 'P', text: 'Prompt body' }],
  pr: 'p1', sel: { k: 'ep', id: 'e1' },
  globalPrompt: { on: false, text: '', qualities: [] },
  features: { prompts: true, tools: true, commands: true, playlists: true, skills: false },
  tools: {},
  skills: { skills: [] },
  ...over,
})

const um = { id: 'u1', r: 'user', t: 'hello' }

test('the system prompt always states the current UTC date', () => {
  const p = planRequest(state(), um, {})
  assert.match(p.sys, /Current date and time \(UTC\): \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC/)
})

test('prompt variables are resolved in the user-facing system prompt', () => {
  const p = planRequest(state({
    globalPrompt: { on: true, text: 'Today is {date}, it is {time}.', qualities: [] },
  }), um, {})
  const today = new Date().toISOString().slice(0, 10)
  assert.match(p.sys, new RegExp(`Today is ${today}`))
  assert.ok(!p.sys.includes('{date}'))
  assert.ok(!p.sys.includes('{time}'))
})

test('a chat prompt variable is resolved too', () => {
  const p = planRequest(state({
    prompts: [{ id: 'p1', name: 'P', text: 'Date: {date}' }],
  }), um, {})
  const today = new Date().toISOString().slice(0, 10)
  assert.match(p.sys, new RegExp(`Date: ${today}`))
})

test('unknown placeholders are left untouched', () => {
  const p = planRequest(state({
    globalPrompt: { on: true, text: 'Keep {notAVariable} as is.', qualities: [] },
  }), um, {})
  assert.match(p.sys, /Keep \{notAVariable\} as is\./)
})
