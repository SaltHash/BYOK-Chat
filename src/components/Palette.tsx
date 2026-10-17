import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Search, Plus, MessageSquare, Settings, Palette as Pi, Cpu, ScrollText, Download, PanelRight, Server, Trash2, Type, Maximize2, Sparkles, Wrench, Keyboard, FolderOpen, SlidersHorizontal, Brain, ListMusic, Terminal, TrendingUp, Database, FlaskConical, Library } from 'lucide-react'
import { useS, THEMES, themePatch, modelsOf, modelNameOf, exportChat, featOn, FEATURES, LIBRARY_ITEMS, type FeatureId } from '../store'
import { nextThemePatch, stepModelSelection, stepPromptSelection } from '../selection'
import { SETTINGS_TABS, SETTING_LINKS, TAB_KEYWORDS } from '../settingsCatalog'
import { visibleTabs } from './Settings'
import { normSkills, resolveSkill } from '../skills'
import { CI, TOOLS, WIDGETS, KEYS } from '../meta'
import { WORKSPACE_TEMPLATES } from '../workspace'
import { Modal, cx, type Ic } from './ui'

const TAB_FEATURE: Record<string, FeatureId> = {
  prompts: 'prompts', skills: 'skills', pls: 'playlists', cmds: 'commands',
  tools: 'tools', memory: 'memory', widgets: 'widgets', keys: 'shortcuts', stats: 'stats', adv: 'advanced', workspace: 'workspace',
}

const FEATURE_ICON: Record<string, Ic> = {
  prompts: ScrollText, skills: Sparkles, tools: Wrench, playlists: ListMusic, commands: Terminal,
  stats: TrendingUp, memory: Brain, widgets: PanelRight, shortcuts: Keyboard, library: Library,
  workspace: FolderOpen, routing: ListMusic, advanced: FlaskConical,
}

