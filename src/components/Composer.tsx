import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Plus, FileUp, FileText, ArrowUp, Square, CornerDownRight, ChevronRight, ListMusic, Cpu, ScrollText, Settings, Search, BookOpen, X, TriangleAlert, Wrench, Link as LinkIcon, ScanText, Loader2, Mic, Star, GripVertical, Check } from 'lucide-react'
import { useS, usable, modelsOf, modelNameOf, featOn, normDocs, normSearch, fetchOptsOf, effortClassifierOf, helperRef, splitHelperRef, toggleFavRef, type Att, type Ep } from '../store'
import { CI, orderTools } from '../meta'
import { composerWidth } from '../layout'
import { can, readAtts, ocrImage, fetchPage } from '../engine'
import { fitDoc } from '../docs'
import { bannerOf, armMention, isPill, mentionsOf, stripMention, tokenizeMentions, type Mention, type Seg as MentionSeg } from '../mentions'
import { Btn, Item, Pop, Seg, RangeSlider, Toggle, ImageLightbox, cx, type Ic } from './ui'
import { SortableList } from './dnd'
import { MentionBanner, MentionInfo } from './Mention'
import { Notice } from './Extra'
import { dictationAvailable, startDictation, stopSpeaking, normVoice, type Dictation } from '../voice'
import { getPromptHistory, pushPromptHistory } from '../promptHistory'

const chip = 'flex h-9 min-w-0 items-center gap-2 rounded-lg px-2.5 text-sm text-mu hover:bg-hov hover:text-tx'

/* The composer is a contenteditable surface, so the DOM is the source of truth
 * while the user types. These helpers keep the DOM and the plain-text draft in
 * lockstep without fighting the native caret. */

/** Plain-text value of a composer node. Pills contribute their label once. */
function textOf(node: Node): string {
  let out = ''
  const walk = (n: Node) => {
    if (n.nodeType === 3) { out += n.nodeValue ?? ''; return }
    if (n.nodeType !== 1 && n.nodeType !== 11) return
    if (n.nodeType === 1) {
      const el = n as HTMLElement
      if (el.dataset.pill != null) { out += el.dataset.label ?? el.textContent ?? ''; return }
      if (el.tagName === 'BR') { if (el.dataset.sentinel == null) out += '\n'; return }
      // Browser-generated blocks (undo, some paste paths) represent lines.
      if ((el.tagName === 'DIV' || el.tagName === 'P') && out && !out.endsWith('\n')) out += '\n'
    }
    for (const child of Array.from(n.childNodes)) walk(child)
  }
  walk(node)
  return out
}

/** Structural signature of the pills currently in the DOM. */
function pillSignature(root: HTMLElement): string {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-pill]'))
    .map((el) => `${el.dataset.label ?? ''}:${el.dataset.off ?? ''}`)
    .join('|')
}

function appendText(frag: DocumentFragment, text: string) {
  text.replace(/\r\n?/g, '\n').split('\n').forEach((part, i) => {
    if (i) frag.appendChild(document.createElement('br'))
    if (part) frag.appendChild(document.createTextNode(part))
  })
}

/** A trailing line break needs a second, non-semantic br to keep the empty line
 * visible. It is ignored when serializing back to the draft. */
function ensureTrailingBreak(root: HTMLElement) {
  root.querySelectorAll('br[data-sentinel]').forEach((br) => br.remove())
  while (root.lastChild && root.lastChild.nodeType === 3 && !(root.lastChild.nodeValue ?? '')) root.lastChild.remove()
  const last = root.lastChild as HTMLElement | null
  if (last && last.nodeType === 1 && last.tagName === 'BR') {
    const sentinel = document.createElement('br')
    sentinel.dataset.sentinel = '1'
    root.appendChild(sentinel)
  }
}

/** Rebuild the visual composer content from the tokenized draft. */
function renderComposer(root: HTMLElement, segs: MentionSeg[]) {
  const frag = document.createDocumentFragment()
  let index = 0
  for (const sg of segs) {
    if (sg.kind === 'text') { appendText(frag, sg.text); continue }
    if (isPill(sg.m)) {
      const pill = document.createElement('span')
      pill.className = 'mention-pill' + (sg.m.enabled ? '' : ' mention-pill-off')
      pill.contentEditable = 'false'
      pill.dataset.pill = String(index++)
      pill.dataset.label = sg.m.label
      if (!sg.m.enabled) pill.dataset.off = '1'
      pill.textContent = sg.m.label
      frag.appendChild(pill)
    } else {
      const label = document.createElement('span')
      label.textContent = sg.m.label
      frag.appendChild(label)
    }
  }
  root.replaceChildren(frag)
  ensureTrailingBreak(root)
}

/** Caret offset in plain-text units, or null when the selection is elsewhere. */
function caretOffset(root: HTMLElement): number | null {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return null
  const range = sel.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null
  const before = document.createRange()
  before.selectNodeContents(root)
  before.setEnd(range.startContainer, range.startOffset)
  return textOf(before.cloneContents()).length
}

/** Put the caret back at a plain-text offset, skipping over atomic pills. */
function setCaret(root: HTMLElement, offset: number) {
  const sel = window.getSelection()
  if (!sel) return
  const range = document.createRange()
  let rest = Math.max(0, offset)
  let found = false
  const visit = (node: Node): boolean => {
    for (const n of Array.from(node.childNodes)) {
      if (n.nodeType === 3) {
        const len = (n.nodeValue ?? '').length
        if (rest <= len) { range.setStart(n, rest); found = true; return true }
        rest -= len
      } else if (n.nodeType === 1) {
        const el = n as HTMLElement
        if (el.tagName === 'BR') {
          if (el.dataset.sentinel != null) {
            if (rest <= 0) { range.setStartBefore(el); found = true; return true }
            continue
          }
          if (rest <= 0) { range.setStartBefore(el); found = true; return true }
          rest -= 1
        } else if (el.dataset.pill != null) {
          const len = (el.dataset.label ?? el.textContent ?? '').length
          if (rest <= 0) { range.setStartBefore(el); found = true; return true }
          if (rest <= len) { range.setStartAfter(el); found = true; return true }
          rest -= len
        } else if (visit(el)) return true
      }
    }
    return false
  }
  visit(root)
  if (!found) { range.selectNodeContents(root); range.collapse(false) }
  else range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
}

