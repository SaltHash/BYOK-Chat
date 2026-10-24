import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Copy, ExternalLink, Loader2, Lock, RefreshCw, Share2, TriangleAlert } from 'lucide-react'
import { useS } from '../store'
import { createShare, latestShare, shareHash, updateShare, type ShareRecord } from '../share'
import { Btn, Modal, Toggle, cx } from './ui'

const when = (at: number) => {
  try { return new Date(at).toLocaleString() } catch { return '' }
}

/** A single remembered link row (used for the current link and the history). */
function LinkRow({ rec, current, onCopied }: { rec: ShareRecord; current?: boolean; onCopied?: () => void }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard?.writeText(rec.url) } catch { /* clipboard may be blocked; the link is still shown */ }
    setCopied(true)
    onCopied?.()
    setTimeout(() => setCopied(false), 1600)
  }
  return (
    <div className={cx('space-y-2 rounded-xl bg-surf p-3', current && 'ring-1 ring-ac/40')}>
      <div className="flex items-center gap-2">
        <input readOnly value={rec.url} onFocus={(e) => e.currentTarget.select()} aria-label="Share link" className="min-w-0 flex-1 rounded-lg bg-bg px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-ac/40" />
        <Btn sm icon={copied ? Check : Copy} title="Copy link" onClick={() => void copy()} className={cx(copied && 'text-ac')} />
        <Btn sm icon={ExternalLink} title="Open link in a new tab" onClick={() => window.open(rec.url, '_blank', 'noopener')} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-mu">
        {current && <span className="rounded-sm bg-ac/15 px-1.5 py-0.5 font-medium text-ac">Current</span>}
        {rec.private && <span className="inline-flex items-center gap-1 text-ac"><Lock size={11} />Private</span>}
        {rec.auto && <span className="inline-flex items-center gap-1"><RefreshCw size={11} />Auto-updates</span>}
        <span className="ml-auto">{when(rec.at)}</span>
      </div>
    </div>
  )
}

