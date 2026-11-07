/* Reply bookmarks.
 *
 * Bookmarks live on the chat (`Chat.bookmarks`, newest first) rather than in a
 * separate top-level list: chats already travel through persistence, backups
 * and device sync, so a bookmark keeps its chat, survives a reload, and is
 * deleted with the conversation it belongs to. The message text is resolved at
 * read time, so an edited reply never leaves a stale excerpt behind.
 *
 * Pure and React-free so the toggle/order rules stay unit-testable.
 */

export type BookmarkMessage = {
  id: string
  r: 'user' | 'assistant'
  t?: string
  toolFinal?: string
  at?: number
  by?: string
}

export type BookmarkChat = {
  id: string
  title?: string
  bookmarks?: string[]
  msgs: BookmarkMessage[]
}

export type BookmarkEntry = {
  chatId: string
  chatTitle: string
  msgId: string
  /** Message timestamp (0 when the message predates timestamps). */
  at: number
  by?: string
  /** Whitespace-normalized excerpt, capped for the sidebar row. */
  text: string
  reply: boolean
}

/** Add a bookmark to the front, or remove it when already present. */
export const toggleBookmark = (ids: readonly string[] | undefined, id: string): string[] => {
  const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string' && !!x) : []
  return list.includes(id) ? list.filter((x) => x !== id) : [id, ...list]
}

export const isBookmarked = (ids: readonly string[] | undefined, id: string): boolean =>
  Array.isArray(ids) && ids.includes(id)

const EXCERPT_MAX = 180

const excerpt = (message: BookmarkMessage): string => {
  const raw = message.r === 'assistant' ? (message.toolFinal ?? message.t) : message.t
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim()
  return text.length > EXCERPT_MAX ? `${text.slice(0, EXCERPT_MAX).trimEnd()}…` : text
}

/** Every resolvable bookmark across the supplied chats, newest message first.
 *  Dangling ids (a deleted or edited-away message) are skipped rather than
 *  rendered as an empty row; the next toggle on that chat prunes them. */
export const bookmarkEntries = (chats: readonly BookmarkChat[]): BookmarkEntry[] => {
  const out: BookmarkEntry[] = []
  for (const chat of chats) {
    if (!chat.bookmarks?.length) continue
    const byId = new Map(chat.msgs.map((m) => [m.id, m]))
    for (const id of chat.bookmarks) {
      const message = byId.get(id)
      if (!message) continue
      out.push({
        chatId: chat.id,
        chatTitle: chat.title?.trim() || 'New chat',
        msgId: id,
        at: Number(message.at) || 0,
        ...(message.by ? { by: message.by } : {}),
        text: excerpt(message),
        reply: message.r === 'assistant',
      })
    }
  }
  return out.sort((a, b) => b.at - a.at || a.chatTitle.localeCompare(b.chatTitle))
}
