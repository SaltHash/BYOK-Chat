import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Plus, FileUp, FileText, Image as ImageIcon, ArrowUp, Square, ChevronRight, ListMusic, Cpu, ScrollText, Settings, Search, BookOpen, X, TriangleAlert, Wrench, Link as LinkIcon, ScanText } from 'lucide-react'
import { useS, useLive, usable, modelsOf, modelNameOf, featOn, normDocs, effortClassifierOf, type Att, type Ep } from '../store'
import { CI, TOOLS } from '../meta'
import { composerWidth } from '../layout'
import { can, fmt, readAtts, ocrImage, fetchPage } from '../engine'
import { fitDoc } from '../docs'
import { bannerOf, armMention, isPill, mentionsOf, pillEdit, stripMention, tokenizeMentions, type Mention } from '../mentions'
import { Btn, Item, Pop, Seg, RangeSlider, Toggle, cx, type Ic } from './ui'
import { MentionBanner, MentionInfo } from './Mention'
import { Notice } from './Extra'

const chip = 'flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm text-mu hover:bg-hov hover:text-tx'

function ModelMenu({ close, cfg }: { close: () => void; cfg: (t: string) => void }) {
  const s = useS(useShallow((st) => { const { chats, ...rest } = st; void chats; return rest }))
  const plsOn = featOn(s, 'playlists')
  const [t, setT] = useState<'pl' | 'ep'>(plsOn ? s.sel?.k ?? 'ep' : 'ep')
  const [q, setQ] = useState('')
  const L: any[] = (t === 'pl' && plsOn ? s.pls : s.eps).filter((x) => x.name.toLowerCase().includes(q.toLowerCase()) || (t === 'ep' && modelsOf(x as Ep).some((model) => model.toLowerCase().includes(q.toLowerCase()))))
  const activeEp = t === 'ep' && s.sel?.k === 'ep' && s.sel.model ? s.eps.find((x) => x.id === s.sel?.id) : undefined
  const activeModel = activeEp && s.sel?.model
  const efforts: string[] = activeModel ? activeEp?.modelEfforts?.[activeModel] ?? [] : []
  const effortRank: Record<string, number> = { none: 0, minimal: 1, low: 2, medium: 3, high: 4, xhigh: 5, max: 6 }
  const effortLevels = [...efforts].sort((a, b) => (effortRank[a.toLowerCase()] ?? 50) - (effortRank[b.toLowerCase()] ?? 50))
  const autoOn = !!effortClassifierOf(s)
  const effortChoices = autoOn && effortLevels.length ? ['auto', ...effortLevels] : effortLevels
  const storedEffort = activeModel ? s.effort[activeModel] : undefined
  const effortValue = storedEffort && effortChoices.includes(storedEffort) ? storedEffort : effortLevels[0] ?? effortChoices[0]
  const effortIndex = Math.max(0, effortChoices.indexOf(effortValue))
  const activeEffort = effortChoices[effortIndex]
  return (
    <div className="flex flex-col" style={{ maxHeight: `min(${s.prefs.modelPickerHeight ?? 480}px, 85dvh)` }}>
      {plsOn && <Seg v={t} set={setT} opts={[['pl', 'Playlists', ListMusic], ['ep', 'Models', Cpu]]} />}
      <div className="relative my-2">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-mu" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="h-9 w-full rounded-lg bg-surf pl-9 pr-3 text-sm outline-none" />
      </div>
      {activeModel && effortChoices.length > 0 && <div className="shrink-0 border-b border-bor px-2.5 py-3" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between text-xs"><span className="truncate pr-2 font-medium text-tx">Effort · {modelNameOf(activeEp!, activeModel).replace(/^~+/, '')}</span><span className="text-ac capitalize">{activeEffort}</span></div>
        <RangeSlider label={`${modelNameOf(activeEp!, activeModel).replace(/^~+/, '')} reasoning effort`} min={0} max={effortChoices.length - 1} step={1} value={effortIndex} valueText={effortChoices[effortIndex]} set={(n) => s.patch({ effort: { ...s.effort, [activeModel]: effortChoices[n] } })} className="mt-1 w-full" />
        <div className="mt-1 flex justify-between text-xs capitalize text-mu"><span>{effortChoices[0]}</span><span>{effortChoices.at(-1)}</span></div>
      </div>}
      <div className="min-h-0 flex-1 overflow-y-auto">
      {t === 'ep' && <Item icon={Cpu} on={!s.sel} sub="list order" onClick={() => { s.patch({ sel: null }); close() }}>All endpoints</Item>}
      {L.map((x) => (
        <div key={x.id}>
          {t === 'pl' || (plsOn && x.modelsMode === 'playlist')
            ? <Item icon={t === 'pl' ? ListMusic : Cpu} off={x.on === false} on={s.sel?.id === x.id && !s.sel?.model} sub={t === 'pl' ? `${x.e.length} models` : `${modelsOf(x).length} model playlist`} onClick={() => { s.patch({ sel: { k: t, id: x.id } }); close() }}>{x.name}</Item>
            : <>
              <div className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-mu">{x.name}</div>
              {modelsOf(x).map((model) => {
                const primary = s.prefs.modelPrimary ?? 'name'
                const secondary = s.prefs.modelSecondary ?? 'none'
                const alias = modelNameOf(x, model)
                const title = (primary === 'name' ? alias : model).replace(/^~+/, '')
                const sub = secondary === 'provider' ? x.name : secondary === 'none' || secondary === primary ? '' : (secondary === 'name' ? alias : model).replace(/^~+/, '')
                return <Item key={model} icon={Cpu} off={x.on === false} on={s.sel?.id === x.id && s.sel?.model === model} sub={sub} onClick={() => { s.patch({ sel: { k: 'ep', id: x.id, model } }); close() }}>{title}</Item>
              })}
            </>}
        </div>
      ))}
      {!L.length && <p className="px-2.5 py-3 text-sm text-mu">Nothing here yet. Suspiciously quiet.</p>}
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
  const ta = useRef<HTMLTextAreaElement>(null)
  const bd = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const spans = useRef<Record<number, HTMLSpanElement | null>>({})
  const pending = useRef<number | null>(null)
  const fi = useRef<HTMLInputElement>(null)
  const v = s.draft
  const [hi, setHi] = useState(0)
  const [menuOff, setMenuOff] = useState(false)
  // Escape hides the slash/@ popup until the draft changes again.
  useEffect(() => { setMenuOff(false) }, [v])
  const [ime, setIme] = useState(false)
  const [armed, setArmed] = useState<'search' | 'research' | null>(null)
  const [active, setActive] = useState<{ m: Mention; left: number; top: number } | null>(null)
  const tw = v.match(/(?:^|\s)(@\w*)$/)?.[1]
  const menu: { k: string; icon: Ic; label: string; hint: string; pick: () => void }[] | null = /^\/\S*$/.test(v) && featOn(s, 'commands')
    ? s.cmds.filter((c) => c.on && c.name.startsWith(v.slice(1))).map((c) => ({ k: c.id, icon: CI[c.in], label: '/' + c.name, hint: c.desc || c.in, pick: () => s.patch({ draft: '/' + c.name + ' ' }) }))
    : tw && featOn(s, 'tools')
      ? [
        ...TOOLS.filter((t) => t[3].startsWith(tw.toLowerCase())).map((t) => ({ k: t[0], icon: t[2], label: t[3].split('(')[0], hint: s.tools[t[0]] ? t[4] : 'Off. Enable in Settings → Tools', pick: () => s.patch({ draft: v.slice(0, v.length - tw.length) + '@' + t[0] + (/^(calc|count|json|base64|search|fetch_page|random|hash)$/.test(t[0]) ? '(' : ' ') }) })),
        ...('@research'.startsWith(tw.toLowerCase()) ? [{ k: 'deep_research', icon: BookOpen as Ic, label: '@research', hint: 'Start deep research: pick a depth, review the plan, then run', pick: () => s.patch({ draft: v.slice(0, v.length - tw.length) + '@research(' }) }] : []),
      ]
      : null
  const hl = Math.min(hi, Math.max((menu?.length ?? 1) - 1, 0))
  const segs = useMemo(() => tokenizeMentions(v, { cmds: s.cmds, tools: s.tools, commandsOn: featOn(s, 'commands'), toolsOn: featOn(s, 'tools') }), [v, s.cmds, s.tools, s.features])
  const pills = useMemo(() => mentionsOf(segs).filter(isPill), [segs])
  const live = useLive((l) => l.tools)
  const lastAiId = useS((st) => {
    const c = st.chats.find((x) => x.id === st.chat)
    return c ? [...c.msgs].reverse().find((m) => m.r === 'assistant')?.id : undefined
  })
  const searchOn = !!s.busy && !!lastAiId && (live[lastAiId] ?? []).some((t) => t.name === 'search')
  const running: 'search' | null = searchOn ? 'search' : null
  const typed = useMemo(() => bannerOf(v, segs), [v, segs])
  // Banner reflects a pre-send state only (armed/typed mentions). A sent
  // research run keeps its banner in the chat bubble (picker/progress card),
  // not in the composer.
  const banner: 'search' | 'research' | null = running ?? armed ?? typed?.kind ?? null
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
  // Auto-grow plus caret restore after programmatic pill deletes, so the real
  // input and the mirror layer behind it never disagree on height or position.
  useLayoutEffect(() => {
    const t = ta.current
    if (!t) return
    const keep = t.scrollTop
    t.style.height = 'auto'
    t.style.height = Math.min(t.scrollHeight, 208) + 'px'
    t.scrollTop = keep
    if (bd.current) bd.current.scrollTop = t.scrollTop
    if (pending.current != null) {
      const p = Math.max(0, Math.min(t.value.length, pending.current))
      pending.current = null
      t.setSelectionRange(p, p)
    }
  }, [v])
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
  const add = async (l: FileList | null) => {
    if (!l) return
    const dp = normDocs(s.docPrefs)
    const txtChars = att.reduce((a, x) => a + (x.text?.length ?? 0), 0)
    const { atts, notices } = await readAtts(l, txtChars, dp)
    if (notices.length) s.patch({ notice: { t: notices.join('\n') } })
    if (atts.length) setAtt((a) => [...a, ...atts])
  }
  const [urlOpen, setUrlOpen] = useState(false)
  const [urlVal, setUrlVal] = useState('')
  const [urlBusy, setUrlBusy] = useState(false)
  const addUrl = async () => {
    const u = urlVal.trim()
    if (!u || urlBusy) return
    setUrlBusy(true)
    try {
      const page = await fetchPage(u)
      const txtChars = att.reduce((a, x) => a + (x.text?.length ?? 0), 0)
      const { text } = fitDoc(page.text, Math.min(normDocs(s.docPrefs).perFileChars, 200000))
      if (txtChars + text.length > 500000) { s.patch({ notice: { t: 'That page did not fit, because this message is already at its text limit. Shorten the message or remove an attachment, then try again.' } }); return }
      setAtt((a) => [...a, { name: (page.title || u).slice(0, 80), kind: 'txt', size: `${Math.round(text.length / 1024)} KB`, source: 'url', text: `[from URL: ${page.url}]\n${text}` }])
      setUrlVal(''); setUrlOpen(false)
    } catch (x: any) { s.patch({ notice: { t: `That page could not be attached (${String(x?.message ?? x)}). Check the link is reachable, or paste the text instead.` } }) }
    finally { setUrlBusy(false) }
  }
  const [ocrBusy, setOcrBusy] = useState<Att | null>(null)
  const ocrOne = async (a: Att) => {
    if (!a || a.kind !== 'img' || !a.data || a.text || ocrBusy != null) return
    const dp = normDocs(s.docPrefs)
    const vex = s.eps.find((e) => e.id === dp.ocrEp && usable(e) && can(e, 'img'))
      ?? s.eps.find((e) => usable(e) && can(e, 'img'))
      ?? (ep && can(ep, 'img') ? ep : undefined)
    if (!vex) { s.patch({ notice: { t: 'Transcription needs a vision-capable endpoint, and none is set up yet. Add one in Settings → Endpoints, then try again.', tab: 'eps', label: 'Open endpoints' } }); return }
    setOcrBusy(a)
    try {
      const model = vex.id === dp.ocrEp && dp.ocrModel ? dp.ocrModel : vex.model
      const text = await ocrImage(vex, model, a)
      // Match by identity, not by index: the list may have changed while the
      // request was in flight.
      setAtt((list) => list.map((x) => x === a ? { ...x, text: `[ocr: transcribed from ${x.name}]\n${text}`, source: 'ocr' } : x))
    } catch (x: any) { s.patch({ notice: { t: `Transcription did not finish (${String(x?.message ?? x)}). Try again, or pick a different endpoint in Settings.` } }) }
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
    // An armed banner sends as the real call so the tool loop and the deep
    // research planner still receive exactly what they expect.
    const raw = armed ? `@${armed}(${v.trim()})` : v, files = att
    if (await s.send(raw, files)) {
      if (useS.getState().draft === v) s.patch({ draft: '' })
      setArmed(null)
      setAtt([])
      setActive(null)
      if (ta.current) ta.current.style.height = 'auto'
    }
  }
  /* Atomic pill editing: every decision uses the real textarea selection, so
     the pill, the caret and the underlying draft can never drift apart. */
  const editDraft = (next: string, caret: number) => { pending.current = caret; setActive(null); s.patch({ draft: next }) }
  const pillKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const t = ta.current
    if (!t || ime) return false
    const edit = pillEdit(segs, e.key, t.selectionStart, t.selectionEnd)
    if (!edit) return false
    e.preventDefault()
    if (edit.kind === 'caret') { setActive(null); t.setSelectionRange(edit.pos, edit.pos); return true }
    editDraft(v.slice(0, edit.start) + v.slice(edit.end), edit.start)
    return true
  }
  const syncActive = () => {
    const t = ta.current
    if (!t) return
    const a = t.selectionStart, b = t.selectionEnd
    const hit = a !== b ? pills.find((m) => m.start === a && m.end === b) : null
    const el = hit ? spans.current[hit.start] : null, host = box.current
    if (!hit || !el || !host) { setActive(null); return }
    const r = el.getBoundingClientRect(), c = host.getBoundingClientRect()
    setActive({ m: hit, left: r.left - c.left + r.width / 2, top: r.top - c.top })
  }
  const selectPill = () => {
    const t = ta.current
    if (!t || ime || t.selectionStart !== t.selectionEnd) return
    const hit = pills.find((m) => t.selectionStart >= m.start && t.selectionStart <= m.end)
    if (!hit) { setActive(null); return }
    t.setSelectionRange(hit.start, hit.end)
    syncActive()
  }
  const dismissBanner = () => {
    if (running === 'search') { s.stop(); return }
    if (armed) { setArmed(null); ta.current?.focus(); return }
    if (typed?.kind === 'research') { s.patch({ draft: typed.query ?? '' }); ta.current?.focus(); return }
    if (typed?.kind === 'search' && typed.m) { s.patch({ draft: stripMention(v, typed.m) }); ta.current?.focus() }
  }
  return (
    <div className="w-full self-center">
      <div className="mx-auto w-full px-4" style={{ maxWidth: composerWidth(s.prefs.chatWidth) }}>
      <Notice cfg={cfg} />
      <div ref={box} className={cx('relative rounded-2xl p-3 transition-colors', s.prefs.glassComposer !== false ? 'glass-composer border border-hov hover:border-bor focus-within:border-bor shadow-lg shadow-black/10' : 'edge-border bg-surf hover:border-bor focus-within:border-bor')} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); add(e.dataTransfer.files) }}>
        {banner && <MentionBanner kind={banner} onDismiss={dismissBanner} warning={banner === 'search' && !searchEnabled ? 'Web search is off.' : undefined} onEnable={banner === 'search' && !searchEnabled ? () => { s.patch({ features: { ...s.features, tools: true }, tools: { ...s.tools, search: true } }) } : undefined} />}
        {menu && !menuOff && (
          <div className="edge-border absolute inset-x-0 bottom-full mb-2 rounded-xl bg-hov p-1.5">
            {menu.length ? menu.map((o, i) => (
              <Item key={o.k} icon={o.icon} on={i === hl} sub={o.hint} onClick={() => { o.pick(); ta.current?.focus() }}>{o.label}</Item>
            )) : <p className="px-2.5 py-3 text-sm text-mu">{tw ? 'No tool matches.' : 'No enabled command matches. Manage commands in Settings.'}</p>}
          </div>
        )}
        {att.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {att.map((a, i) => a.kind === 'img' && a.data ? (
              <div key={i} className={cx('group/preview relative flex h-24 w-28 flex-col overflow-hidden rounded-lg bg-hov p-1.5 ring-1 ring-hov', bad(a) && 'ring-er')} title={a.text ? `${a.name} · transcribed text attached` : a.name}>
                <img src={`data:${a.mime || 'image/*'};base64,${a.data}`} alt={a.name} className="min-h-0 flex-1 rounded object-contain p-1" />
                <span className="truncate px-1 text-xs text-mu" title={a.name}>{a.text ? '✓ ' : ''}{a.name}</span>
                {!a.text && <button aria-label={`Transcribe text from ${a.name}`} title="Transcribe image text with a vision model" onClick={() => { void ocrOne(a) }} disabled={ocrBusy != null} className="absolute bottom-6 left-1 grid size-5 place-items-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover/preview:opacity-100 focus:opacity-100 disabled:opacity-40"><ScanText size={12} /></button>}
                <button aria-label={`Remove ${a.name}`} onClick={() => setAtt(att.filter((_, j) => j !== i))} className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover/preview:opacity-100 focus:opacity-100"><X size={12} /></button>
                {bad(a) && <span className="absolute left-1 right-1 top-7 rounded bg-er/90 px-1 py-0.5 text-center text-xs text-white"><TriangleAlert size={11} className="inline" /> Unsupported</span>}
              </div>
            ) : (
              <span key={i} title={bad(a) ? 'The selected model cannot process this file' : (a.source ? `${a.name} · ${a.source}${a.pages ? ` · ${a.pages} pages` : ''}${a.text ? ` · ${Math.round(a.text.length / 1024)} KB text` : ''}` : undefined)} className={cx('inline-flex items-center gap-1.5 rounded-lg bg-hov py-1 pl-2 pr-1 text-xs', bad(a) && 'text-er')}>
                {bad(a) ? <TriangleAlert size={13} /> : <FileText size={13} />}{a.text && a.kind !== 'txt' ? '✓ ' : ''}{a.name}<span className="text-mu">{a.size}</span>
                <button onClick={() => setAtt(att.filter((_, j) => j !== i))} className="grid size-5 place-items-center rounded hover:bg-surf"><X size={12} /></button>
              </span>
            ))}
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
          <div ref={bd} aria-hidden="true" className={cx('pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-1 py-1', ime && 'invisible')}>
            {segs.map((sg, i) => sg.kind === 'text'
              ? <span key={i}>{sg.text}</span>
              : isPill(sg.m)
                ? <span key={i} ref={(el) => { if (el) spans.current[sg.m.start] = el }} className={cx('mention-pill', !sg.m.enabled && 'mention-pill-off', active?.m.start === sg.m.start && 'mention-pill-sel')}>{sg.m.label}</span>
                : <span key={i}>{sg.m.label}</span>)}
          </div>
          <textarea
            id="composer" ref={ta} rows={1} value={v} placeholder={armed === 'search' ? 'What should I search for?' : armed === 'research' ? 'What should I research?' : s.eps.some(usable) ? (featOn(s, 'commands') && featOn(s, 'tools') ? 'Message, / for commands, @ for tools' : featOn(s, 'commands') ? 'Message, / for commands' : featOn(s, 'tools') ? 'Message, @ for tools' : 'Message') : 'Add a model endpoint to start (press Send for a walkthrough)'}
            onChange={(e) => { setActive(null); s.patch({ draft: e.target.value }); setHi(0) }}
            onScroll={(e) => { if (bd.current) bd.current.scrollTop = e.currentTarget.scrollTop }}
            onKeyDown={(e) => {
              // Never handle Enter/arrows while an IME candidate window is open.
              if (e.nativeEvent.isComposing || ime) return
              if (menu && !menuOff && menu.length && !e.shiftKey && ['ArrowDown', 'ArrowUp', 'Tab', 'Enter'].includes(e.key)) {
                e.preventDefault()
                if (e.key === 'ArrowDown') setHi((hl + 1) % menu.length)
                else if (e.key === 'ArrowUp') setHi((hl - 1 + menu.length) % menu.length)
                else menu[hl].pick()
                return
              }
              if (menu && !menuOff && e.key === 'Escape') { e.preventDefault(); setMenuOff(true); return }
              if (pillKey(e)) return
              if (e.key === 'Enter' && !e.shiftKey && s.prefs.enterSends && !s.busy) { e.preventDefault(); submit() }
            }}
            onSelect={syncActive}
            onClick={selectPill}
            onCompositionStart={() => setIme(true)}
            onCompositionEnd={() => setIme(false)}
            onBlur={() => setActive(null)}
            onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); add(e.clipboardData.files) } }}
            className={cx('mention-input relative max-h-52 w-full resize-none rounded-md bg-transparent px-1 py-1 outline-none', ime ? 'text-tx' : 'text-transparent caret-ac')}
          />
        </div>
        {active && !ime && (
          <MentionInfo m={active.m} cmds={s.cmds} className="absolute" style={{ left: `clamp(8.5rem, ${active.left}px, calc(100% - 8.5rem))`, top: Math.max(active.top - 10, 4), transform: 'translate(-50%, -100%)' }} />
        )}
        <input ref={fi} type="file" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = '' }} />
        <div className="mt-2 flex items-center gap-1">
          <Pop up w="w-64" trigger={() => <Btn icon={Plus} title="Attach files or manage tools" className="rounded-full" />}>
            {(close) => {
              const row = 'flex w-full items-center gap-1 rounded-lg px-1 hover:bg-surf'
              const main = 'flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1.5 py-2 text-left text-sm'
              const gear = 'grid size-7 shrink-0 place-items-center rounded-md text-mu hover:bg-hov hover:text-tx'
              return (
              <>
                <div className={row}>
                  <button className={main} onClick={() => { pick(''); close() }}><FileUp size={16} className="shrink-0 text-mu" /><span className="min-w-0 flex-1 truncate">Upload a file</span></button>
                  <button aria-label="Document settings" title="Document settings" className={gear} onClick={() => { close(); cfg('tools') }}><Settings size={15} /></button>
                </div>
                <div className={row}>
                  <button className={main} onClick={() => { setUrlOpen(true); close() }}><LinkIcon size={16} className="shrink-0 text-mu" /><span className="min-w-0 flex-1 truncate">Attach page from URL</span></button>
                  <button aria-label="Document settings" title="Document settings" className={gear} onClick={() => { close(); cfg('tools') }}><Settings size={15} /></button>
                </div>
                <div className={row}>
                  <button className={main} onClick={() => { s.patch({ draft: v ? `${v.trim()} @research(` : '@research(' }); close(); ta.current?.focus() }}><BookOpen size={16} className="shrink-0 text-mu" /><span className="min-w-0 flex-1 truncate">Deep research…</span></button>
                  <button aria-label="Deep research settings" title="Deep research settings" className={gear} onClick={() => { close(); cfg('tools') }}><Settings size={15} /></button>
                </div>
                <Item icon={Wrench} onClick={() => { close(); cfg('tools') }}>Manage tools…</Item>
              </>
              )
            }}
          </Pop>
          <Pop up w="w-80" scroll={false} trigger={(o) => (
            <button className={chip}>
              {s.sel?.k === 'pl' && featOn(s, 'playlists') ? <ListMusic size={16} /> : <Cpu size={16} />}
              <span className="max-w-40 truncate">{sel ? (s.sel?.model && s.sel.k === 'ep' ? modelNameOf(sel as any, s.sel.model) : sel.name) : 'All endpoints'}</span><ChevronRight size={14} className={cx('transition-transform', o && 'rotate-90')} />
            </button>
          )}>{(close) => <ModelMenu close={close} cfg={cfg} />}</Pop>
          {featOn(s, 'prompts') && <Pop up trigger={(o) => (
            <button className={chip}><ScrollText size={16} /><span className="max-w-32 truncate">{pr ? pr.name : 'No prompt'}</span>{s.globalPrompt?.on && <span className="size-1.5 shrink-0 rounded-full bg-ac" title="Global system prompt on" />}<ChevronRight size={14} className={cx('transition-transform', o && 'rotate-90')} /></button>
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
          <button onClick={s.busy ? s.stop : submit} title={s.busy ? 'Stop' : 'Send'} className={cx('grid size-9 place-items-center rounded-full transition-colors', s.busy || ready ? 'bg-ac text-acx' : 'bg-hov text-mu')}>
            {s.busy ? <Square size={14} fill="currentColor" /> : <ArrowUp size={18} />}
          </button>
        </div>
      </div>
      </div>
      {/* Solid strip from the bottom of the composer to the bottom of the screen. */}
      <div className="bg-bg px-4 pb-4">
        <p className="mx-auto pt-2 text-center text-xs text-mu" style={{ maxWidth: composerWidth(s.prefs.chatWidth) }}>{`${s.prefs.enterSends ? 'Enter to send · Shift+Enter for a new line' : 'Enter adds a new line · send with the button'} · ${fmt(s.keys.palette ?? 'Mod+K')} for the palette`}</p>
      </div>
    </div>
  )
}
