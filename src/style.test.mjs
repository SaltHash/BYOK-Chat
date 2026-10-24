import test from 'node:test'
import assert from 'node:assert/strict'

const {
  normStylePreset, normDensity, normSpacing, resolveSpacing, spacingVars,
  hasSpacingOverrides, DENSITIES, STYLE_PRESETS, STYLE_PRESET_IDS,
} = await import('./style.ts')

test('unknown or missing style values fall back to the defaults', () => {
  assert.equal(normStylePreset(undefined), 'modern')
  assert.equal(normStylePreset('neon'), 'modern')
  assert.equal(normStylePreset('bubbly'), 'bubbly')
  assert.equal(normDensity(null), 'comfortable')
  assert.equal(normDensity('wide'), 'comfortable')
  assert.equal(normDensity('compact'), 'compact')
})

test('every preset has a label and description for the picker', () => {
  for (const id of STYLE_PRESET_IDS) {
    assert.ok(STYLE_PRESETS[id].label.length > 0)
    assert.ok(STYLE_PRESETS[id].description.length > 0)
  }
})

test('resolveSpacing returns each density unchanged without overrides', () => {
  for (const id of ['compact', 'comfortable', 'spacious']) {
    assert.deepEqual(resolveSpacing(id), DENSITIES[id].spacing)
  }
  // Comfortable keeps the original layout numbers.
  assert.deepEqual(resolveSpacing('comfortable'), {
    headerPad: 12, headerPadY: 0, chatPad: 16, chatPadY: 24, messageGap: 32,
    sidePad: 12, sideGap: 12, sideItemPad: 8, sideItemGap: 0, composerPad: 12, panelPad: 12,
    codePadX: 16, codePadY: 12, codeHeadPadX: 16, codeHeadPadY: 8,
  })
})

test('overrides are clamped to their ranges and rounded', () => {
  const s = resolveSpacing('comfortable', { headerPad: -5, chatPad: 11.6, messageGap: 999 })
  assert.equal(s.headerPad, 0)
  assert.equal(s.chatPad, 12)
  assert.equal(s.messageGap, 96)
})

test('vertical padding keeps the density proportion when the margin changes', () => {
  // Comfortable is 24/16 = 1.5x.
  assert.equal(resolveSpacing('comfortable', { chatPad: 40 }).chatPadY, 60)
  // Compact is 12/12 = 1x.
  assert.equal(resolveSpacing('compact', { chatPad: 20 }).chatPadY, 20)
  // Spacious is 32/28.
  assert.equal(resolveSpacing('spacious', { chatPad: 14 }).chatPadY, 16)
})

test('an unset override keeps the density value', () => {
  const s = resolveSpacing('spacious', { messageGap: 50 })
  assert.equal(s.messageGap, 50)
  assert.equal(s.chatPad, 28)
  assert.equal(s.headerPad, 20)
})

test('normSpacing drops junk and keeps valid entries', () => {
  assert.deepEqual(normSpacing(null), {})
  assert.deepEqual(normSpacing({ headerPad: '8', chatPad: NaN, messageGap: 24, extra: 4 }), { messageGap: 24 })
  assert.equal(hasSpacingOverrides(undefined), false)
  assert.equal(hasSpacingOverrides({}), false)
  assert.equal(hasSpacingOverrides({ chatPad: 0 }), true)
})

test('spacingVars emits the shell tokens for every structural surface', () => {
  assert.deepEqual(spacingVars('comfortable'), {
    '--ui-header-pad': '12px',
    '--ui-header-pad-y': '0px',
    '--ui-chat-pad-x': '16px',
    '--ui-chat-pad-y': '24px',
    '--ui-msg-gap': '32px',
    '--ui-side-pad': '12px',
    '--ui-side-gap': '12px',
    '--ui-side-item-py': '8px',
    '--ui-side-item-gap': '0px',
    '--ui-composer-pad': '12px',
    '--ui-panel-pad': '12px',
    '--ui-code-pad-x': '16px',
    '--ui-code-pad-y': '12px',
    '--ui-code-head-pad-x': '16px',
    '--ui-code-head-pad-y': '8px',
  })
})

test('spacious gives the top bar vertical padding; comfortable does not', () => {
  assert.equal(resolveSpacing('comfortable').headerPadY, 0)
  assert.equal(resolveSpacing('spacious').headerPadY, 12)
  assert.equal(resolveSpacing('compact').headerPadY, 4)
})

test('comfortable keeps the original code-block paddings', () => {
  const s = resolveSpacing('comfortable')
  assert.equal(s.codePadX, 16)
  assert.equal(s.codePadY, 12)
  assert.equal(s.codeHeadPadX, 16)
  assert.equal(s.codeHeadPadY, 8)
})

test('sidebar item padding and row spacing scale with the density', () => {
  assert.equal(resolveSpacing('comfortable').sideItemPad, 8)
  assert.equal(resolveSpacing('comfortable').sideItemGap, 0)
  assert.equal(resolveSpacing('spacious').sideItemPad, 12)
  assert.equal(resolveSpacing('spacious').sideItemGap, 6)
  assert.equal(resolveSpacing('compact').sideItemPad, 6)
  assert.equal(resolveSpacing('spacious', { sideItemGap: 99 }).sideItemGap, 16)
})

test('new spacing areas can be overridden independently and clamp', () => {
  const s = resolveSpacing('comfortable', { sidePad: 999, composerPad: -3, codeHeadPadY: 5 })
  assert.equal(s.sidePad, 40)
  assert.equal(s.composerPad, 0)
  assert.equal(s.codeHeadPadY, 5)
  assert.equal(s.chatPad, 16) // untouched areas keep the density value
})
