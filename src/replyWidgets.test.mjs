import test from 'node:test'
import assert from 'node:assert/strict'

const { normalizePoll, initialPollAnswers, pollAnswerText } = await import('../src/replyWidgets.ts')

test('normalizes the current questions schema', () => {
  const poll = normalizePoll({
    questions: [
      {
        label: 'Which editor do you use?',
        type: 'choice',
        options: ['VS Code', { label: 'Other', fillBlank: true }],
      },
      { label: 'How many hours?', type: 'number', defaultValue: '4' },
    ],
  })
  assert.equal(poll.length, 2)
  assert.equal(poll[0].type, 'choice')
  assert.deepEqual(poll[0].options.map((o) => o.label), ['VS Code', 'Other'])
  assert.equal(poll[0].options[1].fillBlank, true)
  assert.equal(poll[1].type, 'number')
})

test('keeps legacy single-question polls renderable', () => {
  const [poll] = normalizePoll({
    question: 'Pick a path',
    mode: 'multiple',
    options: [{ label: 'A', prompt: 'Do A' }, { label: 'B', prompt: 'Do B' }],
  })
  assert.equal(poll.label, 'Pick a path')
  assert.equal(poll.type, 'choice')
  assert.equal(poll.multiple, true)
  assert.equal(poll.options.length, 2)
})

test('answers include the typed value attached to a fill-in option', () => {
  const poll = normalizePoll({
    questions: [{
      label: 'Which editor?',
      type: 'choice',
      options: ['VS Code', { label: 'Other', fillBlank: true }],
    }],
  })
  const answers = initialPollAnswers(poll)
  answers[0] = { ...answers[0], choice: [1], text: 'Neovim' }
  assert.equal(pollAnswerText(poll, answers), 'Which editor?\nOther: Neovim')
})

test('slider answers start at their minimum and can be sent', () => {
  const poll = normalizePoll({ questions: [{ label: 'Confidence?', type: 'slider', min: 1, max: 5 }] })
  const answers = initialPollAnswers(poll)
  assert.equal(answers[0].number, '1')
  answers[0] = { ...answers[0], number: '4' }
  assert.equal(pollAnswerText(poll, answers), 'Confidence?\n4')
})

test('a numeric slider default is honored', () => {
  const poll = normalizePoll({ questions: [{ label: 'Confidence?', type: 'slider', min: 1, max: 5, defaultValue: 3 }] })
  assert.equal(initialPollAnswers(poll)[0].number, '3')
})

test('invalid or empty poll arguments do not produce a card', () => {
  assert.deepEqual(normalizePoll(null), [])
  assert.deepEqual(normalizePoll({}), [])
  assert.deepEqual(normalizePoll({ questions: [{ type: 'choice', options: [] }] }), [])
})
