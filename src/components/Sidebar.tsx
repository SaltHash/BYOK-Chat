import { useEffect, useRef, useState, type DragEvent } from 'react'
import { Plus, Clock, Search, PanelLeftClose, Pin, Pencil, Trash2, MessageSquare, Server, ListMusic, ScrollText, Terminal, Wrench, Settings, Palette, Lock, PanelRight, Folder, FolderPlus, FolderMinus, ChevronRight, ChevronDown, Bookmark } from 'lucide-react'
import { useS, THEMES, type Chat } from '../store'
import { Btn, Confirm, cx } from './ui'

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

function Row({ c, mv, del }: { c: Chat; mv: (id: string, x: number, y: number) => void; del: (id: string, shift: boolean) => void }) {
  const s = useS()
  const [ed, setEd] = useState(false)
  return (
    <div draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', 'chat:' + c.id)} className={cx('group flex items-center rounded-lg pr-1 text-sm', s.chat === c.id ? 'bg-hov' : 'hover:bg-surf')}>
      {ed ? <Name v={c.title} save={(t) => s.rename(c.id, t)} done={() => setEd(false)} /> : (
        <button onDoubleClick={() => setEd(true)} onClick={() => s.patch({ chat: c.id })} className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-left">
          {c.pin ? <Pin size={15} className="shrink-0 text-ac" /> : c.temporary ? <Clock size={15} className="shrink-0 text-mu" /> : <MessageSquare size={15} className="shrink-0 text-mu" />}
          <span className="truncate">{c.title}{c.temporary ? ' · temporary' : ''}</span>
        </button>
      )}
      <span className="hidden group-hover:flex">
        <button title="Rename" onClick={() => setEd(true)} className={act}><Pencil size={14} /></button>
        <button title="Move to folder" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); mv(c.id, r.left, r.bottom + 4) }} className={act}><Folder size={14} /></button>
        <button title={c.pin ? 'Unpin' : 'Pin'} onClick={() => s.chatOp(c.id, 'pin')} className={act}><Pin size={14} /></button>
        <button title="Delete chat (hold Shift to skip confirmation)" onClick={(e) => del(c.id, e.shiftKey)} className={cx(act, 'hover:text-er')}><Trash2 size={14} /></button>
      </span>
    </div>
  )
}

