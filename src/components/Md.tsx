import { lazy, Suspense, useState } from 'react'
import { Check, Copy, GitBranch, Pencil } from 'lucide-react'
import { useS, type FadeEvent, type Msg } from '../store'
import { Btn } from './ui'

// The full renderer (tables, math, highlighting) loads on first use to keep the first paint light.
const Rich = lazy(() => import('./Rich'))

export function Md({ t, fadeEvents = [], fade = 0 }: { t: string; fadeEvents?: FadeEvent[]; fade?: number }) {
  return (
    <Suspense fallback={<p className="whitespace-pre-wrap">{t}</p>}>
      <Rich t={t} fadeEvents={fadeEvents} fade={fade} />
    </Suspense>
  )
}

export function UserText({ m }: { m: Msg }) {
  const edit = useS((s) => s.editMsg)
  const branch = useS((s) => s.branch)
  const [ed, setEd] = useState(false)
  const [v, setV] = useState(m.t)
  if (ed)
    return (
      <div className="space-y-2">
        <textarea autoFocus rows={3} value={v} onChange={(e) => setV(e.target.value)} className="w-full resize-y rounded-2xl bg-surf px-4 py-2.5 outline-none focus:ring-2 focus:ring-ac/40" />
        <p className="text-xs text-mu">Saving resends this message and replaces every reply after it. Use Branch from here first to keep the current thread.</p>
        <div className="flex justify-end gap-2">
          <Btn v="soft" onClick={() => { setV(m.t); setEd(false) }}>Cancel</Btn>
          <Btn v="solid" icon={Check} onClick={() => { edit(m.id, v); setEd(false) }}>Save and resend</Btn>
        </div>
      </div>
    )
  return (
    <div className="group/u relative flex items-start justify-end gap-1">
      <span className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover/u:opacity-100 focus-within:opacity-100">
        <Btn sm icon={GitBranch} title="Branch from here (copy this thread into a new chat)" onClick={() => branch(m.id)} />
        <Btn sm icon={Pencil} title="Edit message" onClick={() => setEd(true)} />
      </span>
      <div className="whitespace-pre-wrap rounded-2xl bg-surf px-4 py-2.5">{m.t}</div>
    </div>
  )
}
