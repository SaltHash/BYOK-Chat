import test from 'node:test'
import assert from 'node:assert/strict'

const { BUILTIN_SKILLS, RETIRED_SKILL_IDS, DEFAULT_SKILL_STATE, normSkills, resolveSkill, enabledSkills, getSkillInstructions, composeSystemPrompt, validateCustomSkill, SKILL_TOOL_NAME } = await import('./skills.ts')

test('built-in skills cover the required domains with descriptions and instructions', () => {
  const ids = BUILTIN_SKILLS.map((s) => s.id)
  for (const id of ['software-engineering', 'debugging', 'testing', 'code-review', 'writing', 'prompt-writing']) {
    assert.ok(ids.includes(id), `missing built-in skill: ${id}`)
  }
  for (const skill of BUILTIN_SKILLS) {
    assert.ok(skill.name.trim(), `${skill.id} needs a name`)
    assert.ok(skill.description.trim(), `${skill.id} needs a description`)
    assert.ok(skill.instructions.trim(), `${skill.id} needs instructions`)
    assert.ok(!('triggers' in skill), `${skill.id} must not have triggers`)
  }
  assert.deepEqual(DEFAULT_SKILL_STATE.map((s) => s.id).sort(), ids.sort())
  assert.ok(DEFAULT_SKILL_STATE.every((s) => s.enabled))
  assert.ok(DEFAULT_SKILL_STATE.every((s) => !('auto' in s)), 'no auto/always modes')
})

test('duplicate, design and prompt-architect skills are gone from the catalog', () => {
  const ids = BUILTIN_SKILLS.map((s) => s.id)
  assert.deepEqual([...RETIRED_SKILL_IDS].sort(), ['frontend-design', 'modular-code', 'prompt-architect'])
  for (const id of RETIRED_SKILL_IDS) assert.ok(!ids.includes(id), `${id} must not ship as a built-in skill`)
  // The modular-file guidance now lives in the software-engineering skill.
  const se = BUILTIN_SKILLS.find((s) => s.id === 'software-engineering')
  assert.match(se.instructions, /small, focused files/)
  assert.match(se.instructions, /unless the user explicitly asks for a single file/)
})

