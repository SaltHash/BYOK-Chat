import { useRef, useState } from 'react'
import { FileUp, FileText, X, Folder } from 'lucide-react'
import { useS, type Project, type ProjectFile } from '../store'
import { Btn, Modal, Toggle, cx } from './ui'

/* Optional project context files are stored with their extracted text inline
 * (like text-backed chat attachments). Binary files (images, PDFs) are kept
 * name-only: the AI sees their names but no content. Pure helper. */
const MAX_TEXT = 20000
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36)
const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`)
const TEXTUAL = /\.(md|txt|json|csv|tsv|log|ya?ml|toml|ini|xml|html?|css|s?css|js|jsx|mjs|cjs|ts|tsx|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|sh|bash|zsh|sql|graphql|env|gitignore|dockerfile)$/i

async function readContextFile(file: File): Promise<ProjectFile> {
  const base: ProjectFile = { id: uid(), name: file.name, size: fmtSize(file.size), mime: file.type || undefined, text: '' }
  const textual = file.type.startsWith('text/') || TEXTUAL.test(file.name)
  if (!textual || file.size > 2 * 1048576) return base
  try {
    let text = await file.text()
    if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + '\n[truncated]'
    return { ...base, text }
  } catch { return base }
}

/** Create or edit a project: set its name and attach optional context files
 *  the AI may consult in any chat of the project. */
export function ProjectModal({ close, project }: { close: () => void; project?: Project }) {
  const editing = !!project
  const [name, setName] = useState(project?.name ?? '')
  const [files, setFiles] = useState<ProjectFile[]>(project?.context ?? [])
  const [shareWs, setShareWs] = useState(project?.shareWorkspaces !== false)
  const [over, setOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const add = async (list: FileList | File[]) => {
    const read = await Promise.all(Array.from(list).map(readContextFile))
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => f.name))
      return [...prev, ...read.filter((f) => !seen.has(f.name))]
    })
  }
  const save = () => {
    const s = useS.getState()
    const finalName = (name.trim() || 'New project').slice(0, 40)
    if (editing && project) {
      s.renameProject(project.id, finalName)
      s.setProjectContext(project.id, files)
      s.setProjectShareWorkspaces(project.id, shareWs)
    } else {
      const id = s.addProject(finalName, files)
      s.setProjectShareWorkspaces(id, shareWs)
      s.openProject(id)
    }
    close()
  }
  return (
    <Modal close={close}>
      <div className="modal-panel flex w-full max-w-md flex-col gap-4 rounded-2xl bg-bg p-5">
        <div className="flex items-center gap-2 font-semibold"><Folder size={18} className="text-ac" />{editing ? 'Edit project' : 'New project'}</div>
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-mu">Name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save() }}
            placeholder="New project" maxLength={40}
            className="h-9 w-full rounded-lg bg-surf px-3 text-sm outline-none focus:ring-2 focus:ring-ac/40" />
        </label>
        <div className="text-sm">
          <span className="mb-1 block text-xs font-medium text-mu">Context files <span className="font-normal">(optional)</span></span>
          {/* Drop zone + picker. Files land as reference material only: the AI
              may read them when relevant, they are never standing orders. */}
          <div onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); void add(e.dataTransfer.files) }}
            className={cx('rounded-xl border border-dashed p-3 text-center text-xs text-mu transition-colors', over ? 'border-ac bg-ac/10' : 'border-bor')}>
            Drop files here or
            <button onClick={() => inputRef.current?.click()} className="mx-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-ac hover:bg-surf"><FileUp size={13} />browse</button>
            <input ref={inputRef} type="file" multiple hidden onChange={(e) => { if (e.target.files) void add(e.target.files); e.target.value = '' }} />
            <p className="mt-1 text-[11px] text-mu/70">Text files are read as content; other files keep their name only. The AI treats them as background it may consult — not instructions.</p>
          </div>
          {!!files.length && (
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
              {files.map((f) => (
                <li key={f.id} className="flex items-center gap-2 rounded-lg bg-surf px-2.5 py-1.5 text-xs">
                  <FileText size={14} className="shrink-0 text-mu" />
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <span className="shrink-0 text-mu">{f.size}{f.text ? '' : ' · name only'}</span>
                  <button title="Remove file" onClick={() => setFiles((prev) => prev.filter((x) => x.id !== f.id))} className="grid size-6 shrink-0 place-items-center rounded-md text-mu hover:text-er"><X size={13} /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-surf p-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">Share workspace across chats</div>
            <p className="mt-0.5 text-xs text-mu">The AI can keep writing into the same workspace from any chat of this project. Off keeps each chat's workspace files to itself. Projects never share workspaces with each other.</p>
          </div>
          <Toggle on={shareWs} set={setShareWs} label="Share workspace across chats" />
        </div>
        <div className="flex justify-end gap-2">
          <Btn v="soft" onClick={close}>Cancel</Btn>
          <Btn v="solid" onClick={save}>{editing ? 'Save' : 'Create project'}</Btn>
        </div>
      </div>
    </Modal>
  )
}
