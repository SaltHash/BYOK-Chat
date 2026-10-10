import { useEffect, useRef, useState } from 'react'
import { Search, Plus, MessageSquare, Settings, Palette as Pi, Cpu, ScrollText, Download, PanelRight, Server, Trash2, Type, Sun, Moon, Maximize2 } from 'lucide-react'
import { useS, THEMES, modelsOf, modelNameOf, exportChat } from '../store'
import { CI } from '../meta'
import { Modal, cx, type Ic } from './ui'

const TABS: [string, string, string][] = [
  ['eps', 'Endpoints', 'models providers api keys connections model aliases'], ['pls', 'Playlists', 'routes groups'], ['prompts', 'Prompts', 'system instructions'], ['cmds', 'Commands', 'slash'], ['tools', 'Tools', 'helpers'], ['widgets', 'Widgets', 'panels'], ['stats', 'Stats', 'usage tokens cost'], ['keys', 'Shortcuts', 'keybinds keyboard'], ['look', 'Appearance', 'fonts theme display layout max height'], ['data', 'Data', 'import backup privacy'],
]

export function Palette({ close, cfg, toggleSide }: { close: () => void; cfg: (t: string) => void; toggleSide: () => void }) {
  const s = useS()
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  type Action = { icon: Ic; t: string; h: string; words: string; run: () => void }
  const action = (icon: Ic, t: string, h: string, words: string, run: () => void): Action => ({ icon, t, h, words, run })
  const all: Action[] = [
    action(Plus, 'New chat', 'Action', 'create start conversation blank', s.newChat),
    ...s.chats.map((c) => action(MessageSquare, c.title, 'Chat', `chat conversation ${c.title}`, () => s.patch({ chat: c.id }))),
    ...s.eps.flatMap((e) => modelsOf(e).map((model) => action(Cpu, modelNameOf(e, model), e.name, `model ${modelNameOf(e, model)} ${model} ${e.name} provider endpoint switch select`, () => s.patch({ sel: { k: 'ep', id: e.id, model } })))),
    ...s.pls.map((p) => action(Cpu, p.name, 'Playlist', `playlist model route ${p.name}`, () => s.patch({ sel: { k: 'pl', id: p.id } }))),
    action(Server, 'Add endpoint', 'Action', 'provider model connection api', () => { s.add('eps'); cfg('eps') }),
    action(Settings, 'Open settings', 'Action', 'preferences configure options', () => cfg('eps')),
    action(Settings, 'Close settings', 'Action', 'dismiss settings', () => cfg('')),
    action(PanelRight, 'Toggle widgets panel', 'Action', 'sidebar widgets panel show hide', () => s.patch({ rail: !s.rail })),
    action(Maximize2, 'Toggle sidebar', 'Action', 'navigation chats sidebar show hide', toggleSide),
    action(Download, 'Export current chat', 'Action', 'download markdown save', exportChat),
    action(Trash2, 'Clear model selection', 'Action', 'reset automatic endpoints models', () => s.patch({ sel: null })),
    action(Type, 'Clear prompt selection', 'Action', 'reset system instructions', () => s.patch({ pr: '' })),
    ...s.cmds.filter((c) => c.on).map((c) => action(CI[c.in], '/' + c.name, c.desc || 'Command', `command slash ${c.name} ${c.desc}`, () => s.patch({ draft: '/' + c.name + ' ' }))),
    ...TABS.map(([k, label, words]) => action(Settings, label, 'Settings', `${label} ${words}`, () => cfg(k))),
    ...s.prompts.map((p) => action(ScrollText, p.name, 'Prompt', `prompt system instruction ${p.name} ${p.text}`, () => s.patch({ pr: p.id }))),
    ...Object.entries(THEMES).map(([k, n]) => action(Pi, n, 'Theme', `theme color ${n}`, () => s.patch({ theme: k as keyof typeof THEMES }))),
    action(Pi, 'Next theme', 'Action', 'cycle theme appearance colors', () => { const keys = Object.keys(THEMES) as (keyof typeof THEMES)[]; s.patch({ theme: keys[(keys.indexOf(s.theme) + 1) % keys.length] }) }),
    action(ScrollText, 'Next prompt', 'Action', 'cycle prompt system instruction', () => { const n = s.prompts.length ? (s.prompts.findIndex((p) => p.id === s.pr) + 1) % s.prompts.length : -1; s.patch({ pr: n < 0 ? '' : s.prompts[n].id }) }),
    action(Cpu, 'Next model', 'Action', 'cycle model endpoint provider', () => { const list = s.eps.flatMap((e) => modelsOf(e).map((model) => ({ k: 'ep' as const, id: e.id, model }))); const at = list.findIndex((m) => m.id === s.sel?.id && m.model === s.sel?.model); s.patch({ sel: list.length ? list[(at + 1) % list.length] : null }) }),
  ]
  const needle = q.trim().toLowerCase()
  const L = all.map((x, order) => {
    const title = x.t.toLowerCase(), words = x.words.toLowerCase(), queryWords = needle.split(/\s+/).filter(Boolean)
    let score = !needle ? 1 : title === needle ? 1000 : title.startsWith(needle) ? 700 : title.includes(needle) ? 500 : words.includes(needle) ? 350 : 0
    if (queryWords.length && queryWords.every((w) => (title + ' ' + words + ' ' + x.h.toLowerCase()).includes(w))) score = Math.max(score, 200)
    return { ...x, score, order }
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.order - b.order).slice(0, 40)
  const run = (n: number) => { L[n]?.run(); close() }
  const m = Math.max(L.length, 1)
  useEffect(() => { refs.current[i]?.scrollIntoView({ block: 'nearest' }) }, [i, L.length])
  return (
    <Modal close={close}>
      <div className="mt-[10vh] w-full max-w-lg self-start overflow-hidden rounded-2xl bg-surf">
        <div className="flex items-center gap-3 px-4 py-3">
          <Search size={18} className="text-mu" />
          <input
            autoFocus value={q} placeholder="Search chats, commands, settings"
            onChange={(e) => { setQ(e.target.value); setI(0) }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setI((i + 1) % m) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setI((i - 1 + m) % m) }
              else if (e.key === 'Enter') run(i)
            }}
            className="flex-1 bg-transparent outline-none"
          />
        </div>
        <div className="space-y-0.5 overflow-y-auto p-1.5" style={{ maxHeight: s.prefs.paletteMax }}>
          {L.map((x, n) => {
            const I = x.icon
            return (
              <button ref={(el) => { refs.current[n] = el }} key={n} onClick={() => run(n)} onMouseMove={() => setI(n)} className={cx('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm', n === i && 'bg-hov')}>
                <I size={16} className="text-mu" /><span className="flex-1 truncate">{x.t}</span><span className="text-xs text-mu">{x.h}</span>
              </button>
            )
          })}
          {!L.length && <p className="px-3 py-6 text-center text-sm text-mu">No matches.</p>}
        </div>
      </div>
    </Modal>
  )
}
