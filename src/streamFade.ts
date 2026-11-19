/* Reply fade-in, as a rehype plugin.
 *
 * Each word (with the whitespace that follows it) becomes an inline
 * `<span class="sd-fade">`, and the CSS animation runs once, when that span is
 * created. A re-parse of the growing document produces the same spans in the
 * same order, so React keeps the existing DOM nodes: only words that are new
 * since the last frame mount, so only they fade. There is deliberately no
 * per-word delay — cadence comes from the pacing buffer, not from the parser.
 *
 * Code, keyboard keys, SVG and math are skipped whole: a token split into two
 * spans would break syntax highlighting and KaTeX, and fading a highlighted
 * token individually reads as noise. Their block wrappers (pre, table,
 * blockquote, img) get the class once instead, so a code block or table fades
 * in as one unit when it appears.
 *
 * The plugin runs after `rehype-sanitize` (see REHYPE_BASE in Rich.tsx), so
 * the spans it adds are the ones that reach the DOM, not markup the sanitizer
 * would strip. It only wraps text that is already there: textContent is
 * unchanged, so copying and selecting the reply, and its reading order, are
 * exactly as before.
 */

const FADE = 'sd-fade'

/** Never descend into these: a word split inside one would corrupt it. */
const SKIP = new Set(['code', 'pre', 'kbd', 'samp', 'svg', 'math', 'script', 'style', 'textarea'])
/** Faded as a single unit instead of word by word. */
const WHOLE = new Set(['pre', 'table', 'blockquote', 'img'])
/** KaTeX and Mermaid output: skipped whole, never wrapped. */
const MATH = /(^|\s)(katex|katex-display|math|math-inline|math-display|mermaid)(\s|$)/

type Node = {
  type: string
  value?: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: Node[]
}

const classOf = (n: Node): string => {
  const c = n.properties?.className
  return Array.isArray(c) ? c.join(' ') : typeof c === 'string' ? c : ''
}

const addFadeClass = (n: Node) => {
  const props = (n.properties ??= {})
  const current = props.className
  const list = Array.isArray(current)
    ? [...current] as unknown[]
    : typeof current === 'string' && current
      ? current.split(/\s+/)
      : []
  if (!list.includes(FADE)) list.push(FADE)
  props.className = list
}

/** The units a reply fades in as: a word with the whitespace that follows it,
 *  or a run of whitespace standing on its own. Both the markdown plugin here
 *  and the plain-text live body (components/Chat.tsx) use these, so a reply
 *  fades the same way whichever branch renders it. */
export type FadeUnit = { t: string; fade: boolean }

export function splitFadeUnits(value: string): FadeUnit[] {
  const out: FadeUnit[] = []
  for (const part of value.split(/(\S+\s*)/)) {
    if (part) out.push({ t: part, fade: /^\S/.test(part) })
  }
  return out
}

/** `"hello world "` → one span per word, the leading whitespace left as text. */
const splitWords = (value: string): Node[] | null => {
  if (!/\S/.test(value)) return null
  const out: Node[] = splitFadeUnits(value).map((u) => u.fade
    ? { type: 'element', tagName: 'span', properties: { className: [FADE] }, children: [{ type: 'text', value: u.t }] }
    : { type: 'text', value: u.t })
  return out.length ? out : null
}

const walk = (n: Node) => {
  const kids = n.children
  if (!kids?.length) return
  for (let i = 0; i < kids.length; i++) {
    const child = kids[i]
    if (child.type === 'text') {
      const split = splitWords(child.value ?? '')
      if (split) {
        kids.splice(i, 1, ...split)
        i += split.length - 1
      }
      continue
    }
    if (child.type !== 'element') continue
    const tag = child.tagName ?? ''
    if (SKIP.has(tag) || MATH.test(classOf(child))) {
      if (WHOLE.has(tag)) addFadeClass(child)
      continue
    }
    if (WHOLE.has(tag)) {
      addFadeClass(child)
      continue
    }
    walk(child)
  }
}

export function rehypeFade() {
  return (tree: Node) => { walk(tree) }
}
