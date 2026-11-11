import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8')
const script = /<script data-theme-boot>([\s\S]*?)<\/script>/.exec(html)?.[1]
assert.ok(script, 'index.html contains the pre-paint theme script')

function boot(stored) {
  const properties = {}
  const attributes = {}
  const root = {
    dataset: {},
    style: {
      setProperty: (name, value) => { properties[name] = value },
    },
  }
  const document = {
    documentElement: root,
    querySelector: (selector) => selector === 'meta[name="theme-color"]'
      ? { setAttribute: (name, value) => { attributes[name] = value } }
      : null,
  }
  vm.runInNewContext(script, {
    localStorage: { getItem: () => stored },
    document,
  })
  return { root, properties, attributes }
}

test('pre-paint boot applies the saved light theme', () => {
  const { root, attributes } = boot(JSON.stringify({ state: { themeMode: 'light', themeLight: 'sage' } }))
  assert.equal(root.dataset.t, 'sage')
  assert.equal(root.style.backgroundColor, '#e9ecea')
  assert.equal(root.style.colorScheme, undefined)
  assert.equal(attributes.content, '#e9ecea')
})

test('pre-paint boot applies saved custom colors before React mounts', () => {
  const colors = {
    bg: '#20242c', side: '#181c22', surf: '#2a303a', hov: '#343b46',
    tx: '#f0f2f5', mu: '#a0a8b3', ac: '#7c9cff', acx: '#101010', er: '#ff5566',
    code: '#14181e', codeh: '#242a33', c2: '#8fe3b0', c3: '#f2b98b', c4: '#8fb9ff', c5: '#c7a6ff',
    bor: '#20242c',
  }
  const { root, properties, attributes } = boot(JSON.stringify({
    state: { themeMode: 'dark', themeDark: 'custom', customDarkColors: colors },
  }))
  assert.equal(root.dataset.t, 'custom')
  assert.equal(properties['--bg'], colors.bg)
  assert.equal(properties['--ac'], colors.ac)
  assert.equal(properties['--bor'], colors.bor)
  assert.equal(root.style.backgroundColor, colors.bg)
  assert.equal(root.style.colorScheme, 'dark')
  assert.equal(attributes.content, colors.bg)
})

test('pre-paint boot migrates legacy theme keys', () => {
  const { root } = boot(JSON.stringify({ state: { themeMode: 'dark', themeDark: 'nord' } }))
  assert.equal(root.dataset.t, 'claude')
})

test('pre-paint boot uses the neutral fallback for missing or invalid themes', () => {
  for (const stored of [
    null,
    '{broken',
    JSON.stringify({ state: { themeMode: 'light', themeLight: 'plum' } }),
    JSON.stringify({ state: { themeMode: 'dark', themeDark: 'custom', customDarkColors: { bg: '#fff' } } }),
  ]) {
    const { root, attributes } = boot(stored)
    assert.equal(root.dataset.t, 'neutral')
    assert.equal(root.style.backgroundColor, '#181818')
    assert.equal(root.style.colorScheme, 'dark')
    assert.equal(attributes.content, '#181818')
  }
})
