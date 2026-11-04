import test from 'node:test'
import assert from 'node:assert/strict'

const { quoteForSend, splitQuotedReply } = await import('./quote.ts')

test('a quoted reply round-trips through the leading blockquote', () => {
  const encoded = quoteForSend('First line\nSecond line')
  assert.equal(encoded, '> First line\n> Second line\n\n')
  assert.deepEqual(splitQuotedReply(`${encoded}My reply`), {
    quote: 'First line\nSecond line',
    body: 'My reply',
  })
})

test('splitQuotedReply leaves ordinary messages and blockquotes alone', () => {
  assert.equal(splitQuotedReply('Just a message'), null)
  assert.equal(splitQuotedReply('A quote later\n\n> not attached'), null)
  assert.equal(splitQuotedReply('>'), null)
})

test('a quote can be the whole message and preserves a blank quoted line', () => {
  const encoded = quoteForSend('One\n\nThree')
  assert.deepEqual(splitQuotedReply(encoded), { quote: 'One\n\nThree', body: '' })
})
