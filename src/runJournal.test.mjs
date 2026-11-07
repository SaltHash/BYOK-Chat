import test from 'node:test'
import assert from 'node:assert/strict'
import { continueNote, normRunEntry, normRunJournal } from './runJournal.ts'

test('a journal entry keeps only the fields recovery needs', () => {
  const entry = normRunEntry({
    mid: 'm1',
    at: 10,
    attempts: 99,
    status: 'question',
    question: { id: 'q1', question: '  Pick one? ', options: ['A', 'a', 'B'], allowText: false, at: 9 },
    approval: { name: 'write_file', args: 'x'.repeat(2000) },
  })
  assert.equal(entry.mid, 'm1')
  assert.equal(entry.attempts, 9)
  assert.equal(entry.status, 'question')
  assert.equal(entry.question.question, 'Pick one?')
  assert.deepEqual(entry.question.options, ['A', 'B'])
  assert.equal(entry.question.allowText, false)
  assert.equal(entry.approval.name, 'write_file')
  assert.equal(entry.approval.args.length, 1600)
})

test('an entry without its subject cannot claim to be blocked', () => {
  const noQuestion = normRunEntry({ mid: 'm1', status: 'question' })
  assert.equal(noQuestion.status, 'running')
  assert.equal(noQuestion.question, undefined)
  const noApproval = normRunEntry({ mid: 'm2', status: 'approval', approval: { args: '{}' } })
  assert.equal(noApproval.status, 'running')
  assert.equal(noApproval.approval, undefined)
  assert.equal(normRunEntry({ mid: '   ' }), null)
  assert.equal(normRunEntry('junk'), null)
})

test('the journal drops junk, sorts newest first and caps its size', () => {
  assert.deepEqual(normRunJournal(null), {})
  const raw = { bad: { mid: '' }, alsoBad: 4 }
  for (let i = 0; i < 25; i++) raw[`c${i}`] = { mid: `m${i}`, at: i }
  const journal = normRunJournal(raw)
  assert.equal(Object.keys(journal).length, 20)
  assert.equal(journal.c24.at, 24)
  assert.equal(journal.c4, undefined)
  assert.equal(journal.c5.mid, 'm5')
})

test('continuation notes carry the question answer or the unrun approval', () => {
  const plain = continueNote()
  assert.match(plain, /Continue the same reply/)
  assert.match(plain, /Do not repeat/)
  const answered = continueNote({ question: { question: 'Which one?', answer: 'The second' } })
  assert.match(answered, /Which one\?/)
  assert.match(answered, /The second/)
  assert.match(answered, /do not ask the same question again/i)
  const approved = continueNote({ approval: 'write_file' })
  assert.match(approved, /write_file/)
  assert.match(approved, /did not run/)
})
