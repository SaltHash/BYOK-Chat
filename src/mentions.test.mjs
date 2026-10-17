import test from 'node:test'
import assert from 'node:assert/strict'

const m = await import('./mentions.ts')

const cmds = [
  { id: 'c1', name: 'help', desc: 'Explains how the app works.', on: true },
  { id: 'c2', name: 'off', desc: '', on: false },
]
const opts = { cmds, tools: { calc: true, date: true, search: false, fetch_page: true } }

test('tokenizes a leading slash command and keeps the rest as text', () => {
  const segs = m.tokenizeMentions('/help what is this', opts)
  assert.equal(segs.length, 2)
  assert.deepEqual(segs[0], { kind: 'mention', m: {
    kind: 'command', name: 'help', label: '/help', start: 0, end: 5, enabled: true, desc: 'Explains how the app works.',
  } })
  assert.equal(segs[1].text, ' what is this')
})

test('commits a command at the end of the message and marks disabled ones', () => {
  const [seg] = m.tokenizeMentions('/off', opts)
  assert.equal(seg.kind, 'mention')
  assert.equal(seg.m.enabled, false)
  assert.equal(seg.m.desc, 'Runs one of your saved commands.')
})

test('slash commands only count at the very start', () => {
  const segs = m.tokenizeMentions('say /help', opts)
  assert.ok(segs.every((s) => s.kind === 'text'))
})

test('tokenizes tool mentions at word boundaries, with and without a call', () => {
  const bare = m.tokenizeMentions('@date tomorrow', opts)
  assert.equal(bare[0].kind, 'mention')
  assert.equal(bare[0].m.label, '@date')
  assert.equal(bare[0].m.end, 5)
  assert.equal(bare[1].text, ' tomorrow')

  const call = m.tokenizeMentions('add it @calc(2*(3+4)) please', opts)
  assert.equal(call[0].text, 'add it ')
  assert.equal(call[1].kind, 'mention')
  assert.equal(call[1].m.label, '@calc')
  assert.equal(call[2].text, '(2*(3+4)) please')
})

test('leaves unknown or unbound mentions as plain text', () => {
  assert.ok(m.tokenizeMentions('@nope hello', opts).every((s) => s.kind === 'text'))
  assert.ok(m.tokenizeMentions('mail@date', opts).every((s) => s.kind === 'text'))
})

test('search and research mentions are flagged for the banner', () => {
  const search = m.mentionsOf(m.tokenizeMentions('@search(climate) now', opts))[0]
  assert.equal(search.kind, 'search')
  assert.equal(search.enabled, false)

  const research = m.mentionsOf(m.tokenizeMentions('@research fusion progress', opts))[0]
  assert.equal(research.kind, 'research')
  assert.equal(research.enabled, true)
})

test('feature switches suppress pills and the banner', () => {
  const off = { ...opts, commandsOn: false, toolsOn: false }
  assert.ok(m.tokenizeMentions('/help @calc(1)', off).every((s) => s.kind === 'text'))
  assert.equal(m.bannerOf('@search(x)', m.tokenizeMentions('@search(x)', off)), null)
})

test('bannerOf prefers deep research over an armed search', () => {
  const segs = m.tokenizeMentions('@search(climate)', opts)
  assert.equal(m.bannerOf('@search(climate)', segs)?.kind, 'search')
  const research = m.tokenizeMentions('@research(climate)', opts)
  assert.deepEqual(m.bannerOf('@research(climate)', research), { kind: 'research', query: 'climate' })
  assert.equal(m.bannerOf('plain text', []), null)
})

test('stripMention removes a whole call or a single space', () => {
  const [tok] = m.mentionsOf(m.tokenizeMentions('@search(climate) hello', opts))
  assert.equal(m.stripMention('@search(climate) hello', tok), 'hello')
  const [mid] = m.mentionsOf(m.tokenizeMentions('hi @search(climate) there', opts))
  assert.equal(m.stripMention('hi @search(climate) there', mid), 'hi there')
  const [bare] = m.mentionsOf(m.tokenizeMentions('@date tomorrow', opts))
  assert.equal(m.stripMention('@date tomorrow', bare), 'tomorrow')
  const [nested] = m.mentionsOf(m.tokenizeMentions('@calc(2*(3+4))!', opts))
  assert.equal(m.stripMention('@calc(2*(3+4))!', nested), '!')
})

// '/help used @calc now' — the command pill runs 0..5 and '@calc' runs 11..16.
const atomic = m.tokenizeMentions('/help used @calc now', opts)