export function Palette({ close, cfg, toggleSide }: { close: () => void; cfg: (t: string) => void; toggleSide: () => void }) {
  /* Narrow slice: the palette is rebuilt from these fields only, so composer
     keystrokes, streaming text updates and widget state no longer re-render it. */
  const s = useS(useShallow((st) => ({
    chats: st.chats, skills: st.skills, eps: st.eps, pls: st.pls, prompts: st.prompts, cmds: st.cmds, pr: st.pr,
    features: st.features, prefs: st.prefs, sel: st.sel, rail: st.rail,
    themeMode: st.themeMode, themeLight: st.themeLight, themeDark: st.themeDark,
    newChat: st.newChat, patch: st.patch, add: st.add,
  })))
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  type Action = { icon: Ic; t: string; h: string; words: string; run: () => void }
  const action = (icon: Ic, t: string, h: string, words: string, run: () => void): Action => ({ icon, t, h, words, run })
  const tabIcon = (tab: string): Ic => SETTINGS_TABS.find(([k]) => k === tab)?.[2] ?? Settings
  const visible = new Set(visibleTabs(s.features).map(([k]) => k))
  const { skills } = normSkills(s.skills)

  const all: Action[] = [
    action(Plus, 'New chat', 'Action', 'create start conversation blank', s.newChat),
    ...s.chats.map((c) => action(MessageSquare, c.title, 'Chat', `chat conversation ${c.title}`, () => s.patch({ chat: c.id }))),
    ...s.eps.flatMap((e) => modelsOf(e).map((model) => action(Cpu, modelNameOf(e, model), e.name, `model ${modelNameOf(e, model)} ${model} ${e.name} provider endpoint switch select`, () => s.patch({ sel: { k: 'ep', id: e.id, model } })))),
    ...(featOn(s, 'playlists') ? s.pls.map((p) => action(Cpu, p.name, 'Playlist', `playlist model route ${p.name}`, () => s.patch({ sel: { k: 'pl', id: p.id } }))) : []),
    action(Server, 'Add endpoint', 'Action', 'provider model connection api', () => { s.add('eps'); cfg('eps#add-endpoint') }),
    action(Settings, 'Open settings', 'Action', 'preferences configure options', () => cfg('eps')),
    action(Settings, 'Close settings', 'Action', 'dismiss settings', () => cfg('')),
    action(PanelRight, 'Toggle widgets panel', 'Action', 'sidebar widgets panel show hide', () => (featOn(s, 'widgets') ? s.patch({ rail: !s.rail }) : cfg('features#feature-widgets'))),
    action(Maximize2, 'Toggle sidebar', 'Action', 'navigation chats sidebar show hide', toggleSide),
    action(Download, 'Export current chat', 'Action', 'download markdown save', exportChat),
    action(Trash2, 'Clear model selection', 'Action', 'reset automatic endpoints models', () => s.patch({ sel: null })),
    ...(featOn(s, 'prompts') ? [action(Type, 'Clear prompt selection', 'Action', 'reset system instructions', () => s.patch({ pr: '' }))] : []),
    ...(featOn(s, 'commands') ? s.cmds.filter((c) => c.on).map((c) => action(CI[c.in], '/' + c.name, c.desc || 'Command', `command slash ${c.name} ${c.desc}`, () => s.patch({ draft: '/' + c.name + ' ' }))) : []),
    // Every settings tab (single source of truth — no hardcoded subset).
    ...SETTINGS_TABS.filter(([k]) => visible.has(k)).map(([k, label]) => action(tabIcon(k), label, 'Settings', `${label} settings tab ${TAB_KEYWORDS[k]}`, () => cfg(k))),
    // Every individual setting/section declared in the catalog.
    ...SETTING_LINKS.filter((l) => visible.has(l.tab) && (!TAB_FEATURE[l.tab] || featOn(s, TAB_FEATURE[l.tab]))).map((l) => action(tabIcon(l.tab), l.title, 'Setting', `${l.title} ${l.keywords} settings ${l.tab}`, () => cfg(`${l.tab}#${l.anchor}`))),
    // Every endpoint card.
    ...s.eps.map((e) => action(Server, `Endpoint: ${e.name}`, 'Setting', `endpoint ${e.name} ${e.model} settings eps`, () => cfg(`eps#ep-${e.id}`))),
    // Every feature toggle.
    ...FEATURES.map(([id, label, desc]) => action(FEATURE_ICON[id] ?? SlidersHorizontal, `Feature: ${label}`, 'Setting', `feature ${label} ${desc} toggle enable disable`, () => cfg(`features#feature-${id}`))),
    // Every library entry.
    ...LIBRARY_ITEMS.map(([k, l]: [string, string]) => action(Library, `Library: ${l}`, 'Setting', `library sidebar ${l} show entries`, () => cfg('features#library-entries'))),
    // Every skill (built-in + custom).
    ...(featOn(s, 'skills') ? skills.map((st) => {
      const def = resolveSkill(st)
      const name = def?.name ?? st.id
      return action(Sparkles, `Skill: ${name}`, 'Setting', `skill ${name} ${st.id} ${st.description ?? def?.description ?? ''} instructions`, () => cfg(`skills#skill-${st.id}`))
    }) : []),
    // Every tool, including its search/workspace sub-settings via the catalog.
    ...(featOn(s, 'tools') ? TOOLS.filter(([k]) => k !== 'memory').map(([k, n, I, u, d]) => action(I, `Tool: ${n}`, 'Setting', `tool ${n} ${k} ${u} ${d}`, () => cfg(`tools#tool-${k}`))) : []),
    // Every widget.
    ...(featOn(s, 'widgets') ? WIDGETS.map(([k, n, I, d]) => action(I, `Widget: ${n}`, 'Setting', `widget ${n} ${k} ${d} panel`, () => cfg(`widgets#widget-${k}`))) : []),
    // Every shortcut.
    ...(featOn(s, 'shortcuts') ? KEYS.map(([id, label]) => action(Keyboard, `Shortcut: ${label}`, 'Setting', `shortcut keybind keyboard ${label} ${id} change binding`, () => cfg(`keys#key-${id}`))) : []),
    // Every prompt / playlist / command record.
    ...(featOn(s, 'prompts') ? s.prompts.map((p) => action(ScrollText, p.name, 'Prompt', `prompt system instruction ${p.name} ${p.text}`, () => s.patch({ pr: p.id }))) : []),
    ...(featOn(s, 'prompts') ? s.prompts.map((p) => action(ScrollText, `Edit prompt: ${p.name}`, 'Setting', `edit prompt ${p.name} settings`, () => cfg(`prompts#prompt-${p.id}`))) : []),
    ...(featOn(s, 'playlists') ? s.pls.map((p) => action(ListMusic, `Edit playlist: ${p.name}`, 'Setting', `edit playlist ${p.name} models classifier routing`, () => cfg(`pls#playlist-${p.id}`))) : []),
    ...(featOn(s, 'commands') ? s.cmds.map((c) => action(Terminal, `Edit command: /${c.name}`, 'Setting', `edit command slash ${c.name} ${c.desc} template`, () => cfg(`cmds#command-${c.id}`))) : []),
    // Every workspace template.
    ...(featOn(s, 'workspace') ? WORKSPACE_TEMPLATES.map((t) => action(FolderOpen, `Template: ${t.name}`, 'Setting', `template ${t.name} ${t.id} ${t.description} scaffold workspace`, () => cfg(`workspace#template-${t.id}`))) : []),
    ...Object.entries(THEMES).map(([k, n]) => action(Pi, n, 'Theme', `theme color ${n}`, () => s.patch(themePatch(s, k as keyof typeof THEMES)))),
    action(Pi, 'Next theme', 'Action', 'cycle theme appearance colors', () => s.patch(nextThemePatch(s))),
    ...(featOn(s, 'prompts') ? [action(ScrollText, 'Next prompt', 'Action', 'cycle prompt system instruction', () => s.patch({ pr: stepPromptSelection(s.prompts, s.pr) }))] : []),
    action(Cpu, 'Next model', 'Action', 'cycle model endpoint provider', () => { const next = stepModelSelection(s.eps, s.sel, 1); s.patch({ sel: next }) }),
  ]
  const needle = q.trim().toLowerCase()
  const L = all.map((x, order) => {
    const title = x.t.toLowerCase(), words = x.words.toLowerCase(), queryWords = needle.split(/\s+/).filter(Boolean)
    let score = !needle ? 1 : title === needle ? 1000 : title.startsWith(needle) ? 700 : title.includes(needle) ? 500 : words.includes(needle) ? 350 : 0
    if (queryWords.length && queryWords.every((w) => (title + ' ' + words + ' ' + x.h.toLowerCase()).includes(w))) score = Math.max(score, 200)
    return { ...x, score, order }
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.order - b.order).slice(0, 60)
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
