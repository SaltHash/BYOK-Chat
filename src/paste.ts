/* Pasted text is sometimes a document, not a message. A large paste becomes a
 * text attachment so it reaches the model as reference data instead of
 * blending into the user's actual instruction. Small snippets keep the normal
 * inline paste behaviour. */

export const PASTE_ATTACH_CHARS = 800
export const PASTE_ATTACH_LINES = 10

export function isLargePaste(text: string, opts: { chars?: number; lines?: number } = {}): boolean {
  if (!text) return false
  const chars = opts.chars ?? PASTE_ATTACH_CHARS
  const lines = opts.lines ?? PASTE_ATTACH_LINES
  return text.length >= chars || text.replace(/\r\n?/g, '\n').split('\n').length >= lines
}
