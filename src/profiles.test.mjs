import test from 'node:test'
import assert from 'node:assert/strict'
import { captureProfile, describeProfile, freshProfileName, normProfile, normProfiles, profileMatches, profilePatch } from './profiles.ts'
import { useS } from './store.ts'

const state = {
  sel: { k: 'ep', id: 'e1', model: 'vendor/some-model' },
  params: { def: false, temp: 0.2, topp: 0.9, max: 8192, maxToolRounds: 12, highToolsUnlocked: true },
  effort: { 'vendor/some-model': 'high' },
  pr: 'coding',
  tools: { calc: true, search: true, memory: false },
  toolMode: 'standard',
  toolApproval: { location: true },
}

const eps = [{ id: 'e1', name: 'Alpha', model: 'vendor/some-model', models: ['vendor/some-model'], on: true, url: 'https://a' }]
const prompts = [{ id: 'coding', name: 'Coding', text: '' }]
const pls = [{ id: 'p1', name: 'Fast', e: [] }]

test('a profile captures the model, prompt, tools and access policy', () => {
  const p = captureProfile(state, '  Deep work  ', { id: 'p1', now: 100 })
  assert.equal(p.id, 'p1')
  assert.equal(p.name, 'Deep work')
  assert.equal(p.createdAt, 100)
  assert.deepEqual(p.sel, state.sel)
  assert.equal(p.params.temp, 0.2)
  assert.equal(p.tools.calc, true)
  assert.equal(p.tools.memory, undefined, 'explicit false flags are not kept')
  assert.equal(p.toolMode, 'standard')
  assert.equal(p.toolApproval.location, true)
})

test('applying a profile restores the captured settings and does not alias them', () => {
  const p = captureProfile(state, 'Work', { id: 'p1' })
  const patch = profilePatch(p)
  assert.deepEqual(patch.sel, state.sel)
  assert.deepEqual(patch.params, state.params)
  patch.tools.calc = false
  assert.equal(p.tools.calc, true, 'the profile owns its own copy')
})

test('matching detects a manual drift in any captured field', () => {
  const p = captureProfile(state, 'Work', { id: 'p1' })
  assert.equal(profileMatches(state, p), true)
  assert.equal(profileMatches({ ...state, params: { ...state.params, temp: 1.4 } }, p), false)
  assert.equal(profileMatches({ ...state, sel: { k: 'ep', id: 'e2', model: 'x' } }, p), false)
  assert.equal(profileMatches({ ...state, tools: { ...state.tools, calc: false } }, p), false)
  assert.equal(profileMatches({ ...state, toolMode: 'full' }, p), false)
})

test('normalisation drops junk, modes and duplicate ids', () => {
  const raw = [
    { id: 'a', name: 'One', params: { temp: 'hot', max: -4 }, tools: { calc: true, search: 'yes' }, toolMode: 'bogus', sel: { k: 'x', id: 3 } },
    { id: 'a', name: 'Duplicate' },
    { name: 'No id' },
    null,
  ]
  const out = normProfiles(raw, 5)
  assert.equal(out.length, 1)
  assert.equal(out[0].params.temp, 0.7, 'invalid temperature falls back')
  assert.equal(out[0].params.max, 1, 'negative max is clamped')
  assert.deepEqual(out[0].tools, { calc: true })
  assert.equal(out[0].toolMode, 'standard', 'unknown modes fall back to Standard')
  assert.equal(out[0].sel, null)
  assert.equal(out[0].createdAt, 5)
})

test('a single profile normalises a playlist selection', () => {
  const p = normProfile({ id: 'x', name: 'Route', sel: { k: 'pl', id: 'p1' } })
  assert.deepEqual(p.sel, { k: 'pl', id: 'p1' })
})

test('the summary names the model instead of its id and counts enabled tools', () => {
  const p = captureProfile(state, 'Work', { id: 'p1' })
  const d = describeProfile(p, { eps, pls, prompts })
  assert.equal(d.model, 'Some Model', 'model display name, never the raw id')
  assert.equal(d.prompt, 'Coding')
  assert.equal(d.mode, 'Standard')
  assert.equal(d.tools, '2 tools')

  const gone = captureProfile({ ...state, sel: { k: 'ep', id: 'missing', model: 'vendor/other-id' } }, 'Gone', { id: 'p2' })
  assert.equal(describeProfile(gone, { eps, pls, prompts }).model, 'Other Id')
  const playlist = captureProfile({ ...state, sel: { k: 'pl', id: 'p1' } }, 'Route', { id: 'p3' })
  assert.equal(describeProfile(playlist, { eps, pls, prompts }).model, 'Playlist · Fast')
})

test('new profile names stay unique', () => {
  assert.equal(freshProfileName([]), 'New profile')
  assert.equal(freshProfileName([{ name: 'New profile' }]), 'New profile 2')
})

/* The store keeps one source of truth: a profile is active when the live
 * settings match it, so a manual edit is drift rather than silence. */
const reset = () => {
  const s = useS.getState()
  useS.setState({
    profiles: [], profile: '', projects: [], activeProject: '',
    sel: { k: 'ep', id: 'e1', model: 'm1' },
    params: { ...s.params, def: false, temp: 0.2, topp: 0.9, max: 4096, maxToolRounds: 6, highToolsUnlocked: false },
    effort: {}, pr: '', tools: { calc: true }, toolMode: 'standard', toolApproval: {},
  })
}

test('saving, drifting and re-applying a profile through the store', () => {
  reset()
  const id = useS.getState().saveProfile('Deep work')
  assert.equal(useS.getState().profile, id)
  const p = useS.getState().profiles.find((x) => x.id === id)
  assert.equal(profileMatches(useS.getState(), p), true)
  useS.getState().patch({ params: { ...useS.getState().params, temp: 1.3 } })
  assert.equal(profileMatches(useS.getState(), p), false)
  useS.getState().applyProfile(id)
  assert.equal(useS.getState().params.temp, 0.2)
  assert.equal(profileMatches(useS.getState(), p), true)
})

test('a bound profile is applied when its project is opened', () => {
  reset()
  const id = useS.getState().saveProfile('Project mode')
  useS.setState({ projects: [{ id: 'p1', name: 'One', open: false, profile: id }] })
  useS.getState().patch({ params: { ...useS.getState().params, temp: 1.6 } })
  useS.getState().openProject('p1')
  assert.equal(useS.getState().activeProject, 'p1')
  assert.equal(useS.getState().params.temp, 0.2)
  assert.equal(useS.getState().profile, id)
})

test('deleting a profile unbinds its projects and clears the pointer', () => {
  reset()
  const id = useS.getState().saveProfile('Temp')
  useS.setState({ projects: [{ id: 'p1', name: 'One', open: true, profile: id }] })
  useS.getState().delProfile(id)
  assert.deepEqual(useS.getState().profiles, [])
  assert.equal(useS.getState().profile, '')
  assert.equal(useS.getState().projects[0].profile, undefined)
})

test('always allowing a tool edits the policy and keeps the active profile in sync', () => {
  reset()
  useS.setState({ toolApproval: { location: true } })
  const id = useS.getState().saveProfile('Ask first')
  assert.equal(useS.getState().profiles.find((x) => x.id === id).toolApproval.location, true)
  useS.getState().alwaysAllowTool('location')
  assert.equal(useS.getState().toolApproval.location, false)
  const after = useS.getState().profiles.find((x) => x.id === id)
  assert.equal(after.toolApproval.location, false)
  assert.equal(profileMatches(useS.getState(), after), true)
})