test('arrow keys step over a whole pill instead of into it', () => {
  assert.deepEqual(m.pillEdit(atomic, 'ArrowLeft', 16, 16), { kind: 'caret', pos: 11 })
  assert.deepEqual(m.pillEdit(atomic, 'ArrowLeft', 14, 14), { kind: 'caret', pos: 11 })
  assert.deepEqual(m.pillEdit(atomic, 'ArrowRight', 11, 11), { kind: 'caret', pos: 16 })
  assert.deepEqual(m.pillEdit(atomic, 'ArrowRight', 13, 13), { kind: 'caret', pos: 16 })
  assert.deepEqual(m.pillEdit(atomic, 'ArrowLeft', 5, 5), { kind: 'caret', pos: 0 })
  // Just outside a pill: the browser keeps its normal single-character step.
  assert.equal(m.pillEdit(atomic, 'ArrowLeft', 11, 11), null)
  assert.equal(m.pillEdit(atomic, 'ArrowRight', 16, 16), null)
  assert.equal(m.pillEdit(atomic, 'ArrowLeft', 17, 17), null)
})

test('backspace and delete remove a pill in one step, never a fragment', () => {
  assert.deepEqual(m.pillEdit(atomic, 'Backspace', 16, 16), { kind: 'delete', start: 11, end: 16 })
  assert.deepEqual(m.pillEdit(atomic, 'Backspace', 14, 14), { kind: 'delete', start: 11, end: 16 })
  assert.deepEqual(m.pillEdit(atomic, 'Delete', 11, 11), { kind: 'delete', start: 11, end: 16 })
  assert.deepEqual(m.pillEdit(atomic, 'Delete', 13, 13), { kind: 'delete', start: 11, end: 16 })
  assert.deepEqual(m.pillEdit(atomic, 'Backspace', 11, 16), { kind: 'delete', start: 11, end: 16 })
  // Text plus a pill selected: hand it back to the browser.
  assert.equal(m.pillEdit(atomic, 'Backspace', 10, 16), null)
  assert.equal(m.pillEdit(atomic, 'Backspace', 11, 11), null)
  assert.equal(m.pillEdit(atomic, 'Delete', 16, 16), null)
})

test('atomic rules ignore unrelated keys and plain text', () => {
  assert.equal(m.pillEdit(atomic, 'Enter', 13, 13), null)
  assert.equal(m.pillEdit(atomic, 'a', 13, 13), null)
  const plain = m.tokenizeMentions('nothing to see', opts)
  assert.equal(m.pillEdit(plain, 'Backspace', 8, 8), null)
  // Banner mentions are not pills, so they delete one character at a time.
  const search = m.tokenizeMentions('@search(climate)', opts)
  assert.equal(m.pillEdit(search, 'Backspace', 7, 7), null)
})

test('armMention pulls an opened call out of the draft', () => {
  assert.deepEqual(m.armMention('@search('), { kind: 'search', rest: '' })
  assert.deepEqual(m.armMention('@research('), { kind: 'research', rest: '' })
  assert.deepEqual(m.armMention('find the answer @search('), { kind: 'search', rest: 'find the answer' })
  assert.deepEqual(m.armMention('hi  @research('), { kind: 'research', rest: 'hi' })
  // Multi-line drafts keep everything before the call.
  assert.deepEqual(m.armMention('first line\nsecond @search('), { kind: 'search', rest: 'first line\nsecond' })
})

test('armMention also takes a whole pasted call', () => {
  assert.deepEqual(m.armMention('@search(climate adaptation)'), { kind: 'search', rest: 'climate adaptation' })
  assert.deepEqual(m.armMention('  @research( fusion progress ) '), { kind: 'research', rest: 'fusion progress' })
})

test('armMention leaves ordinary writing alone', () => {

  assert.equal(m.armMention(''), null)
  assert.equal(m.armMention('@search'), null)
  assert.equal(m.armMention('@search climate'), null)
  assert.equal(m.armMention('see @search( now'), null)
  assert.equal(m.armMention('mail@search('), null)
  // Tier syntax is left for the research planner to read.
  assert.equal(m.armMention('@research[quick](fusion)'), null)
})

test('sentBodyText drops the search/research wording the banner already shows', () => {
  const opts2 = { cmds, tools: { search: true } }
  // Search with a trailing query text.
  let segs = m.tokenizeMentions('@search weather today', opts2)
  let b = m.bannerOf('@search weather today', segs)
  assert.equal(m.sentBodyText('@search weather today', b), 'weather today')
  // Search with a complete (...) wrapper: only surrounding text remains.
  segs = m.tokenizeMentions('quick @search(climate news) please', opts2)
  b = m.bannerOf('quick @search(climate news) please', segs)
  assert.equal(m.sentBodyText('quick @search(climate news) please', b), 'quick please')
  // Research: banner carries the query, body shows nothing extra.
  assert.equal(m.sentBodyText('@research(battery recycling)', m.bannerOf('@research(battery recycling)', [])), 'battery recycling')
  assert.equal(m.sentBodyText('@research ocean currents', null), '@research ocean currents')
})
