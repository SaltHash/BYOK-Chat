import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Rich from './components/Rich.tsx'

const render = (t) => renderToStaticMarkup(createElement(Rich, { t }))

/* A model that emits `id="setting-tools"` (or `id="composer"`) must not be able
 * to shadow an app anchor: the sanitizer prefixes every incoming id with
 * `user-content-`, so deep links and the composer keep their identities. */
test('markdown ids are prefixed so model HTML cannot shadow app anchors', () => {
  const html = render('<h2 id="setting-tools">Head</h2>\n\n<a id="composer" href="#setting-tools">x</a>\n')
  assert.ok(!html.includes('id="setting-tools"'), html)
  assert.ok(!html.includes('id="composer"'), html)
  assert.match(html, /id="user-content-setting-tools"/)
})

test('footnote anchors resolve to the sanitized id (single prefix)', () => {
  const html = render('Text[^1]\n\n[^1]: note\n')
  assert.match(html, /id="user-content-fn-1"/, html)
  assert.match(html, /href="#user-content-fn-1"/, html)
  assert.match(html, /id="user-content-fnref-1"/, html)
  assert.match(html, /href="#user-content-fnref-1"/, html)
  assert.ok(!html.includes('user-content-user-content'), html)
})

/* Remote images are click-to-load by default: a reply must not beacon the
 * reader's IP to a host the model chose. (SSR renders the store's initial
 * snapshot, so the preference itself cannot be flipped mid-render here; the
 * enabled path is the plain `<img>` branch covered by the test below.) */
test('remote images are click-to-load by default', () => {
  const html = render('![diagram](https://evil.example/x.png)\n')
  assert.ok(!html.includes('<img'), html)
  assert.match(html, /Remote image/)
  assert.match(html, /evil\.example/)
  assert.match(html, /Load image/)
  assert.match(html, /Always load/)
})

test('relative images still render immediately', () => {
  const html = render('![x](/assets/a.png)\n')
  assert.match(html, /<img[^>]*\/assets\/a\.png/)
})
