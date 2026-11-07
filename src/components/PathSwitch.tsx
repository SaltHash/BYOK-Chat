import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Check, ChevronLeft, ChevronRight, GitCompare } from 'lucide-react'
import { useS } from '../store'
import { continuationHeads, siblingCount, siblingIndex } from '../conversationTree'
import { Btn, Modal, cx } from './ui'

type Preview = { ordinal: number; path: { id: string; r: string; t: string }[] }

/** Path arrows for the siblings that branch at one point in the conversation.
 *
 *  The fork lives on the message before the split (or on the chat, for a split
 *  before the first message), so the same control appears under that message
 *  wherever it is rendered. It subscribes to the sibling count only, which
 *  keeps it out of the streaming re-render path. */
export function PathSwitch({ anchor, className }: { anchor: string; className?: string }) {
  const info = useS(useShallow((s) => {
    const c = s.chats.find((x) => x.id === s.chat)
    if (!c) return null
    const at = anchor ? c.msgs.findIndex((m) => m.id === anchor) : -1
    if (anchor && at < 0) return null
    const n = siblingCount(c, at)
    return n > 1 ? { n, at, index: siblingIndex(c, at) } : null
  }))
  const goto = useS((s) => s.gotoPath)
  const [preview, setPreview] = useState<Preview[] | null>(null)
  if (!info) return null
  const { n, at, index } = info

  const openCompare = () => {
    const s = useS.getState()
    const c = s.chats.find((x) => x.id === s.chat)
    if (!c) return
    setPreview(continuationHeads(c, at).map(({ ordinal, path }) => ({
      ordinal,
      path: path.map((m) => ({ id: m.id, r: m.r, t: (m.toolFinal ?? m.t) || '' })),
    })))
  }

  return (
    <span className={cx('inline-flex items-center gap-0.5', className)} role="group" aria-label={`Conversation path ${index + 1} of ${n}`}>
      <Btn sm icon={ChevronLeft} title="Previous path at this point" aria-label="Previous path at this point" disabled={index < 1} onClick={() => goto(anchor, index - 1)} />
      <span aria-live="polite" className="px-1 text-xs tabular-nums text-mu">{index + 1}/{n}</span>
      <Btn sm icon={ChevronRight} title="Next path at this point" aria-label="Next path at this point" disabled={index >= n - 1} onClick={() => goto(anchor, index + 1)} />
      <Btn sm icon={GitCompare} title="Compare the paths that branch here" aria-label="Compare the paths that branch here" onClick={openCompare} />
      {preview && (
        <Modal close={() => setPreview(null)} labelledBy="path-compare-title">
          <div className="modal-panel w-[min(64rem,100%)] rounded-2xl bg-bg p-4">
            <h2 id="path-compare-title" className="text-base font-semibold">Paths from this point</h2>
            <p className="mt-1 text-xs leading-5 text-mu">These continuations share everything above them. Only one is shown at a time; switching keeps whatever you wrote on the other, so nothing is overwritten.</p>
            <div className="mt-3 grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(preview.length, 3)}, minmax(0, 1fr))` }}>
              {preview.map((p) => {
                const shown = p.ordinal === index
                return (
                  <section key={p.ordinal} aria-label={`Path ${p.ordinal + 1}`} className={cx('flex min-h-0 flex-col rounded-xl border p-3', shown ? 'border-ac/50 bg-ac/5' : 'border-bor bg-surf')}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">Path {p.ordinal + 1}</span>
                      {shown && <span className="inline-flex items-center gap-1 text-xs text-ac"><Check size={12} />Showing</span>}
                    </div>
                    <div className="mt-2 max-h-72 flex-1 space-y-2 overflow-y-auto pr-1">
                      {p.path.length ? p.path.map((m, k) => (
                        <div key={`${p.ordinal}:${k}:${m.id}`} className="text-xs leading-5">
                          <div className={cx('text-[10px] font-medium uppercase tracking-wide', m.r === 'user' ? 'text-mu' : 'text-ac')}>{m.r === 'user' ? 'You' : 'Reply'}</div>
                          <p className="whitespace-pre-wrap break-words text-tx">{m.t.trim() ? `${m.t.trim().slice(0, 900)}${m.t.length > 900 ? '…' : ''}` : 'No text yet'}</p>
                        </div>
                      )) : <p className="text-xs text-mu">Empty path — the next message you send starts here.</p>}
                    </div>
                    {!shown && <Btn v="soft" className="mt-3 w-full" onClick={() => { setPreview(null); goto(anchor, p.ordinal) }}>Show this path</Btn>}
                  </section>
                )
              })}
            </div>
          </div>
        </Modal>
      )}
    </span>
  )
}
