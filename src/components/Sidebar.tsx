import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Plus, Clock, Search, PanelLeftClose, Pin, Pencil, Trash2, MessageSquare, Server, ListMusic, ScrollText, Terminal, Wrench, Settings, Palette, PanelRight, Folder, FolderPlus, FolderMinus, ChevronRight, Bookmark, Download } from 'lucide-react'
import { useS, chatMd, dl, THEMES, DARK_THEMES, LIGHT_THEMES, themeKeyOf, DEFAULT_LIBRARY_SHOW, featOn, type Chat, type FeatureId } from '../store'
import { searchChats } from '../recall'
import { clampSidebarWidth } from '../layout'
import { Btn, Confirm, cx } from './ui'
import { DndPlaceholder, DndLiveRegion, showDragOverlay, moveDragOverlay, hideDragOverlay, measureBox, DND_ACTIVATION_PX, useFlipAnimate, restDocTop, pointerDocY, edgeScroll } from './dnd'
import { stepInsertion } from '../dndShared'

const act = 'grid size-7 place-items-center rounded-md text-mu hover:text-tx'

function Name({ v, save, done }: { v: string; save: (t: string) => void; done: () => void }) {
  const [t, setT] = useState(v)
  const cancel = useRef(false)
  return (
    <input autoFocus value={t} onChange={(e) => setT(e.target.value)} onFocus={(e) => e.currentTarget.select()}
      onBlur={() => { if (!cancel.current && t.trim()) save(t.trim()); done() }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { cancel.current = true; e.currentTarget.blur() } }}
      className="mx-1 min-w-0 flex-1 rounded-md bg-bg px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ac/40" />
  )
}

type RowDnd = { register: (id: string) => (el: HTMLDivElement | null) => void; handle: (chat: Chat, container: string, index: number) => { className: string; tabIndex: number; role: string; 'aria-label': string; 'aria-pressed': boolean; onPointerDown: (e: React.PointerEvent) => void; onKeyDown: (e: React.KeyboardEvent) => void }; activeId: string | null }
type RowProps = { c: Chat; mv: (id: string, x: number, y: number) => void; del: (id: string, shift: boolean) => void; dnd: RowDnd; container: string; index: number }

function RowBody({ c, mv, del, dnd, container, index }: RowProps) {
  // The only store field a row renders is whether it is the open chat; the
  // actions are stable and read on demand, so a streamed chunk or a keystroke
  // in the composer does not re-render the list.
  const selected = useS((s) => s.chat === c.id)
  const [ed, setEd] = useState(false)
  const dragging = dnd.activeId === c.id
  const h = dnd.handle(c, container, index)
  return (
    <div ref={dnd.register(c.id)} data-chat-row={c.id}
      {...h} title="Drag to move to a folder"
      className={cx('dnd-handle group flex cursor-grab items-center rounded-lg pr-1 text-sm', selected ? 'bg-hov' : 'hover:bg-surf', dragging && 'opacity-25')}>
      {ed ? <Name v={c.title} save={(t) => useS.getState().rename(c.id, t)} done={() => setEd(false)} /> : (
        <button onDoubleClick={() => setEd(true)} onClick={() => useS.getState().patch({ chat: c.id })} className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-left">
          {c.pin ? <Pin size={15} className="shrink-0 text-ac" /> : c.temporary ? <Clock size={15} className="shrink-0 text-mu" /> : <MessageSquare size={15} className="shrink-0 text-mu" />}
          <span className="truncate">{c.title}{c.temporary ? ' · temporary' : ''}</span>
        </button>
      )}
      <span className="dnd-actions hidden group-hover:flex">
        <button title="Rename" onClick={() => setEd(true)} className={act}><Pencil size={14} /></button>
        <button title="Export this chat (.md + .json)" onClick={() => {
          const chat = useS.getState().chats.find((x) => x.id === c.id)
          if (!chat) return
          const base = chat.title.replace(/[^\w-]+/g, '_')
          dl(`${base}.md`, chatMd(chat), 'text/markdown')
          dl(`${base}.json`, JSON.stringify({ v: 4, chats: [chat] }, null, 1), 'application/json')
        }} className={act}><Download size={14} /></button>
        <button title="Move to folder" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); mv(c.id, r.left, r.bottom + 4) }} className={act}><Folder size={14} /></button>
        <button title={c.pin ? 'Unpin' : 'Pin'} onClick={() => useS.getState().chatOp(c.id, 'pin')} className={act}><Pin size={14} /></button>
        <button title="Delete chat (hold Shift to skip confirmation)" onClick={(e) => del(c.id, e.shiftKey)} className={cx(act, 'hover:text-er')}><Trash2 size={14} /></button>
      </span>
    </div>
  )
}

