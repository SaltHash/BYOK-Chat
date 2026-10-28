import test from 'node:test'
import assert from 'node:assert/strict'

const { BUILTIN_SKILLS, DEFAULT_SKILL_STATE, normSkills, resolveSkill, enabledSkills, getSkillInstructions, composeSystemPrompt, validateCustomSkill, SKILL_TOOL_NAME } = await import('./skills.ts')

test('built-in skills cover the required domains with descriptions and instructions', () => {
  const ids = BUILTIN_SKILLS.map((s) => s.id)
  for (const id of ['frontend-design', 'software-engineering', 'debugging', 'testing', 'writing', 'prompt-writing']) {
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

test('frontend-design skill preserves the official Anthropic instructions', () => {
  const skill = BUILTIN_SKILLS.find((s) => s.id === 'frontend-design')
  assert.match(skill.instructions, /^# Frontend Design\n/)
  assert.match(skill.instructions, /Approach this as the design lead at a design studio/)
  assert.match(skill.instructions, /Consider Chanel's advice/)
  assert.match(skill.instructions, /Let each written element do exactly one job\./)
  assert.equal(skill.source, 'https://github.com/anthropics/skills/tree/main/skills/frontend-design')
  assert.match(skill.license || '', /Apache-2\.0/)
})

test('prompt-writing skill covers conventions and the writing skill is scoped to creative prose', () => {
  const promptSkill = BUILTIN_SKILLS.find((s) => s.id === 'prompt-writing')
  assert.equal(promptSkill.name, 'Prompt writing')
  assert.match(promptSkill.description, /prompt/i)
  assert.match(promptSkill.instructions, /^# Prompt writing\n/)
  assert.match(promptSkill.instructions, /## Definition of done/)
  assert.match(promptSkill.instructions, /placeholders/)
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
  assert.throws(() => validateCustomSkill({ id: 'frontend-design', instructions: 'x', description: 'd' }), /built-in/)
  assert.throws(() => validateCustomSkill({ id: 'mine', instructions: '   ', description: 'd' }), /needs instructions/)
  assert.throws(() => validateCustomSkill({ id: 'mine', instructions: 'x', description: '  ' }), /description/)
  const skill = validateCustomSkill({ id: 'API Docs!', name: 'API docs', instructions: 'Follow the docs.', description: 'Use for API docs questions.' })
  assert.equal(skill.id, 'api-docs')
  assert.equal(skill.enabled, true)
  assert.equal(skill.description, 'Use for API docs questions.')
})
