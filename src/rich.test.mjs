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

/* A reply about pricing is prose, not math. Pairing two dollar signs used to
 * hand a price list to KaTeX, which renders what it cannot parse in the error
 * colour (errorColor: var(--er)): "Pro is $20/mo, Max is $100/mo" came out red. */
test('prices stay prose and never become math', () => {
  for (const t of [
    'Pro is $20/mo, Max is $100/mo, Ultra is $200/mo.\n',
    'Opus is $4/$20 per 1M input/output tokens.\n',
    'Gemini is $0.75–$2.00 input / $3.75–$10.00 output per 1M tokens.\n',
    'Copilot is $10–$39 a month, and $5 and $10 are both cheap.\n',
  ]) {
    const html = render(t)
    assert.ok(!/class="[^"]*math/.test(html), `${t}\n${html}`)
    assert.ok(html.includes('$'), html)
  }
})

/* Prices must not cost real math its own rendering: inline and display math
 * keep working, including a span that ends right before a digit. */
test('real math still renders as math', () => {
  assert.match(render('Euler wrote $e^{i\\pi} + 1 = 0$ for us.\n'), /math-inline/)
  assert.match(render('Cost per token: $x$ of $y$ here.\n'), /math-inline/)
  // Display math is left for KaTeX (a code block until its chunk loads in the
  // browser); what matters is that the price rule did not escape its dollars.
  const display = render('$$\na^2 + b^2 = c^2\n$$\n')
  assert.match(display, /a\^2 \+ b\^2 = c\^2/, display)
  assert.ok(!display.includes('$$'), display)
})

/* A model that opens a display block on its own line but closes it at the end
 * of the last line ("$$L=\\int…\\approx 15.3$$") writes *flow* math to the
 * parser: the rest of the opening line is dropped as a fence info string and
 * the block only ends at a `$$` that starts a line, so it swallowed the rest of
 * the reply and KaTeX painted all of it in the error colour. */
test('a display block closed at the end of a line does not swallow the reply', () => {
  const html = render('Before.\n\n$$L=\\int_1^3 f\\,dx\n=\\left[\\frac{2x^{3}}{3}-x\\right]_{1}^{3}\\approx 15.3$$\n\n**Visual estimate:** consistent with $\\approx15.3$.\n\n### 4. $y=x$\n')
  // One display block, holding both lines the model wrote, and no stray `$$`.
  assert.equal((html.match(/bg-code/g) ?? []).length, 1, html)
  assert.ok(!html.includes('$$'), html)
  assert.match(html, /L=\\int_1\^3 f\\,dx/, html)
  assert.match(html, /\\approx 15\.3/, html)
  // Everything after it is prose again, not another line of the block.
  assert.match(html, /<strong>Visual estimate:<\/strong>/, html)
  assert.match(html, /<h3[^>]*>4\. /, html)
  assert.match(html, /math-inline/, html)
})

/* `$$…$$` inside a sentence is inline math and must stay that way, whether the
 * model closed it on the same line or wrapped it onto the next one. */
test('inline $$ math keeps the sentence on one line', () => {
  for (const t of [
    'The value is $$a+b$$ exactly.\n',
    'The value is $$a+b\n= c$$ exactly.\n',
    '$$a+b$$ alone here\n',
  ]) {
    const html = render(t)
    assert.ok(!/bg-code/.test(html), `${t}\n${html}`)
    assert.ok(!html.includes('$$'), `${t}\n${html}`)
    assert.match(html, /math-inline/, `${t}\n${html}`)
  }
  // A `$$` left starting a line would open a block that never closes.
  const joined = render('text $$a+b\n$$ more text\n')
  assert.ok(!/bg-code/.test(joined), joined)
  assert.match(joined, /more text/, joined)
})

/* A model that escapes a digit while writing a numeric range ("~5–\\6") is
 * not writing markdown or math; the stray backslash must not reach the page. */
test('stray backslashes before digits are dropped, code excepted', () => {
  const html = render('Plan for ~5–\\6 months of runway.\n')
  assert.match(html, /~5–6 months of runway/, html)
  assert.ok(!html.includes('\\6'), html)
  // Inline code is left exactly as the model wrote it.
  const code = render('Run `echo 5–\\6` now.\n')
  assert.match(code, /5–\\6/, code)
})
