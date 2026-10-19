import { useEffect, useState } from 'react'
import { Link2, Lock, MessageSquare, TriangleAlert } from 'lucide-react'
import { fetchShare, type SharedChat } from '../share'
import { useS } from '../store'
import { Md } from './Md'

/** Read-only view of a shared conversation, rendered from the public snapshot
 *  at `/api/share/<id>`. Reached with the `#share/<id>` hash so the whole app
 *  shell (and the hash router) stays untouched. When this browser created the
 *  share it also holds the owner token, which is required to open a private
 *  link. */
export function ShareView({ id }: { id: string }) {
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; chat: SharedChat }
  >({ status: 'loading' })
  // The owner token lives only in the creator's browser; a visitor has none.
  const token = useS((s) => s.shares.find((x) => x.id === id)?.token ?? '')
  useEffect(() => {
    let live = true
    setState({ status: 'loading' })
    fetchShare(id, token)
      .then((chat) => { if (live) setState({ status: 'ready', chat }) })
      .catch((e: any) => { if (live) setState({ status: 'error', message: String(e?.message ?? e) }) })
    return () => { live = false }
  }, [id, token])
  const chat = state.status === 'ready' ? state.chat : null
  const isPrivate = state.status === 'error' && /private/i.test(state.message)
  return (
    <div className="min-h-dvh bg-bg text-tx">
      <header className="sticky top-0 z-10 border-b border-bor bg-side/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surf text-ac"><MessageSquare size={17} /></span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{chat?.title ?? 'Shared conversation'}</div>
            <div className="text-xs text-mu">{chat ? `${chat.private ? 'Private · ' : ''}Read-only · shared ${new Date(chat.createdAt ?? chat.sharedAt).toLocaleDateString()}` : 'Read-only snapshot'}</div>
          </div>
          <a href="#chat" className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-hov px-3 text-sm font-medium hover:opacity-80"><Link2 size={14} />Open the app</a>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-7 px-4 py-8">
        {state.status === 'loading' && <div className="space-y-3" aria-label="Loading shared conversation"><div className="h-6 w-2/3 animate-pulse rounded-lg bg-surf" /><div className="h-24 animate-pulse rounded-2xl bg-surf" /><div className="h-40 animate-pulse rounded-2xl bg-surf" /></div>}
        {state.status === 'error' && (
          <div className="space-y-3 rounded-2xl border border-er/30 bg-er/10 p-4">
            <div className="flex items-center gap-2 font-semibold text-er">{isPrivate ? <Lock size={18} /> : <TriangleAlert size={18} />}{isPrivate ? 'This shared conversation is private' : 'This shared conversation could not be opened'}</div>
            <p className="text-sm text-er/90">{state.message}</p>
            <p className="text-xs text-mu">{isPrivate ? 'Only the person who created the link can open it, on a browser where they shared it.' : 'Ask the person who shared it for a new link. Shares live on the server that created them, so a link only works while that host keeps the snapshot.'}</p>
          </div>
        )}
        {chat && (
          <>
            <p className="rounded-xl bg-surf p-3 text-xs text-mu">This is a read-only copy shared from another device. Keys, settings, attachments, and workspace files were never included.</p>
            {chat.msgs.map((m, i) => m.r === 'user' ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-surf px-4 py-2.5">{m.t}</div>
              </div>
            ) : (
              <article key={i} className="space-y-1.5">
                <div className="text-xs text-mu">{m.by || 'Assistant'}{m.at ? ` · ${new Date(m.at).toLocaleString()}` : ''}</div>
                <div className="md leading-7"><Md t={m.t} /></div>
              </article>
            ))}
          </>
        )}
      </main>
    </div>
  )
}
