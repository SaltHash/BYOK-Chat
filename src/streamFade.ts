/* Reply fade-in, as a rehype plugin.
 *
 * Each word (with the whitespace that follows it) becomes an inline
 * `<span class="sd-fade">`, and the CSS animation runs once, when that span is
 * created. A re-parse of the growing document produces the same spans in the
 * same order, so React keeps the existing DOM nodes: only words that are new
 * since the last frame mount, so only they fade. There is deliberately no
 * per-word delay — cadence comes from the pacing buffer, not from the parser.
 *
 * Only the newest words of a document keep a span (see `fadeCutoff`). A word
 * needs one only while it is new, and the block still being written is
 * re-parsed for every released word: wrapping a whole long paragraph or list
 * made the cost of a reply grow with its length on the hottest path in the
 * app, and made any re-parse of that block (a half-typed marker closing, math
 * arriving) replay the animation over all of it.
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

/** How many of a document's most recent units keep a fade span. */
export const FADE_TAIL = 64

/** The first unit that still fades; every unit before it stays plain text. A
 *  unit is a word (with the whitespace that follows it) or a whole block. */
export function fadeCutoff(total: number, tail: number = FADE_TAIL): number {
  return Math.max(0, total - Math.max(0, tail))
}

type Node = {
  type: string
  value?: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: Node[]
}

/** One place in the tree that may fade, and where it sits in the document's
 *  running count of units. */
type Unit = { parent: Node; index: number; start: number; units?: FadeUnit[]; node?: Node }

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

/** Collect every place that may fade, in document order, and count the units.
 *  Nothing is changed yet: the cutoff is only known once the total is. */
function collect(n: Node, out: Unit[], from: number): number {
  const kids = n.children
  if (!kids?.length) return from
  let total = from
  for (let i = 0; i < kids.length; i++) {
    const child = kids[i]
    if (child.type === 'text') {
      const units = splitFadeUnits(child.value ?? '')
      if (!units.length) continue
      out.push({ parent: n, index: i, start: total, units })
      total += units.length
      continue
    }
    if (child.type !== 'element') continue
    const tag = child.tagName ?? ''
    const math = MATH.test(classOf(child))
    if (!math && WHOLE.has(tag)) {
      out.push({ parent: n, index: i, start: total, node: child })
      total++
      continue
    }
    if (math || SKIP.has(tag)) continue
    total = collect(child, out, total)
  }
  return total
}

/** Wrap (or class-name) only the units at or after `keep`'s cutoff. */
function fadeTail(tree: Node, keep: number): void {
  const units: Unit[] = []
  const total = collect(tree, units, 0)
  const cutoff = fadeCutoff(total, keep)
  if (total <= cutoff) return
  /* Replacements are applied per parent, from the last child backwards, so the
   * offsets of the ones still to do stay valid. */
  const edits = new Map<Node, { index: number; nodes: Node[] }[]>()
  const edit = (parent: Node, index: number, nodes: Node[]) => {
    const list = edits.get(parent)
    if (list) list.push({ index, nodes })
    else edits.set(parent, [{ index, nodes }])
  }

  for (const unit of units) {
    if (!unit.units) {
      if (unit.start >= cutoff && unit.node) addFadeClass(unit.node)
      continue
    }
    const from = cutoff - unit.start
    if (from >= unit.units.length) continue
    const nodes: Node[] = []
    let plain = ''
    let faded = false
    for (let u = 0; u < unit.units.length; u++) {
      const part = unit.units[u]
      if (part.fade && u >= from) {
        faded = true
        if (plain) {
          nodes.push({ type: 'text', value: plain })
          plain = ''
        }
        nodes.push({ type: 'element', tagName: 'span', properties: { className: [FADE] }, children: [{ type: 'text', value: part.t }] })
      } else plain += part.t
    }
    // Nothing in this node fades (whitespace only): leave it exactly as it is.
    if (!faded) continue
    if (plain) nodes.push({ type: 'text', value: plain })
    edit(unit.parent, unit.index, nodes)
  }

  for (const [parent, list] of edits) {
    list.sort((a, b) => b.index - a.index)
    for (const e of list) parent.children?.splice(e.index, 1, ...e.nodes)
  }
}

export function rehypeFade(tail: number = FADE_TAIL) {
  const keep = typeof tail === 'number' && Number.isFinite(tail) && tail > 0 ? tail : FADE_TAIL
  return (tree: Node) => { fadeTail(tree, keep) }
}
