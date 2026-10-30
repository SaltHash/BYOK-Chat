import test from 'node:test'
import assert from 'node:assert/strict'
import { buildExportPayload, chatsInDateRange, mergeImportedSearch } from './configIO.ts'
import { normSearch } from './store.ts'

/* A save's search credentials are only ever exported when the user ticks
 * "Include API keys", so an import must treat a blank key as "not included"
 * rather than "cleared" — otherwise moving or restoring a save silently wipes
 * the search keys and the page-reader key it could not carry. */

const state = {
  search: normSearch({ provider: 'exa', keys: { exa: 'sk-exa', jina: 'jina-key' }, readerProvider: 'jina', readerKey: 'reader-key' }),
}

const exportSearch = (withKeys) => {
  const data = buildExportPayload(
    { ...state, eps: [], tools: {}, mcps: [] },
    { eps: false, prompts: false, pls: false, cmds: false, skills: false, memory: false, keys: false, appearance: false, features: false, tools: true, tuning: false, widgets: false, stats: false, chats: false },
    withKeys,
    (v) => ({ skills: v }),
    normSearch,
  )
  return data.search
}

test('a keyless export blanks every search provider key and the reader key', () => {
  const search = exportSearch(false)
  for (const [id, value] of Object.entries(search.keys)) assert.equal(value, '', `${id} key must not be exported`)
  assert.equal(search.readerKey, '')
  // The provider choice is not a credential and still travels.
  assert.equal(search.provider, 'exa')
  assert.equal(search.readerProvider, 'jina')
})

test('an export that includes keys keeps them, including Jina', () => {
  const search = exportSearch(true)
  assert.equal(search.keys.exa, 'sk-exa')
  assert.equal(search.keys.jina, 'jina-key')
  assert.equal(search.readerKey, 'reader-key')
})

test('importing a copy without credentials keeps the keys this device holds', () => {
  const current = normSearch({ provider: 'exa', keys: { exa: 'sk-local' }, readerProvider: 'jina', readerKey: 'reader-local' })
  const incoming = normSearch({ provider: 'exa', keys: {}, readerProvider: 'jina', readerKey: '' })
  const merged = mergeImportedSearch(current, incoming)
  assert.equal(merged.keys.exa, 'sk-local')
  assert.equal(merged.readerKey, 'reader-local')
  assert.equal(merged.provider, 'exa')
})

test('a replace of a saved copy keeps credentials the file never carried', () => {
  // Restoring a local backup or moving a save passes merge=false; the file has
  // no keys at all, but the device's own keys must survive either way.
  const current = normSearch({ provider: 'tinyfish', keys: { tinyfish: 'tf-local' } })
  const incoming = normSearch({ provider: 'exa', keys: {}, readerProvider: 'builtin', readerKey: '' })
  const merged = mergeImportedSearch(current, incoming)
  assert.equal(merged.keys.tinyfish, 'tf-local')
  assert.equal(merged.readerKey, '')
  // Ordinary settings from the file still apply.
  assert.equal(merged.provider, 'exa')
  assert.equal(merged.readerProvider, 'builtin')
})

test('credentials the file does carry replace the stored ones', () => {
  const current = normSearch({ provider: 'exa', keys: { exa: 'sk-old' }, readerProvider: 'jina', readerKey: 'reader-old' })
  const incoming = normSearch({ provider: 'exa', keys: { exa: 'sk-new' }, readerProvider: 'jina', readerKey: 'reader-new' })
  const merged = mergeImportedSearch(current, incoming)
  assert.equal(merged.keys.exa, 'sk-new')
  assert.equal(merged.readerKey, 'reader-new')
})

test('whitespace-only credentials in a file count as absent', () => {
  const current = normSearch({ keys: { exa: 'sk-local' }, readerKey: 'reader-local' })
  const merged = mergeImportedSearch(current, normSearch({ keys: { exa: '   ' }, readerKey: '  ' }))
  assert.equal(merged.keys.exa, 'sk-local')
  assert.equal(merged.readerKey, 'reader-local')
})

test('an imported search block that is not an object never invents credentials', () => {
  const current = normSearch({ keys: { exa: 'sk-local' }, readerKey: 'reader-local' })
  const merged = mergeImportedSearch(current, null)
  assert.equal(merged.keys.exa, 'sk-local')
  assert.equal(merged.readerKey, 'reader-local')
})

const chat = (id, ats) => ({ id, msgs: ats.map((at, i) => ({ id: `${id}-${i}`, at })) })
const at = (iso) => new Date(iso).getTime()
const chats = [
  chat('before', [at('2026-01-01T12:00:00')]),
  chat('inside', [at('2026-05-10T12:00:00'), at('2026-05-20T12:00:00')]),
  chat('after', [at('2026-09-01T12:00:00')]),
  { id: 'empty', msgs: [] },
]

test('no range keeps every chat, including empty ones', () => {
  assert.equal(chatsInDateRange(chats).length, 4)
})

test('a date range keeps chats with any message inside it', () => {
  assert.deepEqual(chatsInDateRange(chats, '2026-05-01', '2026-05-31').map((c) => c.id), ['inside'])
  assert.deepEqual(chatsInDateRange(chats, '2026-01-01', '2026-05-10').map((c) => c.id), ['before', 'inside'])
  assert.deepEqual(chatsInDateRange(chats, '', '2026-05-09').map((c) => c.id), ['before'])
  assert.deepEqual(chatsInDateRange(chats, '2026-06-01').map((c) => c.id), ['after'])
})
