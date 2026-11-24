import test from 'node:test'
import assert from 'node:assert/strict'

const { arrivalFadeMs, fadeMsOf, segmentFade } = await import('./replyFade.ts')

test('the reply fade setting becomes a duration in milliseconds', () => {
  assert.equal(fadeMsOf(0.3), 300)
  assert.equal(fadeMsOf(1), 1000)
  assert.equal(fadeMsOf(4), 1000) // clamped to the slider's range
  assert.equal(fadeMsOf(0), 0)
  assert.equal(fadeMsOf(undefined), 0)
  assert.equal(fadeMsOf(NaN), 0)
})

test('a segment that mounted with the fade keeps it when it stops being last', () => {
  // Flipping the duration re-parses the block: dropping the fade destroys its
  // spans, and restoring it later replays every word's animation.
  assert.equal(segmentFade(300, false, 300), 300)
})

test('a segment that mounted without a fade never gains one', () => {
  assert.equal(segmentFade(0, true, 300), 0)
})

test('a new segment is faded only when it is the piece still being written', () => {
  assert.equal(segmentFade(undefined, true, 300), 300)
  assert.equal(segmentFade(undefined, false, 300), 0)
  assert.equal(segmentFade(undefined, true, 0), 0)
})

test('the prose the paced body was already showing does not fade again', () => {
  // A tool round commits and the live body is replaced by pieces: the opening
  // piece has been readable for a while and must not go back to transparent.
  assert.equal(segmentFade(undefined, true, 300, true), 0)
})

test('a reply that faded its words does not fade as a whole afterwards', () => {
  assert.equal(arrivalFadeMs({ finished: true, live: false, painted: true, setting: 0.3 }), 0)
})

test('a reply that never put a fading word on screen fades as one unit', () => {
  assert.equal(arrivalFadeMs({ finished: true, live: false, painted: false, setting: 0.3 }), 300)
})

test('no arrival fade while the reply is still streaming or the setting is off', () => {
  assert.equal(arrivalFadeMs({ finished: true, live: true, painted: false, setting: 0.3 }), 0)
  assert.equal(arrivalFadeMs({ finished: false, live: false, painted: false, setting: 0.3 }), 0)
  assert.equal(arrivalFadeMs({ finished: true, live: false, painted: false, setting: 0 }), 0)
})