test('prompt-writing is the single prompt-authoring skill, and writing stays creative prose', () => {
  const promptSkill = BUILTIN_SKILLS.find((s) => s.id === 'prompt-writing')
  assert.equal(promptSkill.name, 'Prompt writing')
  assert.match(promptSkill.description, /prompt/i)
  assert.match(promptSkill.instructions, /^# Prompt writing\n/)
  assert.match(promptSkill.instructions, /## Definition of done/)
  assert.match(promptSkill.instructions, /placeholders/)
  assert.equal(BUILTIN_SKILLS.filter((s) => /prompt/i.test(s.name)).length, 1)
  const writing = BUILTIN_SKILLS.find((s) => s.id === 'writing')
  assert.equal(writing.name, 'Creative writing')
  assert.match(writing.description, /creative/i)
  assert.doesNotMatch(writing.description, /README|summaries/)
})

test('model decides: catalog lists skills, instructions load by id', () => {
  const states = normSkills(undefined).skills
  const enabled = enabledSkills(states)
  assert.ok(enabled.length >= 4)
  const sys = composeSystemPrompt('Base prompt.', enabled)
  assert.match(sys, /# Available skills/)
  assert.match(sys, new RegExp(SKILL_TOOL_NAME))
  // Only the catalog (ids + descriptions) is in the prompt, not full instructions.
  assert.ok(!sys.includes('Reproduce the problem first'), 'full instructions must not be inlined')
  const debugging = getSkillInstructions('debugging', states)
  assert.ok(debugging?.instructions.includes('Reproduce the problem first'))
  assert.equal(getSkillInstructions('nope', states), null)
  const disabled = states.map((s) => (s.id === 'debugging' ? { ...s, enabled: false } : s))
  assert.deepEqual(enabledSkills(disabled).filter((x) => x.id === 'debugging'), [])
  assert.equal(getSkillInstructions('debugging', disabled), null)
})

test('built-in skills can be deleted and restored', () => {
  const { skills } = normSkills([{ id: 'testing', deleted: true }])
  const testing = skills.find((s) => s.id === 'testing')
  assert.equal(testing.deleted, true)
  assert.equal(resolveSkill(testing), null)
  assert.equal(getSkillInstructions('testing', skills), null)
  assert.ok(!enabledSkills(skills).some((s) => s.id === 'testing'))
  assert.doesNotMatch(composeSystemPrompt('Base prompt.', enabledSkills(skills)), /- testing: /)
  const restored = normSkills([{ id: 'testing', deleted: false }]).skills
  assert.ok(enabledSkills(restored).some((s) => s.id === 'testing'))
  assert.equal(restored.find((s) => s.id === 'testing').deleted, undefined)
})

test('stored state for retired skills is dropped instead of becoming a custom skill', () => {
  const { skills } = normSkills([
    { id: 'frontend-design', enabled: true },
    { id: 'prompt-architect', enabled: true, name: 'Prompt architect', description: 'Old skill.', instructions: 'Old text.' },
    { id: 'modular-code', enabled: true },
  ])
  for (const id of RETIRED_SKILL_IDS) assert.ok(!skills.some((s) => s.id === id), `${id} should be dropped`)
})

test('malformed stored skills are skipped with useful warnings', () => {
  const { skills, warnings } = normSkills([
    null,
    { id: '' },
    { id: 'debugging', enabled: false },
    { id: 'debugging', enabled: true },
    { id: 'custom', name: 'Custom', description: 'Use for custom things.', instructions: '  Do custom things.  ' },
    { id: 'broken', enabled: true, name: 'Broken', description: 'Broken skill.', instructions: '   ' },
  ])
  assert.equal(warnings.length, 3)
  const debugging = skills.find((s) => s.id === 'debugging')
  assert.equal(debugging.enabled, false)
  const custom = skills.find((s) => s.id === 'custom')
  assert.equal(resolveSkill(custom)?.instructions, 'Do custom things.')
  // A skill without instructions never resolves, so it is never offered.
  assert.equal(resolveSkill(skills.find((s) => s.id === 'broken')), null)
  assert.ok(enabledSkills(skills).some((x) => x.id === 'custom'))
  assert.ok(!enabledSkills(skills).some((x) => x.id === 'broken'))
})

test('prompt composition lists the catalog instead of inlining instructions', () => {
  assert.equal(composeSystemPrompt('  Base prompt.  ', []), 'Base prompt.')
  const states = normSkills(undefined).skills
  const applied = enabledSkills(states)
  const composed = composeSystemPrompt('Base prompt.', applied)
  assert.match(composed, /^Base prompt\.\n\n# Available skills\n/)
  assert.match(composed, /- debugging: /)
  assert.match(composed, /- testing: /)
})

test('custom skill validation rejects bad input with useful errors', () => {
  assert.throws(() => validateCustomSkill({ id: '!!!', instructions: 'x', description: 'd' }), /lowercase/)
  assert.throws(() => validateCustomSkill({ id: 'testing', instructions: 'x', description: 'd' }), /built-in/)
  assert.throws(() => validateCustomSkill({ id: 'mine', instructions: '   ', description: 'd' }), /needs instructions/)
  assert.throws(() => validateCustomSkill({ id: 'mine', instructions: 'x', description: '  ' }), /description/)
  const skill = validateCustomSkill({ id: 'API Docs!', name: 'API docs', instructions: 'Follow the docs.', description: 'Use for API docs questions.' })
  assert.equal(skill.id, 'api-docs')
  assert.equal(skill.enabled, true)
  assert.equal(skill.description, 'Use for API docs questions.')
})
