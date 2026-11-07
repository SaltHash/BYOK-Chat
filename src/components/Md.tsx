import { lazy, Suspense, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, GitBranch, Pencil, Trash2 } from 'lucide-react'
import { useS, featOn, type Msg } from '../store'
import { tokenizeMentions, bannerOf, sentBodyText, isPill } from '../mentions'
import { MentionChip, SentMentionBanner, SentQuoteBanner } from './Mention'
import { splitQuotedReply } from '../quote'
import { Btn, cx } from './ui'
import { PathSwitch } from './PathSwitch'
import { loadChunk } from '../chunkLoad'
import type { CiteMap } from './Rich'

// The full renderer (tables, math, highlighting) loads on first use to keep the
// first paint light. A tab left open across a deploy holds an older shell whose
// chunk names no longer exist, so the load recovers instead of 404ing.
const Rich = lazy(() => loadChunk(() => import('./Rich')))

export function Md({ t, bare = false, cites, blocks = false, fadeFrom }: { t: string; bare?: boolean; cites?: CiteMap; blocks?: boolean; fadeFrom?: number }) {
  return (
    <Suspense fallback={<p className="whitespace-pre-wrap">{t}</p>}>
      <Rich t={t} bare={bare} cites={cites} blocks={blocks} fadeFrom={fadeFrom} />
    </Suspense>
  )
}

export function UserText({ m, searchQuery, searchOpen }: { m: Msg; searchQuery?: string; searchOpen?: boolean }) {
  const edit = useS((s) => s.editMsg)
  const branch = useS((s) => s.branch)
  const cmds = useS((s) => s.cmds)
  const tools = useS((s) => s.tools)
  const features = useS((s) => s.features)
  const [ed, setEd] = useState(false)
  const [v, setV] = useState(m.t)
  const [copied, setCopied] = useState(false)
  const quoted = useMemo(() => splitQuotedReply(m.t), [m.t])
  const messageText = quoted?.body ?? m.t
  const segs = useMemo(() => tokenizeMentions(messageText, { cmds, tools, commandsOn: featOn({ features }, 'commands'), toolsOn: featOn({ features }, 'tools') }), [messageText, cmds, tools, features])
  const sentBanner = useMemo(() => bannerOf(messageText, segs), [messageText, segs])
  const bodyText = useMemo(() => sentBodyText(messageText, sentBanner), [messageText, sentBanner])
  const cmdMsg = segs[0]?.kind === 'mention' && segs[0].m.kind === 'command'
  const hasMention = segs.some((s) => s.kind === 'mention')
  const contentRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return
    const marks = Array.from(el.querySelectorAll('.search-highlight'))
    for (const mark of marks) {
      const parent = mark.parentNode
      if (!parent) continue
      parent.insertBefore(document.createTextNode(mark.textContent ?? ''), mark)
      parent.removeChild(mark)
      parent.normalize()
    }
    const q = searchQuery?.trim()
    if (!searchOpen || !q) return
    const regex = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi')
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent ?? ''
        if (regex.test(text)) {
          regex.lastIndex = 0
          const parts = text.split(regex)
          const frag = document.createDocumentFragment()
          for (let i = 0; i < parts.length; i++) {
            if (i % 2 === 1) {
              const mark = document.createElement('mark')
              mark.className = 'search-highlight'
              mark.textContent = parts[i]
              frag.appendChild(mark)
            } else {
              frag.appendChild(document.createTextNode(parts[i]))
            }
          }
          node.parentNode?.replaceChild(frag, node)
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = (node as Element).tagName.toLowerCase()
        if (tag === 'script' || tag === 'style' || tag === 'svg') return
        const children = Array.from(node.childNodes)
        for (const child of children) walk(child)
      }
    }
    walk(el)
  }, [searchQuery, searchOpen, m.t, messageText, segs, bodyText, sentBanner])
  if (ed)
    return (
      <div className="space-y-2">
        <textarea autoFocus rows={3} value={v} onChange={(e) => setV(e.target.value)} className="w-full resize-y rounded-2xl bg-surf px-4 py-2.5 outline-none focus:ring-2 focus:ring-ac/40" />
        <p className="text-xs text-mu">Saving resends this message. The wording and replies you have now stay reachable as another path.</p>
        <div className="flex justify-end gap-2">
          <Btn v="soft" onClick={() => { setV(m.t); setEd(false) }}>Cancel</Btn>
          <Btn v="solid" icon={Check} onClick={() => { if (edit(m.id, v)) setEd(false) }}>Save and resend</Btn>
        </div>
      </div>
    )
  return (
    <div className="group/u flex flex-col items-end gap-1">
      <div className={cx('max-w-full overflow-hidden rounded-2xl', cmdMsg ? 'min-w-40 border border-ac/40 bg-ac/5 shadow-sm' : 'bg-surf')}>
        {quoted && <SentQuoteBanner text={quoted.quote} />}
        {sentBanner && <SentMentionBanner kind={sentBanner.kind} />}
        {(messageText || sentBanner) && (
          <div ref={contentRef} className="whitespace-pre-wrap" style={{ padding: 'calc(var(--ui-composer-pad) - 2px) calc(var(--ui-composer-pad) + 4px)' }}>
            {sentBanner
              ? bodyText
              : hasMention
                ? segs.map((sg, i) => sg.kind === 'text'
                  ? <span key={i}>{sg.text}</span>
                  : isPill(sg.m)
                    ? <MentionChip key={i} m={sg.m} cmds={cmds} />
                    : <span key={i}>{sg.m.label}</span>)
                : messageText}
          </div>
        )}
      </div>
      <span className={cx('flex shrink-0 flex-wrap gap-0.5 transition-opacity md:group-hover/u:opacity-100 md:focus-within:opacity-100', m.fork && m.fork.paths.length > 0 ? 'opacity-100' : 'opacity-100 md:opacity-0')}>
        <Btn sm icon={copied ? Check : Copy} title="Copy" onClick={() => { void navigator.clipboard?.writeText(m.t).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200) }).catch(() => {}) }} />
        <PathSwitch anchor={m.id} />
        <Btn sm icon={GitBranch} title="Start a new path from here — this thread stays reachable from the path arrows" onClick={() => branch(m.id)} />
        <Btn sm icon={Pencil} title="Edit message" onClick={() => setEd(true)} />
        <Btn sm icon={Trash2} title="Delete" onClick={() => useS.getState().delMsg(m.id)} />
      </span>
    </div>
  )
}