const Row = memo(RowBody, (a, b) =>
  a.container === b.container && a.index === b.index && a.dnd === b.dnd && a.mv === b.mv && a.del === b.del
  && a.c.id === b.c.id && a.c.title === b.c.title && a.c.pin === b.c.pin && a.c.temporary === b.c.temporary)

export function Sidebar({ open, toggle, cfg, width = 288 }: { open: boolean; toggle: () => void; cfg: (t: string) => void; width?: number }) {
  /* Narrow slice: the sidebar shows chat metadata, folder names and library
     counts. Composer keystrokes, streaming text and widget state no longer
     re-render the whole list. Actions are stable, so subscribing to them is
     free and keeps the call sites unchanged. */
  const s = useS(useShallow((st) => ({
    chats: st.chats, chat: st.chat, folders: st.folders, prefs: st.prefs,
    themeMode: st.themeMode, themeLight: st.themeLight, themeDark: st.themeDark, libraryShow: st.libraryShow,
    eps: st.eps, pls: st.pls, prompts: st.prompts, cmds: st.cmds, tools: st.tools, memories: st.memories, widgets: st.widgets, features: st.features,
    patch: st.patch, newChat: st.newChat, renameFolder: st.renameFolder, toggleFolder: st.toggleFolder, delFolder: st.delFolder, addFolder: st.addFolder, moveChat: st.moveChat,
  })))
  const [clock, setClock] = useState(Date.now())
  const [q, setQ] = useState('')
  const [fe, setFe] = useState('')
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [deleteId, setDeleteId] = useState('')
  const [folderId, setFolderId] = useState('')
  // The temporary section is collapsed to its two newest chats by default and
  // capped at a fraction of the sidebar's height, past which it scrolls.
  const [tempOpen, setTempOpen] = useState(false)
  const [sideH, setSideH] = useState(0)
  const asideRef = useRef<HTMLElement>(null)
  // Pointer-based cross-container drag state (replaces HTML5 DnD): the dragged
  // chat follows the pointer in an overlay while a wireframe placeholder marks
  // the live insertion point inside the hovered folder (or Recent).
  const [dragId, setDragId] = useState<string | null>(null)
  const [target, setTarget] = useState<{ folder: string; at: number } | null>(null)
  const [box, setBox] = useState<{ w: number; h: number; radius: string } | null>(null)
  const [dndMsg, setDndMsg] = useState('')
  const rowEls = useRef(new Map<string, HTMLDivElement>())
  const zoneEls = useRef(new Map<string, HTMLDivElement>())
  const navRef = useRef<HTMLElement>(null)
  const pending = useRef<{ id: string; startX: number; startY: number; dx: number; dy: number } | null>(null)
  const dragRef = useRef<{ id: string; dx: number; dy: number; lastY: number; raf: number } | null>(null)
  const dragState = useRef({ dragId: null as string | null, target: null as { folder: string; at: number } | null })
  dragState.current = { dragId, target }
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 30000); return () => clearInterval(timer) }, [])
  // Track the sidebar's height so the temporary section can be capped relative
  // to it regardless of viewport size or the user's resized width.
  useEffect(() => {
    const el = asideRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = () => setSideH(el.getBoundingClientRect().height)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [open])
  useEffect(() => {
    if (!menu) return
    const f = () => setMenu(null)
    addEventListener('mousedown', f)
    return () => removeEventListener('mousedown', f)
  }, [menu])
  const k = q.toLowerCase()
  // Filter and partition in single passes, memoized: the list only changes
  // when chats or the query change, not on every unrelated store write.
  const L = useMemo(
    () => s.chats.filter((c) => !k || c.title.toLowerCase().includes(k) || c.msgs.some((m) => m.t.toLowerCase().includes(k))),
    [s.chats, k],
  )
  const { temporary, pinned, free } = useMemo(() => {
    const out = { temporary: [] as Chat[], pinned: [] as Chat[], free: [] as Chat[] }
    for (const c of L) {
      if (c.temporary) out.temporary.push(c)
      else if (c.pin) out.pinned.push(c)
      else if (!c.folder) out.free.push(c)
    }
    return out
  }, [L])
  const folderCounts = useMemo(() => {
    const m = new Map<string, number>()
    // Count only what the folder actually lists: pinned and temporary chats
    // are rendered in their own sections, so counting them here made the
    // badge disagree with the visible rows.
    for (const c of s.chats) if (c.folder && !c.pin && !c.temporary) m.set(c.folder, (m.get(c.folder) ?? 0) + 1)
    return m
  }, [s.chats])
  // Ranked message search (BM25): one hit per chat with a text snippet.
  // Jump-to-message sets flashMsg, which Chat highlights and scrolls to.
  const hits = useMemo(() => (k ? searchChats(s.chats, q, 30) : []), [s.chats, q, k])
  const jump = (chatId: string, msgId: string | null) => {
    s.patch({ chat: chatId, flashMsg: msgId })
    if (typeof window !== 'undefined' && window.innerWidth < 768) toggle()
  }
  const th = s.themeMode === 'light' ? [...LIGHT_THEMES, 'custom'] : [...DARK_THEMES, 'custom']
  const thCur = s.themeMode === 'light' ? s.themeLight : s.themeDark
  const thNext = th[(th.indexOf(thCur) + 1) % th.length]
  const libFeature: Record<string, FeatureId> = { pls: 'playlists', prompts: 'prompts', cmds: 'commands', tools: 'tools', memory: 'memory', widgets: 'widgets' }
  const show = s.libraryShow ?? DEFAULT_LIBRARY_SHOW
  const lib: [string, string, typeof Server, number][] = [
    ['eps', 'Endpoints', Server, s.eps.length],
    ['pls', 'Playlists', ListMusic, s.pls.length],
    ['prompts', 'Prompts', ScrollText, s.prompts.length],
    ['cmds', 'Commands', Terminal, s.cmds.filter((c) => c.on).length],
    ['tools', 'Tools', Wrench, Object.values(s.tools).filter(Boolean).length],
    ['memory', 'Memory', Bookmark, s.memories.length],
    ['widgets', 'Widgets', PanelRight, Object.values(s.widgets).filter(Boolean).length],
  ]
  const library = lib.filter(([key]) => (show[key] ?? true) && (!libFeature[key] || featOn(s, libFeature[key])))
  const mv = useCallback((id: string, x: number, y: number) => setMenu({ id, x, y }), [])
  const registerRow = useCallback((id: string) => (el: HTMLDivElement | null) => {
    if (el) rowEls.current.set(id, el)
    else rowEls.current.delete(id)
  }, [])
  const registerZone = useCallback((key: string) => (el: HTMLDivElement | null) => {
    if (el) zoneEls.current.set(key, el)
    else zoneEls.current.delete(key)
  }, [])
  const zoneKeys = useMemo(() => ['', ...s.folders.map((f) => f.id)], [s.folders])
  // Live snapshot for window-level listeners (attached once; always current).
  const live = useRef({ L, zoneKeys, folders: s.folders })
  live.current = { L, zoneKeys, folders: s.folders }
  // Stable, ref-reading: the drag listeners and the memoized rows call these,
  // so they must not be rebuilt when the list re-renders.
  const liveMembers = useCallback((folder: string, exclude?: string | null) =>
    live.current.L.filter((c) => !c.temporary && !c.pin && (folder ? c.folder === folder : !c.folder) && c.id !== exclude), [])

  const computeTarget = (clientY: number): { folder: string; at: number } | null => {
    const d = dragRef.current
    const exclude = d?.id ?? dragState.current.dragId
    for (const [key, el] of zoneEls.current) {
      const r = el.getBoundingClientRect()
      if (clientY < r.top - 8 || clientY > r.bottom + 8) continue
      const rows = liveMembers(key, exclude)
      // Transform-free midpoints: live rects include in-flight FLIP offsets and
      // would feed back into the placement decision.
      const mids: number[] = []
      for (const c of rows) {
        const row = rowEls.current.get(c.id)
        if (!row) continue
        mids.push(restDocTop(row) + row.getBoundingClientRect().height / 2)
      }
      const prev = dragState.current.target
      const current = prev && prev.folder === key ? prev.at : rows.length
      return { folder: key, at: stepInsertion(mids, pointerDocY(clientY, el), current) }
    }
    return null
  }

  // Stable: reads the drag state through refs, so it can be a dependency of the
  // once-attached window listeners and of the memoized row handlers.
  const endDrag = useCallback((commit: boolean, override?: { folder: string; at: number } | null) => {
    const d = dragRef.current
    const st = dragState.current
    const id = d?.id ?? st.dragId
    // Pointer releases pass a target computed from the latest pointer position.
    const t = override !== undefined ? override : st.target
    if (d) cancelAnimationFrame(d.raf)
    dragRef.current = null
    pending.current = null
    hideDragOverlay()
    setDragId(null)
    setTarget(null)
    setBox(null)
    if (commit && id && t) {
      const store = useS.getState()
      const all = [...store.chats]
      const cur = all.findIndex((c) => c.id === id)
      if (cur >= 0) {
        const [chat] = all.splice(cur, 1)
        const updated: Chat = { ...chat, folder: t.folder || undefined, ...(chat.pin ? { pin: false } : null) }
        // Exclude the dragged chat so `t.at` (computed without it) indexes the same list.
        const list = liveMembers(t.folder, id)
        const before = list[Math.min(t.at, list.length)]
        let idx = all.length
        if (before) {
          const bi = all.findIndex((c) => c.id === before.id)
          if (bi >= 0) idx = bi
        } else {
          for (let i = all.length - 1; i >= 0; i--) {
            const c = all[i]
            if (!c.temporary && !c.pin && (t.folder ? c.folder === t.folder : !c.folder)) { idx = i + 1; break }
          }
        }
        all.splice(idx, 0, updated)
        store.patch({ chats: all })
        const label = t.folder ? (live.current.folders.find((f) => f.id === t.folder)?.name ?? 'folder') : 'Recent'
        setDndMsg(`${chat.title} moved to ${label} at position ${Math.min(t.at, list.length) + 1}.`)
      }
    } else {
      setDndMsg('Chat drag cancelled. Order unchanged.')
    }
  }, [liveMembers])

  useEffect(() => {
    const mvWindow = (e: PointerEvent) => {
      const d = dragRef.current
      const p = pending.current
      if (d) {
        e.preventDefault()
        const { clientX, clientY } = e
        d.lastY = clientY
        cancelAnimationFrame(d.raf)
        d.raf = requestAnimationFrame(() => {
          moveDragOverlay(clientX, clientY, d.dx, d.dy)
          const t = computeTarget(clientY)
          const cur = dragState.current.target
          if ((t?.folder !== cur?.folder || t?.at !== cur?.at) && !(t == null && cur == null)) setTarget(t)
          edgeScroll(clientY, [navRef.current])
        })
        return
      }
      if (p) {
        if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) < DND_ACTIVATION_PX) return
        const el = rowEls.current.get(p.id)
        pending.current = null
        if (!el) return
        const b = measureBox(el)
        dragRef.current = { id: p.id, dx: p.dx, dy: p.dy, lastY: e.clientY, raf: 0 }
        showDragOverlay(el, e.clientX, e.clientY)
        setBox(b)
        setDragId(p.id)
        const src = live.current.L.find((c) => c.id === p.id)
        if (!src) return
        const srcKey = !src.temporary && !src.pin ? (src.folder ?? '') : ''
        const list = liveMembers(srcKey, p.id)
        const srcIdx = live.current.L.filter((c) => !c.temporary && (src.pin ? c.pin : !c.pin && (srcKey ? c.folder === srcKey : !c.folder))).findIndex((c) => c.id === p.id)
        setTarget({ folder: live.current.zoneKeys.includes(srcKey) ? srcKey : '', at: src.pin ? list.length : Math.max(0, srcIdx) })
        setDndMsg(`${src.title} lifted. Move to choose a folder and position, release to drop, Escape to cancel.`)
      }
    }
    // A release over a row button makes the browser dispatch a click on it. That
    // click would open the chat and re-render the list right after the drop, so
    // swallow the first click that follows a drag.
    let swallowClick = false
    const swallow = (e: MouseEvent) => {
      if (!swallowClick) return
      swallowClick = false
      e.stopPropagation()
      e.preventDefault()
    }
    const up = () => {
      const d = dragRef.current
      if (d) {
        const t = computeTarget(d.lastY)
        swallowClick = true
        setTimeout(() => { swallowClick = false }, 50)
        endDrag(!!t, t)
      } else pending.current = null
    }
    const cancel = () => { if (dragRef.current) endDrag(false); else pending.current = null }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (dragRef.current || dragState.current.dragId)) {
        e.preventDefault()
        e.stopPropagation()
        endDrag(false)
      }
    }
    window.addEventListener('pointermove', mvWindow, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key, true)
    window.addEventListener('click', swallow, true)
    return () => {
      window.removeEventListener('click', swallow, true)
      window.removeEventListener('pointermove', mvWindow)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key, true)
    }
    // Attached once; render-fresh data flows through refs above and `endDrag`
    // is stable (it reads refs + `useS.getState()`).
  }, [endDrag])

  // Animate rows around the live placeholder; keyed on the visible row order so
  // unrelated re-renders (e.g. the clock tick) never disturb in-flight motion.
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const flipKey = `${L.map((c) => c.id).join(',')}|${dragId ?? ''}|${target ? `${target.folder}:${target.at}` : ''}`
  useFlipAnimate(rowEls, !!reducedMotion, flipKey)

  // Stable row handlers: depend only on refs and setState, so memoized rows
  // keep their props between renders (including during a drag, apart from the
  // `activeId` flip that legitimately changes every row's dnd object).
  const rowHandle = useCallback((chat: Chat, container: string, index: number) => ({
    className: 'dnd-handle',
    tabIndex: 0,
    role: 'button' as const,
    'aria-label': `${chat.title}. Press Space to lift and move between folders.`,
    'aria-pressed': dragState.current.dragId === chat.id,
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      // Action buttons share the row surface: a press on one must not arm the
      // row drag (the title area is still a valid drag handle).
      if (e.target instanceof Element && e.target.closest('.dnd-actions')) return
      const el = rowEls.current.get(chat.id)
      if (!el) return
      const r = el.getBoundingClientRect()
      pending.current = { id: chat.id, startX: e.clientX, startY: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top }
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      const active = dragState.current.dragId
      if (active !== chat.id) {
        if (e.key === ' ' && !active) {
          e.preventDefault()
          const el = rowEls.current.get(chat.id)
          const b = el ? measureBox(el) : { w: 0, h: 40, radius: '8px' }
          dragRef.current = null
          setBox(b)
          setDragId(chat.id)
          if (container === 'pinned' || container === 'temporary') {
            setTarget({ folder: '', at: liveMembers('', chat.id).length })
          } else {
            setTarget({ folder: container, at: index })
          }
          setDndMsg(`${chat.title} lifted. Arrow keys choose position, Left and Right switch folders, Space drops, Escape cancels.`)
        }
        return
      }
      const t = dragState.current.target ?? { folder: '', at: 0 }
      const list = liveMembers(t.folder, chat.id)
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const d = e.key === 'ArrowDown' ? 1 : -1
        setTarget({ folder: t.folder, at: Math.max(0, Math.min(list.length, t.at + d)) })
        setDndMsg(`Destination position ${Math.max(0, Math.min(list.length, t.at + d)) + 1} of ${list.length + 1}.`)
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault()
        const keys = live.current.zoneKeys
        const i = keys.indexOf(t.folder)
        const next = keys[(i + (e.key === 'ArrowRight' ? 1 : keys.length - 1)) % keys.length]
        const nl = liveMembers(next, chat.id)
        setTarget({ folder: next, at: nl.length })
        setDndMsg(`Destination folder ${next ? (live.current.folders.find((f) => f.id === next)?.name ?? 'folder') : 'Recent'}. Position ${nl.length + 1}.`)
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        endDrag(true)
      } else if (e.key === 'Home') {
        e.preventDefault()
        setTarget({ folder: t.folder, at: 0 })
      } else if (e.key === 'End') {
        e.preventDefault()
        setTarget({ folder: t.folder, at: list.length })
      }
    },
  }), [endDrag, liveMembers])

  const del = useCallback((id: string, shift: boolean) => {
    if (shift) useS.getState().chatOp(id, 'del')
    else setDeleteId(id)
  }, [])
  const dnd = useMemo(() => ({ register: registerRow, handle: rowHandle, activeId: dragId }), [registerRow, rowHandle, dragId])

  const rows = (l: Chat[], container: string) => {
    // The dragged row is replaced by the live placeholder so the destination
    // index always refers to the visible rows (no duplicates, no gaps). The
    // source index is carried through the pass instead of searched per row.
    const shown: { c: Chat; index: number }[] = []
    l.forEach((c, index) => { if (c.id !== dragId) shown.push({ c, index }) })
    const drop = dragId && target && container !== 'pinned' && container !== 'temporary' && container === target.folder
      ? Math.max(0, Math.min(target.at, shown.length))
      : -1
    const items: ReactNode[] = []
    shown.forEach(({ c, index }, i) => {
      if (i === drop) items.push(<DndPlaceholder key="__drop" height={box?.h ?? 40} radius={box?.radius} />)
      items.push(<Row key={c.id} c={c} mv={mv} del={del} dnd={dnd} container={container} index={index} />)
    })
    if (drop === shown.length) items.push(<DndPlaceholder key="__drop" height={box?.h ?? 40} radius={box?.radius} />)
    return items
  }
  if (!open) return null
  const timeLeft = (c: Chat) => {
    if (!c.expiresAt) return 'until you leave'
    const mins = Math.max(0, Math.ceil((c.expiresAt - clock) / 60000))
    return mins >= 60 ? `${Math.floor(mins / 60)}h left` : `${mins}m left`
  }
  // Cap the temporary section at 40% of the sidebar so it can never crowd out
  // folders and Recent; beyond the cap the chat list scrolls within the frame.
  const tempMaxH = sideH ? Math.floor(sideH * 0.4) : undefined
  const tempVisible = tempOpen ? temporary : temporary.slice(0, 2)
  const item = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-surf'
  const safeWidth = clampSidebarWidth(width)
  return (
    <aside ref={asideRef} style={{ width: safeWidth, maxWidth: '90vw' }} className="z-20 flex min-w-0 shrink-0 flex-col gap-3 border-r border-bor bg-side p-3 max-md:fixed max-md:inset-y-0">
      <div className="flex gap-2">
        <Btn v="solid" icon={s.prefs.temporaryByDefault ? Clock : Plus} title={s.prefs.temporaryByDefault ? 'New temporary chat' : 'New chat'} className="flex-1" onClick={() => s.newChat()}>{s.prefs.temporaryByDefault ? 'Temporary chat' : 'New chat'}</Btn>
        <Btn icon={s.prefs.temporaryByDefault ? Plus : Clock} title={s.prefs.temporaryByDefault ? 'New regular chat' : 'New temporary chat'} onClick={() => s.newChat(!s.prefs.temporaryByDefault)} />
        <Btn icon={PanelLeftClose} title="Hide sidebar" onClick={toggle} />
      </div>
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-mu" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles and messages" className="h-9 w-full rounded-lg bg-surf pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ac/40" />
      </div>
      <nav ref={navRef} data-dnd-scroll="" className="-mx-1 flex-1 space-y-3 overflow-y-auto px-1">
        {k ? (
          <div>
            <div className="px-2.5 pb-1 text-xs font-medium text-mu">{hits.length ? `Top matches (${hits.length})` : 'No matches'}</div>
            {hits.map((h) => {
              const c = s.chats.find((x) => x.id === h.chatId)
              if (!c) return null
              return (
                <button key={h.chatId} onClick={() => jump(h.chatId, h.msgId)} className={cx('block w-full rounded-lg px-2.5 py-2 text-left text-sm hover:bg-surf', s.chat === h.chatId && 'bg-hov')}>
                  <span className="flex items-center gap-2">
                    {c.pin ? <Pin size={13} className="shrink-0 text-ac" /> : c.temporary ? <Clock size={13} className="shrink-0 text-mu" /> : <MessageSquare size={13} className="shrink-0 text-mu" />}
                    <span className="min-w-0 flex-1 truncate font-medium">{c.title}</span>
                  </span>
                  {(h.pre || h.match) && (
                    <span className="mt-1 block truncate text-xs text-mu">{h.pre}<mark className="rounded bg-ac/25 px-0.5 text-tx">{h.match}</mark>{h.post}</span>
                  )}
                </button>
              )
            })}
          </div>
        ) : (
        <>
        {!!pinned.length && <div><div className="px-2.5 pb-1 text-xs font-medium text-mu">Pinned</div>{rows(pinned, 'pinned')}</div>}
        <div className="flex flex-col rounded-lg" style={{ maxHeight: tempMaxH }}>
          <div className="shrink-0 px-2.5 pb-1 text-xs font-medium text-mu">Temporary chats</div>
          <div className="min-h-0 overflow-y-auto">
            {tempVisible.map((c) => <div key={c.id} className={cx('group flex items-center rounded-lg pr-2 text-sm', s.chat === c.id ? 'bg-hov' : 'hover:bg-surf')}>
              <button onClick={() => s.patch({ chat: c.id })} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left">
                <Clock size={15} className="shrink-0 text-mu" /><span className="truncate">{c.title}</span>
              </button>
              <span title={c.expiresAt ? `Deletes in ${timeLeft(c)}` : 'Deletes when you leave'} className="shrink-0 text-xs text-mu">{timeLeft(c)}</span>
              <button title="Delete chat (hold Shift to skip confirmation)" onClick={(e) => del(c.id, e.shiftKey)} className={cx(act, 'ml-1 hidden group-hover:grid hover:text-er')}><Trash2 size={14} /></button>
            </div>)}
            {!temporary.length && <p className="px-2.5 py-1 text-sm text-mu">No temporary chats. Nothing to clean up, nice.</p>}
          </div>
          {temporary.length > 2 && (
            <button onClick={() => setTempOpen((v) => !v)} aria-expanded={tempOpen} className="mt-0.5 shrink-0 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-mu hover:bg-surf hover:text-tx">
              {tempOpen ? 'Show less' : `Show more (${temporary.length - 2})`}
            </button>
          )}
        </div>
        <div className="flex items-center justify-between px-2.5 text-xs font-medium text-mu">
          <span>Folders</span>
          <button title="New folder" onClick={() => setFe(s.addFolder())} className="grid size-6 place-items-center rounded-md hover:text-tx"><FolderPlus size={14} /></button>
        </div>
        {s.folders.map((f) => {
          const l = L.filter((c) => c.folder === f.id && !c.pin)
          if (k && !l.length) return null
          const o = f.open || !!k
          return (
            <div key={f.id} ref={registerZone(f.id)} className="rounded-lg">
              <div className="group flex items-center rounded-lg pr-1 text-sm hover:bg-surf">
                {fe === f.id ? <Name v={f.name} save={(t) => s.renameFolder(f.id, t)} done={() => setFe('')} /> : (
                  <button onClick={() => s.toggleFolder(f.id)} onDoubleClick={() => setFe(f.id)} className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left">
                    <span className="relative grid shrink-0 place-items-center" aria-hidden="true">
                      <Folder size={20} className="text-mu" />
                      <span className="absolute inset-0 flex items-center justify-center pt-[3px] text-[9px] font-semibold leading-none text-mu">{folderCounts.get(f.id) ?? 0}</span>
                    </span><span className="min-w-0 truncate">{f.name}<span className="sr-only"> ({folderCounts.get(f.id) ?? 0} chats)</span></span>
                    <ChevronRight size={14} className={cx('shrink-0 text-mu transition-transform', o && 'rotate-90')} />
                  </button>
                )}
                <span className="hidden group-hover:flex">
                  <button title="Rename folder" onClick={() => setFe(f.id)} className={act}><Pencil size={14} /></button>
                  <button title="Delete folder (its chats are kept)" onClick={() => setFolderId(f.id)} className={cx(act, 'hover:text-er')}><Trash2 size={14} /></button>
                </span>
              </div>
              {o && <div className="ml-3">{rows(l, f.id)}{!l.length && !dragId && <p className="px-2.5 py-1 text-xs text-mu">Drop chats here.</p>}</div>}
            </div>
          )
        })}
        <div ref={registerZone('')} className="rounded-lg">
          <div className="px-2.5 pb-1 text-xs font-medium text-mu">Recent</div>
          {rows(free, '')}
          {!free.length && <p className="px-2.5 py-1 text-sm text-mu">{!s.chats.length ? 'No chats yet.' : k ? 'No chats match.' : 'Nothing here. Drop a chat to unfile it.'}</p>}
        </div>
        </>
        )}
      </nav>
      {featOn(s, 'library') && (
      <div className="space-y-0.5">
        <div className="px-2.5 pb-1 text-xs font-medium text-mu">Library</div>
        {library.map(([key, l, I, n]) => (
          <button key={key} onClick={() => cfg(key)} className={item}>
            <I size={16} className="text-mu" /><span className="flex-1 text-left">{l}</span>{n !== null && <span className="text-xs text-mu">{n}</span>}
          </button>
        ))}
      </div>
      )}
      <div className="flex items-center gap-1">
        <Btn icon={Settings} className="flex-1 justify-start" onClick={() => cfg('eps')}>Settings</Btn>
        <Btn icon={Palette} title={`Theme: ${THEMES[themeKeyOf(s)]}`} onClick={() => s.patch(s.themeMode === 'light' ? { themeLight: thNext as typeof s.themeLight } : { themeDark: thNext as typeof s.themeDark })} />
      </div>
      {menu && (
        <div onMouseDown={(e) => e.stopPropagation()} style={{ left: Math.min(menu.x, Math.max(8, (typeof window !== 'undefined' ? window.innerWidth : 0) - 216)), top: Math.min(menu.y, Math.max(8, (typeof window !== 'undefined' ? window.innerHeight : 0) - (60 + (s.folders.length + 1) * 36))) }} className="fixed z-40 w-52 rounded-xl bg-hov p-1.5">
          <button onClick={() => { s.moveChat(menu.id, ''); setMenu(null) }} className={item}><FolderMinus size={16} className="text-mu" />No folder</button>
          {s.folders.map((f) => <button key={f.id} onClick={() => { s.moveChat(menu.id, f.id); setMenu(null) }} className={item}><Folder size={16} className="text-mu" /><span className="truncate">{f.name}</span></button>)}
          {!s.folders.length && <p className="px-2.5 py-2 text-xs text-mu">Create a folder first with the folder button.</p>}
        </div>
      )}
      {deleteId && <Confirm title="Delete this chat?" text="This chat and its messages will be permanently removed." ok="Delete" close={() => setDeleteId('')} run={() => useS.getState().chatOp(deleteId, 'del')} />}
      {folderId && <Confirm title="Delete this folder?" text="The folder is removed; its chats are kept and move back to Recent." ok="Delete folder" close={() => setFolderId('')} run={() => s.delFolder(folderId)} />}
      <DndLiveRegion message={dndMsg} />
    </aside>
  )
}
