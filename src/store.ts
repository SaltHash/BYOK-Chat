import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { DEFAULT_TOOLS, KEYS, TOOLS, WIDGETS } from './meta'
import { est, redact, can, stream, wire, runToolLoop, type ToolResult, searchWeb, formatSearch, shouldSearchWeb } from './engine'

export type Kind = 'eps' | 'prompts' | 'pls' | 'cmds'
export type ModelPrice = { input: number; output: number; source?: 'manual' | 'openrouter' }
export type Ep = { id: string; name: string; type: 'openai' | 'anthropic'; url: string; key: string; model: string; preset?: string; endpointId?: string; endpointFilter?: 'author' | 'provider'; models?: string[]; modelNames?: Record<string, string>; modelEfforts?: Record<string, string[]>; modelEffortSource?: Record<string, 'auto' | 'manual'>; modelsMode?: 'separate' | 'playlist'; prices?: Record<string, ModelPrice>; on: boolean }
export type Prompt = { id: string; name: string; text: string }
export type Pl = { id: string; name: string; sys: string; e: string[]; cls: string; clsModel?: string; rule: string }
export type Cmd = { id: string; name: string; desc: string; in: 'text' | 'image' | 'image+text' | 'doc'; sys: string; tpl: string; pl: string; on: boolean }
export type Try = { n: string; m: string; detail?: string; ms?: number; err?: string; tin?: number; tout?: number; at?: number }
export type Att = { name: string; kind: 'img' | 'pdf' | 'txt'; size: string; mime?: string; data?: string; text?: string }
export type FadeEvent = { text: string; at: number }
export type Msg = { id: string; r: 'user' | 'assistant'; t: string; at?: number; fadeEvents?: FadeEvent[]; by?: string; tps?: number; log?: Try[]; att?: Att[]; err?: boolean; full?: string; ctx?: string[]; fx?: string; cmd?: string; alts?: Snap[]; ai?: number; historyTokens?: number; explicitTokens?: number; reasoning?: string; thinkingOn?: boolean; toolRounds?: { text: string; calls: ToolResult[] }[]; toolFinal?: string }
export type Snap = { t: string; by?: string; tps?: number; log?: Try[]; err?: boolean }
export type Chat = { id: string; title: string; pin?: boolean; started?: boolean; folder?: string; msgs: Msg[]; temporary?: boolean; expiresAt?: number; titleAuto?: boolean }
export type Folder = { id: string; name: string; open: boolean }
export type Notice = { t: string; tab?: string; label?: string } | null
export type Stats = { tin: number; tout: number; historyIn: number; explicitIn: number; sent: number; chats: number; since: number; cost: number }
export type Memory = { id: string; text: string; category: string; createdAt: number; updatedAt: number }

export const THEMES = { plum: 'Plum', graphite: 'Graphite', paper: 'Paper', sepia: 'Sepia', custom: 'Custom' }
export const THEME_COLOR_KEYS = ['bg', 'side', 'surf', 'hov', 'tx', 'mu', 'ac', 'acx', 'er', 'code', 'codeh', 'c2', 'c3', 'c4', 'c5'] as const
export type ThemeColorKey = typeof THEME_COLOR_KEYS[number]
export type ThemeColors = Record<ThemeColorKey, string>
export const THEME_COLOR_LABELS: Record<ThemeColorKey, string> = { bg: 'Main background', side: 'Sidebar', surf: 'Panel surface', hov: 'Hover and selection', tx: 'Main text', mu: 'Muted text', ac: 'Accent', acx: 'Text on accent', er: 'Error', code: 'Code block', codeh: 'Code block header', c2: 'Syntax: strings', c3: 'Syntax: numbers', c4: 'Syntax: titles', c5: 'Syntax: types' }
export const DEFAULT_CUSTOM_COLORS: ThemeColors = { bg: '#17101c', side: '#120c16', surf: '#211828', hov: '#2c2036', tx: '#f3eaf7', mu: '#a893b4', ac: '#dc8ad8', acx: '#1b1020', er: '#ff8fa3', code: '#100b15', codeh: '#2f2040', c2: '#9fe3c5', c3: '#f2b98b', c4: '#8fb9ff', c5: '#c7a6ff' }
export const PRE: Record<string, ['openai' | 'anthropic', string, string, 'author' | 'provider']> = {
  Anthropic: ['anthropic', 'https://api.anthropic.com/v1', 'anthropic', 'author'],
  Google: ['openai', 'https://generativelanguage.googleapis.com/v1beta/openai/', 'google', 'author'],
  DeepSeek: ['openai', 'https://api.deepseek.com/v1', 'deepseek', 'author'],
  xAI: ['openai', 'https://api.x.ai/v1', 'x-ai', 'author'],
  Mistral: ['openai', 'https://api.mistral.ai/v1', 'mistralai', 'author'],
  Together: ['openai', 'https://api.together.xyz/v1', 'Together', 'provider'],
  Fireworks: ['openai', 'https://api.fireworks.ai/inference/v1', 'Fireworks', 'provider'],
  Cerebras: ['openai', 'https://api.cerebras.ai/v1', 'cerebras', 'author'],
  Perplexity: ['openai', 'https://api.perplexity.ai', 'perplexity', 'author'],
  Groq: ['openai', 'https://api.groq.com/openai/v1', 'Groq', 'provider'],
  'Ollama (local)': ['openai', 'http://localhost:11434/v1', 'ollama', 'provider'],
  OpenAI: ['openai', 'https://api.openai.com/v1', 'openai', 'author'],
  OpenRouter: ['openai', 'https://openrouter.ai/api/v1', '', 'author'],
  'Other OpenAI-compatible': ['openai', '', '', 'author'],
}
export const uid = () => Math.random().toString(36).slice(2, 9)
export const usable = (e: Ep) => e.on && !!e.model.trim() && /^https?:\/\//i.test(e.url.trim())
export const BLANK: Record<Kind, () => any> = {
  eps: () => ({ id: uid(), name: 'New endpoint', type: 'openai', url: '', key: '', model: '', models: [''], modelsMode: 'separate', prices: {}, on: true }),
  prompts: () => ({ id: uid(), name: 'New prompt', text: '' }),
  pls: () => ({ id: uid(), name: 'New playlist', sys: '', e: [], cls: '', rule: '' }),
  cmds: () => ({ id: uid(), name: 'command', desc: '', in: 'text', sys: '', tpl: '{{input}}', pl: '', on: true }),
}
const ZERO = (): Stats => ({ tin: 0, tout: 0, historyIn: 0, explicitIn: 0, sent: 0, chats: 0, since: Date.now(), cost: 0 })
export const dl = (n: string, t: string, m: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], { type: m })); a.download = n; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 999) }
export const chatMd = (c: Chat) => `# ${c.title}\n\n` + c.msgs.map((m) => `**${m.r === 'user' ? 'You' : m.by || 'Assistant'}**\n\n${m.t}`).join('\n\n---\n\n')
export const exportChat = () => {
  const s = useS.getState(), c = s.chats.find((x) => x.id === s.chat)
  if (!c || !c.msgs.length) return s.patch({ notice: { t: 'This chat is empty, so there is nothing to export.' } })
  dl(c.title.replace(/[^\w-]+/g, '_') + '.md', chatMd(c), 'text/markdown')
}

