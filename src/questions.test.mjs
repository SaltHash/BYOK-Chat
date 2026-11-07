import test from 'node:test'
import assert from 'node:assert/strict'
import {
  answerUserQuestion,
  cancelUserQuestions,
  clearOrphanQuestions,
  normalizeQuestionInput,
  queueOrphanQuestion,
  requestUserQuestion,
  resetUserQuestions,
  useQuestions,
} from './questions.ts'
import { DEFAULT_TOOLS, TOOLS } from './meta.ts'

test.beforeEach(() => resetUserQuestions())
test.after(() => resetUserQuestions())

test('normalizeQuestionInput trims, caps and dedupes what the card can show', () => {
  assert.equal(normalizeQuestionInput(null), null)
  assert.equal(normalizeQuestionInput({ question: '   ' }), null)
  assert.deepEqual(normalizeQuestionInput({ question: '  Which   one? ', options: ['A', ' a ', '', 3, 'B'], allowText: false }), {
    question: 'Which one?',
    options: ['A', 'B'],
    allowText: false,
  })
  const many = normalizeQuestionInput({ question: 'Pick', options: ['1', '2', '3', '4', '5', '6', '7'] })
  assert.equal(many.options.length, 6)
  assert.equal(normalizeQuestionInput({ question: 'x'.repeat(900) }).question.length, 600)
})

test('a live question shows in the queue and resolves with the typed answer', async () => {
  const pending = requestUserQuestion({ chatId: 'c1', question: 'Which branch?', options: ['main', 'next'], allowText: true })
  const card = useQuestions.getState().queue[0]
  assert.equal(card.chatId, 'c1')
  assert.equal(card.question, 'Which branch?')
  assert.deepEqual(card.options, ['main', 'next'])
  assert.equal(answerUserQuestion(card.id, '  next  '), true)
  assert.equal(await pending, 'next')
  assert.equal(useQuestions.getState().queue.length, 0)
  assert.equal(answerUserQuestion(card.id, 'main'), false)
})

test('stop rejects the waiter and removes only that chat’s cards', async () => {
  const first = requestUserQuestion({ chatId: 'c1', question: 'One?', options: [], allowText: true })
  const second = requestUserQuestion({ chatId: 'c1', question: 'Two?', options: [], allowText: true })
  const other = requestUserQuestion({ chatId: 'c2', question: 'Other?', options: [], allowText: true })
  cancelUserQuestions('c1')
  await assert.rejects(first, /stopped/i)
  await assert.rejects(second, /stopped/i)
  assert.equal(useQuestions.getState().queue.length, 1)
  assert.equal(useQuestions.getState().queue[0].chatId, 'c2')
  answerUserQuestion(useQuestions.getState().queue[0].id, 'kept')
  assert.equal(await other, 'kept')
})

test('a restored journal question has no waiter and is queued once', async () => {
  const question = { id: 'q-restored', chatId: 'c3', question: 'Resume?', options: ['Yes'], allowText: true, at: 1 }
  queueOrphanQuestion(question)
  queueOrphanQuestion(question)
  assert.deepEqual(useQuestions.getState().queue, [{ ...question, orphan: true }])
  assert.equal(answerUserQuestion('q-restored', 'Yes'), false)
  assert.equal(useQuestions.getState().queue.length, 1)
  cancelUserQuestions('c3')
  assert.equal(useQuestions.getState().queue.length, 0)
})

test('starting a new message drops restored questions but leaves live ones', async () => {
  queueOrphanQuestion({ id: 'q-old', chatId: 'c1', question: 'Old?', options: [], allowText: true, at: 1 })
  const live = requestUserQuestion({ chatId: 'c1', question: 'Live?', options: [], allowText: true })
  clearOrphanQuestions('c1')
  assert.equal(useQuestions.getState().queue.length, 1)
  assert.equal(useQuestions.getState().queue[0].question, 'Live?')
  answerUserQuestion(useQuestions.getState().queue[0].id, 'kept')
  assert.equal(await live, 'kept')
})

test('ask is an enabled tool in the registry', () => {
  assert.equal(DEFAULT_TOOLS.ask, true)
  assert.equal(TOOLS[0][0], 'ask')
})
