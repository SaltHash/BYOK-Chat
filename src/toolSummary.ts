/** A saved tool call as the transcript needs it: no rendering, just enough to
 *  describe what happened. */
export type TrailCall = { name: string; arguments?: string; result?: string; error?: boolean }

export type ToolKind = 'search' | 'page' | 'write' | 'delete' | 'read' | 'other'

export type ToolClause = { kind: ToolKind; text: string; count: number }

/** One collapsed line's worth of a tool run: a title and the clauses it came
 *  from. Titles read like a sentence ("Searched 8 websites, wrote 2 files")
 *  rather than a list of tool names. */
export type ToolSummary = { title: string; clauses: ToolClause[] }

export type TrailSegment = { text: string; calls: TrailCall[] }

const argsOf = (raw?: string): Record<string, unknown> => {
  try {
    const v = JSON.parse(raw || '{}')
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

const baseName = (path: string) => path.replace(/\\/g, '/').split('/').filter(Boolean).pop() || path

/** Files named in a write/delete call, without duplicates. */
const pathsOf = (calls: TrailCall[], actions: string[]) => {
  const seen = new Set<string>()
  for (const call of calls) {
    const a = argsOf(call.arguments)
    const action = str(a.action) || 'create'
    if (!actions.includes(action)) continue
    const path = str(a.path)
    if (path) seen.add(path)
  }
  return [...seen]
}

const fileList = (paths: string[], verb: string) => {
  if (paths.length === 1) return `${verb} ${baseName(paths[0])}`
  if (paths.length === 2) return `${verb} ${baseName(paths[0])} and ${baseName(paths[1])}`
  return `${verb} ${paths.length} files`
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Turn one round's calls into a short, human title plus the clauses that
 *  compose it. The caller renders the title and can expand the calls. */
export function summarizeToolCalls(calls: TrailCall[]): ToolSummary {
  const list = calls.filter((c) => c && c.name)
  if (!list.length) return { title: 'Tool calls', clauses: [] }
  const clauses: ToolClause[] = []

  const searches = list.filter((c) => c.name === 'search')
  if (searches.length) {
    let sources = 0
    for (const c of searches) sources += (c.result ?? '').match(/\[Source [^\]]+\]/g)?.length ?? 0
    const n = sources || searches.length
    clauses.push({ kind: 'search', count: n, text: `searched ${plural(n, 'website')}` })
  }

  const pages = list.filter((c) => c.name === 'fetch_page')
  if (pages.length) clauses.push({ kind: 'page', count: pages.length, text: `read ${plural(pages.length, 'page')}` })

  const writes = pathsOf(list.filter((c) => c.name === 'workspace_upsert'), ['create', 'update', 'patch', 'continue', 'move', 'rename'])
  if (writes.length) clauses.push({ kind: 'write', count: writes.length, text: fileList(writes, 'wrote') })

  const deletes = pathsOf(list.filter((c) => c.name === 'workspace_upsert'), ['delete'])
  if (deletes.length) clauses.push({ kind: 'delete', count: deletes.length, text: fileList(deletes, 'deleted') })

  const reads = list.filter((c) => c.name === 'workspace_upsert' && (str(argsOf(c.arguments).action) || 'create') === 'read')
  if (reads.length) clauses.push({ kind: 'read', count: reads.length, text: `read ${plural(reads.length, 'workspace file')}` })

  const other = list.filter((c) => !['search', 'fetch_page', 'workspace_upsert'].includes(c.name))
  if (other.length) {
    const phrase = other.length === 1 ? singleOther(other[0]) : `used ${plural(other.length, 'tool')}`
    clauses.push({ kind: 'other', count: other.length, text: phrase })
  }

  if (!clauses.length) clauses.push({ kind: 'other', count: list.length, text: `used ${plural(list.length, 'tool')}` })
  const title = clauses.map((c, i) => (i ? c.text : c.text.charAt(0).toUpperCase() + c.text.slice(1))).join(', ')
  return { title, clauses }
}

function singleOther(call: TrailCall) {
  const a = argsOf(call.arguments)
  const path = str(a.path)
  switch (call.name) {
    case 'run_code': return 'ran code'
    case 'generate_image': return 'generated an image'
    case 'graph': return 'drew a chart'
    case 'show_artifact': return 'opened an artifact'
    case 'memory': return 'updated memory'
    case 'calc': return 'did a calculation'
    case 'time':
    case 'date': return 'checked the date'
    case 'ask': return 'asked a question'
    case 'inline_poll': return 'added a question card'
    case 'prompt_chip': return 'added follow-up options'
    case 'use_skill': return 'loaded a skill'
    case 'workspace_list': return 'listed the workspace'
    default: {
      const label = call.name.startsWith('mcp_') ? call.name.slice(4).replace(/_/g, ' ') : call.name.replace(/_/g, ' ')
      return path ? `used ${label} on ${baseName(path)}` : `used ${label}`
    }
  }
}

/** Split a reply's text at the places where it called tools, so a marker can
 *  sit between the writing before the call and the writing after it.
 *
 *  `text` is the accumulated reply: each round's own text followed by the final
 *  answer, with blank lines inserted between them. Rounds with no writing merge
 *  into the previous run. Returns null when the saved rounds do not line up
 *  with the text (older replies, resumed text), so callers keep the plain
 *  rendering instead of guessing at a boundary. */
export function splitToolTrail(text: string, rounds?: { text?: string; calls: TrailCall[] }[]): TrailSegment[] | null {
  if (!rounds?.length) return null
  const out: TrailSegment[] = []
  let rest = text
  for (const round of rounds) {
    const own = round.text ?? ''
    let at = 0
    if (own.trim()) {
      at = rest.indexOf(own)
      if (at < 0) return null
      if (rest.slice(0, at).trim()) return null
    }
    rest = rest.slice(at + own.length)
    if (own.trim()) out.push({ text: own.trim(), calls: [...round.calls] })
    else if (out.length) out[out.length - 1].calls.push(...round.calls)
    else out.push({ text: '', calls: [...round.calls] })
  }
  if (rest.trim()) out.push({ text: rest.trim(), calls: [] })
  return out.some((s) => s.calls.length) ? out : null
}
