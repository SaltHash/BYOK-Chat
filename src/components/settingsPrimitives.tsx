import type { ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { useS, type Kind } from '../store'
import { SETTINGS_TABS, settingDomId } from '../settingsCatalog'
import { Btn, HelpTip } from './ui'

/** Small layout primitives shared by Settings and the lazily loaded Extra tabs.
 *  They live apart from Settings.tsx so Extra does not statically import the
 *  whole settings editor (which would drag it back onto the first-paint path). */

/** Addressable wrapper: renders id="setting-<anchor>" so the palette can
 *  deep-link to an individual setting. Unknown anchors still open the tab. */
export function Anchor({ id, children }: { id: string; children: ReactNode }) {
  return <div id={settingDomId(id)} data-anchor={id} className="scroll-mt-6">{children}</div>
}

const INFO: Record<string, string> = {
  features: 'Disabled features are hidden and unavailable.',
  eps: 'Model APIs you connect with your own key.',
  prompts: 'Reusable prompts for a chat, plus one optional global prompt.',
  skills: 'Extra instructions for specific tasks.',
  pls: 'Ordered model lists; earlier entries are tried first.',
  cmds: 'Slash commands that apply a prompt and template to your input.',
  mcp: 'Connect external MCP tool servers.',
  voice: 'Dictate messages and hear replies read aloud.',
  memory: 'Optional memory used in future replies.',
  widgets: 'Optional panels beside the chat.',
  stats: 'Usage and cost across saved replies, including chats you later delete.',
  keys: 'Choose keyboard shortcuts. Each needs Ctrl/Cmd or Alt.',
  adv: 'Debugging tools; off by default.',
}

/** A titled group of related settings inside a tab. Sections give every
 *  settings page the same shape: a header, then the settings that belong
 *  together. */
export function Section({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="border-b border-bor pb-1.5">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold tracking-wide text-tx">{title}{desc && <HelpTip text={desc} label={`About ${title}`} />}</h3>
      </div>
      {children}
    </section>
  )
}

export function Panel({ id, k, n, add, children }: { id: string; k?: Kind; n?: number; add?: string; children: ReactNode }) {
  const a = useS((s) => s.add)
  const t = SETTINGS_TABS.find((x) => x[0] === id)!
  const I = t[2]
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 pr-10">
        <div className="flex-1">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><I size={20} className="text-ac" />{t[1]}{INFO[id] && <HelpTip text={INFO[id]} label={`About ${t[1]}`} />}</h2>
        </div>
        {k && <Btn v="solid" icon={Plus} onClick={() => a(k)}>{add}</Btn>}
      </div>
      <div className="space-y-3">
        {n === 0 && <p className="rounded-xl bg-surf p-6 text-center text-sm text-mu">{id === 'eps' ? 'No endpoints yet. Add one above to get started.' : 'Nothing here yet.'}</p>}
        {children}
      </div>
    </div>
  )
}