export function Sidebar({ open, toggle, cfg, width = 288 }: { open: boolean; toggle: () => void; cfg: (t: string) => void; width?: number }) {
  const s = useS()
  const [clock, setClock] = useState(Date.now())
  const [q, setQ] = useState('')
  const [fe, setFe] = useState('')
  const [over, setOver] = useState('')
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [deleteId, setDeleteId] = useState('')
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 30000); return () => clearInterval(timer) }, [])
  useEffect(() => {
    if (!menu) return
    const f = () => setMenu(null)
    addEventListener('mousedown', f)
    return () => removeEventListener('mousedown', f)
  }, [menu])
  const k = q.toLowerCase()
  const L = s.chats.filter((c) => !k || c.title.toLowerCase().includes(k) || c.msgs.some((m) => m.t.toLowerCase().includes(k)))
  const th = Object.keys(THEMES)
  const lib = [
    ['eps', 'Endpoints', Server, s.eps.length],
    ['pls', 'Playlists', ListMusic, s.pls.length],
    ['prompts', 'Prompts', ScrollText, s.prompts.length],
    ['cmds', 'Commands', Terminal, s.cmds.filter((c) => c.on).length],
    ['tools', 'Tools', Wrench, Object.values(s.tools).filter(Boolean).length],
    ['memory', 'Memory', Bookmark, s.memories.length],
    ['widgets', 'Widgets', PanelRight, Object.values(s.widgets).filter(Boolean).length],
  ] as const
  const library = lib.filter(([key]) => s.settingsScope === 'power-user' || key !== 'cmds')
  const mv = (id: string, x: number, y: number) => setMenu({ id, x, y })
  const target = (key: string, to: string) => ({
    onDragOver: (e: DragEvent) => { e.preventDefault(); setOver(key) },
    onDragLeave: () => setOver(''),
    onDrop: (e: DragEvent) => {
      e.preventDefault(); setOver('')
      const [t, id] = e.dataTransfer.getData('text/plain').split(':')
      if (t === 'chat' && id) s.moveChat(id, to)
    },
  })
  const rows = (l: Chat[]) => l.map((c) => <Row key={c.id} c={c} mv={mv} del={(id, shift) => shift ? s.chatOp(id, 'del') : setDeleteId(id)} />)
  if (!open) return null
  const temporary = L.filter((c) => c.temporary)
  const pinned = L.filter((c) => !c.temporary && c.pin), free = L.filter((c) => !c.temporary && !c.pin && !c.folder)
  const timeLeft = (c: Chat) => {
    if (!c.expiresAt) return 'until you leave'
    const mins = Math.max(0, Math.ceil((c.expiresAt - clock) / 60000))
    return mins >= 60 ? `${Math.ceil(mins / 60)}h left` : `${mins}m left`
  }
  const item = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-surf'
  return (
    <aside style={{ width }} className="z-20 flex w-72 min-w-0 shrink-0 flex-col gap-3 bg-side p-3 max-md:fixed max-md:inset-y-0">
      <div className="flex gap-2">
        <Btn v="solid" icon={s.prefs.temporaryByDefault ? Clock : Plus} title={s.prefs.temporaryByDefault ? 'New temporary chat' : 'New chat'} className="flex-1" onClick={() => s.newChat()}>{s.prefs.temporaryByDefault ? 'Temporary chat' : 'New chat'}</Btn>
        <Btn icon={s.prefs.temporaryByDefault ? Plus : Clock} title={s.prefs.temporaryByDefault ? 'New regular chat' : 'New temporary chat'} onClick={() => s.newChat(!s.prefs.temporaryByDefault)} />
        <Btn icon={PanelLeftClose} title="Hide sidebar" onClick={toggle} />
      </div>
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-mu" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles and messages" className="h-9 w-full rounded-lg bg-surf pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ac/40" />
      </div>
      <nav className="-mx-1 flex-1 space-y-3 overflow-y-auto px-1">
        {!!pinned.length && <div><div className="px-2.5 pb-1 text-xs font-medium text-mu">Pinned</div>{rows(pinned)}</div>}
        <div {...target('temporary', '')} className={cx('rounded-lg', over === 'temporary' && 'ring-2 ring-ac')}>
          <div className="px-2.5 pb-1 text-xs font-medium text-mu">Temporary chats</div>
          {temporary.map((c) => <div key={c.id} className="group flex items-center rounded-lg pr-2 text-sm hover:bg-surf">
            <button onClick={() => s.patch({ chat: c.id })} className={cx('flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-left', s.chat === c.id && 'bg-hov')}>
              <Clock size={15} className="shrink-0 text-mu" /><span className="truncate">{c.title}</span>
            </button>
            <span title={c.expiresAt ? `Deletes in ${timeLeft(c)}` : 'Deletes when you leave'} className="shrink-0 text-[11px] text-mu">{timeLeft(c)}</span>
            <button title="Delete chat" onClick={() => setDeleteId(c.id)} className={cx(act, 'ml-1 hidden group-hover:grid hover:text-er')}><Trash2 size={14} /></button>
          </div>)}
          {!temporary.length && <p className="px-2.5 py-1 text-sm text-mu">No temporary chats.</p>}
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
            <div key={f.id} {...target(f.id, f.id)} className={cx('rounded-lg', over === f.id && 'ring-2 ring-ac')}>
              <div className="group flex items-center rounded-lg pr-1 text-sm hover:bg-surf">
                {fe === f.id ? <Name v={f.name} save={(t) => s.renameFolder(f.id, t)} done={() => setFe('')} /> : (
                  <button onClick={() => s.toggleFolder(f.id)} onDoubleClick={() => setFe(f.id)} className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left">
                    {o ? <ChevronDown size={14} className="text-mu" /> : <ChevronRight size={14} className="text-mu" />}
                    <Folder size={15} className="shrink-0 text-mu" /><span className="truncate">{f.name}</span>
                    <span className="text-xs text-mu">{s.chats.filter((c) => c.folder === f.id).length}</span>
                  </button>
                )}
                <span className="hidden group-hover:flex">
                  <button title="Rename folder" onClick={() => setFe(f.id)} className={act}><Pencil size={14} /></button>
                  <button title="Delete folder (its chats are kept)" onClick={() => s.delFolder(f.id)} className={cx(act, 'hover:text-er')}><Trash2 size={14} /></button>
                </span>
              </div>
              {o && <div className="ml-3">{rows(l)}{!l.length && <p className="px-2.5 py-1 text-xs text-mu">Drop chats here.</p>}</div>}
            </div>
          )
        })}
        <div {...target('free', '')} className={cx('rounded-lg', over === 'free' && 'ring-2 ring-ac')}>
          <div className="px-2.5 pb-1 text-xs font-medium text-mu">Recent</div>
          {rows(free)}
          {!free.length && <p className="px-2.5 py-1 text-sm text-mu">{!s.chats.length ? 'No chats yet.' : k ? 'No chats match.' : 'Nothing here. Drop a chat to unfile it.'}</p>}
        </div>
      </nav>
      <div className="space-y-0.5">
        <div className="px-2.5 pb-1 text-xs font-medium text-mu">Library</div>
        {library.map(([key, l, I, n]) => (
          <button key={key} onClick={() => cfg(key)} className={item}>
            <I size={16} className="text-mu" /><span className="flex-1 text-left">{l}</span>{n !== null && <span className="text-xs text-mu">{n}</span>}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <Btn icon={Settings} className="flex-1 justify-start" onClick={() => cfg('eps')}>Settings</Btn>
        <Btn icon={Palette} title={`Theme: ${THEMES[s.theme]}`} onClick={() => s.patch({ theme: th[(th.indexOf(s.theme) + 1) % th.length] as keyof typeof THEMES })} />
      </div>
      <p className="flex items-center gap-1.5 px-1 text-xs text-mu"><Lock size={12} />Keys stay in this browser</p>
      {menu && (
        <div onMouseDown={(e) => e.stopPropagation()} style={{ left: menu.x, top: menu.y }} className="fixed z-40 w-52 rounded-xl bg-hov p-1.5">
          <button onClick={() => { s.moveChat(menu.id, ''); setMenu(null) }} className={item}><FolderMinus size={16} className="text-mu" />No folder</button>
          {s.folders.map((f) => <button key={f.id} onClick={() => { s.moveChat(menu.id, f.id); setMenu(null) }} className={item}><Folder size={16} className="text-mu" /><span className="truncate">{f.name}</span></button>)}
          {!s.folders.length && <p className="px-2.5 py-2 text-xs text-mu">Create a folder first with the folder button.</p>}
        </div>
      )}
      {deleteId && <Confirm title="Delete this chat?" text="This chat and its messages will be permanently removed." ok="Delete" close={() => setDeleteId('')} run={() => s.chatOp(deleteId, 'del')} />}
    </aside>
  )
}
