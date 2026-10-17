import type { CSSProperties } from 'react'
import { BookOpen, Search, Wrench, X, type LucideIcon } from 'lucide-react'
import { CI, TOOLS } from '../meta'
import type { Mention } from '../mentions'
import type { Cmd } from '../store'
import { cx } from './ui'

/** Icon that stands for a mention: the command's own icon, the tool's icon,
 * or BookOpen / Search for the two banner mentions. */
export function mentionIcon(m: Mention, cmds: Cmd[]): LucideIcon {
  if (m.kind === 'command') {
    const c = cmds.find((x) => x.name === m.name)
    return (c && CI[c.in]) || CI.text
  }
  if (m.kind === 'research') return BookOpen
  if (m.kind === 'search') return Search
  return TOOLS.find(([id]) => id === m.name)?.[2] ?? Wrench
}

/** Inline pill used in sent user messages. Hover shows the plain-language
 * description; the raw text stays available through copy. */
export function MentionChip({ m, cmds }: { m: Mention; cmds: Cmd[] }) {
  const I = mentionIcon(m, cmds)
  return (
    <span
      title={m.desc}
      className={cx('mx-0.5 inline-flex max-w-full items-center gap-1 rounded-full px-2 py-px align-baseline text-xs font-medium ring-1', m.enabled ? 'bg-ac/15 text-ac ring-ac/30' : 'bg-hov text-mu ring-mu/30')}
    >
      <I size={12} className="shrink-0" aria-hidden="true" />
      <span className="truncate">{m.label}</span>
    </span>
  )
}

/** Static strip fused to the top of a sent user message that invoked search
 * or deep research. Same attached strip styling as the composer banner,
 * without the dismiss control (there is nothing left to cancel once sent). */
export function SentMentionBanner({ kind }: { kind: 'search' | 'research' }) {
  const I = kind === 'research' ? BookOpen : Search
  const label = kind === 'research' ? 'Deep research' : 'Search'
  return (
    <div className="mention-banner flex items-center gap-2 rounded-t-2xl border-b border-ac/25 bg-ac/10 px-4 py-2">
      <I size={14} className="shrink-0 text-ac" aria-hidden="true" />
      <span className="truncate text-xs font-semibold tracking-wide text-ac">{label}</span>
    </div>
  )
}
/** Description card shown while a composer pill is selected. */
export function MentionInfo({ m, cmds, className, style }: { m: Mention; cmds: Cmd[]; className?: string; style?: CSSProperties }) {
  const I = mentionIcon(m, cmds)
  return (
    <div style={style} className={cx('pointer-events-none z-30 w-64 max-w-[80vw] rounded-xl border border-hov bg-hov p-2.5 shadow-lg', className)}>
      <div className="flex items-center gap-2 text-sm font-medium">
        <I size={14} className="shrink-0 text-ac" aria-hidden="true" />
        <span className="truncate">{m.label}</span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-mu">{m.desc}</p>
      {!m.enabled && <p className="mt-1 text-xs text-er">{m.kind === 'command' ? 'This command is off right now. Turn it on in Settings.' : 'This tool is off right now. Turn it on in Settings.'}</p>}
    </div>
  )
}

/** State strip fused to the top of the prompt box. The × clears the armed
 * mention while typing, or stops the run while it is working. */
export function MentionBanner({ kind, onDismiss }: { kind: 'search' | 'research'; onDismiss: () => void }) {
  const I = kind === 'research' ? BookOpen : Search
  const label = kind === 'research' ? 'Deep research' : 'Search'
  const action = `Cancel ${label.toLowerCase()}`
  return (
    <div role="status" aria-live="polite" className="mention-banner -mx-3 -mt-3 mb-3 flex items-center gap-2 rounded-t-2xl border-b border-ac/25 bg-ac/10 px-3.5 py-2">
      <I size={14} className="shrink-0 text-ac" aria-hidden="true" />
      <span className="truncate text-xs font-semibold tracking-wide text-ac">{label}</span>
      <button type="button" onClick={onDismiss} aria-label={action} title={action} className="ml-auto grid size-5 shrink-0 place-items-center rounded-full text-ac/70 transition-colors hover:bg-ac/15 hover:text-ac">
        <X size={12} />
      </button>
    </div>
  )
}
