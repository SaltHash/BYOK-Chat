import test from 'node:test'
import assert from 'node:assert/strict'

const a = await import('./artifacts.ts')
const r = await import('./research.ts')

test('artifact arguments are validated and height is bounded', () => {
  const spec = a.parseArtifactArgs(JSON.stringify({ title: '  Budget  ', html: '<p>Hello</p>', height: 9999 }))
  assert.equal(spec.title, 'Budget')
  assert.equal(spec.height, 720)
  assert.equal(a.parseArtifactArgs('{"title":"x"}'), null)
  assert.equal(a.parseArtifactArgs('not json'), null)
})

test('artifact markup loses model styling and keeps only the native classes', () => {
  const body = a.sanitizeArtifactBody('<div class="artifact-card evil" style="color:red" bgcolor="#fff"><font color="red">Hi</font><svg><path fill="#ff0000" stroke="none" /></svg><script>console.log(1)</script></div>')
  assert.match(body, /class="artifact-card"/)
  assert.doesNotMatch(body, /evil|style=|bgcolor|#ff0000/)
  assert.doesNotMatch(body, /<font/)
  assert.match(body, /fill="currentColor"/)
  assert.match(body, /stroke="none"/)
  assert.match(body, /<script>/)
})

test('artifact document carries the app theme and a no-network sandbox policy', () => {
  const doc = a.artifactDocument({ title: 'T', html: '<button class="artifact-button">Go</button>' }, {
    bg: '#101010', surf: '#202020', tx: '#eeeeee', mu: '#999999', bor: '#333333', hov: '#444444', ac: '#abcdef', acx: '#ffffff', er: '#ff0000',
  })
  assert.match(doc, /default-src 'none'/)
  assert.match(doc, /connect-src 'none'/)
  assert.match(doc, /background:#101010/)
  assert.match(doc, /artifact-button/)
})

test('report artifact fences are removed from markdown and returned as specs', () => {
  const out = a.extractArtifactBlocks([
    '# Report', '', 'Body text.', '',
    '```html-artifact title="Compare" height="300"',
    '<div class="artifact-card">Interactive</div>',
    '```', '', 'Tail.',
  ].join('\n'))
  assert.equal(out.text, '# Report\n\nBody text.\n\nTail.')
  assert.equal(out.artifacts.length, 1)
  assert.equal(out.artifacts[0].title, 'Compare')
  assert.equal(out.artifacts[0].height, 300)
})

test('the report prompt gets the artifact fence and class vocabulary', () => {
  assert.match(r.RESEARCH_REPORT_ASK, /html-artifact/)
  assert.match(r.RESEARCH_REPORT_ASK, /artifact-card/)
  assert.match(r.RESEARCH_REPORT_ASK, /Do not write <style>/)
})

test('a partial plan stream yields readable title and step labels', () => {
  const preview = r.planPreview('```json\n{"title":"Search API market","steps":[{"label":"Free plans"},{"label":"Freshness and quality')
  assert.equal(preview.title, 'Search API market')
  assert.deepEqual(preview.steps, ['Free plans', 'Freshness and quality'])
})
