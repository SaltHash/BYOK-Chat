import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Folder, Plus, Pencil, FileText, MessageSquare, Trash2, X, CalendarDays, Files } from 'lucide-react'
import { useS, type Project, type ProjectFile } from '../store'
import { Btn, Confirm, cx } from './ui'
import { Composer } from './Composer'
import { ProjectModal } from './ProjectModal'

const item = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-surf'

function ContextRow({ f, onRemove }: { f: ProjectFile; onRemove: () => void }) {
  return (
    <li className="group flex items-center gap-2 rounded-lg bg-surf px-2.5 py-1.5 text-xs">
      <FileText size={14} className="shrink-0 text-mu" />
      <span className="min-w-0 flex-1 truncate">{f.name}</span>
      <span className="shrink-0 text-mu">{f.size}{f.text ? '' : ' · name only'}</span>
      <button title="Remove file" aria-label={`Remove ${f.name} from project context`} onClick={onRemove} className="grid size-6 shrink-0 place-items-center rounded-md text-mu hover:text-er"><X size={13} /></button>
    </li>
  )
}

/** Project overview: fills the main area when a project is opened from the
 *  sidebar. Centered composer (sends land in a new chat of this project),
 *  recent chats, optional context files, and a few useful details. */
export function ProjectOverview({ project, cfg }: { project: Project; cfg: (t: string) => void }) {
  const chats = useS(useShallow((st) => st.chats.filter((c) => c.project === project.id)))
  const shareOn = project.shareWorkspaces !== false
  const [editModal, setEditModal] = useState(false)
  const [delId, setDelId] = useState('')
  const [confirmFile, setConfirmFile] = useState<ProjectFile | null>(null)
  const recent = chats.filter((c) => !c.pin && !c.temporary)
  const pinned = chats.filter((c) => c.pin)
  const msgs = chats.reduce((n, c) => n + c.msgs.length, 0)
  const created = project.createdAt ? new Date(project.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : null
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="absolute inset-0 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-6 px-4 pb-44 pt-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-surf text-ac"><Folder size={22} /></span>
              <div className="min-w-0">
                <h2 className="truncate text-xl font-semibold">{project.name}</h2>
                <p className="text-sm text-mu">{chats.length} chat{chats.length === 1 ? '' : 's'} · {msgs} message{msgs === 1 ? '' : 's'}{created ? <> · <CalendarDays size={12} className="inline" /> {created}</> : null}</p>
                {/* Workspace-sharing indicator: the live state is always visible here, and the badge doubles as a shortcut to the control in the project editor. */}
                <button onClick={() => setEditModal(true)} className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-dashed border-bor px-2 py-0.5 text-xs text-mu transition-colors hover:bg-surf hover:text-tx" title={shareOn ? 'Workspace sharing is on: chats in this project share one workspace. Open the project editor to change it.' : 'Workspace sharing is off: each chat in this project keeps its own workspace files. Open the project editor to change it.'}>
                  <Files size={12} className={cx('shrink-0', shareOn && 'text-ac')} />
                  {shareOn ? 'Workspace shared across chats' : 'Workspace kept per chat'}
                </button>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Btn v="solid" icon={Plus} onClick={() => useS.getState().newChat()}>New chat</Btn>
              <Btn icon={Pencil} title="Edit project (name and context files)" onClick={() => setEditModal(true)} />
            </div>
          </div>

          <section>
            <h3 className="mb-2 text-xs font-medium text-mu">Recent chats</h3>
            <div className="space-y-0.5 rounded-xl border border-bor p-1.5">
              {pinned.map((c) => (
                <button key={c.id} onClick={() => useS.getState().patch({ chat: c.id, activeProject: '' })} className={cx(item, 'bg-surf')}>
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  <span className="shrink-0 text-xs text-mu">pinned</span>
                </button>
              ))}
              {recent.map((c) => (
                <button key={c.id} onClick={() => useS.getState().patch({ chat: c.id, activeProject: '' })} className={item}>
                  <MessageSquare size={15} className="shrink-0 text-mu" />
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  <span className="shrink-0 text-xs text-mu">{c.msgs.length} msg{c.msgs.length === 1 ? '' : 's'}</span>
                  <button title="Delete chat (hold Shift to skip confirmation)" onClick={(e) => { e.stopPropagation(); if (e.shiftKey) useS.getState().chatOp(c.id, 'del'); else setDelId(c.id) }} className="grid size-7 shrink-0 place-items-center rounded-md text-mu hover:text-er"><Trash2 size={14} /></button>
                </button>
              ))}
              {!chats.length && <p className="px-2.5 py-2 text-sm text-mu">No chats in this project yet. Send a message below to start one.</p>}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-medium text-mu">Project context <span className="font-normal">· optional reference the AI may read in every chat here</span></h3>
              <Btn v="soft" icon={Files} onClick={() => setEditModal(true)}>{project.context?.length ? 'Edit files' : 'Add files'}</Btn>
            </div>
            {project.context?.length ? (
              <ul className="space-y-1 rounded-xl border border-bor p-1.5">
                {project.context.map((f) => <ContextRow key={f.id} f={f} onRemove={() => setConfirmFile(f)} />)}
              </ul>
            ) : (
              <p className="rounded-xl border border-dashed border-bor px-3 py-3 text-sm text-mu">No context files. Add reference material (notes, specs, exports) that the AI may consult when relevant — it is never treated as standing instructions.</p>
            )}
          </section>
        </div>
      </div>
      {/* Centered composer, like a fresh chat: sending from here starts a new
          chat inside this project (the project id rides in the store). */}
      <div className="absolute inset-x-0 top-1/2 z-10 flex -translate-y-1/2 justify-center">
        <div className="w-full px-4"><Composer cfg={cfg} /></div>
      </div>
      {editModal && <ProjectModal close={() => setEditModal(false)} project={project} />}
      {delId && <Confirm title="Delete this chat?" text="This chat and its messages will be permanently removed." ok="Delete" close={() => setDelId('')} run={() => useS.getState().chatOp(delId, 'del')} />}
      {confirmFile && (
        <Confirm title={`Remove ${confirmFile.name}?`} text="The file is removed from this project's context. Chats are not affected." ok="Remove" close={() => setConfirmFile(null)} run={() => useS.getState().setProjectContext(project.id, (project.context ?? []).filter((x) => x.id !== confirmFile.id))} />
      )}
    </div>
  )
}
