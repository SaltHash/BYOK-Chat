import { useState } from 'react'
import { Check, Layers, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useS, useSConfig } from '../store'
import { describeProfile, profileMatches, type Profile } from '../profiles'
import { Anchor, Panel, Section } from './settingsPrimitives'
import { Btn, Input, Item, Pop, cx } from './ui'

/* Profiles are edited as whole setups, not as field-by-field forms: capture
 * what the app is doing now, then edit the name and apply it elsewhere. That
 * keeps the editor honest — a profile can never describe settings the app
 * cannot actually produce. */

function ProfileRow({ p, projectNames }: { p: Profile; projectNames: string[] }) {
  const s = useSConfig()
  const [name, setName] = useState(p.name)
  const [confirm, setConfirm] = useState(false)
  const active = profileMatches(s, p)
  const d = describeProfile(p, { eps: s.eps, pls: s.pls, prompts: s.prompts })
  const saveName = () => {
    const next = name.trim().slice(0, 60)
    if (!next || next === p.name) { setName(p.name); return }
    useS.getState().renameProfile(p.id, next)
  }
  return (
    <div className={cx('space-y-2.5 rounded-xl border p-3', active ? 'border-ac/40 bg-ac/5' : 'border-transparent bg-surf')}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} maxLength={60}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setName(p.name); e.currentTarget.blur() } }}
          aria-label={`Name of ${p.name}`}
          className="h-9 min-w-0 flex-1 rounded-lg bg-bg px-3 text-sm outline-none focus:ring-2 focus:ring-ac/40"
        />
        {active && <span className="inline-flex items-center gap-1 rounded-full bg-ac/15 px-2 py-0.5 text-xs font-medium text-ac"><Check size={12} />Active</span>}
      </div>
      <p className="text-xs leading-5 text-mu">
        <span className="text-tx">{d.model}</span> · prompt {d.prompt} · {d.mode} · {d.tools}
        {projectNames.length > 0 && <> · used by {projectNames.join(', ')}</>}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Btn v="solid" disabled={active} onClick={() => useS.getState().applyProfile(p.id)}>Apply</Btn>
        <Btn v="soft" icon={RotateCcw} title="Replace this profile with the current setup" onClick={() => useS.getState().updateProfile(p.id)}>Update from current</Btn>
        {confirm ? (
          <>
            <span className="text-xs text-er">Delete “{p.name}”?</span>
            <Btn sm v="danger" icon={Check} title="Confirm delete profile" onClick={() => { useS.getState().delProfile(p.id); setConfirm(false) }} />
            <Btn sm v="soft" title="Cancel delete" onClick={() => setConfirm(false)}>Cancel</Btn>
          </>
        ) : (
          <Btn v="soft" icon={Trash2} className="ml-auto text-er" title={`Delete ${p.name}`} onClick={() => setConfirm(true)}>Delete</Btn>
        )}
      </div>
    </div>
  )
}

/** Settings → Profiles: the list, the capture action and what each profile carries. */
export function ProfilesTab() {
  const s = useSConfig()
  const [name, setName] = useState('')
  const save = () => {
    useS.getState().saveProfile(name)
    setName('')
  }
  return (
    <Panel id="profiles">
      <Section title="Save the current setup" desc="A profile stores the model, sampling, prompt, tools and access policy. Theme, keys and layout stay out of it.">
        <Anchor id="profiles-save">
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-surf p-3">
            <Input value={name} set={setName} placeholder="New profile" />
            <Btn v="solid" icon={Plus} onClick={save}>Save current setup</Btn>
          </div>
          <p className="mt-2 text-xs text-mu">Saving captures exactly what is active now. Change a model or prompt afterwards and the profile keeps the old values until you update it.</p>
        </Anchor>
      </Section>
      <Section title="Saved profiles" desc="Apply a profile to switch model, prompt, tools and access policy at once.">
        <Anchor id="profiles-list">
          {s.profiles.length ? (
            <div className="space-y-2">
              {s.profiles.map((p) => (
                <ProfileRow key={p.id} p={p} projectNames={s.projects.filter((f) => f.profile === p.id).map((f) => f.name)} />
              ))}
            </div>
          ) : (
            <p className="rounded-xl bg-surf p-6 text-center text-sm text-mu">No profiles yet. Set up a model, prompt and tools you like, then save them here.</p>
          )}
        </Anchor>
      </Section>
      <Section title="Project binding" desc="A project can apply one profile whenever you open it, so entering a project also enters the way you work on it.">
        <Anchor id="profiles-projects">
          {s.projects.length ? (
            <div className="space-y-2">
              {s.projects.map((f) => (
                <div key={f.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-surf p-3">
                  <span className="min-w-0 flex-1 truncate text-sm">{f.name}</span>
                  <select
                    aria-label={`Profile for ${f.name}`}
                    value={f.profile ?? ''}
                    onChange={(e) => useS.getState().bindProjectProfile(f.id, e.target.value)}
                    className="h-9 rounded-lg bg-bg px-2 text-sm outline-none focus:ring-2 focus:ring-ac/40"
                  >
                    <option value="">No profile</option>
                    {s.profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-mu">Create a project to bind a profile to it.</p>}
        </Anchor>
      </Section>
      <p className="rounded-xl bg-bg px-3 py-2 text-xs text-mu">Profiles travel with your settings export and device sync. They do not include API keys, which stay in Data controls.</p>
    </Panel>
  )
}

/** Header switcher: the active profile is derived from the live settings, so it
 *  reads "No profile" the moment anything it captured is changed by hand. */
export function ProfileButton({ cfg }: { cfg: (t: string) => void }) {
  const profiles = useS((s) => s.profiles)
  const active = useS((s) => {
    const live = s
    const p = s.profiles.find((x) => profileMatches(live, x))
    return p?.id ?? ''
  })
  const current = profiles.find((p) => p.id === active)
  return (
    <Pop right w="w-72" trigger={() => (
      <Btn icon={Layers} title={current ? `Profile: ${current.name}` : 'Profiles'} aria-label={current ? `Profile: ${current.name}` : 'Profiles'}>
        <span className="hidden max-w-28 truncate lg:inline">{current ? current.name : 'No profile'}</span>
      </Btn>
    )}>
      {(close) => (
        <>
          <div className="px-2.5 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wide text-mu">Profiles</div>
          {profiles.length ? profiles.map((p) => (
            <Item key={p.id} icon={Layers} on={p.id === active} title={`Apply ${p.name}`} onClick={() => { useS.getState().applyProfile(p.id); close() }}>{p.name}</Item>
          )) : <p className="px-2.5 py-2 text-sm text-mu">No profiles yet. Save the current setup to make one.</p>}
          <div role="separator" aria-hidden="true" className="mx-1 my-1.5 border-t border-bor/60" />
          <Item icon={Plus} onClick={() => { close(); useS.getState().saveProfile(); cfg('profiles#profiles-list') }}>Save current setup as a profile</Item>
          <Item icon={Layers} onClick={() => { close(); cfg('profiles') }}>Manage profiles…</Item>
        </>
      )}
    </Pop>
  )
}
