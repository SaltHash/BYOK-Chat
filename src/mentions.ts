/* Mention grammar for the composer and the sent-message bubble. Pure and
 * dependency-light: the same segments drive the composer overlay, the
 * Search / Deep research banner, and the sent bubble. No store or DOM here. */
import { TOOLS } from './meta'
import { parseResearchRequest } from './research'

export type MentionKind = 'command' | 'tool' | 'search' | 'research'
export type Mentionable = { id: string; name: string; desc: string; on: boolean }
export type Mention = {
  kind: MentionKind
  name: string
  label: string
  start: number
  end: number
  enabled: boolean
  desc: string
}
export type Seg =
  | { kind: 'text'; text: string; start: number; end: number }
  | { kind: 'mention'; m: Mention }
export type MentionOpts = { cmds: Mentionable[]; tools: Record<string, boolean>; commandsOn?: boolean; toolsOn?: boolean }

export const RESEARCH_DESC = 'Drafts a research plan for you to review, then runs a deep, multi-step report with sources.'

const WORD = /[A-Za-z0-9_]/
const SPACE = /\s/

/** Plain-language description for a mention. Never technical. */
export function describeMention(kind: MentionKind, name: string, cmd?: Pick<Mentionable, 'desc'>): string {
  if (kind === 'command') return cmd?.desc?.trim() || 'Runs one of your saved commands.'
  if (kind === 'research') return RESEARCH_DESC
  return TOOLS.find(([id]) => id === name)?.[4] ?? 'Uses a built-in tool.'
}

/** Split a draft into plain text and known @mentions / slash commands.
 * A mention commits when its name is complete and followed by a space, a
 * newline, "(", or the end of the message. Commands only count at the start. */
export function tokenizeMentions(v: string, o: MentionOpts): Seg[] {
  const out: Seg[] = []
  const text = (from: number, to: number) => {
    if (to > from) out.push({ kind: 'text', text: v.slice(from, to), start: from, end: to })
  }
  let i = 0
  if (o.commandsOn !== false && v[0] === '/') {
    const m = /^\/(\S+)(?=\s|$)/.exec(v)
    const cmd = m ? o.cmds.find((c) => c.name === m[1]) : undefined
    if (m && cmd) {
      out.push({
        kind: 'mention',
        m: { kind: 'command', name: cmd.name, label: '/' + cmd.name, start: 0, end: m[0].length, enabled: cmd.on, desc: describeMention('command', cmd.name, cmd) },
      })
      i = m[0].length
    }
  }
  if (o.toolsOn !== false) {
    for (let j = i; j < v.length; j++) {
      if (v[j] !== '@' || (j > 0 && !SPACE.test(v[j - 1]))) continue
      let k = j + 1
      while (k < v.length && WORD.test(v[k])) k++
      if (k === j + 1) continue
      const name = v.slice(j + 1, k)
      const after = k < v.length ? v[k] : ''
      if (after && after !== '(' && !SPACE.test(after)) continue
      if (name !== 'research' && !TOOLS.some(([id]) => id === name)) continue
      const kind: MentionKind = name === 'search' ? 'search' : name === 'research' ? 'research' : 'tool'
      text(i, j)
      out.push({
        kind: 'mention',
        m: { kind, name, label: '@' + name, start: j, end: k, enabled: kind === 'research' ? true : o.tools[name] === true, desc: describeMention(kind, name) },
      })
      i = k
      j = k - 1
    }
  }
  text(i, v.length)
  return out
}

export const mentionsOf = (segs: Seg[]): Mention[] => segs.flatMap((s) => (s.kind === 'mention' ? [s.m] : []))

/** Mentions that render as composer pills (search / research use the banner). */
export const isPill = (m: Mention) => m.kind === 'command' || m.kind === 'tool'

/** Remove a mention from a draft, taking a trailing @tool(...) call or one
 * space with it so the remaining text stays tidy. */
