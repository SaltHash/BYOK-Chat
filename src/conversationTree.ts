import type { Msg } from './store'

/* A conversation is a path: `msgs` holds the messages currently shown, in
 * order. Branching does not copy the chat: it stores the continuations that
 * are not currently shown.
 *
 * A fork sits on the node just before the split — a message (`Msg.fork`) or,
 * for a split before the first message, the chat itself (`at = -1`). Each
 * stored path replaces everything after that node; the live path is never
 * stored twice, it is materialised from `msgs` when needed. `ai` is the
 * ordinal of the active sibling, so 2/3 stays 2/3 after switching away and
 * back instead of jumping to the end of the list.
 *
 * All helpers are pure and return the chat fields they touch, which keeps the
 * store actions small and lets the UI compute siblings without mutating.
 */
export type Fork = { paths: Msg[][]; ai: number }
export type ForkedChat = { msgs: Msg[]; fork?: Fork }

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

const forkOf = (chat: ForkedChat, at: number): Fork | undefined => (at < 0 ? chat.fork : chat.msgs[at]?.fork)

/** How many continuations follow the node at `at`, counting the active one. */
export function siblingCount(chat: ForkedChat, at: number): number {
  return 1 + (forkOf(chat, at)?.paths.length ?? 0)
}

/** Ordinal of the continuation currently shown, 0-based. */
export function siblingIndex(chat: ForkedChat, at: number): number {
  return forkOf(chat, at)?.ai ?? 0
}

/** Every continuation at `at` in display order, the live one included. */
export function continuations(chat: ForkedChat, at: number): Msg[][] {
  const live = chat.msgs.slice(at + 1)
  const fork = forkOf(chat, at)
  if (!fork) return [live]
  const out = [...fork.paths]
  out.splice(clamp(fork.ai, 0, out.length), 0, live)
  return out
}

function withFork(chat: ForkedChat, at: number, fork: Fork | undefined, live: Msg[]): ForkedChat {
  if (at < 0) return { ...chat, fork, msgs: live }
  const head = { ...chat.msgs[at] }
  if (fork) head.fork = fork
  else delete head.fork
  return { ...chat, msgs: [...chat.msgs.slice(0, at), head, ...live] }
}

/** Show sibling `to` at `at`. The live path is captured first, so anything
 *  written since the last switch is kept. Invalid input is a no-op. */
export function switchTo(chat: ForkedChat, at: number, to: number): ForkedChat {
  const all = continuations(chat, at)
  if (to < 0 || to >= all.length || to === siblingIndex(chat, at)) return chat
  const paths = all.filter((_, k) => k !== to)
  return withFork(chat, at, paths.length ? { paths, ai: to } : undefined, all[to])
}

/** Replace the continuation after `at` with `next`, keeping the one that was
 *  live as an inactive sibling. By default the old one takes `next`'s place,
 *  so an edit stays at the same 1/2 and the previous wording moves to 2/2. */
export function forkAt(chat: ForkedChat, at: number, next: Msg[], ordinal?: number): ForkedChat {
  const all = continuations(chat, at)
  const pos = clamp(ordinal ?? siblingIndex(chat, at), 0, all.length)
  const order = [...all]
  order.splice(pos, 0, next)
  const paths = order.filter((_, k) => k !== pos)
  return withFork(chat, at, paths.length ? { paths, ai: pos } : undefined, next)
}

/** Sibling ordinals other than the active one, for building a path picker. */
export function siblingOrdinals(chat: ForkedChat, at: number): number[] {
  return Array.from({ length: siblingCount(chat, at) }, (_, k) => k)
}

/** The first node of each continuation, with its ordinal: enough for a
 *  compare view to label the paths without rendering whole transcripts. */
export function continuationHeads(chat: ForkedChat, at: number): { ordinal: number; path: Msg[] }[] {
  return continuations(chat, at).map((path, ordinal) => ({ ordinal, path }))
}