export function ShareDialog({ chatId, close }: { chatId: string; close: () => void }) {
  const shares = useS((s) => s.shares)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [record, setRecord] = useState<ShareRecord | null>(null)
  const [busy, setBusy] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const started = useRef(false)

  const remember = (rec: ShareRecord) => {
    const list = useS.getState().shares
    useS.getState().patch({ shares: [rec, ...list.filter((x) => x.id !== rec.id)] })
  }
  const patchRecord = (id: string, p: Partial<ShareRecord>) =>
    useS.getState().patch({ shares: useS.getState().shares.map((x) => (x.id === id ? { ...x, ...p } : x)) })

  /** Resolve the current link on open: reuse when nothing changed, update the
   *  existing link when it auto-updates, otherwise mint a new one. */
  const resolveLink = async () => {
    setPhase('loading')
    setError('')
    const st = useS.getState()
    const chat = st.chats.find((c) => c.id === chatId)
    if (!chat || !chat.msgs.length) { setError('This chat is empty, so there is nothing to share yet. Send a message first, then try again.'); setPhase('error'); return }
    const hash = shareHash(chat)
    if (!hash) { setError('This chat has nothing shareable yet.'); setPhase('error'); return }
    const prev = latestShare(st.shares, chatId)
    if (prev && prev.hash === hash) { setRecord(prev); setPhase('ready'); return }
    try {
      if (prev && prev.auto) {
        await updateShare(prev.id, prev.token, chat, { private: prev.private })
        const next: ShareRecord = { ...prev, hash, at: Date.now() }
        patchRecord(prev.id, { hash, at: next.at })
        setRecord(next)
      } else {
        const r = await createShare(chat, { private: prev?.private === true })
        const rec: ShareRecord = { id: r.id, chatId, url: r.url, token: r.token, hash, at: Date.now(), auto: prev?.auto === true, private: r.private }
        remember(rec)
        setRecord(rec)
      }
      setPhase('ready')
    } catch (x: any) {
      setError(String(x?.message ?? x))
      setPhase('error')
    }
  }

  useEffect(() => {
    if (started.current) return
    started.current = true
    void resolveLink()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Toggle auto-update (client-side only) or privacy (needs a server update). */
  const toggleAuto = (v: boolean) => {
    if (!record) return
    patchRecord(record.id, { auto: v })
    setRecord({ ...record, auto: v })
  }
  const togglePrivate = async (v: boolean) => {
    if (!record || busy) return
    setBusy(true)
    try {
      const st = useS.getState()
      const chat = st.chats.find((c) => c.id === chatId)
      if (!chat || !chat.msgs.length) throw Error('This chat is empty, so there is nothing to share yet.')
      await updateShare(record.id, record.token, chat, { private: v })
      patchRecord(record.id, { private: v, hash: shareHash(chat) })
      setRecord({ ...record, private: v, hash: shareHash(chat) })
    } catch (x: any) {
      setError(String(x?.message ?? x))
      // A failed privacy change leaves the previous setting in place.
      setTimeout(() => setError(''), 6000)
    } finally { setBusy(false) }
  }

  const history = shares.filter((x) => x.chatId === chatId).sort((a, b) => b.at - a.at)
  const previous = history.filter((x) => x.id !== record?.id)

  return (
    <Modal close={close} blur={false}>
      <div role="dialog" aria-modal="true" aria-label="Share conversation" className="modal-panel w-full max-w-md space-y-4 rounded-2xl bg-bg p-5">
        <div className="flex items-center gap-2 font-semibold"><Share2 size={18} className="text-ac" />Share conversation</div>

        {phase === 'loading' && (
          <div className="flex flex-col items-center justify-center gap-3 py-8 text-mu" aria-live="polite">
            <Loader2 size={28} className="animate-spin text-ac" />
            <span className="text-sm">Creating the link…</span>
          </div>
        )}

        {phase === 'error' && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-xl bg-surf p-3 text-sm text-er"><TriangleAlert size={18} className="mt-0.5 shrink-0" />{error}</div>
            <div className="flex justify-end gap-2">
              <Btn v="soft" onClick={close}>Close</Btn>
              <Btn v="solid" icon={RefreshCw} onClick={() => void resolveLink()}>Try again</Btn>
            </div>
          </div>
        )}

        {phase === 'ready' && record && (
          <>
            <p className="text-sm text-mu">Anyone with the link can read a snapshot of this conversation. Keys, attachments and settings are never included.</p>
            <LinkRow rec={record} current />
            {error && <div className="flex items-start gap-2 rounded-xl bg-surf p-2.5 text-xs text-er"><TriangleAlert size={14} className="mt-0.5 shrink-0" />{error}</div>}
            <div className="space-y-2 divide-y divide-bor">
              <label className="flex cursor-pointer items-center justify-between gap-3 pt-1">
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-medium"><RefreshCw size={14} className="text-mu" />Auto-update</span>
                  <span className="mt-0.5 block text-xs text-mu">Keep this link pointing at the latest version of the conversation.</span>
                </span>
                <Toggle on={record.auto} set={toggleAuto} label="Auto-update this link" />
              </label>
              <label className="flex cursor-pointer items-center justify-between gap-3 pt-2">
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-medium"><Lock size={14} className="text-mu" />Private</span>
                  <span className="mt-0.5 block text-xs text-mu">Makes the link unusable for anyone but you. Only this browser holds the key.</span>
                </span>
                {busy ? <Loader2 size={18} className="shrink-0 animate-spin text-ac" /> : <Toggle on={record.private} set={(v) => void togglePrivate(v)} label="Make this link private" />}
              </label>
            </div>
            <div className="flex items-center justify-between gap-2">
              {previous.length ? (
                <Btn v="ghost" sm icon={ChevronDown} className={cx('!h-8', showHistory && '[&>svg]:rotate-180')} onClick={() => setShowHistory((v) => !v)}>
                  {showHistory ? 'Hide previous links' : `Previous links (${previous.length})`}
                </Btn>
              ) : <span className="text-xs text-mu">This is the first link for this chat.</span>}
              <Btn v="solid" onClick={close}>Done</Btn>
            </div>
            {showHistory && previous.length > 0 && (
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {previous.map((p) => <LinkRow key={p.id} rec={p} />)}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
