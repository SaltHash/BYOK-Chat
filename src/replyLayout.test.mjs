import test from 'node:test'
import assert from 'node:assert/strict'

const { replyBlocks, roundEmbeds } = await import('./replyLayout.ts')

const artifact = (id, title = 'Chart') => ({
  id, name: 'show_artifact',
  arguments: JSON.stringify({ title, html: '<p>hello</p>' }),
})
const graph = (id, placement = 'left') => ({
  id, name: 'graph',
  arguments: JSON.stringify({ equations: ['x^2'], placement }),
})

test('a reply without embeds stays on the single-pass path', () => {
  assert.equal(replyBlocks('Hello.', [{ text: 'Hello.', calls: [{ id: 'c1', name: 'calc', arguments: '{}' }] }]), null)
  assert.equal(replyBlocks('Hello.'), null)
})

test('each embed sits directly after the text of the round that made it', () => {
  const text = 'First part.\n\nSecond part.\n\nLast words.'
  const blocks = replyBlocks(text, [
    { text: 'First part.', calls: [artifact('a1')] },
    { text: 'Second part.', calls: [graph('g1')] },
    { text: 'Last words.', calls: [] },
  ])
  assert.deepEqual(blocks.map((b) => b.text ?? ''), ['First part.', '', '\n\nSecond part.', '', '\n\nLast words.'])
  assert.deepEqual(blocks.map((b) => b.embeds[0]?.kind ?? null), [null, 'artifact', null, 'graph', null])
  assert.equal(blocks[3].embeds[0].call.placement, 'left')
})

test('an embed made before any text sits at that point, not at the end', () => {
  const blocks = replyBlocks('The answer.', [
    { text: '', calls: [graph('g1', 'right')] },
    { text: 'The answer.', calls: [] },
  ])
  assert.equal(blocks[0].text, undefined)
  assert.equal(blocks[0].embeds[0].call.placement, 'right')
  assert.equal(blocks[1].text, 'The answer.')
})

test('order within a round follows the calls', () => {
  const blocks = replyBlocks('Intro.', [
    { text: 'Intro.', calls: [graph('g1'), artifact('a1'), { id: 'c1', name: 'calc', arguments: '{}' }] },
  ])
  assert.deepEqual(blocks.flatMap((b) => b.embeds.map((e) => e.kind)), ['graph', 'artifact'])
})

test('an embed whose round text is not in this reply keeps to the end', () => {
  const blocks = replyBlocks('Report body.', [
    { text: 'Some text the report does not contain.', calls: [artifact('a1')] },
  ])
  assert.deepEqual(blocks.map((b) => b.text ?? ''), ['Report body.', ''])
  assert.equal(blocks[1].embeds[0].kind, 'artifact')
  assert.equal(blocks[0].embeds.length, 0)
})

test('unrenderable calls are skipped', () => {
  assert.deepEqual(roundEmbeds([{ id: 'e', name: 'show_artifact', arguments: '{"title":"x"}', error: true }]), [])
  assert.deepEqual(roundEmbeds([{ id: 'b', name: 'show_artifact', arguments: 'not json' }]), [])
  assert.deepEqual(roundEmbeds([{ id: 'b', name: 'graph', arguments: '{"equations":[""]}' }]), [])
  assert.equal(roundEmbeds([{ id: 'g', name: 'graph', arguments: '{"series":[{"points":[[1,2]]}]}' }]).length, 1)
})

test('the reply text survives the split in order', () => {
  const text = 'Alpha.\n\nBeta.\n\nGamma.'
  const blocks = replyBlocks(text, [
    { text: 'Alpha.', calls: [artifact('a1')] },
    { text: 'Beta.', calls: [graph('g1', 'below')] },
    { text: 'Gamma.', calls: [] },
  ])
  assert.equal(blocks.map((b) => b.text ?? '').join(''), text)
})
