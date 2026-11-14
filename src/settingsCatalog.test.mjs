import test from 'node:test'
import assert from 'node:assert/strict'
import { SETTINGS_GROUPS, SETTINGS_TABS, searchSettings, splitSettingTarget } from './settingsCatalog.ts'

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

test('settings search ranks an exact section above its settings', () => {
  assert.equal(searchSettings('appearance')[0]?.target, 'look')
})

test('settings search finds sections and individual deep links using keywords', () => {
  assert.deepEqual(searchSettings('   '), [])
  assert.ok(searchSettings('api key').some(result => result.target === 'eps#credentials' && result.section === 'Endpoints'))
  assert.ok(searchSettings('dark theme').some(result => result.target === 'look'))
  assert.deepEqual(splitSettingTarget('eps#credentials'), { tab: 'eps', anchor: 'credentials' })
})
