/* Chat URLs are local-first: they open a chat from this browser's storage,
 * not a public snapshot. The hash route is deliberately separate from
 * `#share/<id>` and `#settings/<tab>` so the existing router stays intact. */
export const chatHash = (id: string): string => (id ? `#chat/${encodeURIComponent(id)}` : '#chat')

export function chatIdFromHash(hash: string): string {
  const match = /^#\/?chat\/([^/?#]+)$/.exec(String(hash ?? ''))
  if (!match) return ''
  try {
    const id = decodeURIComponent(match[1])
    return id.length <= 128 ? id : ''
  } catch {
    return ''
  }
}
