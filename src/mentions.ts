/* Mention grammar for the composer and the sent-message bubble. Pure and
 * dependency-light: the only mention left is a saved slash command. Web search
 * and deep research are requests stored with the message (see Msg.intent), not
 * syntax the reader types, so nothing here parses @search or @research. */
import { TOOLS } from './meta'

export type MentionKind = 'command' | 'tool'
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
export type MentionOpts = { cmds: Mentionable[]; commandsOn?: boolean }

const WORD = /[A-Za-z0-9_]/
const SPACE = /\s/

/** Plain-language description for a mention. Never technical. */
export function describeMention(kind: MentionKind, name: string, cmd?: Pick<Mentionable, 'desc'>): string {
  if (kind === 'command') return cmd?.desc?.trim() || 'Runs one of your saved commands.'
  return TOOLS.find(([id]) => id === name)?.[4] ?? 'Uses a built-in tool.'
}

/** Split a draft into plain text and a leading slash command. Commands only
 * count at the start of the message. */
export function tokenizeMentions(v: string, o: MentionOpts): Seg[] {
  const out: Seg[] = []
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
  if (i < v.length) out.push({ kind: 'text', text: v.slice(i), start: i, end: v.length })
  return out
}

export const mentionsOf = (segs: Seg[]): Mention[] => segs.flatMap((s) => (s.kind === 'mention' ? [s.m] : []))

/** Mentions that render as composer pills. */
export const isPill = (m: Mention) => m.kind === 'command' || m.kind === 'tool'

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
