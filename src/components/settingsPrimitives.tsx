import type { ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { useS, type Kind } from '../store'
import { SETTINGS_TABS, settingDomId } from '../settingsCatalog'
import { Btn } from './ui'

/** Small layout primitives shared by Settings and the lazily loaded Extra tabs.
 *  They live apart from Settings.tsx so Extra does not statically import the
 *  whole settings editor (which would drag it back onto the first-paint path). */

/** Addressable wrapper: renders id="setting-<anchor>" so the palette can
 *  deep-link to an individual setting. Unknown anchors still open the tab. */
export function Anchor({ id, children }: { id: string; children: ReactNode }) {
  return <div id={settingDomId(id)} data-anchor={id} className="scroll-mt-6">{children}</div>
}

/** A titled group of related settings inside a tab. */
export function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section>
      {title && <h3 className="pb-2 text-sm font-semibold text-tx">{title}</h3>}
      {/* Hairlines between rows instead of a card per setting. */}
      <div className="divide-y divide-bor">{children}</div>
    </section>
  )
}

/** Label on the left, control on the right. The shared shape for settings. */
export function SettingRow({ label, children, className = '' }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`flex min-h-11 flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3 ${className}`}>
      <div className="min-w-0 text-sm">{label}</div>
      <div className="ml-auto flex shrink-0 items-center justify-end gap-2">{children}</div>
    </div>
  )
}

export function Panel({ id, k, n, add, children }: { id: string; k?: Kind; n?: number; add?: string; children: ReactNode }) {
  const a = useS((s) => s.add)
  const t = SETTINGS_TABS.find((x) => x[0] === id)!
  return (
    <div className="space-y-6">
      {(k || add) && (
        <div className="flex items-center gap-3">
          <h2 className="flex-1 text-sm font-medium">{t[1]}</h2>
          {k && <Btn v="soft" icon={Plus} onClick={() => a(k)}>{add}</Btn>}
        </div>
      )}
      {n === 0 && <p className="py-8 text-center text-sm text-mu">{id === 'eps' ? 'No endpoints yet. Add one above to get started.' : 'Nothing here yet.'}</p>}
      {children}
    </div>
  )
}