type S = {
  eps: Ep[]; prompts: Prompt[]; pls: Pl[]; cmds: Cmd[]; chats: Chat[]; chat: string
  tools: Record<string, boolean>
  sel: { k: 'ep' | 'pl'; id: string; model?: string } | null; pr: string
  theme: keyof typeof THEMES
  customColors: ThemeColors
  setupDone: boolean; settingsScope: 'standard' | 'power-user'
  prefs: { showBy: boolean; showLog: boolean; showTps: boolean; enterSends: boolean; autoTitle: boolean; temporaryByDefault: boolean; showModelPricing: boolean; titleEp: string; titleModel?: string; fade: number; tempHours: number; fontBody: string; fontMono: string; fontHeader: string; modelDisplay: 'none' | 'name' | 'provider' | 'both'; paletteMax: number; chatWidth: 'narrow' | 'standard' | 'wide'; settingsWidth: number; settingsHeight: number; modelPickerHeight: number; sidebarWidth?: number; widgetWidth?: number; modalBlur: number; settingsOpacity: number }
  widgets: Record<string, boolean>; widgetPrefs: { usageGroup: 'endpoint' | 'model'; usageMode: 'success' | 'tokens'; usageFormat: string; usageTotal: boolean; usagePeriod: 'session' | 'day' | 'week' | 'custom' | 'all'; usageFrom?: string; usageTo?: string; lastSpeed: boolean; timeUnit: 'ms' | 's' | 'auto'; widgetOrder: string[]; shortcuts: string[]; contextLimit: number; showDisabledEndpoints: boolean; scratchRows: number; snippetLimit: number; costDecimals: number; activePromptsOnly: boolean; charsPerToken: number; hideDoneTodos: boolean }; rail: boolean; pad: string; snips: string[]
  params: { def: boolean; temp: number; topp: number; max: number }; effort: Record<string, string>
  stats: Stats; keys: Record<string, string>
  memories: Memory[]; memoryPrefs: { enabled: boolean; intent: 'intentional' | 'balanced' | 'aggressive'; recall: 'holistic' | 'contextual' | 'specific'; classifierEp: string; classifierModel: string }
  folders: Folder[]; price: { in: number; out: number }; todos: { id: string; t: string; done: boolean }[]
  draft: string; busy: boolean; notice: Notice
  patch: (p: Partial<S>) => void
  add: (k: Kind) => void
  upd: (k: Kind, id: string, p: object) => void
  del: (k: Kind, id: string) => void
  move: (k: Kind, id: string, d: number) => void
  newChat: (temporary?: boolean) => void
  chatOp: (id: string, op: 'pin' | 'del') => void
  send: (v: string, att: Att[]) => Promise<boolean>
  stop: () => void
  regen: () => void
  delMsg: (id: string) => void
  editMsg: (id: string, t: string) => void
  resetStats: () => void
  rename: (id: string, t: string) => void
  reorder: (k: Kind, from: string, to: string) => void
  addFolder: () => string
  renameFolder: (id: string, name: string) => void
  toggleFolder: (id: string) => void
  delFolder: (id: string) => void
  moveChat: (id: string, folder: string) => void
  branch: (mid: string) => void
  variant: (mid: string, idx: number) => void
}

const splitEntry = (ref: string) => { const i = ref.indexOf('::'); return i < 0 ? [ref, ''] : [ref.slice(0, i), ref.slice(i + 2)] }
const ents = (s: S, p: Pl) => p.e.flatMap((ref) => {
  const [id, model] = splitEntry(ref), e = s.eps.find((x) => x.id === id)
  if (!e) return []
  return (model ? [model] : modelsOf(e)).map((m) => ({ ...e, model: m }))
})
const body = (c: Cmd | undefined, t: string) => (!c?.tpl ? t : c.tpl.includes('{{input}}') ? c.tpl.split('{{input}}').join(t) : c.tpl + (t ? '\n\n' + t : ''))
const full = (b: string, ctx: string[] = [], fx = '') => b + (ctx.length ? '\n\n[tool results]\n' + ctx.join('\n') : '') + fx
const hint = (l: Try[]) => {
  const t = l.map((x) => x.err ?? '').join(' ')
  return /CORS/.test(t) ? '\n\nCORS or network error: check the base URL, your connection, and that the server allows browser requests.'
    : /HTTP 40[13]/.test(t) ? '\n\nThe key was rejected. Check it in Settings → Endpoints.'
    : /HTTP 404/.test(t) ? '\n\nNot found. Check the base URL and the model id.' : ''
}

const snap = (m: Msg): Snap => ({ t: m.t, by: m.by, tps: m.tps, log: m.log, err: m.err })
export const modelsOf = (e: Ep) => [...new Set((e.models?.length ? e.models : [e.model]).map((x) => x?.trim()).filter(Boolean))]
export const modelNameOf = (e: Ep, model: string) => {
  const name = e.modelNames?.[model]
  if (name) {
    const colon = name.indexOf(':')
    const prefix = colon >= 0 ? name.slice(0, colon).trim().toLowerCase() : ''
    if (prefix && [e.name, e.endpointId, model.split('/')[0]].some(owner => owner?.toLowerCase() === prefix)) return name.slice(colon + 1).trim()
    return name
  }
  return model.split('/').pop()!.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function plan(s: S, um: Msg) {
  const cmd = um.cmd ? s.cmds.find((c) => c.id === um.cmd) : undefined
  const sel = s.sel ? (s.sel.k === 'pl' ? s.pls : s.eps).find((x) => x.id === s.sel!.id) : undefined
  let pool: Ep[], pl: Pl | null = null, ex = false, tgt: string
  if (cmd) { pl = s.pls.find((p) => p.id === cmd.pl) ?? null; pool = pl ? ents(s, pl) : s.eps; tgt = '/' + cmd.name }
  else if (sel && s.sel!.k === 'ep') { pool = [sel as Ep]; ex = true; tgt = sel.name }
  else if (sel) { pl = sel as Pl; pool = ents(s, pl); tgt = 'playlist ' + pl.name }
  else { pool = s.eps; tgt = 'your endpoints' }
  const need = [...new Set((um.att ?? []).filter((a) => a.kind !== 'txt').map((a) => a.kind as 'img' | 'pdf'))]
  const ready = pool.filter(usable), cand = ready.filter((e) => need.every((n) => can(e, n))).flatMap((e) => modelsOf(e)
    .filter((model) => !(s.sel?.k === 'ep' && s.sel.id === e.id && s.sel.model) || s.sel?.model === model)
    .map((model) => ({ ...e, model })))
  const baseSys = cmd?.sys || s.prompts.find((x) => x.id === s.pr)?.text || (pl && !cmd ? pl.sys : '') || ''
  const enabledTools = TOOLS.filter(([name]) => s.tools[name] === true).map(([name]) => name)
  const sys = enabledTools.length ? `${baseSys}${baseSys ? '\n\n' : ''}You may use the enabled tools when needed to answer the user. Call a tool for requests that need its actual result, then base your answer on the returned result.` : baseSys
  let err: Notice = null
  if (!s.eps.length) err = { t: 'You have not added a model endpoint yet. Open Settings → Endpoints, choose a provider preset, paste your API key and the model id, then press Test connection. After that, send your message again.', tab: 'eps', label: 'Add an endpoint' }
  else if (!ready.length) err = { t: ex ? `${tgt} is disabled or incomplete. An endpoint must be enabled and have a base URL and a model id.` : `No endpoint in ${tgt} is ready. Enable one and make sure it has a base URL and a model id.`, tab: pl ? 'pls' : 'eps', label: 'Fix endpoints' }
  else if (!cand.length) err = { t: `Not sent: no ready endpoint in ${tgt} can process ${need.map((n) => (n === 'img' ? 'images' : 'PDFs')).join(' and ')}. Your attachments are still in the message box. Choose a compatible endpoint or model.`, tab: 'eps', label: 'Open endpoints' }
  return { cmd, pl, ex, sys, cand, err }
}

type Run = { stopped: boolean; ctl: AbortController | null }
let cur: Run | null = null
const storage = createJSONStorage(() => ({
  getItem: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  setItem: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* storage full or blocked */ } },
  removeItem: (k: string) => { try { localStorage.removeItem(k) } catch { /* ignore */ } },
}))

