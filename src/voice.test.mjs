import test from 'node:test'
import assert from 'node:assert/strict'

const { BLANK_VOICE, normVoice, speechText, voiceOn, dictationAvailable, startDictation } = await import('./voice.ts')

test('voice prefs normalize rate and flags', () => {
  assert.deepEqual(normVoice(undefined), BLANK_VOICE)
  assert.equal(normVoice({ rate: 99 }).rate, 2)
  assert.equal(normVoice({ rate: 0.1 }).rate, 0.5)
  assert.equal(normVoice({ rate: 'fast' }).rate, 1)
  assert.equal(normVoice({ autoRead: 'yes' }).autoRead, false)
  assert.equal(normVoice({ autoRead: true }).autoRead, true)
  assert.equal(normVoice({ dictLang: 'en-US' }).dictLang, 'en-US')
})

test('voice can be switched off at the feature level', () => {
  assert.equal(voiceOn({ features: { voice: false } }), false)
  assert.equal(voiceOn({ features: { voice: true } }), true)
  assert.equal(voiceOn(undefined), true)
})

test('speech text drops code, links, citations, and markdown noise', () => {
  const md = [
    '# Heading',
    '',
    'Here is a [link](https://example.com/page) and some **bold** text [S1].',
    '',
    '```js',
    'const x = 1',
    '```',
    '',
    '- item one',
    '- item two',
    '',
    'See https://example.com/raw for more.',
  ].join('\n')
  const spoken = speechText(md)
  assert.match(spoken, /Heading/)
  assert.match(spoken, /Here is a link and some bold text/)
  assert.match(spoken, /Code block\./)
  assert.match(spoken, /item one item two/)
  assert.ok(!spoken.includes('const x'))
  assert.ok(!spoken.includes('[S1]'))
  assert.ok(!spoken.includes('https://example.com/page'))
  assert.ok(!spoken.includes('**'))
  assert.ok(spoken.length <= 8000)
  assert.equal(speechText('   '), '')
})

test('dictation mirrors interim and final results and reports errors', () => {
  const created = []
  class FakeRecognition {
    constructor() { created.push(this) }
    start() { this.started = true }
    stop() { this.stopped = true }
  }
  globalThis.window = { SpeechRecognition: FakeRecognition, navigator: { language: 'en-GB' } }
  try {
    assert.equal(dictationAvailable(), true)
    const seen = []
    let ended = 0
    const d = startDictation({ lang: 'en-US', onText: (t, interim) => seen.push([t, interim]), onEnd: () => ended++ })
    const rec = created[0]
    assert.equal(rec.started, true)
    assert.equal(rec.lang, 'en-US')
    assert.equal(rec.interimResults, true)
    rec.onresult({ resultIndex: 0, results: [{ 0: { transcript: 'hello ' }, isFinal: true }, { 0: { transcript: 'wor' }, isFinal: false }] })
    assert.deepEqual(seen.at(-1), ['hello wor', true])
    d.stop()
    assert.equal(rec.stopped, true)
    assert.equal(ended, 1)
    // A later onend must not double-report.
    rec.onend()
    assert.equal(ended, 1)

    let message = ''
    const d2 = startDictation({ onText: () => {}, onError: (m) => { message = m } })
    created[1].onerror({ error: 'not-allowed' })
    assert.match(message, /Microphone access was blocked/)
    d2.stop()
  } finally {
    delete globalThis.window
  }
})

test('dictation reports an unsupported browser instead of throwing raw', () => {
  globalThis.window = { navigator: { language: 'en-US' } }
  try {
    assert.equal(dictationAvailable(), false)
    assert.throws(() => startDictation({ onText: () => {} }), /not supported in this browser/)
  } finally {
    delete globalThis.window
  }
})
