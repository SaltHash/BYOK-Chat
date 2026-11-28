import test from 'node:test'
import assert from 'node:assert/strict'

const {
  SKILL_SOURCES, parseFrontmatter, parseSkillDoc, parseSkillIndex,
  listingsFromIndex, applyDoc, uniqueSkillId, searchListings, skillFromListing, loadSkillCatalog,
  clearSkillCatalogCache, installListing,
} = await import('./skillCatalog.ts')
const { SKILL_INSTRUCTIONS_MAX } = await import('./skills.ts')

const source = SKILL_SOURCES[0]

const index = (body) => JSON.parse(body)
const marketplace = JSON.stringify({
  name: 'anthropic-agent-skills',
  plugins: [
    { name: 'example-skills', description: 'Examples', skills: ['./skills/webapp-testing', './skills/frontend-design'] },
    { name: 'document-skills', skills: ['./skills/pdf'] },
  ],
})

const doc = (name, description, body = 'Do the thing.') => `---\nname: ${name}\ndescription: ${description}\nlicense: MIT\n---\n\n${body}\n`

test('front matter is read as a flat map and the body is kept whole', () => {
  const { fields, body } = parseFrontmatter(doc('Webapp testing', 'Use when testing a page.'))
  assert.equal(fields.name, 'Webapp testing')
  assert.equal(fields.description, 'Use when testing a page.')
  assert.equal(fields.license, 'MIT')
  assert.equal(body, 'Do the thing.')

  // Quoted values, folded blocks and indented continuations.
  const folded = parseFrontmatter('---\nname: "PDF works"\ndescription: >\n  Fill forms and read\n  every page\ntags:\n  - docs\n---\nBody text.')
  assert.equal(folded.fields.name, 'PDF works')
  assert.equal(folded.fields.description, 'Fill forms and read every page')
  assert.equal(folded.fields.tags, '- docs')
  assert.equal(folded.body, 'Body text.')

  // No front matter at all: the whole file is the body.
  assert.deepEqual(parseFrontmatter('# Title\n\nText'), { fields: {}, body: '# Title\n\nText' })
})

test('a skill document yields its name, description and instructions', () => {
  const parsed = parseSkillDoc(doc('Canvas design', 'Use for posters.', '# Canvas\n\nWork in layers.'))
  assert.deepEqual(parsed, { name: 'Canvas design', description: 'Use for posters.', instructions: '# Canvas\n\nWork in layers.' })
  // A file with no front matter still installs under its folder name.
  assert.equal(parseSkillDoc('# Only a body').instructions, '# Only a body')
})

test('the index lists skill folders from a marketplace file or a plain list', () => {
  const fromMarket = parseSkillIndex(index(marketplace), source)
  assert.deepEqual(fromMarket.map((e) => e.path), ['skills/webapp-testing', 'skills/frontend-design', 'skills/pdf'])
  assert.deepEqual([...new Set(fromMarket.map((e) => e.group))], ['Example skills', 'Document skills'])

  const fromList = parseSkillIndex({ skills: ['skills/a-skill', { path: 'skills/b-skill', name: 'B skill', description: 'Use B.' }, { url: 'https://example.test/skills/c/SKILL.md' }] }, source)
  assert.deepEqual(fromList.map((e) => e.path), ['skills/a-skill', 'skills/b-skill', 'https://example.test/skills/c'])
  assert.equal(fromList[1].name, 'B skill')
  assert.equal(fromList[2].url, 'https://example.test/skills/c/SKILL.md')

  // Duplicates and empty entries are dropped rather than listed twice.
  assert.equal(parseSkillIndex({ skills: ['skills/a', 'skills/a', '', null] }, source).length, 1)
  assert.deepEqual(parseSkillIndex({ nope: true }, source), [])
})

test('listings carry a proposed id, a doc url and where they came from', () => {
  const listings = listingsFromIndex(index(marketplace), source)
  assert.deepEqual(listings.map((l) => l.id), ['webapp-testing', 'frontend-design', 'pdf'])
  assert.equal(listings[0].url, 'https://raw.githubusercontent.com/anthropics/skills/main/skills/webapp-testing/SKILL.md')
  assert.equal(listings[0].origin, 'github.com/anthropics/skills/skills/webapp-testing')
  assert.equal(listings[0].page, source.home)
  // Before the SKILL.md is read the name comes from the folder.
  assert.equal(listings[0].name, 'Webapp testing')
  assert.equal(listings[0].instructions, '')
})

test('reading a document fills the listing and marks a body that had to be cut', () => {
  const [listing] = listingsFromIndex(index(marketplace), source)
  const filled = applyDoc(listing, doc('Webapp testing', 'Use when driving a real browser.', 'Step one.'))
  assert.equal(filled.name, 'Webapp testing')
  assert.equal(filled.description, 'Use when driving a real browser.')
  assert.equal(filled.instructions, 'Step one.')
  assert.equal(filled.truncated, false)

  const long = applyDoc(listing, `---\nname: Long\n---\n${'x'.repeat(SKILL_INSTRUCTIONS_MAX + 10)}`)
  assert.equal(long.instructions.length, SKILL_INSTRUCTIONS_MAX)
  assert.equal(long.truncated, true)
})