export function stripMention(v: string, m: Mention): string {
  let end = m.end
  if (v[end] === '(') {
    let depth = 0
    for (let i = end; i < v.length; i++) {
      if (v[i] === '(') depth++
      else if (v[i] === ')') {
        depth--
        if (!depth) { end = i + 1; break }
      }
    }
  }
  let out = v.slice(0, m.start) + v.slice(end)
  if (out[m.start] === ' ' && (m.start === 0 || SPACE.test(out[m.start - 1]))) out = out.slice(0, m.start) + out.slice(m.start + 1)
  return out
}

export type Banner = { kind: 'search' | 'research'; m?: Mention; query?: string }

/** The banner a draft deserves: Deep research beats an armed web search. */
export function bannerOf(v: string, segs: Seg[]): Banner | null {
  const req = parseResearchRequest(v)
  if (req) return { kind: 'research', query: req.query }
  const found = mentionsOf(segs).find((m) => m.kind === 'search')
  return found ? { kind: 'search', m: found } : null
}

/** The text a sent bubble shows under the banner: the @search / @research
 * mention (and its optional (...) wrapper) is already on the banner, so the
 * body keeps only the surrounding query text. */
export function sentBodyText(v: string, banner: Banner | null): string {
  if (!banner) return v
  if (banner.kind === 'research') return banner.query ?? v
  const hit = banner.m
  if (!hit) return v
  // hit.start points at the '@'; after cutting it out, out[hit.start]
  // lines up with what followed the name in the original string.
  let out = v.slice(0, hit.start) + v.slice(hit.end)
  if (out[hit.start] === '(') {
    let depth = 0
    for (let i = hit.start; i < out.length; i++) {
      if (out[i] === '(') depth++
      else if (out[i] === ')') { depth--; if (!depth) { out = out.slice(0, hit.start) + out.slice(i + 1); break } }
    }
  }
  return out.replace(/\s+/g, ' ').trim()
}

export type PillEdit = { kind: 'caret'; pos: number } | { kind: 'delete'; start: number; end: number }

/** Atomic pill rules for the composer. `a`/`b` are the textarea selection
 * offsets and `segs` must come from the same draft. Null means the browser's
 * native behaviour for that key should run instead. */
export function pillEdit(segs: Seg[], key: string, a: number, b: number): PillEdit | null {
  const pills = mentionsOf(segs).filter(isPill)
  if (!pills.length) return null
  if (a !== b) {
    const whole = key === 'Backspace' && pills.find((m) => a === m.start && b === m.end)
    return whole ? { kind: 'delete', start: a, end: b } : null
  }
  if (key === 'ArrowLeft') {
    const hit = pills.find((m) => a > m.start && a <= m.end)
    return hit ? { kind: 'caret', pos: hit.start } : null
  }
  if (key === 'ArrowRight') {
    const hit = pills.find((m) => a >= m.start && a < m.end)
    return hit ? { kind: 'caret', pos: hit.end } : null
  }
  if (key === 'Backspace' || key === 'Delete') {
    const hit = key === 'Backspace' ? pills.find((m) => a > m.start && a <= m.end) : pills.find((m) => a >= m.start && a < m.end)
    return hit ? { kind: 'delete', start: hit.start, end: hit.end } : null
  }
  return null
}

export type Armed = { kind: 'search' | 'research'; rest: string }

/** A `@search(` or `@research(` call (just typed, pasted whole, or inserted from
 * the + menu) leaves the draft and becomes a banner instead. `rest` is whatever
 * the user had already written, which stays in the box as the query. */
export function armMention(v: string): Armed | null {
  const open = /(^|\s)@(search|research)\($/.exec(v)
  if (open) return { kind: open[2] === 'research' ? 'research' : 'search', rest: v.slice(0, open.index).replace(/\s+$/, '') }
  const full = /^@(search|research)\(([\s\S]*)\)$/.exec(v.trim())
  return full ? { kind: full[1] === 'research' ? 'research' : 'search', rest: full[2].trim() } : null
}
