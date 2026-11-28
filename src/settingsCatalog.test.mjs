import test from 'node:test'
import assert from 'node:assert/strict'
import { SETTINGS_GROUPS, SETTINGS_TABS, SETTINGS_TAB_HINTS, SETTING_LINKS, searchSettings, splitSettingTarget } from './settingsCatalog.ts'

test('every section says what it is for, in one line', () => {
  for (const [id] of SETTINGS_TABS) {
    const hint = SETTINGS_TAB_HINTS[id]
    assert.equal(typeof hint, 'string', `${id} needs a hint`)
    assert.ok(hint.trim().length > 8 && hint.length <= 80, `${id}'s hint should be one short line`)
  }
  assert.deepEqual(Object.keys(SETTINGS_TAB_HINTS).sort(), SETTINGS_TABS.map(([id]) => id).sort())
})

test('settings groups contain every existing tab exactly once', () => {
  const ids = SETTINGS_GROUPS.flatMap(group => group.tabs)
  assert.equal(new Set(ids).size, ids.length)
  assert.deepEqual([...ids].sort(), SETTINGS_TABS.map(([id]) => id).sort())
})

test('settings navigation leads with unlabelled Features, then customization, additions and system', () => {
  assert.equal(SETTINGS_GROUPS.length, 4)
  assert.equal(SETTINGS_GROUPS[0].label, '')
  assert.deepEqual(SETTINGS_GROUPS[0].tabs, ['features'])
  assert.deepEqual(SETTINGS_GROUPS[1].tabs, ['look', 'chats', 'prompts', 'eps', 'tools'])
  assert.deepEqual(SETTINGS_GROUPS.map((group) => group.label), ['', 'Essentials', 'More', 'System'])
})

test('no setting link is declared twice', () => {
  const keys = SETTING_LINKS.map((link) => `${link.tab}#${link.anchor}`)
  assert.equal(new Set(keys).size, keys.length)
})

test('every feature has exactly one switch link in the catalog', async () => {
  const { FEATURES } = await import('./store.ts')
  const ids = SETTING_LINKS
    .filter((link) => link.tab === 'features' && link.anchor.startsWith('feature-'))
    .map((link) => link.anchor.slice('feature-'.length))
  assert.deepEqual([...ids].sort(), FEATURES.map(([id]) => id).sort())
})

test('every setting link points at an anchor the UI renders', async () => {
  const { readdir, readFile } = await import('node:fs/promises')
  const dir = new URL('./components/', import.meta.url)
  const files = (await readdir(dir)).filter((name) => name.endsWith('.tsx'))
  const source = (await Promise.all(files.map((name) => readFile(new URL(name, dir), 'utf8')))).join('\n')
  for (const link of SETTING_LINKS) {
    // feature-* anchors are rendered from one template over FEATURES.
    const needle = link.anchor.startsWith('feature-') ? 'feature-${id}' : link.anchor
    assert.ok(source.includes(needle), `${link.tab}#${link.anchor} (${link.title}) has no anchor in the UI`)
  }
})

test('settings search ranks an exact section above its settings', () => {
  assert.equal(searchSettings('appearance')[0]?.target, 'look')
})

test('settings search finds sections and individual deep links using keywords', () => {
  assert.deepEqual(searchSettings('   '), [])
  assert.ok(searchSettings('api key').some(result => result.target === 'eps#credentials' && result.section === 'Endpoints'))
  assert.ok(searchSettings('dark theme').some(result => result.target === 'look'))
  assert.deepEqual(splitSettingTarget('eps#credentials'), { tab: 'eps', anchor: 'credentials' })
})

test('settings search finds the revert send button by what it does', () => {
  for (const q of ['revert', 'edit message', 'revert message']) {
    assert.ok(searchSettings(q).some(result => result.target === 'chats#revert-send'), q)
  }
})
