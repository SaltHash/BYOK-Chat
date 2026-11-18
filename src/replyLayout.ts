/* Ordering of inline reply embeds (artifacts and graphs).
 *
 * A reply is written in rounds: some text, a tool call, then more text. The
 * saved reply text is the concatenation of those rounds, so each round's text
 * can be found in it and the things the round produced belong directly after
 * that text — where the model used them. Collecting every embed at the end of
 * the message put an artifact under prose it was never about, and a round that
 * produced its figure before writing anything looked like "always at the
 * bottom".
 *
 * Pure and dependency-free apart from the artifact and graph parsers, so the
 * placement rules can be tested without rendering. */

import { parseArtifactArgs, type ArtifactSpec } from './artifacts'
import { graphItemCount, normalizeGraphSpec, type GraphPlacement } from './graph'

export type LayoutCall = { id?: string; name: string; arguments: string; error?: boolean }
export type LayoutRound = { text?: string; calls: LayoutCall[] }

/** A graph call as the renderer needs it: the raw arguments stay the source of
 *  truth (the plot is redrawn from them, never stored as pixels). */
export type GraphCall = { id: string; name: 'graph'; arguments: string; placement: GraphPlacement }

export type ReplyEmbed =
  | { kind: 'artifact'; key: string; spec: ArtifactSpec }
  | { kind: 'graph'; key: string; call: GraphCall }

/** A piece of the reply: text and, right after it, whatever the model placed
 *  there. `text` is empty on a block that is only embeds. */
export type ReplyBlock = { text?: string; embeds: ReplyEmbed[] }

const argsOf = (raw: string): Record<string, unknown> => {
  try {
    const v = JSON.parse(String(raw || '{}'))
    return v && typeof v === 'object' ? v as Record<string, unknown> : {}
  } catch { return {} }
}

/** The usable embeds among a round's calls, in the order the model made them.
 *  A call that errored or whose payload cannot be rendered is skipped. */
export function roundEmbeds(calls?: LayoutCall[]): ReplyEmbed[] {
  const out: ReplyEmbed[] = []
  for (const [i, call] of (calls ?? []).entries()) {
    if (!call || call.error) continue
    if (call.name === 'show_artifact') {
      const spec = parseArtifactArgs(call.arguments)
      if (spec) out.push({ kind: 'artifact', key: call.id || `artifact-${i}`, spec })
      continue
    }
    if (call.name === 'graph') {
      const spec = normalizeGraphSpec(argsOf(call.arguments))
      if (!graphItemCount(spec)) continue
      const id = call.id || `graph-${i}`
      out.push({ kind: 'graph', key: id, call: { id, name: 'graph', arguments: call.arguments, placement: spec.placement } })
    }
  }
  return out
}

/** Split a reply so every artifact and graph sits where the model used it.
 *  Returns null when the reply has no embeds, which keeps the ordinary body on
 *  the single-pass rendering path. */
export function replyBlocks(text: string, rounds?: LayoutRound[]): ReplyBlock[] | null {
  const source = String(text ?? '')
  const list = rounds ?? []
  if (!list.some((round) => roundEmbeds(round.calls).length > 0)) return null
  const out: ReplyBlock[] = []
  const deferred: ReplyEmbed[] = []
  let cursor = 0
  let buf = ''
  const cut = (embeds: ReplyEmbed[]) => {
    if (buf.trim()) out.push({ text: buf, embeds: [] })
    if (embeds.length) out.push({ embeds })
    buf = ''
  }
  for (const round of list) {
    const t = String(round.text ?? '')
    let found = -1
    if (t) {
      found = source.indexOf(t, cursor)
      if (found >= 0) {
        buf += source.slice(cursor, found + t.length)
        cursor = found + t.length
      }
    }
    const embeds = roundEmbeds(round.calls)
    if (!embeds.length) continue
    // A round that wrote no text produced its embed at this point in the
    // reply: place it at the cursor, not at the end. A round whose text is not
    // part of this reply at all (a research run writes its report separately)
    // cannot be placed exactly; keep those at the end rather than guessing.
    if (!t || found >= 0) cut(embeds)
    else deferred.push(...embeds)
  }
  buf += source.slice(cursor)
  if (buf.trim()) out.push({ text: buf, embeds: [] })
  if (deferred.length) out.push({ embeds: deferred })
  return out.length ? out : null
}