export const useS = create<S>()(
  persist(
    (set, get) => {
      const bump = (tin: number, tout: number, historyIn = tin, explicitIn = 0) => set((s) => ({ stats: { ...s.stats, tin: s.stats.tin + tin, tout: s.stats.tout + tout, historyIn: s.stats.historyIn + historyIn, explicitIn: s.stats.explicitIn + explicitIn } }))
      const addCost = (e: Ep, model: string, tin: number, tout: number) => {
        const price = e.prices?.[model]
        if (price) set((s) => ({ stats: { ...s.stats, cost: s.stats.cost + (tin * price.input + tout * price.output) / 1e6 } }))
      }
      const edit = (id: string, mid: string, f: (m: Msg) => Msg) => set((s) => ({ chats: s.chats.map((c) => (c.id === id ? { ...c, msgs: c.msgs.map((m) => (m.id === mid ? f(m) : m)) } : c)) }))
      const warn = (n: Notice) => { set({ notice: n }); return false }

      async function generateTitle(chatId: string, usedEp?: Ep, responseStart = '') {
        const s = get()
        if (!s.prefs.autoTitle) return
        const chat = s.chats.find(c => c.id === chatId)
        if (!chat || chat.msgs.length < 1 || (!chat.titleAuto && chat.title !== 'New chat')) return

        let ep = usedEp
        if (s.prefs.titleEp) {
          const customEp = s.eps.find(e => e.id === s.prefs.titleEp && usable(e))
          if (customEp) ep = { ...customEp, model: s.prefs.titleModel && modelsOf(customEp).includes(s.prefs.titleModel) ? s.prefs.titleModel : customEp.model }
        }
        if (!ep || !usable(ep)) {
          ep = s.eps.find(usable)
        }
        if (!ep) return

        const promptMessages = chat.msgs.filter(m => m.r === 'user' || m.t).slice(0, 4).map(m => ({
          role: m.r === 'user' ? 'user' as const : 'assistant' as const,
          content: m.t || '[attachment]'
        }))
        if (responseStart && !promptMessages.some(m => m.role === 'assistant')) promptMessages.push({ role: 'assistant', content: responseStart.slice(0, 500) })
        promptMessages.push({ role: 'user', content: 'Give this conversation a brief, specific 3–6 word title. Use the fewest words needed to name the central topic. Avoid unnecessary adjectives and promotional words (for example, use “Markdown Syntax Reference,” not “Comprehensive Markdown Syntax Reference”). Paraphrase the topic; never repeat the latest user message verbatim. Return only the title.' })

        try {
          const ctrl = new AbortController()
          const res = await stream(ep, 'Create a brief, specific topic label for the conversation. Use the fewest words needed to name the central topic. Avoid unnecessary adjectives and promotional words. Do not copy the user message verbatim. Return only a 3 to 6 word title.', promptMessages, () => {}, ctrl, { cap: 30 })
          let title = res.text.trim().replace(/^["']|["']$/g, '')
          const firstUser = chat.msgs.find(m => m.r === 'user')?.t.trim()
          if (firstUser && title.toLowerCase() === firstUser.toLowerCase()) title = `Chat about ${firstUser}`
          if (title) {
            set(state => ({ chats: state.chats.map(c => c.id === chatId && (c.titleAuto || c.title === 'New chat') ? { ...c, title: title.slice(0, 60), titleAuto: false } : c) }))
          }
        } catch {
          // Ignore title generation errors silently
        }
      }

      async function route(pl: Pl, cand: Ep[], q: string, log: Try[], r: Run) {
        const selected = get().eps.find((e) => e.id === pl.cls && usable(e))
        const c = selected ? { ...selected, model: pl.clsModel && modelsOf(selected).includes(pl.clsModel) ? pl.clsModel : selected.model } : undefined
        if (!c) { log.push({ n: 'Classifier', m: '', err: 'endpoint is missing, disabled or incomplete; using list order' }); return cand }
        const ids = [...new Set(cand.map((e) => e.model))], t0 = Date.now()
        try {
          r.ctl = new AbortController()
          const x = await stream(c, `Choose the best model for the user's request. ${pl.rule || ''}\nAllowed model ids: ${JSON.stringify(ids)}\nReply with only JSON: {"model":"<one allowed id>"}`, [{ role: 'user', content: q.slice(0, 4000) }], () => {}, r.ctl, { cap: 200 })
          bump(x.tin, x.tout)
          addCost(c, c.model, x.tin, x.tout)
          const j = JSON.parse(x.text.match(/\{[\s\S]*\}/)?.[0] ?? '')
          if (!j || typeof j !== 'object' || Object.keys(j).join() !== 'model' || !ids.includes(j.model)) throw Error('output rejected (wrong shape, or an id outside this playlist): ' + x.text.slice(0, 80))
          log.push({ n: c.name + ' (classifier)', m: c.model, detail: `Compared the request (${q.slice(0, 4000).length} characters) against ${ids.length} allowed model IDs using playlist rule${pl.rule ? `: “${pl.rule.slice(0, 180)}${pl.rule.length > 180 ? '…' : ''}”` : ' (no custom rule)'}.`, ms: Date.now() - t0, tin: x.tin, tout: x.tout, at: Date.now() })
          const f = cand.find((e) => e.model === j.model)!
          return [f, ...cand.filter((e) => e !== f)]
        } catch (x: any) {
          if (!r.stopped) log.push({ n: c.name + ' (classifier)', m: c.model, ms: Date.now() - t0, err: redact(c, x.message), at: Date.now() })
          return cand
        }
      }

      async function answer(um: Msg, prev?: Snap[]) {
        const s = get(), id = s.chat, p = plan(s, um)
        if (p.err) { set({ notice: p.err }); return }
        const r: Run = { stopped: false, ctl: null }
        cur = r
        const mid = uid(), log: Try[] = []
        set((st) => ({ busy: true, notice: null, chats: st.chats.map((c) => (c.id === id ? { ...c, msgs: [...c.msgs, { id: mid, r: 'assistant', t: '', at: Date.now(), by: '', log: [], ...(prev ? { alts: prev, ai: prev.length } : {}) }] } : c)) }))
        const hist = () => (get().chats.find((c) => c.id === id)?.msgs ?? []).filter((m) => m.id !== mid)
        let order = p.cand, ok = false, usedEp: Ep | undefined, system = p.sys
        const memoryState = get(), mp = memoryState.memoryPrefs
        // Capture the memory context decision for the visible process log without exposing memory text.
        let memoryTrace: string | undefined
        if (mp.enabled) system += `${system ? '\n\n' : ''}Memory tool policy: memories are user-controlled local data. Use action list to find exact IDs before updating or deleting; never guess an ID. Use add only for short, summarized durable details. ${mp.intent === 'intentional' ? 'Add only when the user explicitly asks you to remember something.' : mp.intent === 'balanced' ? 'Add details the user explicitly asks you to remember and important durable information they disclose.' : 'Add explicit requests, important disclosures, and smaller useful preferences or details.'} Update or delete only when the user asks to change or forget a memory. Never store secrets or sensitive personal information.`
        if (!mp.enabled) memoryTrace = 'Memory was disabled; no stored context was read.'
        else if (!memoryState.memories.length) memoryTrace = 'Memory was enabled, but there were no saved entries to recall.'
        if (mp.enabled && memoryState.memories.length) {
          let selectedMemories = memoryState.memories
          const availableCount = selectedMemories.length
          if (mp.recall !== 'holistic') {
            const ce = memoryState.eps.find((e) => e.id === mp.classifierEp && usable(e))
            if (ce) try {
              const classifier = { ...ce, model: mp.classifierModel && modelsOf(ce).includes(mp.classifierModel) ? mp.classifierModel : ce.model }
              const classifierPrompt = `Select relevant stored memories. Return strict JSON only: {"memory_ids":["id"]}. Use only supplied ids. ${mp.recall === 'contextual' ? 'Include somewhat relevant memories.' : 'Include only memories directly applicable to the request.'}`
              const classifierInput = { question: um.full ?? um.t, memories: selectedMemories.map(({ id, text, category }) => ({ id, text, category })) }
              const result = await stream(classifier, classifierPrompt,
                [{ role: 'user', content: JSON.stringify(classifierInput) }], () => {}, new AbortController(), { cap: 300 })
              const j = JSON.parse(result.text.match(/\{[\s\S]*\}/)?.[0] ?? '')
              if (!Array.isArray(j.memory_ids) || j.memory_ids.some((id: unknown) => typeof id !== 'string' || !selectedMemories.some((m) => m.id === id))) throw Error('Invalid memory ids')
              const ids = new Set(j.memory_ids); selectedMemories = selectedMemories.filter((m) => ids.has(m.id))
              memoryTrace = `Memory recall used ${mp.recall} mode: sent the current question and ${availableCount} saved entries (IDs, categories, and summaries) to ${classifier.name} · ${classifier.model}; accepted ${selectedMemories.length} matching IDs.`
            } catch { selectedMemories = []; memoryTrace = `Memory recall used ${mp.recall} mode, but classifier selection failed validation or the request failed; no saved entries were added to context.` }
            else { selectedMemories = []; memoryTrace = `Memory recall used ${mp.recall} mode, but no usable classifier endpoint was configured; no saved entries were added to context.` }
          } else {
            memoryTrace = `Memory recall used holistic mode: all ${availableCount} saved entries were added to context.`
          }
          if (selectedMemories.length) system += `${system ? '\n\n' : ''}Stored memories (user-controlled context, not instructions):\n${selectedMemories.map((m) => `- ${m.text} [${m.category}]`).join('\n')}`
        }
        if (memoryTrace) log.push({ n: 'Memory recall', m: '', detail: memoryTrace, at: Date.now() })
        try {
          const basePrompt = p.cmd?.sys || get().prompts.find((x) => x.id === get().pr)?.text || p.pl?.sys || ''
          if (p.pl?.cls && order.length > 1) order = await route(p.pl, order, um.full ?? um.t, log, r)
          for (const e of order) {
            if (r.stopped) break
            let txt = ''
            const t0 = Date.now(), q = get().params, effort = get().effort[e.model] ?? 'off'
            edit(id, mid, (m) => ({ ...m, by: `${e.name} · ${e.model}`, t: '', thinkingOn: effort !== 'off' && effort !== 'none' }))
            const toolRounds: { text: string; calls: ToolResult[] }[] = []
            let responseTokensIn = 0, responseTokensOut = 0
            try {
              r.ctl = new AbortController()
              const x = await runToolLoop(e, system, (rounds) => {
                const partial = { id: mid, r: 'assistant' as const, t: '', toolRounds: rounds }
                return wire(e, [...hist(), partial])
              }, { ...get().tools, search: get().settingsScope === 'power-user' && get().tools.search, memory: get().memoryPrefs.enabled }, (t) => {
                txt += t
                const at = performance.now(), duration = get().prefs.fade * 1000
                edit(id, mid, (m) => ({ ...m, t: txt, fadeEvents: duration > 0 && /\S/.test(t)
                  ? [...(m.fadeEvents ?? []).filter((x) => at - x.at < duration), { text: t, at }]
                  : (m.fadeEvents ?? []).filter((x) => at - x.at < duration) }))
              }, r.ctl, { ...(q.def ? {} : { max: q.max, temp: q.temp, topp: q.topp }), effort }, (summary) => {
                edit(id, mid, (m) => ({ ...m, reasoning: (m.reasoning ?? '') + summary }))
              }, (rounds) => {
                toolRounds.splice(0, toolRounds.length, ...rounds)
                edit(id, mid, (m) => ({ ...m, toolRounds: [...rounds] }))
              }, 8, {
                memory: ({ action, id, text, category }: { action: 'list' | 'add' | 'update' | 'delete'; id?: string; text?: string; category?: string }) => {
                const state = get(), prefs = state.memoryPrefs
                if (!prefs.enabled) throw Error('Memory is disabled')
                if (action === 'list') return state.memories.length ? state.memories.map((m) => `${m.id} | ${m.category} | ${m.text}`).join('\n') : 'No memories are stored.'
                if (action === 'add') {
                  const explicit = /\b(remember that|please remember|remember this|don't forget)\b/i.test(um.t)
                  if (prefs.intent === 'intentional' && !explicit) throw Error('Intentional memory mode only stores details the user explicitly asked to remember')
                  if (typeof text !== 'string' || !text.trim()) throw Error('Provide a concise memory summary')
                  const now = Date.now(), memory: Memory = { id: uid(), text: text.trim().slice(0, 500), category: String(category || 'General').trim().slice(0, 60) || 'General', createdAt: now, updatedAt: now }
                  set((current) => ({ memories: [...current.memories, memory] }))
                  return `Stored memory ${memory.id}: ${memory.text}`
                }
                if (!id) throw Error(`Provide the exact memory id to ${action}`)
                const current = state.memories.find((m) => m.id === id)
                if (!current) throw Error(`No memory found with id ${id}`)
                if (action === 'delete') {
                  set((s) => ({ memories: s.memories.filter((m) => m.id !== id) }))
                  return `Deleted memory ${id}: ${current.text}`
                }
                if (action === 'update') {
                  if (typeof text !== 'string' || !text.trim()) throw Error('Provide the revised memory summary')
                  const updated = { ...current, text: text.trim().slice(0, 500), category: category == null ? current.category : String(category).trim().slice(0, 60) || 'General', updatedAt: Date.now() }
                  set((s) => ({ memories: s.memories.map((m) => m.id === id ? updated : m) }))
                  return `Updated memory ${id}: ${updated.text} [${updated.category}]`
                }
                throw Error('Choose list, add, update, or delete')
              } })
              txt = x.text
              responseTokensIn = x.tin; responseTokensOut = x.tout
              const current = get().chats.find(c => c.id === id)
              if (txt.trim() && current && (current.titleAuto || current.title === 'New chat' || !current.title)) void generateTitle(id, e, txt)
              const elapsed = Date.now() - t0
              const toolElapsed = toolRounds.reduce((total, round) => total + Math.max(0, ...round.calls.map((call) => call.ms ?? 0)), 0)
              log.push({ n: e.name, m: e.model, detail: `Answered with ${(um.att ?? []).length} attachments and ${Object.values(get().tools).filter(Boolean).length} enabled tools`, ms: Math.max(0, elapsed - toolElapsed), tin: responseTokensIn, tout: responseTokensOut, at: Date.now() })
              const sum = (um.historyTokens ?? 0) + (um.explicitTokens ?? 0), explicit = sum ? Math.round(x.tin * (um.explicitTokens ?? 0) / sum) : 0
              bump(responseTokensIn, responseTokensOut, responseTokensIn - explicit, explicit); ok = true
              addCost(e, e.model, responseTokensIn, responseTokensOut)
              edit(id, mid, (m) => ({ ...m, tps: Math.round(responseTokensOut / Math.max(elapsed / 1000, 0.001) * 10) / 10, toolRounds, ...(toolRounds.length ? { toolFinal: x.text } : {}) }))
              usedEp = e
              break
            } catch (x: any) {
              if (r.stopped) { if (txt) bump(0, est(txt)); break }
              const elapsed = Date.now() - t0
              const toolElapsed = toolRounds.reduce((total, round) => total + Math.max(0, ...round.calls.map((call) => call.ms ?? 0)), 0)
              log.push({ n: e.name, m: e.model, ms: Math.max(0, elapsed - toolElapsed), err: redact(e, x.message), at: Date.now() })
              if (p.ex) break
            }
          }
        } catch (x: any) { log.push({ n: 'engine', m: '', err: String(x?.message ?? x) }) }
        edit(id, mid, (m) => r.stopped
          ? { ...m, log, by: m.by ? m.by + ' (stopped)' : 'Stopped', t: m.t || '(stopped before any text arrived)' }
          : ok ? { ...m, log }
          : { ...m, log, err: true, by: 'No model responded', t: log.filter((x) => x.err).map((x) => `${x.n}${x.m ? ' · ' + x.m : ''}: ${x.err}`).join('\n') + hint(log) })
        if (prev) edit(id, mid, (m) => ({ ...m, alts: [...prev, snap(m)], ai: prev.length }))
        if (cur === r) { cur = null; set({ busy: false }) }
      }

      return {
        eps: [], pls: [],
        prompts: [
          { id: 's1', name: 'Concise', text: 'Answer briefly and directly. Skip preamble.' },
          { id: 's2', name: 'Code review', text: 'Review the code for bugs, edge cases and unclear naming. List findings by severity.' },
          { id: 's3', name: 'Coding', text: 'You are a capable software engineer and product-minded frontend designer. First understand the request, existing code, constraints, and project conventions; inspect before changing, preserve working behavior, and make the smallest complete implementation. For UI work, ground the design in the product and audience, choose a deliberate visual direction, and use hierarchy, typography, color, spacing, and motion with intent. Avoid generic template layouts, repetitive cards, decorative labels, and default-looking controls; make every element earn its place. Build responsive, accessible interfaces with clear focus states, keyboard support, reduced-motion handling, and consistent custom controls. Use semantic, maintainable code; handle errors and edge cases; explain important tradeoffs briefly. Verify changes with appropriate checks when asked, and report what changed and what remains uncertain.' },
        ],
        cmds: [
          { id: 'k1', name: 'describe', desc: 'Describe an image', in: 'image', sys: 'Describe images accurately and objectively.', tpl: 'Describe this image.', pl: '', on: true },
          { id: 'k2', name: 'summarize', desc: 'Summarize a document', in: 'doc', sys: 'Summarize documents faithfully in under 150 words.', tpl: 'Summarize the attached document. {{input}}', pl: '', on: true },
          { id: 'k3', name: 'ask', desc: 'Ask about an image', in: 'image+text', sys: '', tpl: '{{input}}', pl: '', on: false },
          { id: 'k4', name: 'explain', desc: 'Explain a concept clearly', in: 'text', sys: 'Explain the topic clearly, define unfamiliar terms, and use a concrete example.', tpl: '{{input}}', pl: '', on: true },
          { id: 'k5', name: 'rewrite', desc: 'Rewrite text for clarity', in: 'text', sys: 'Rewrite the provided text for clarity and flow while preserving its meaning. Return only the rewrite.', tpl: '{{input}}', pl: '', on: true },
          { id: 'k6', name: 'translate', desc: 'Translate text', in: 'text', sys: 'Translate the provided text into the language requested. If no target language is specified, ask which language.', tpl: '{{input}}', pl: '', on: true },
          { id: 'k7', name: 'brainstorm', desc: 'Generate useful ideas', in: 'text', sys: 'Generate varied, practical ideas. Keep each idea distinct and briefly explain why it may work.', tpl: '{{input}}', pl: '', on: true },
        ],
        chats: [], chat: '', memories: [], memoryPrefs: { enabled: false, intent: 'balanced', recall: 'contextual', classifierEp: '', classifierModel: '' }, tools: { ...DEFAULT_TOOLS }, widgets: {}, widgetPrefs: { usageGroup: 'endpoint', usageMode: 'success', usageFormat: '{in}/{out}', usageTotal: false, usagePeriod: 'all', lastSpeed: true, timeUnit: 'auto', widgetOrder: WIDGETS.map(([k]) => k), shortcuts: KEYS.map(([k]) => k), contextLimit: 128000, showDisabledEndpoints: true, scratchRows: 6, snippetLimit: 20, costDecimals: 4, activePromptsOnly: false, charsPerToken: 4, hideDoneTodos: false }, rail: false, pad: '', snips: [],
        params: { def: true, temp: 0.7, topp: 1, max: 4096 }, effort: {},
        sel: null, pr: '', theme: 'plum', customColors: { ...DEFAULT_CUSTOM_COLORS }, setupDone: false, settingsScope: 'standard', prefs: { showBy: true, showLog: true, showTps: false, enterSends: true, autoTitle: true, temporaryByDefault: false, showModelPricing: false, titleEp: '', titleModel: '', fade: 0.4, tempHours: 3, fontBody: 'system', fontMono: 'system', fontHeader: 'system', modelDisplay: 'both', paletteMax: 320, chatWidth: 'standard', settingsWidth: 1024, settingsHeight: 780, modelPickerHeight: 480, sidebarWidth: 288, widgetWidth: 320, modalBlur: 12, settingsOpacity: 55 },
        stats: ZERO(), keys: Object.fromEntries(KEYS.map(([k, , d]) => [k, d])),
        folders: [], price: { in: 0, out: 0 }, todos: [],
        draft: '', busy: false, notice: null,

        patch: (p) => set(p),
        add: (k) => set((s) => ({ [k]: [...(s[k] as any[]), BLANK[k]()] }) as Partial<S>),
        upd: (k, id, p) => set((s) => ({ [k]: (s[k] as any[]).map((x) => (x.id === id ? { ...x, ...p } : x)) }) as Partial<S>),
        del: (k, id) => set((s) => {
          const n: any = { [k]: (s[k] as any[]).filter((x) => x.id !== id) }
          if (k === 'eps') n.pls = s.pls.map((p) => ({ ...p, e: p.e.filter((x) => splitEntry(x)[0] !== id), cls: p.cls === id ? '' : p.cls, clsModel: p.cls === id ? '' : p.clsModel }))
          if (k === 'pls') n.cmds = s.cmds.map((c) => (c.pl === id ? { ...c, pl: '' } : c))
          if (s.sel?.id === id) n.sel = null
          if (s.pr === id) n.pr = ''
          return n
        }),
        move: (k, id, d) => set((s) => {
          const a = [...(s[k] as any[])], i = a.findIndex((x) => x.id === id), j = i + d
          if (i < 0 || j < 0 || j >= a.length) return s
          ;[a[i], a[j]] = [a[j], a[i]]
          return { [k]: a } as Partial<S>
        }),
        newChat: (temporary) => set((s) => {
          temporary ??= s.prefs.temporaryByDefault
          const c = s.chats.find((x) => x.id === s.chat)
          if (c && !c.msgs.length && !temporary && !c.temporary) return { notice: null }
          const n: Chat = { id: uid(), title: temporary ? 'Temporary chat' : 'New chat', msgs: [], temporary, expiresAt: temporary && s.prefs.tempHours > 0 ? Date.now() + s.prefs.tempHours * 3600000 : undefined }
          return { chats: [n, ...s.chats.filter((x) => !(x.temporary && s.prefs.tempHours === 0))], chat: n.id, notice: null }
        }),
        chatOp: (id, op) => set((s) => {
          const chats = op === 'del' ? s.chats.filter((c) => c.id !== id) : s.chats.map((c) => (c.id === id ? { ...c, pin: !c.pin } : c))
          return { chats, chat: s.chat === id && op === 'del' ? chats[0]?.id ?? '' : s.chat }
        }),

        send: async (v, att) => {
          const s = get()
          if (s.busy) return false
          const raw = v.trim()
          if (!raw && !att.length) return false
          let text = raw, cmd: Cmd | undefined
          const m = v.match(/^\/(\S+)(?:\s+([\s\S]*))?$/)
          if (m) {
            if (s.settingsScope !== 'power-user') return warn({ t: 'Slash commands are available in Power user settings.' })
            cmd = s.cmds.find((c) => c.name === m[1])
            if (!cmd) return warn({ t: `/${m[1]} is not a saved command. Start the message with a space to send it as plain text.`, tab: 'cmds', label: 'Manage commands' })
            if (!cmd.on) return warn({ t: `/${cmd.name} is disabled. Enable it in Settings → Commands.`, tab: 'cmds', label: 'Open commands' })
            text = (m[2] ?? '').trim()
            const i = att.some((a) => a.kind === 'img'), d = att.some((a) => a.kind !== 'img')
            const miss = { text: !text && 'text', image: !i && 'an image', 'image+text': (!i || !text) && 'an image and some text', doc: !d && 'a document (PDF or text file)' }[cmd.in]
            if (miss) return warn({ t: `/${cmd.name} needs ${miss}. Attach it with the + button, then send again.` })
          }
          const um: Msg = { id: uid(), r: 'user', t: raw, at: Date.now(), att, cmd: cmd?.id }
          const pre = plan(s, um)
          if (pre.err) return warn(pre.err)
          um.ctx = []
          if (s.settingsScope === 'power-user' && s.tools.search && shouldSearchWeb(text)) {
            try { um.ctx.push(formatSearch(await searchWeb(text))) }
            catch (x: any) { um.ctx.push(`Web search was unavailable: ${x?.message ?? 'unknown error'}. Answer without claiming live verification.`) }
          }
          um.fx = att.filter((a) => a.kind === 'txt').map((a) => `\n\n[file: ${a.name}]\n${a.text ?? ''}`).join('')
          um.full = full(body(cmd, text), um.ctx, um.fx)
          const previous = s.chats.find((c) => c.id === s.chat)?.msgs ?? []
          um.historyTokens = est(JSON.stringify(wire(s.eps.find(usable)!, previous)))
          um.explicitTokens = est(um.full + JSON.stringify(att.map(a => ({ name: a.name, text: a.text }))))
          set((st) => {
            const old = st.chats.find((c) => c.id === st.chat)
            const base: Chat = old ?? { id: uid(), title: 'New chat', msgs: [] }
            const next: Chat = { ...base, started: true, titleAuto: base.msgs.length ? base.titleAuto : st.prefs.autoTitle, title: base.msgs.length ? base.title : (raw || att[0]?.name || 'New chat').slice(0, 40), msgs: [...base.msgs, um] }
            return { chat: base.id, chats: old ? st.chats.map((c) => (c.id === base.id ? next : c)) : [next, ...st.chats], notice: null, stats: { ...st.stats, sent: st.stats.sent + 1, chats: st.stats.chats + (base.started ? 0 : 1) } }
          })
          void answer(um)
          return true
        },
        stop: () => { if (cur) { cur.stopped = true; cur.ctl?.abort() } set({ busy: false }) },
        regen: () => {
          const s = get(), c = s.chats.find((x) => x.id === s.chat)
          if (s.busy || !c) return
          let i = c.msgs.length - 1
          while (i >= 0 && c.msgs[i].r !== 'user') i--
          if (i < 0) return
          const um = c.msgs[i], pre = plan(s, um)
          if (pre.err) { set({ notice: pre.err }); return }
          const old = c.msgs.slice(i + 1).find((m) => m.r === 'assistant')
          const prev = old ? old.alts ?? [snap(old)] : undefined
          set({ chats: s.chats.map((x) => (x.id === c.id ? { ...x, msgs: c.msgs.slice(0, i + 1) } : x)) })
          void answer(um, prev)
        },
        delMsg: (id) => set((s) => ({ chats: s.chats.map((c) => ({ ...c, msgs: c.msgs.filter((m) => m.id !== id) })) })),
        editMsg: (id, t) => {
          const s = get(), c = s.chats.find((x) => x.id === s.chat), i = c ? c.msgs.findIndex((m) => m.id === id) : -1
          if (!c || i < 0) return
          if (s.busy) { set({ notice: { t: 'Stop the current reply before editing a message.' } }); return }
          const o = c.msgs[i]
          if (!t.trim() && !o.att?.length) return
          const m = t.match(/^\/(\S+)(?:\s+([\s\S]*))?$/), cmd = s.settingsScope === 'power-user' ? m ? s.cmds.find((x) => x.name === m[1]) : s.cmds.find((x) => x.id === o.cmd) : undefined
          const um: Msg = { ...o, t: t.trim(), cmd: cmd?.id, full: full(body(cmd, m && cmd ? (m[2] ?? '').trim() : t.trim()), o.ctx, o.fx) }
          { const pre = plan(s, um); if (pre.err) { set({ notice: pre.err }); return } }
          set((st) => ({ chats: st.chats.map((x) => (x.id === c.id ? { ...x, msgs: [...c.msgs.slice(0, i), um] } : x)), stats: { ...st.stats, sent: st.stats.sent + 1 } }))
          void answer(um)
        },
        resetStats: () => set({ stats: ZERO() }),
        rename: (id, t) => set((s) => ({ chats: s.chats.map((c) => (c.id === id ? { ...c, title: t.slice(0, 80), titleAuto: false } : c)) })),
        reorder: (k, f, t) => set((s) => {
          const a = [...(s[k] as any[])], i = a.findIndex((x) => x.id === f), j = a.findIndex((x) => x.id === t)
          if (i < 0 || j < 0 || i === j) return s
          const [x] = a.splice(i, 1); a.splice(j, 0, x)
          return { [k]: a } as Partial<S>
        }),
        addFolder: () => { const id = uid(); set((s) => ({ folders: [...s.folders, { id, name: 'New folder', open: true }] })); return id },
        renameFolder: (id, name) => set((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...f, name: name.slice(0, 40) } : f)) })),
        toggleFolder: (id) => set((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...f, open: !f.open } : f)) })),
        delFolder: (id) => set((s) => ({ folders: s.folders.filter((f) => f.id !== id), chats: s.chats.map((c) => (c.folder === id ? { ...c, folder: undefined } : c)) })),
        moveChat: (id, folder) => set((s) => ({ chats: s.chats.map((c) => (c.id === id ? { ...c, folder: folder || undefined } : c)) })),
        branch: (mid) => set((s) => {
          const c = s.chats.find((x) => x.msgs.some((m) => m.id === mid))
          if (!c) return s
          const i = c.msgs.findIndex((m) => m.id === mid)
          const n: Chat = { id: uid(), title: (c.title + ' (branch)').slice(0, 80), folder: c.folder, started: true, msgs: c.msgs.slice(0, i + 1).map((m) => ({ ...m, id: uid() })) }
          return { chats: [n, ...s.chats], chat: n.id }
        }),
        variant: (mid, idx) => set((s) => ({ chats: s.chats.map((c) => ({ ...c, msgs: c.msgs.map((m) => { const v = m.alts?.[idx]; return m.id === mid && v ? { ...m, ...v, ai: idx } : m }) })) }))
      }
    },
    {
      name: 'byok.v1', version: 13, storage,
      migrate: (p: any, v: number) => {
        if (v < 11) {
          const hasUserData = !!(p.eps?.length || p.chats?.length || p.pls?.length || p.prompts?.some((x: any) => !['s1','s2','s3'].includes(x.id)))
          p.setupDone = hasUserData
          p.settingsScope ??= 'standard'
        }
        p.customColors = { ...DEFAULT_CUSTOM_COLORS, ...(p.customColors ?? {}) }
        p.eps = (p.eps ?? []).map((e: Ep) => {
          const oldGoogle = e.preset === 'Gemini' || (/generativelanguage\.googleapis\.com/i.test(e.url) && e.name === 'Gemini')
          const preset = oldGoogle ? 'Google' : e.preset
          const endpointId = e.endpointId ?? (preset ? PRE[preset]?.[2] : '')
          const directAuthor = !/openrouter\.ai/i.test(e.url) && (e.endpointFilter ?? (preset ? PRE[preset]?.[3] : 'author')) === 'author' ? endpointId : ''
          const strip = (id: string) => directAuthor && id.toLowerCase().startsWith(`${directAuthor.toLowerCase()}/`) ? id.slice(directAuthor.length + 1) : id
          const remap = (obj?: Record<string, any>) => obj ? Object.fromEntries(Object.entries(obj).map(([id, value]) => [strip(id), value])) : obj
          return { ...e, ...(preset ? { preset } : {}), name: oldGoogle && e.name === 'Gemini' ? 'Google' : e.name, endpointId, endpointFilter: e.endpointFilter ?? (preset ? PRE[preset]?.[3] : undefined), model: strip(e.model), models: e.models?.map(strip), modelNames: remap(e.modelNames), modelEfforts: remap(e.modelEfforts), modelEffortSource: remap(e.modelEffortSource), prices: remap(e.prices) }
        })
        if (p.effort) p.effort = Object.fromEntries(Object.entries(p.effort).map(([id, value]: [string, any]) => [id, typeof value === 'number' ? (value <= 0 ? 'off' : value < 34 ? 'low' : value < 68 ? 'medium' : 'high') : value]))
        delete p.allow
        delete p.fetchMode
        if (p.tools) delete p.tools.fetch
        if (v < 2) {
          p.eps = (p.eps ?? []).filter((e: any) => !(['e1', 'e2'].includes(e.id) && !e.key))
          p.pls = (p.pls ?? []).filter((x: any) => x.id !== 'p1')
          p.chats = (p.chats ?? []).filter((c: any) => !['c1', 'c2', 'c3'].includes(c.id))
          p.sel = null; p.chat = ''
        }
        if (p.prefs && p.prefs.autoTitle === undefined) {
          p.prefs.autoTitle = true
          p.prefs.titleEp = ''
        }
        if (p.prefs && p.prefs.showTps === undefined) p.prefs.showTps = false
        p.prefs = { ...p.prefs, fade: p.prefs?.fade ?? 0.4, tempHours: p.prefs?.tempHours ?? 3, fontBody: p.prefs?.fontBody ?? 'system', fontMono: p.prefs?.fontMono ?? 'system', fontHeader: p.prefs?.fontHeader ?? 'system', modelDisplay: p.prefs?.modelDisplay ?? 'both', paletteMax: p.prefs?.paletteMax ?? 320, chatWidth: p.prefs?.chatWidth ?? 'standard', settingsWidth: p.prefs?.settingsWidth ?? 1024, settingsHeight: p.prefs?.settingsHeight ?? 780, modelPickerHeight: p.prefs?.modelPickerHeight ?? 480, showModelPricing: p.prefs?.showModelPricing ?? false, titleModel: p.prefs?.titleModel ?? '', sidebarWidth: p.prefs?.sidebarWidth ?? 288, widgetWidth: p.prefs?.widgetWidth ?? 320, modalBlur: p.prefs?.modalBlur ?? 12, settingsOpacity: p.prefs?.settingsOpacity ?? 55, temporaryByDefault: p.prefs?.temporaryByDefault ?? false }
        p.tools = { ...DEFAULT_TOOLS, ...(p.tools ?? {}) }
        p.memories = Array.isArray(p.memories) ? p.memories : []
        p.memoryPrefs = { enabled: false, intent: 'balanced', recall: 'contextual', classifierEp: '', classifierModel: '', ...(p.memoryPrefs ?? {}) }
        p.widgetPrefs = { usageGroup: 'endpoint', usageMode: 'success', usageFormat: '{in}/{out}', usageTotal: false, usagePeriod: 'all', lastSpeed: true, timeUnit: 'auto', widgetOrder: WIDGETS.map(([k]) => k), shortcuts: KEYS.map(([k]) => k), contextLimit: 128000, showDisabledEndpoints: true, scratchRows: 6, snippetLimit: 20, costDecimals: 4, activePromptsOnly: false, charsPerToken: 4, hideDoneTodos: false, ...(p.widgetPrefs ?? {}) }
        p.widgetPrefs.widgetOrder = [...new Set([...(p.widgetPrefs.widgetOrder ?? []), ...WIDGETS.map(([k]) => k)])]
        p.stats = { ...ZERO(), ...p.stats }
        p.eps = (p.eps ?? []).map((e: Ep) => ({ ...e, modelsMode: e.modelsMode ?? 'separate', models: e.models?.length ? e.models : [e.model], modelNames: e.modelNames ?? {}, prices: e.prices ?? {} }))
        p.pls = (p.pls ?? []).map((pl: Pl) => ({ ...pl, e: (pl.e ?? []).flatMap((ref) => {
          if (ref.includes('::')) return [ref]
          const ep = p.eps.find((item: Ep) => item.id === ref)
          return ep ? modelsOf(ep).map((model) => `${ep.id}::${model}`) : [ref]
        }) }))
        if (Array.isArray(p.prompts) && !p.prompts.some((x: Prompt) => x.id === 's3')) {
          p.prompts.push({ id: 's3', name: 'Coding', text: 'You are a capable software engineer and product-minded frontend designer. First understand the request, existing code, constraints, and project conventions; inspect before changing, preserve working behavior, and make the smallest complete implementation. For UI work, ground the design in the product and audience, choose a deliberate visual direction, and use hierarchy, typography, color, spacing, and motion with intent. Avoid generic template layouts, repetitive cards, decorative labels, and default-looking controls; make every element earn its place. Build responsive, accessible interfaces with clear focus states, keyboard support, reduced-motion handling, and consistent custom controls. Use semantic, maintainable code; handle errors and edge cases; explain important tradeoffs briefly. Verify changes with appropriate checks when asked, and report what changed and what remains uncertain.' })
        }
        if (Array.isArray(p.prompts)) p.prompts = p.prompts.map((x: Prompt) => x.id === 's3' && x.text === 'You are a skilled coding assistant. Write correct, maintainable code that fits the existing project conventions. Explain important tradeoffs briefly, preserve existing behavior unless asked to change it, and call out assumptions when needed.' ? { ...x, text: 'You are a capable software engineer and product-minded frontend designer. First understand the request, existing code, constraints, and project conventions; inspect before changing, preserve working behavior, and make the smallest complete implementation. For UI work, ground the design in the product and audience, choose a deliberate visual direction, and use hierarchy, typography, color, spacing, and motion with intent. Avoid generic template layouts, repetitive cards, decorative labels, and default-looking controls; make every element earn its place. Build responsive, accessible interfaces with clear focus states, keyboard support, reduced-motion handling, and consistent custom controls. Use semantic, maintainable code; handle errors and edge cases; explain important tradeoffs briefly. Verify changes with appropriate checks when asked, and report what changed and what remains uncertain.' } : x)
        if (Array.isArray(p.cmds)) {
          const defaults: Cmd[] = [
            { id: 'k4', name: 'explain', desc: 'Explain a concept clearly', in: 'text', sys: 'Explain the topic clearly, define unfamiliar terms, and use a concrete example.', tpl: '{{input}}', pl: '', on: true },
            { id: 'k5', name: 'rewrite', desc: 'Rewrite text for clarity', in: 'text', sys: 'Rewrite the provided text for clarity and flow while preserving its meaning. Return only the rewrite.', tpl: '{{input}}', pl: '', on: true },
            { id: 'k6', name: 'translate', desc: 'Translate text', in: 'text', sys: 'Translate the provided text into the language requested. If no target language is specified, ask which language.', tpl: '{{input}}', pl: '', on: true },
            { id: 'k7', name: 'brainstorm', desc: 'Generate useful ideas', in: 'text', sys: 'Generate varied, practical ideas. Keep each idea distinct and briefly explain why it may work.', tpl: '{{input}}', pl: '', on: true },
          ]
          for (const c of defaults) if (!p.cmds.some((x: Cmd) => x.name === c.name || x.id === c.id)) p.cmds.push(c)
        }
        return p
      },
      partialize: (s) => ({
        ...s, busy: false, draft: '', notice: null,
        chats: s.chats.map((c) => ({ ...c, msgs: c.msgs.filter((m) => !(m.r === 'assistant' && !m.t && !m.err)).map((m) => ({ ...m, fadeEvents: undefined, att: m.att?.map(({ name, kind, size }) => ({ name, kind, size })) })) })),
      }),
    },
  ),
)
