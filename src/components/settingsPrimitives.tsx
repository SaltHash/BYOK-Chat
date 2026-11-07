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

const INFO: Record<string, string> = {
  features: 'Turn whole features on or off. A disabled feature is hidden everywhere and is never used by the AI or the app until you turn it back on.',
  library: 'Choose which shortcuts appear in the sidebar library.',
  eps: 'Model APIs you connect with your own key. Add several, disable any, and test each one.',
  prompts: 'Reusable system prompts. Pick one from the prompt menu under the chat box to override a playlist prompt. A global system prompt can also apply to every message in every chat.',
  skills: 'Extra instructions the AI can use for specific tasks. Turn on the ones you want available.',
  pls: 'Ordered lists of models from your endpoints. A request tries each model from top to bottom and stops at the first that succeeds. An optional classifier model picks one entry first.',
  cmds: 'Slash commands apply a system prompt and template to a typed input and run on the first endpoint that accepts that input type.',
  tools: 'Model tools such as date, calculator, and web search. Only enabled tools are sent to the provider.',
  mcp: 'External tool servers speaking the Model Context Protocol. Connect a server, load its tools, and every enabled server’s tools join the normal tool loop. URLs and headers stay in this browser.',
  voice: 'Dictate messages with the microphone and have replies read aloud. Both use the browser’s own speech features, with the language and speed you choose.',
  memory: 'Optional local memory. When enabled, the memory tool summarizes durable details and adds selected memories to future requests.',
  widgets: 'Optional panels beside the chat. Widgets are off by default; enable them here and drag the grip in the panel to rearrange them.',
  stats: 'Windowed usage dashboard built from every saved reply, including replies from temporary, archived and deleted chats: cost, tokens, models and recent attempts. The lifetime counters at the bottom are separate all-time totals that survive deleting chats.',
  keys: 'Click Change, then press the keys you want. Shortcuts need Ctrl/Cmd or Alt so they never fire while you type.',
  look: 'Theme, display options, and auto-generated chat names settings.',
  data: 'Export or import your setup. Exports leave API keys out unless you include them.',
  adv: 'Debugging aids for understanding what the model sees and does. Everything here is off by default; enable the Advanced feature to use it.',
}

/** A titled group of related settings inside a tab. Sections give every
 *  settings page the same shape: a header, then the settings that belong
 *  together. */
export function Section({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="border-b border-bor pb-1.5">
        <h3 className="text-sm font-semibold tracking-wide text-tx">{title}</h3>
        {desc && <p className="mt-0.5 text-xs text-mu">{desc}</p>}
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
          <h2 className="flex items-center gap-2 text-lg font-semibold"><I size={20} className="text-ac" />{t[1]}</h2>
          <p className="mt-1 text-sm text-mu">{INFO[id]}</p>
        </div>
        {k && <Btn v="solid" icon={Plus} onClick={() => a(k)}>{add}</Btn>}
      </div>
      <div className="space-y-3">
        {n === 0 && <p className="rounded-xl bg-surf p-6 text-center text-sm text-mu">{id === 'eps' ? 'No endpoints yet. Press Add endpoint, choose a provider preset, paste your API key, enter the model id, then press Test connection.' : 'Nothing here yet. Use the button above to add one.'}</p>}
        {children}
      </div>
    </div>
  )
}