/** Insert plain text (including newlines) at the native selection. */
function insertText(root: HTMLElement, text: string) {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return
  const range = sel.getRangeAt(0)
  const before = document.createRange()
  before.selectNodeContents(root)
  before.setEnd(range.startContainer, range.startOffset)
  const start = textOf(before.cloneContents()).length
  range.deleteContents()
  const frag = document.createDocumentFragment()
  const plain = text.replace(/\r\n?/g, '\n')
  appendText(frag, plain)
  range.insertNode(frag)
  root.querySelectorAll('br[data-sentinel]').forEach((br) => br.remove())
  ensureTrailingBreak(root)
  setCaret(root, start + plain.length)
}

function ModelMenu({ close, cfg }: { close: () => void; cfg: (t: string) => void }) {
  const s = useS(useShallow((st) => { const { chats, ...rest } = st; void chats; return rest }))
  const plsOn = featOn(s, 'playlists')
  const [t, setT] = useState<'pl' | 'ep'>(plsOn ? s.sel?.k ?? 'ep' : 'ep')
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()
  const favs = Array.isArray(s.favs) ? s.favs : []
  const favSet = new Set(favs)
  const favsOn = s.prefs.favoritesSection !== false
  const hideFavs = favsOn && s.prefs.hideFavoritesInProviders !== false
  const collapsed = s.prefs.collapsedProviders ?? []
  const labelOf = (x: Ep, model: string) => {
    const primary = s.prefs.modelPrimary ?? 'name'
    const secondary = s.prefs.modelSecondary ?? 'none'
    const alias = modelNameOf(x, model)
    const title = (primary === 'name' ? alias : model).replace(/^~+/, '')
    const sub = secondary === 'provider' ? x.name : secondary === 'none' || secondary === primary ? '' : (secondary === 'name' ? alias : model).replace(/^~+/, '')
    return { title, sub }
  }
  const matches = (x: Ep, model: string) => !query || x.name.toLowerCase().includes(query) || model.toLowerCase().includes(query) || modelNameOf(x, model).toLowerCase().includes(query)
  // A model row gets a star so it can be favorited without leaving the menu.
  const modelRow = (x: Ep, model: string, keyPrefix = '') => {
    const { title, sub } = labelOf(x, model)
    const favorite = favSet.has(helperRef(x.id, model))
    return <Item key={`${keyPrefix}${x.id}:${model}`} icon={Cpu} off={x.on === false} on={s.sel?.id === x.id && s.sel?.model === model} sub={keyPrefix ? x.name : sub} star={{ on: favorite, set: () => s.patch({ favs: toggleFavRef(s.favs, helperRef(x.id, model)) }) }} onClick={() => { s.patch({ sel: { k: 'ep', id: x.id, model } }); close() }}>{title}</Item>
  }
  const L: any[] = (t === 'pl' && plsOn ? s.pls : s.eps).filter((x) => x.name.toLowerCase().includes(query) || (t === 'ep' && modelsOf(x as Ep).some((model) => matches(x as Ep, model))))
  // Favorites are addressed by endpoint + model, so a starred model keeps its
  // identity when it also appears in a provider group.
  const favModels = (t === 'ep' ? favs : []).flatMap((ref) => {
    const [id, model] = splitHelperRef(ref)
    const x = s.eps.find((e) => e.id === id)
    return x && model && modelsOf(x).includes(model) ? [{ x, model }] : []
  }).filter(({ x, model }) => matches(x, model))
  const activeEp = t === 'ep' && s.sel?.k === 'ep' && s.sel.model ? s.eps.find((x) => x.id === s.sel?.id) : undefined
  const activeModel = activeEp && s.sel?.model
  const efforts: string[] = activeModel ? activeEp?.modelEfforts?.[activeModel] ?? [] : []
  const effortRank: Record<string, number> = { none: 0, minimal: 1, low: 2, medium: 3, high: 4, xhigh: 5, max: 6, auto: -1 }
  // Dedupe case-insensitively: a provider list that already contains "none"
  // must not produce a second, synthetic one.
  const effortLevels = [...new Map(efforts.filter(Boolean).map((x) => [x.toLowerCase(), x])).values()]
    .sort((a, b) => (effortRank[a.toLowerCase()] ?? 50) - (effortRank[b.toLowerCase()] ?? 50))
  const autoOn = !!effortClassifierOf(s)
  const effortChoices = [...(autoOn ? ['auto'] : []), ...effortLevels]
  const storedEffort = activeModel ? s.effort[activeModel] : undefined
  const effortValue = storedEffort && effortChoices.includes(storedEffort) ? storedEffort : (effortLevels[0] ?? (autoOn ? 'auto' : ''))
  const effortIndex = Math.max(0, effortChoices.indexOf(effortValue))
  const activeEffort = effortChoices[effortIndex] ?? ''
  const toggleProvider = (id: string) => s.patch({ prefs: { ...s.prefs, collapsedProviders: collapsed.includes(id) ? collapsed.filter((x) => x !== id) : [...collapsed, id] } })
  return (
    <div className="flex flex-col" style={{ maxHeight: `min(${s.prefs.modelPickerHeight ?? 480}px, 85dvh)` }}>
      {plsOn && <Seg v={t} set={setT} opts={[['ep', 'Models', Cpu], ['pl', 'Playlists', ListMusic]]} />}
      <div className="relative my-2">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-mu" />
        <input aria-label="Search models and playlists" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="h-9 w-full rounded-lg bg-surf pl-9 pr-3 text-sm outline-none" />
      </div>
      {activeModel && effortChoices.length > 0 && <div className="shrink-0 border-b border-bor px-2.5 py-3" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between text-xs"><span className="truncate pr-2 font-medium text-tx">Effort · {modelNameOf(activeEp!, activeModel).replace(/^~+/, '')}</span><span className="text-ac capitalize">{activeEffort}</span></div>
        <RangeSlider label={`${modelNameOf(activeEp!, activeModel).replace(/^~+/, '')} reasoning effort`} min={0} max={effortChoices.length - 1} step={1} value={effortIndex} valueText={effortChoices[effortIndex]} set={(n) => s.patch({ effort: { ...s.effort, [activeModel]: effortChoices[n] } })} className="mt-1 w-full" />
        <div className="mt-1 flex justify-between text-xs capitalize text-mu"><span>{effortChoices[0]}</span><span>{effortChoices.at(-1)}</span></div>
      </div>}
      <div className="min-h-0 flex-1 overflow-y-auto">
      {t === 'ep' && favsOn && favModels.length > 0 && <>
        <div className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-ac"><Star size={12} fill="currentColor" />Favorites<span className="ml-auto font-normal normal-case opacity-70">{favModels.length}</span></div>
        {favModels.map(({ x, model }) => modelRow(x, model, 'fav:'))}
        <div className="mx-2 my-1 border-t border-bor" />
      </>}
      {L.map((x) => {
        if (t === 'pl' || (plsOn && x.modelsMode === 'playlist')) return <Item key={x.id} icon={t === 'pl' ? ListMusic : Cpu} off={x.on === false} on={s.sel?.id === x.id && !s.sel?.model} sub={t === 'pl' ? `${x.e.length} models` : `${modelsOf(x).length} model playlist`} onClick={() => { s.patch({ sel: { k: t, id: x.id } }); close() }}>{x.name}</Item>
        const models = modelsOf(x).filter((model) => {
          if (hideFavs && favSet.has(helperRef(x.id, model))) return false
          return !query || x.name.toLowerCase().includes(query) || matches(x, model)
        })
        if (!models.length) return null
        const isCollapsed = collapsed.includes(x.id)
        return <div key={x.id}>
          <button type="button" aria-expanded={!isCollapsed} onClick={() => toggleProvider(x.id)} className="group flex w-full items-center gap-1.5 rounded-md px-3 pb-1 pt-2 text-left text-xs font-semibold uppercase tracking-wide text-mu hover:text-tx">
            <ChevronRight size={12} className={cx('shrink-0 transition-transform', !isCollapsed && 'rotate-90')} />
            <span className="min-w-0 flex-1 truncate">{x.name}</span>
            <span className="font-normal normal-case opacity-70">{models.length}</span>
          </button>
          {!isCollapsed && models.map((model) => modelRow(x, model))}
        </div>
      })}
      {!L.length && <p className="px-2.5 py-3 text-sm text-mu">{query ? 'No matches. Try another search.' : 'No models available. Add an endpoint in Settings.'}</p>}
      </div>
      <div className="shrink-0 border-t border-bor px-1 pt-2">
        <Item icon={Settings} className="bg-surf/70 hover:bg-surf" onClick={() => { close(); cfg(t === 'pl' && plsOn ? 'pls' : 'eps') }}>Manage…</Item>
      </div>
    </div>
  )
}

