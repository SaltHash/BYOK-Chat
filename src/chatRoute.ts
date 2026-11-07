/* Chat URLs are local-first: they open a chat from this browser's storage,
 * not a public snapshot. The hash route is deliberately separate from
 * `#share/<id>` and `#settings/<tab>` so the existing router stays intact. */
export const chatHash = (id: string): string => (id ? `#chat/${encodeURIComponent(id)}` : '#chat')

export type HistoryAction = 'none' | 'replace' | 'push'
/** Decide how a route change enters browser history. The first render only
 *  normalizes the URL; a later chat switch or opening/closing Settings pushes;
 *  changing Settings tabs replaces so Back closes the whole surface. */
export function historyAction(input: { ready: boolean; sameHash: boolean; prevChat: string; chat: string; prevSettingsOpen: boolean; settingsOpen: boolean }): HistoryAction {
  if (input.sameHash) return 'none'
  if (!input.ready) return 'replace'
  return input.prevChat !== input.chat || input.prevSettingsOpen !== input.settingsOpen ? 'push' : 'replace'
}

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