test('a free id is picked, skipping taken, retired and built-in names', () => {
  assert.equal(uniqueSkillId('webapp-testing', []), 'webapp-testing')
  assert.equal(uniqueSkillId('webapp-testing', ['webapp-testing']), 'webapp-testing-2')
  assert.equal(uniqueSkillId('webapp-testing', ['webapp-testing', 'webapp-testing-2']), 'webapp-testing-3')
  // Retired ids are dropped on load, so reusing one would make it vanish.
  assert.equal(uniqueSkillId('frontend-design', []), 'frontend-design-2')
  assert.equal(uniqueSkillId('Debugging', []), 'debugging-2')
  assert.equal(uniqueSkillId('!!!', []), 'skill')
})

test('installing builds an editable custom skill with its provenance', () => {
  const [listing] = listingsFromIndex(index(marketplace), source)
  const filled = applyDoc(listing, doc('Webapp testing', 'Use when testing a page.'))
  const state = skillFromListing(filled, ['webapp-testing'])
  assert.equal(state.id, 'webapp-testing-2')
  assert.equal(state.name, 'Webapp testing')
  assert.equal(state.description, 'Use when testing a page.')
  assert.equal(state.instructions, 'Do the thing.')
  assert.equal(state.enabled, true)
  assert.equal(state.source, 'github.com/anthropics/skills/skills/webapp-testing')

  // A skill whose document was never read cannot be installed silently.
  assert.throws(() => skillFromListing(listing, []), /could not be read/)
  // A missing description still yields something the model can match on.
  const bare = skillFromListing({ ...filled, description: '' }, [])
  assert.match(bare.description, /Use for Webapp testing work/)
})

test('search matches words across name, id, description and collection', () => {
  const listings = listingsFromIndex(index(marketplace), source).map((l, i) => applyDoc(l, doc(l.name, i === 2 ? 'Fill forms and read PDF files.' : 'Use for art.')))
  assert.equal(searchListings(listings, '').length, 3)
  assert.deepEqual(searchListings(listings, 'pdf').map((l) => l.id), ['pdf'])
  assert.deepEqual(searchListings(listings, 'forms pdf').map((l) => l.id), ['pdf'])
  assert.deepEqual(searchListings(listings, 'example').map((l) => l.id), ['webapp-testing', 'frontend-design'])
  assert.deepEqual(searchListings(listings, 'nothing here'), [])
})

/* A two-stage fetch: the index, then one SKILL.md per folder. */
const fakeFetch = (docs, fail = new Set()) => {
  const calls = []
  const fn = async (url) => {
    calls.push(url)
    if (url.endsWith('marketplace.json')) return { ok: true, status: 200, text: async () => marketplace }
    if (fail.has(url)) return { ok: false, status: 404, text: async () => '' }
    const name = /skills\/([^/]+)\/SKILL\.md$/.exec(url)?.[1] ?? 'skill'
    return { ok: true, status: 200, text: async () => (docs[name] ?? doc(name, `Use ${name}.`)) }
  }
  return { fetchFn: fn, calls }
}

test('loading the catalogue reads the index and every skill document once', async () => {
  clearSkillCatalogCache()
  const { fetchFn, calls } = fakeFetch({ 'webapp-testing': doc('Webapp testing', 'Use when a real browser is needed.') })
  const first = await loadSkillCatalog(source, { fetchFn })
  assert.equal(first.error, undefined)
  assert.equal(first.listings.length, 3)
  assert.equal(first.listings.find((l) => l.id === 'webapp-testing').description, 'Use when a real browser is needed.')
  assert.equal(first.listings.every((l) => l.instructions), true)
  assert.equal(calls.length, 4)

  // The session cache answers the second open without touching the network.
  await loadSkillCatalog(source, { fetchFn })
  assert.equal(calls.length, 4)
  // Refresh really refetches.
  await loadSkillCatalog(source, { fetchFn, force: true })
  assert.equal(calls.length, 8)
  clearSkillCatalogCache()
})

test('one unreadable skill is a warning, an unreachable index is an error', async () => {
  clearSkillCatalogCache()
  const { fetchFn } = fakeFetch({}, new Set(['https://raw.githubusercontent.com/anthropics/skills/main/skills/pdf/SKILL.md']))
  const partial = await loadSkillCatalog(source, { fetchFn })
  assert.equal(partial.error, undefined)
  assert.equal(partial.listings.length, 3)
  assert.match(partial.warnings[0], /1 skill could not be read/)
  const pdf = partial.listings.find((l) => l.id === 'pdf')
  assert.equal(pdf.instructions, '')

  clearSkillCatalogCache()
  const down = await loadSkillCatalog(source, { fetchFn: async () => { throw new Error('Failed to fetch') } })
  assert.match(down.error, /could not be read: the network did not answer/)
  assert.deepEqual(down.listings, [])
  clearSkillCatalogCache()
})

test('installing a listing whose body was not read fetches it then', async () => {
  const { fetchFn, calls } = fakeFetch({ pdf: doc('PDF', 'Use for PDF files.', 'Read every page.') })
  const listing = { ...listingsFromIndex(index(marketplace), source)[2] }
  assert.equal(listing.id, 'pdf')
  const state = await installListing(listing, [], fetchFn)
  assert.equal(calls.length, 1)
  assert.equal(state.id, 'pdf')
  assert.equal(state.instructions, 'Read every page.')
  assert.equal(state.name, 'PDF')
})