export function Composer({ cfg }: { cfg: (t: string) => void }) {
  const s = useS(useShallow((st) => { const { chats, ...rest } = st; void chats; return rest }))
  const [att, setAtt] = useState<Att[]>([])
  const ta = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const pending = useRef<number | 'end' | null>(null)
  const composing = useRef(false)
  const fi = useRef<HTMLInputElement>(null)
  /* Prompt-recall navigation state: while non-null, ArrowUp/ArrowDown step
   * through the messages sent this session and `histDraft` holds the unsent
   * draft the user was typing before the walk started. */
  const histIdx = useRef<number | null>(null)
  const histDraft = useRef('')
  const v = s.draft
  const [hi, setHi] = useState(0)
  // Focus the composer on load so typing starts here straight away. Skip when
  // a dialog (welcome, settings, palette) owns focus, and never scroll the chat.
  useEffect(() => {
    const t = ta.current
    if (!t) return
    const id = requestAnimationFrame(() => {
      if (document.activeElement !== document.body || document.querySelector('[role="dialog"]')) return
      t.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(id)
  }, [])
  const [menuOff, setMenuOff] = useState(false)
  // Any composer menu (+ attach, model, prompt) or dictation keeps the frame
  // lit even after the pointer leaves it.
  const [menusOpen, setMenusOpen] = useState(false)
  // The frame also lifts while the message surface itself has focus, so typing
  // reads as an active composer and not only when a menu is open.
  const [typing, setTyping] = useState(false)
  // Escape hides the slash/@ popup until the draft changes again.
  useEffect(() => { setMenuOff(false) }, [v])
  const [ime, setIme] = useState(false)
  const [armed, setArmed] = useState<'search' | 'research' | null>(null)
  const [active, setActive] = useState<{ i: number; m: Mention; left: number; top: number } | null>(null)
  const tw = v.match(/(?:^|\s)(@\w*)$/)?.[1]
  const menu: { k: string; icon: Ic; label: string; hint: string; pick: () => void }[] | null = /^\/\S*$/.test(v) && featOn(s, 'commands')
    ? s.cmds.filter((c) => c.on && c.name.startsWith(v.slice(1))).map((c) => ({ k: c.id, icon: CI[c.in], label: '/' + c.name, hint: `${c.desc || c.in}${c.args ? ` · /${c.name} ${c.args}` : ''}`, pick: () => s.patch({ draft: '/' + c.name + ' ' }) }))
    : tw && featOn(s, 'tools')
      ? [
        ...orderTools(s.tools).filter((t) => t[3].startsWith(tw.toLowerCase())).map((t) => ({ k: t[0], icon: t[2], label: t[3].split('(')[0], hint: s.tools[t[0]] ? t[4] : 'Off. Enable in Settings → Tools', pick: () => s.patch({ draft: v.slice(0, v.length - tw.length) + '@' + t[0] + (/^(calc|count|json|base64|search|fetch_page|random|hash)$/.test(t[0]) ? '(' : ' ') }) })),
        ...('@research'.startsWith(tw.toLowerCase()) ? [{ k: 'deep_research', icon: BookOpen as Ic, label: '@research', hint: 'Start deep research: pick a depth, review the plan, then run', pick: () => s.patch({ draft: v.slice(0, v.length - tw.length) + '@research(' }) }] : []),
      ]
      : null
  const hl = Math.min(hi, Math.max((menu?.length ?? 1) - 1, 0))
  const segs = useMemo(() => tokenizeMentions(v, { cmds: s.cmds, tools: s.tools, commandsOn: featOn(s, 'commands'), toolsOn: featOn(s, 'tools') }), [v, s.cmds, s.tools, s.features])
  const pills = useMemo(() => mentionsOf(segs).filter(isPill), [segs])
  const typed = useMemo(() => bannerOf(v, segs), [v, segs])
  // Banner reflects a pre-send state only (armed/typed mentions). A sent
  // research run keeps its banner in the chat bubble (picker/progress card),
  // not in the composer. The AI using search internally never shows a banner —
  // only an explicit @search( call by the user does.
  const banner: 'search' | 'research' | null = armed ?? typed?.kind ?? null
  // A search banner must say so when the tool is disabled: otherwise the
  // composed @search(…) message is sent with no search tool attached and the
  // model answers from memory.
  const searchEnabled = featOn(s, 'tools') && s.tools.search === true
  // A @search( / @research( call leaves the draft the instant it is typed,
  // pasted or inserted from the + menu, and shows as the box header instead.
  // Done before paint so the raw call never flashes in the textarea.
  useLayoutEffect(() => {
    const hit = armMention(v)
    if (!hit) return
    setArmed(hit.kind)
    if (hit.rest !== v) s.patch({ draft: hit.rest })
  }, [v])
  // Keep the contenteditable DOM in sync with the draft. While the user types,
  // the serialized DOM already equals the draft, so this is a no-op and the
  // native caret keeps blinking. A rebuild only happens when the pill structure
  // changes (a mention just completed or was broken) or the draft was changed
  // programmatically; in that case the caret offset is restored.
  useLayoutEffect(() => {
    const el = ta.current
    if (!el) return
    const want = pills.map((m) => `${m.label}:${m.enabled ? '' : '1'}`).join('|')
    if (!v && el.childNodes.length) {
      el.replaceChildren()
      pending.current = null
      if (document.activeElement === el) setCaret(el, 0)
      return
    }
    if (textOf(el) === v && pillSignature(el) === want) return
    const focused = document.activeElement === el
    const prev = pending.current === 'end'
      ? v.length
      : typeof pending.current === 'number' ? pending.current : caretOffset(el)
    renderComposer(el, segs)
    pending.current = null
    if (focused) setCaret(el, Math.max(0, Math.min(v.length, prev ?? v.length)))
  }, [v, segs, pills])
  // Keep the pill info selection highlight in step with `active`.
  useEffect(() => {
    const el = ta.current
    if (!el) return
    el.querySelectorAll<HTMLElement>('[data-pill]').forEach((pill) => {
      pill.classList.toggle('mention-pill-sel', active != null && Number(pill.dataset.pill) === active.i)
    })
  }, [active, v])
  // A file dropped outside the composer box must not navigate the tab away
  // (the browser default replaces the SPA with the file). Drops on the box are
  // handled by its own onDrop above.
  useEffect(() => {
    const stop = (e: DragEvent) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault() }
    window.addEventListener('dragover', stop)
    window.addEventListener('drop', stop)
    return () => { window.removeEventListener('dragover', stop); window.removeEventListener('drop', stop) }
  }, [])
  const sel = s.sel ? (s.sel.k === 'pl' ? s.pls : s.eps).find((x) => x.id === s.sel!.id) : undefined
  const ep = s.sel?.k === 'ep' ? s.eps.find((e) => e.id === s.sel!.id) : undefined
  const pr = s.prompts.find((p) => p.id === s.pr)
  const bad = (a: Att) => !!ep && !a.text && (a.kind === 'media' || ((a.kind === 'img' || a.kind === 'pdf') && !can(ep, a.kind)))
  const pick = (accept: string) => { if (fi.current) { fi.current.accept = accept; fi.current.click() } }
  const add = async (l: FileList | File[] | null) => {
    if (!l) return
    const dp = normDocs(s.docPrefs)
    const txtChars = att.reduce((a, x) => a + (x.text?.length ?? 0), 0)
    const { atts, notices } = await readAtts(l, txtChars, dp)
    if (notices.length) s.patch({ notice: { t: notices.join('\n') } })
    if (atts.length) { setOcrStatus(''); setAtt((a) => [...a, ...atts]) }
  }
  /* Pasting an image attaches it directly, like dropping a file on the box. */
  /* Pending attachments are reordered with the shared drag system. Each one
   * keeps a stable identity while it moves, so the list never duplicates an
   * entry or follows a stale index. */
  const attIds = useRef(new WeakMap<Att, string>())
  const attSeq = useRef(0)
  const attId = (a: Att): string => {
    let id = attIds.current.get(a)
    if (!id) { id = `att-${++attSeq.current}`; attIds.current.set(a, id) }
    return id
  }
  const byAttId = new Map(att.map((a) => [attId(a), a] as const))
  const [ocrStatus, setOcrStatus] = useState('')
  const [zoomed, setZoomed] = useState<{ src: string; alt: string } | null>(null)
  const [urlOpen, setUrlOpen] = useState(false)
  const [urlVal, setUrlVal] = useState('')
  const [urlBusy, setUrlBusy] = useState(false)
  const addUrl = async () => {
    const u = urlVal.trim()
    if (!u || urlBusy) return
    setUrlBusy(true)
    try {
      const page = await fetchPage(u, fetchOptsOf(normSearch(s.search)))
      const txtChars = att.reduce((a, x) => a + (x.text?.length ?? 0), 0)
      const { text } = fitDoc(page.text, Math.min(normDocs(s.docPrefs).perFileChars, 200000))
      if (txtChars + text.length > 500000) { s.patch({ notice: { t: 'That page did not fit, because this message is already at its text limit. Shorten the message or remove an attachment, then try again.' } }); return }
      setAtt((a) => [...a, { name: (page.title || u).slice(0, 80), kind: 'txt', size: `${Math.round(text.length / 1024)} KB`, source: 'url', text: `[from URL: ${page.url}]\n${text}` }])
      setUrlVal(''); setUrlOpen(false)
    } catch (x: any) { s.patch({ notice: { t: `That page could not be attached (${String(x?.message ?? x)}). Check the link is reachable, or paste the text instead.` } }) }
    finally { setUrlBusy(false) }
  }
  // Dictation: one-shot recognition that mirrors the live transcript into the
  // draft. `base` is captured when recording starts so interim results replace
  // the spoken tail instead of appending over and over.
  const [listening, setListening] = useState(false)
  const dict = useRef<Dictation | null>(null)
  const stopDict = () => { dict.current?.stop(); dict.current = null; setListening(false) }
  useEffect(() => () => { dict.current?.stop() }, [])
  const toggleDict = () => {
    if (listening) { stopDict(); return }
    const base = v
    try {
      dict.current = startDictation({
        lang: normVoice(s.voicePrefs).dictLang,
        onText: (text) => { pending.current = 'end'; s.patch({ draft: base && !/\s$/.test(base) ? `${base} ${text}` : `${base}${text}` }) },
        onEnd: () => { dict.current = null; setListening(false) },
        onError: (message) => s.patch({ notice: { t: message } }),
      })
      setListening(true)
    } catch (x: any) {
      s.patch({ notice: { t: String(x?.message ?? x) } })
    }
  }
  const [ocrBusy, setOcrBusy] = useState<Att | null>(null)
  const ocrOne = async (a: Att) => {
    if (!a || a.kind !== 'img' || !a.data || a.text || ocrBusy != null) return
    const dp = normDocs(s.docPrefs)
    const vex = s.eps.find((e) => e.id === dp.ocrEp && usable(e) && can(e, 'img'))
      ?? s.eps.find((e) => usable(e) && can(e, 'img'))
      ?? (ep && can(ep, 'img') ? ep : undefined)
    if (!vex) { s.patch({ notice: { t: 'Transcription needs a vision-capable endpoint, and none is set up yet. Add one in Settings → Endpoints, then try again.', tab: 'eps', label: 'Open endpoints' } }); return }
    const model = vex.id === dp.ocrEp && dp.ocrModel ? dp.ocrModel : vex.model
    setOcrBusy(a)
    setOcrStatus(`Transcribing ${a.name} with ${modelNameOf(vex, model)}…`)
    try {
      const text = await ocrImage(vex, model, a)
      // Match by identity, not by index: the list may have changed while the
      // request was in flight.
      setAtt((list) => list.map((x) => x === a ? { ...x, text: `[ocr: transcribed text from an attached image]\n${text}`, source: 'ocr' } : x))
      setOcrStatus(`Transcribed ${a.name} · ${text.trim().length.toLocaleString()} characters added to this message, ready to send.`)
    } catch (x: any) { setOcrStatus(''); s.patch({ notice: { t: `Transcription did not finish (${String(x?.message ?? x)}). Try again, or pick a different endpoint in Settings.` } }) }
    finally { setOcrBusy(null) }
  }
  const ready = !!v.trim() || att.length > 0
  const submit = async () => {
    if (s.busy) return
    if (!s.eps.length) {
      s.add('eps')
      s.patch({ notice: { t: 'No endpoint is ready yet. Choose a provider preset, add a model and key, test the connection, then send again.', tab: 'eps', label: 'Add endpoint' } })
      cfg('eps')
      return
    }
    if (!ready) return
    stopDict()
    stopSpeaking()
    // An armed banner sends as the real call so the tool loop and the deep
    // research planner still receive exactly what they expect.
    const raw = armed ? `@${armed}(${v.trim()})` : v, files = att
    if (await s.send(raw, files)) {
      // The history records what the user composed (the visible draft), not
      // the armed `@tool(…)` wrapper, so recall reproduces the typing. With
      // recall off nothing is recorded at all.
      if ((s.prefs.promptRecall ?? 'edges') !== 'off') pushPromptHistory(v)
      histIdx.current = null
      if (useS.getState().draft === v) { pending.current = 'end'; s.patch({ draft: '' }) }
      setArmed(null)
      setAtt([])
      setActive(null)
    }
  }
  /* The contenteditable DOM owns typing, so its plain-text serialization is the
     draft. Pills are non-editable elements: arrow keys step over them and a
     backspace/delete adjacent to one removes it as a whole. */
  const commitInput = () => {
    const el = ta.current
    if (!el) return
    const next = textOf(el)
    // After Ctrl+A + Backspace the browser often leaves structural leftovers
    // (<div><br></div> or a lone <br>) that serialize into newline-only text
    // and would keep a phantom blank line alive. Newline-only text is never a
    // meaningful draft, so collapse it back to an empty composer.
    if (/^\n*$/.test(next)) {
      el.replaceChildren()
      pending.current = null
      if (document.activeElement === el) setCaret(el, 0)
      if (s.draft === '') return
      setActive(null)
      histIdx.current = null
      s.patch({ draft: '' })
      setHi(0)
      return
    }
    ensureTrailingBreak(el)
    if (next === s.draft) return
    setActive(null)
    // Typing ends a prompt-recall walk; the recalled snapshot is stale now.
    histIdx.current = null
    s.patch({ draft: next })
    setHi(0)
  }
  const moveCaret = (pos: number) => {
    const el = ta.current
    if (el) setCaret(el, pos)
  }
  const pillKeys = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = ta.current
    if (!el) return false
    const sel = window.getSelection()
    if (!sel || !sel.isCollapsed || !sel.rangeCount) return false
    const pos = caretOffset(el)
    if (pos == null) return false
    if (e.key === 'ArrowLeft') {
      const hit = pills.find((m) => pos > m.start && pos <= m.end)
      if (!hit) return false
      e.preventDefault()
      moveCaret(hit.start)
      return true
    }
    if (e.key === 'ArrowRight') {
      const hit = pills.find((m) => pos >= m.start && pos < m.end)
      if (!hit) return false
      e.preventDefault()
      moveCaret(hit.end)
      return true
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      const hit = e.key === 'Backspace'
        ? pills.find((m) => pos > m.start && pos <= m.end)
        : pills.find((m) => pos >= m.start && pos < m.end)
      if (!hit) return false
      e.preventDefault()
      pending.current = hit.start
      setActive(null)
      s.patch({ draft: v.slice(0, hit.start) + v.slice(hit.end) })
      return true
    }
    return false
  }
  const clickPill = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-pill]')
    if (!el) { setActive(null); return }
    const i = Number(el.dataset.pill)
    const m = pills[i]
    const host = box.current
    if (!m || !host) return
    const r = el.getBoundingClientRect(), c = host.getBoundingClientRect()
    setActive({ i, m, left: r.left - c.left + r.width / 2, top: r.top - c.top })
  }
  const dismissBanner = () => {
    if (armed) { setArmed(null); pending.current = 'end'; ta.current?.focus(); return }
    if (typed?.kind === 'research') { pending.current = 'end'; s.patch({ draft: typed.query ?? '' }); ta.current?.focus(); return }
    if (typed?.kind === 'search' && typed.m) { pending.current = 'end'; s.patch({ draft: stripMention(v, typed.m) }); ta.current?.focus() }
  }
  const placeholder = armed === 'search' ? 'What should I search for?' : armed === 'research' ? 'What should I research?' : s.eps.some(usable) ? (featOn(s, 'commands') && featOn(s, 'tools') ? 'Message, / for commands, @ for tools' : featOn(s, 'commands') ? 'Message, / for commands' : featOn(s, 'tools') ? 'Message, @ for tools' : 'Message') : 'Add a model endpoint to start (press Send for a walkthrough)'
  return (
    <div className="w-full self-center">
      <div className="mx-auto w-full" style={{ maxWidth: composerWidth(s.prefs.chatWidth), paddingLeft: 'var(--ui-chat-pad-x)', paddingRight: 'var(--ui-chat-pad-x)' }}>
      <Notice cfg={cfg} />
      <div ref={box} style={{ padding: 'var(--ui-composer-pad)', '--glass-blur': `${s.prefs.glassBlur ?? 14}px`, '--glass-opacity': `${s.prefs.glassOpacity ?? 80}%` } as CSSProperties} className={cx('composer-shell relative rounded-2xl transition-colors', s.prefs.glassComposer !== false ? 'glass-composer border border-hov hover:border-bor focus-within:border-bor shadow-lg shadow-black/10' : 'edge-border bg-surf hover:border-bor focus-within:border-bor')} data-lit={menusOpen || listening || typing ? '1' : undefined} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); add(e.dataTransfer.files) }}>
        {banner && <MentionBanner kind={banner} onDismiss={dismissBanner} warning={banner === 'search' && !searchEnabled ? 'Web search is off.' : undefined} onEnable={banner === 'search' && !searchEnabled ? () => { s.patch({ features: { ...s.features, tools: true }, tools: { ...s.tools, search: true } }) } : undefined} />}
        {menu && !menuOff && (
          <div className="edge-border absolute inset-x-0 bottom-full mb-2 rounded-xl bg-hov p-1.5">
            {menu.length ? menu.map((o, i) => (
              <Item key={o.k} icon={o.icon} on={i === hl} sub={o.hint} onClick={() => { pending.current = 'end'; o.pick(); ta.current?.focus() }}>{o.label}</Item>
            )) : <p className="px-2.5 py-3 text-sm text-mu">{tw ? 'No tool matches.' : 'No enabled command matches. Manage commands in Settings.'}</p>}
          </div>
        )}
        {att.length > 0 && (
          <div className="mb-2" role="group" aria-label="Attachments">
            <SortableList
              ids={att.map((a) => attId(a))}
              onCommit={(from, to) => setAtt((list) => {
                // Resolve the dragged item by identity, not by the index the
                // drag started from: an OCR result can replace the list while
                // the pointer is down, and a stale index would move the wrong
                // file (or duplicate one).
                const id = list.map(attId)[from]
                const at = list.findIndex((x) => attId(x) === id)
                if (at < 0) return list
                const next = [...list]
                const [item] = next.splice(at, 1)
                next.splice(Math.max(0, Math.min(to, next.length)), 0, item)
                return next
              })}
              label="Attachment"
              axis="x"
              describe={(id) => byAttId.get(id)?.name ?? 'attachment'}
              className="flex items-center gap-2 overflow-x-auto pb-1"
              itemClassName="shrink-0"
              renderItem={(id, api) => {
                const a = byAttId.get(id)
                if (!a) return null
                const hp = api.handleProps(`Reorder ${a.name}`)
                const remove = () => setAtt((list) => list.filter((x) => x !== a))
                const handle = (extra: string) => (
                  <button
                    type="button"
                    {...hp}
                    title={`Drag to reorder ${a.name}`}
                    className={cx('dnd-handle grid size-5 shrink-0 place-items-center rounded-full bg-black/60 text-white', extra)}
                  >
                    <GripVertical size={12} />
                  </button>
                )
                if (a.kind === 'img' && a.data) {
                  const src = `data:${a.mime || 'image/*'};base64,${a.data}`
                  return (
                    <div onPointerDown={hp.onPointerDown} className={cx('group/preview relative flex h-24 w-28 cursor-grab flex-col overflow-hidden rounded-lg bg-hov p-1.5 ring-1 ring-hov', bad(a) && 'ring-er')} title={a.text ? `${a.name} · transcribed text attached` : a.name}>
                      <button type="button" aria-label={`View ${a.name} full screen`} title="Click to enlarge" onClick={() => setZoomed({ src, alt: a.name })} className="min-h-0 flex-1 overflow-hidden rounded-sm">
                        <img src={src} alt={a.name} draggable={false} className="h-full w-full object-contain p-1" />
                      </button>
                      <span className="truncate px-1 text-xs text-mu" title={a.name}>{a.text ? '✓ ' : ''}{a.name}</span>
                      {handle('absolute left-1 top-1')}
                      {!a.text ? (
                        <button aria-label={`Transcribe text from ${a.name}`} title="Transcribe image text with a vision model" onClick={() => { void ocrOne(a) }} disabled={ocrBusy != null} className="absolute bottom-6 left-1 grid size-5 place-items-center rounded-full bg-black/70 text-white opacity-100 transition-opacity md:opacity-0 md:group-hover/preview:opacity-100 md:focus:opacity-100 disabled:opacity-40">
                          {ocrBusy === a ? <Loader2 size={12} className="animate-spin" /> : <ScanText size={12} />}
                        </button>
                      ) : (
                        <span title="Transcribed text is attached" className="absolute bottom-6 left-1 grid size-5 place-items-center rounded-full bg-ac text-acx"><Check size={12} /></span>
                      )}
                      <button aria-label={`Remove ${a.name}`} title={`Remove ${a.name}`} onClick={remove} className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-black/70 text-white opacity-100 transition-opacity md:opacity-0 md:group-hover/preview:opacity-100 md:focus:opacity-100"><X size={12} /></button>
                      {ocrBusy === a && <span className="absolute inset-0 grid place-items-center bg-black/55 text-center text-[10px] font-medium text-white"><Loader2 size={14} className="mb-1 animate-spin" />Transcribing…</span>}
                      {bad(a) && <span className="absolute left-1 right-1 top-7 rounded-sm bg-er/90 px-1 py-0.5 text-center text-xs text-white"><TriangleAlert size={11} className="inline" /> Unsupported</span>}
                    </div>
                  )
                }
                return (
                  <div onPointerDown={hp.onPointerDown} title={bad(a) ? 'The selected model cannot process this file' : `${a.name}${a.source ? ` · ${a.source}` : ''}${a.pages ? ` · ${a.pages} pages` : ''}${a.text ? ` · ${Math.round(a.text.length / 1024)} KB text` : ''}`} className={cx('inline-flex items-center gap-1.5 rounded-lg bg-hov py-1 pl-2 pr-1 text-xs', bad(a) && 'text-er')}>
                    {handle('!bg-transparent !text-mu hover:!text-tx')}
                    {bad(a) ? <TriangleAlert size={13} /> : <FileText size={13} />}{a.text && a.kind !== 'txt' ? '✓ ' : ''}{a.name}<span className="text-mu">{a.size}</span>
                    <Btn sm icon={X} title={`Remove ${a.name}`} onClick={remove} />
                  </div>
                )
              }}
            />
            {ocrStatus && (
              <p role="status" className={cx('flex items-center gap-1.5 px-1 pt-1 text-xs', ocrBusy ? 'text-mu' : 'text-ac')}>
                {ocrBusy ? <Loader2 size={12} className="shrink-0 animate-spin" /> : <Check size={12} className="shrink-0" />}
                <span className="min-w-0 flex-1 truncate">{ocrStatus}</span>
              </p>
            )}
            {zoomed && <ImageLightbox src={zoomed.src} alt={zoomed.alt} close={() => setZoomed(null)} />}
          </div>
        )}
        {urlOpen && (
          <div className="mb-2 flex gap-2">
            <input autoFocus value={urlVal} onChange={(e) => setUrlVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addUrl(); if (e.key === 'Escape') setUrlOpen(false) }} placeholder="https://… — attach the page text as a document" className="h-9 min-w-0 flex-1 rounded-lg bg-hov px-3 text-sm outline-none" />
            <Btn v="solid" disabled={!urlVal.trim() || urlBusy} onClick={addUrl}>{urlBusy ? 'Reading…' : 'Attach'}</Btn>
            <Btn v="soft" onClick={() => setUrlOpen(false)}>Cancel</Btn>
          </div>
        )}
        <div className="relative">
          <div
            id="composer"
            ref={ta}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label="Message"
            aria-placeholder={placeholder}
            spellCheck
            data-placeholder={placeholder}
            onInput={() => { if (!composing.current) commitInput() }}
            onKeyDown={(e) => {
              // Never handle Enter/arrows while an IME candidate window is open.
              if (e.nativeEvent.isComposing || composing.current || ime) return
              if (menu && !menuOff && menu.length && !e.shiftKey && ['ArrowDown', 'ArrowUp', 'Tab', 'Enter'].includes(e.key)) {
                e.preventDefault()
                if (e.key === 'ArrowDown') setHi((hl + 1) % menu.length)
                else if (e.key === 'ArrowUp') setHi((hl - 1 + menu.length) % menu.length)
                else { pending.current = 'end'; menu[hl].pick() }
                return
              }
              if (menu && !menuOff && e.key === 'Escape') { e.preventDefault(); setMenuOff(true); return }
              if (pillKeys(e)) return
            // Prompt recall: walk the messages sent this session. Entering
            // the walk is gated by the recall mode — at the composer's edges
            // (caret at the start for ↑, the end for ↓), at any caret
            // position, only when the composer is empty, or never. Once
            // inside, both keys step regardless of the caret, like a terminal
            // history. Plain text only — with a modifier held the keys keep
            // their native selection meaning.
            if (!e.altKey && !e.ctrlKey && !e.metaKey && !(menu && menu.length) && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
              const el = ta.current
              const pos = el ? caretOffset(el) : null
              const hist = getPromptHistory()
              const walking = histIdx.current != null
              const mode = s.prefs.promptRecall ?? 'edges'
              const atStart = pos === 0
              const atEnd = pos != null && pos >= v.length
              const canEnter = mode === 'anytime' ? true : mode === 'empty' ? v === '' : e.key === 'ArrowUp' ? atStart : atEnd
              if (mode !== 'off' && hist.length && (walking ? true : canEnter)) {
                  e.preventDefault()
                  if (histIdx.current == null) histDraft.current = v
                  const end = e.key === 'ArrowUp'
                    ? histIdx.current == null ? hist.length - 1 : Math.max(0, histIdx.current - 1)
                    : histIdx.current == null ? null : histIdx.current + 1 >= hist.length ? null : histIdx.current + 1
                  if (end == null) {
                    // Stepped past the newest entry: the draft that was being
                    // typed comes back and the walk ends.
                    histIdx.current = null
                    s.patch({ draft: histDraft.current })
                    pending.current = 'end'
                  } else {
                    histIdx.current = end
                    s.patch({ draft: hist[end] })
                    pending.current = 'end'
                  }
                  return
                }
              }
              if (e.key === 'Enter') {
                if (!e.shiftKey && s.prefs.enterSends && !s.busy) { e.preventDefault(); void submit(); return }
                // Shift+Enter (or Enter when send-on-enter is off) inserts a
                // real line break instead of letting the browser invent divs.
                e.preventDefault()
                const el = ta.current
                if (el) { insertText(el, '\n'); commitInput() }
              }
            }}
            onClick={clickPill}
            onCompositionStart={() => { composing.current = true; setIme(true) }}
            onCompositionEnd={() => { composing.current = false; setIme(false); commitInput() }}
            onBlur={() => { setTyping(false); setActive(null) }}
            onFocus={() => setTyping(true)}
            onPaste={(e) => {
              if (e.clipboardData.files.length) { e.preventDefault(); void add(e.clipboardData.files); return }
              const text = e.clipboardData.getData('text/plain')
              if (!text) return
              e.preventDefault()
              const el = ta.current
              if (el) { insertText(el, text); commitInput() }
            }}
            className="composer-input mention-input relative max-h-52 min-h-7 w-full overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-transparent px-1 py-1 text-tx caret-ac outline-none"
          />
        </div>
        {active && !ime && (
          <MentionInfo m={active.m} cmds={s.cmds} className="absolute" style={{ left: `clamp(8.5rem, ${active.left}px, calc(100% - 8.5rem))`, top: Math.max(active.top - 10, 4), transform: 'translate(-50%, -100%)' }} />
        )}
        <input ref={fi} type="file" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = '' }} />
        <div className="mt-2 flex items-center gap-1">
          <Pop up w="w-64" onOpenChange={setMenusOpen} trigger={() => <Btn icon={Plus} title="Attach files or manage tools" className="rounded-full" />}>
            {(close) => {
              const row = 'flex w-full items-center gap-1 rounded-lg px-1 hover:bg-surf'
              const main = 'flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1.5 py-2 text-left text-sm'
              const gear = 'grid size-7 shrink-0 place-items-center rounded-md text-mu hover:bg-hov hover:text-tx'
              return (
              <>
                <div className={row}>
                  <button className={main} onClick={() => { pick(''); close() }}><FileUp size={16} className="shrink-0 text-mu" /><span className="min-w-0 flex-1 truncate">Upload a file</span></button>
                  <button aria-label="Document settings" title="Document settings" className={gear} onClick={() => { close(); cfg('chats#documents') }}><Settings size={15} /></button>
                </div>
                <div className={row}>
                  <button className={main} onClick={() => { setUrlOpen(true); close() }}><LinkIcon size={16} className="shrink-0 text-mu" /><span className="min-w-0 flex-1 truncate">Attach page from URL</span></button>
                  <button aria-label="Page reader settings" title="Page reader settings" className={gear} onClick={() => { close(); cfg('tools#citations') }}><Settings size={15} /></button>
                </div>
                <div className={row}>
                  <button className={main} onClick={() => { pending.current = 'end'; s.patch({ draft: v ? `${v.trim()} @research(` : '@research(' }); close(); ta.current?.focus() }}><BookOpen size={16} className="shrink-0 text-mu" /><span className="min-w-0 flex-1 truncate">Deep research…</span></button>
                  <button aria-label="Deep research settings" title="Deep research settings" className={gear} onClick={() => { close(); cfg('tools') }}><Settings size={15} /></button>
                </div>
                {searchEnabled && (
                  <div className={row}>
                    <button className={main} onClick={() => { pending.current = 'end'; s.patch({ draft: v ? `${v.trim()} @search(` : '@search(' }); close(); ta.current?.focus() }}><Search size={16} className="shrink-0 text-mu" /><span className="min-w-0 flex-1 truncate">Search the web…</span></button>
                    <button aria-label="Search settings" title="Search settings" className={gear} onClick={() => { close(); cfg('tools') }}><Settings size={15} /></button>
                  </div>
                )}
                <Item icon={Wrench} onClick={() => { close(); cfg('tools') }}>Manage tools…</Item>
              </>
              )
            }}
          </Pop>
          <Pop up w="w-80" scroll={false} onOpenChange={setMenusOpen} trigger={(o) => {
            const activeEp = s.sel?.k === 'ep' && s.sel?.id ? s.eps.find((e) => e.id === s.sel!.id) : undefined
            const activeModel = s.sel?.k === 'ep' && s.sel.model ? s.sel.model : undefined
            const effortsArr = activeModel ? activeEp?.modelEfforts?.[activeModel] ?? [] : []
            const autoOn = !!effortClassifierOf(s)
            const effortRank: Record<string, number> = { none: 0, minimal: 1, low: 2, medium: 3, high: 4, xhigh: 5, max: 6, auto: -1 }
            const effortLevels = [...new Map(effortsArr.filter(Boolean).map((x) => [x.toLowerCase(), x])).values()]
              .sort((a, b) => (effortRank[a.toLowerCase()] ?? 50) - (effortRank[b.toLowerCase()] ?? 50))
            const allChoices = [...(autoOn ? ['auto'] : []), ...effortLevels]
            const stored = activeModel ? s.effort[activeModel] : undefined
            const currentEffort = stored && allChoices.includes(stored) ? stored : (effortLevels[0] ?? (autoOn ? 'auto' : ''))
            return (
            <button className={chip}>
              {s.sel?.k === 'pl' && featOn(s, 'playlists') ? <ListMusic size={16} /> : <Cpu size={16} />}
              <span className="max-w-24 truncate sm:max-w-40">{sel ? (s.sel?.model && s.sel.k === 'ep' ? modelNameOf(sel as any, s.sel.model) : sel.name) : 'Choose a model'}</span>
              {activeModel && currentEffort ? <span className="ml-1 shrink-0 text-sm text-mu capitalize leading-none opacity-60">{currentEffort}</span> : null}
              <ChevronRight size={14} className={cx('transition-transform', o && 'rotate-90')} />
            </button>
            )
          }}>{(close) => <ModelMenu close={close} cfg={cfg} />}</Pop>
          {featOn(s, 'prompts') && <Pop up onOpenChange={setMenusOpen} trigger={(o) => (
            <button className={chip}><ScrollText size={16} /><span className="max-w-20 truncate sm:max-w-32">{pr ? pr.name : 'No prompt'}</span><ChevronRight size={14} className={cx('transition-transform', o && 'rotate-90')} /></button>
          )}>
            {(close) => {
              const g = s.globalPrompt ?? { on: false, text: '', qualities: [] }
              return (
                <>
                  <Item icon={X} on={!s.pr} onClick={() => { s.patch({ pr: '' }); close() }}>No override</Item>
                  {s.prompts.map((p) => <Item key={p.id} icon={ScrollText} on={s.pr === p.id} onClick={() => { s.patch({ pr: p.id }); close() }}>{p.name}</Item>)}
                  <div className="mx-1 mb-1 mt-2 rounded-xl border border-ac/30 bg-ac/5 p-2.5">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 text-sm font-medium">Global system prompt</span>
                      <Toggle on={g.on} set={(on) => s.patch({ globalPrompt: { ...g, on } })} label="Toggle global system prompt" />
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-mu">{g.on ? (g.text.trim() || (g.qualities?.length ?? 0) ? 'On — applies to every message in every chat.' : 'On, but no text set yet — add one in Manage.') : 'Off — applies to every message in every chat when on.'}</p>
                    <Item icon={Settings} onClick={() => { close(); cfg('prompts') }}>Manage global…</Item>
                  </div>
                  <Item icon={Settings} onClick={() => { close(); cfg('prompts') }}>Manage…</Item>
                </>
              )
            }}
          </Pop>}
          <span className="flex-1" />
          {featOn(s, 'voice') && dictationAvailable() && (
            <button
              type="button"
              onClick={toggleDict}
              aria-pressed={listening}
              title={listening ? 'Stop dictation' : 'Dictate a message'}
              aria-label={listening ? 'Stop dictation' : 'Dictate a message'}
              className={cx('grid size-9 place-items-center rounded-full transition-colors', listening ? 'bg-er text-white' : 'text-mu hover:bg-hov hover:text-tx')}
            >
              <Mic size={18} />
            </button>
          )}
          <Btn icon={s.busy ? Square : ArrowUp} v={s.busy || ready ? 'solid' : 'soft'} onClick={s.busy ? s.stop : submit} title={s.busy ? 'Stop' : 'Send'} className="rounded-full" />
        </div>
      </div>
      </div>
      {/* Solid strip from the bottom of the composer to the bottom of the screen. */}
      <div className="bg-bg px-4 pb-4" />
    </div>
  )
}
