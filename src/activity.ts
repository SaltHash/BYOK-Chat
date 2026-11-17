/* Live and finished activity lines for the reply indicator.
 *
 * A reply that is waiting on the model or on a tool call shows one short line
 * ("Searching 3 websites", "Thinking") plus how long the current activity has
 * been running. Once the activity is over the same line is written in the past
 * tense ("Searched 3 websites") and stops animating. Both forms come from the
 * same call so the two never drift apart.
 */

export type ActivityCall = { name: string; arguments?: string; result?: string; error?: boolean }

export type ActivityKind =
  | 'thinking'
  | 'search'
  | 'read'
  | 'write'
  | 'delete'
  | 'code'
  | 'image'
  | 'memory'
  | 'chart'
  | 'question'
  | 'skill'
  | 'mcp'
  | 'tool'

export type Activity = {
  /** Icon family for the indicator. */
  kind: ActivityKind
  /** How many things the line counts: websites, pages, files, calls. */
  count: number
  /** Present-tense line, shown while the activity is running. */
  present: string
  /** Past-tense line, shown once it has finished. */
  past: string
}

const argsOf = (raw?: string): Record<string, unknown> => {
  try {
    const v = JSON.parse(raw || '{}')
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch { return {} }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

const baseName = (path: string) => path.replace(/\\/g, '/').split('/').filter(Boolean).pop() || path

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Websites a search call actually returned, so the line counts sources rather
 *  than requests. Falls back to the number of search calls while results are
 *  still on their way. */
function searchCount(calls: ActivityCall[]): number {
  let sources = 0
  for (const call of calls) sources += (call.result ?? '').match(/\[Source [^\]]+\]/g)?.length ?? 0
  return sources || calls.length
}

/** MCP tool id (`mcp_filesystem_read_file`) as readable words. */
const mcpLabel = (name: string) => name.slice(4).replace(/_/g, ' ').trim() || 'tool'

const TOOL_PHRASES: Record<string, { kind: ActivityKind; present: string; past: string }> = {
  run_code: { kind: 'code', present: 'Running code', past: 'Ran code' },
  generate_image: { kind: 'image', present: 'Generating an image', past: 'Generated an image' },
  memory: { kind: 'memory', present: 'Saving a memory', past: 'Saved a memory' },
  graph: { kind: 'chart', present: 'Drawing a chart', past: 'Drew a chart' },
  show_artifact: { kind: 'chart', present: 'Building an artifact', past: 'Built an artifact' },
  ask: { kind: 'question', present: 'Asking you', past: 'Asked you' },
  inline_poll: { kind: 'question', present: 'Preparing choices', past: 'Prepared choices' },
  prompt_chip: { kind: 'question', present: 'Preparing follow-ups', past: 'Prepared follow-ups' },
  use_skill: { kind: 'skill', present: 'Loading a skill', past: 'Loaded a skill' },
  time: { kind: 'tool', present: 'Checking the time', past: 'Checked the time' },
  date: { kind: 'tool', present: 'Checking the date', past: 'Checked the date' },
  calc: { kind: 'tool', present: 'Calculating', past: 'Calculated' },
  count: { kind: 'tool', present: 'Counting', past: 'Counted' },
  json: { kind: 'tool', present: 'Formatting JSON', past: 'Formatted JSON' },
  base64: { kind: 'tool', present: 'Encoding', past: 'Encoded' },
  location: { kind: 'tool', present: 'Checking location', past: 'Checked location' },
  clipboard: { kind: 'tool', present: 'Reading the clipboard', past: 'Read the clipboard' },
  uuid: { kind: 'tool', present: 'Generating a UUID', past: 'Generated a UUID' },
  random: { kind: 'tool', present: 'Generating a number', past: 'Generated a number' },
  hash: { kind: 'tool', present: 'Hashing', past: 'Hashed' },
  navigate: { kind: 'tool', present: 'Finding a page', past: 'Found a page' },
}

const WRITE_ACTIONS = ['create', 'update', 'patch', 'continue', 'move', 'rename']

type Family = 'search' | 'page' | 'write' | 'delete' | 'workspace' | 'mcp' | 'other'

/** What a call is doing, so a run of the same kind is counted together. */
function familyOf(call: ActivityCall): Family {
  if (call.name === 'search') return 'search'
  if (call.name === 'fetch_page') return 'page'
  if (call.name === 'workspace_upsert') {
    const action = str(argsOf(call.arguments).action) || 'create'
    if (action === 'delete') return 'delete'
    if (WRITE_ACTIONS.includes(action)) return 'write'
    return 'workspace'
  }
  if (call.name.startsWith('mcp_')) return 'mcp'
  return 'other'
}

/** Describe the newest group of tool calls, or plain thinking when the model
 *  has not called one. The line follows the newest call, and counts the calls
 *  of that same kind: one search then one code run reads as the code run, not
 *  as a bundle of two unrelated tools. */
export function activityOf(calls: ActivityCall[], opts: { thinking?: boolean } = {}): Activity {
  const list = (calls ?? []).filter((c) => c && c.name)
  if (!list.length) {
    return opts.thinking === false
      ? { kind: 'tool', count: 0, present: 'Working', past: 'Worked' }
      : { kind: 'thinking', count: 0, present: 'Thinking', past: 'Thought' }
  }

  const last = list[list.length - 1]
  const family = familyOf(last)
  const group = list.filter((c) => familyOf(c) === family)

  if (family === 'search') {
    const n = searchCount(group)
    return { kind: 'search', count: n, present: `Searching ${plural(n, 'website')}`, past: `Searched ${plural(n, 'website')}` }
  }

  if (family === 'page') {
    const n = group.length
    return { kind: 'read', count: n, present: `Reading ${plural(n, 'page')}`, past: `Read ${plural(n, 'page')}` }
  }

  if (family === 'write') {
    const path = str(argsOf(group[group.length - 1].arguments).path)
    const label = group.length === 1 && path ? baseName(path) : plural(group.length, 'file')
    return { kind: 'write', count: group.length, present: `Writing ${label}`, past: `Wrote ${label}` }
  }

  if (family === 'delete') {
    const n = group.length
    return { kind: 'delete', count: n, present: `Deleting ${plural(n, 'file')}`, past: `Deleted ${plural(n, 'file')}` }
  }

  if (family === 'workspace') {
    const n = group.length
    return { kind: 'read', count: n, present: `Reading ${plural(n, 'workspace file')}`, past: `Read ${plural(n, 'workspace file')}` }
  }

  if (family === 'mcp') {
    const label = mcpLabel(last.name)
    return { kind: 'mcp', count: 1, present: `Calling ${label}`, past: `Called ${label}` }
  }

  const phrase = TOOL_PHRASES[last.name]
  if (phrase) return { kind: phrase.kind, count: group.length, present: phrase.present, past: phrase.past }

  const label = last.name.replace(/_/g, ' ')
  return { kind: 'tool', count: group.length, present: `Using ${label}`, past: `Used ${label}` }
}

/** Whole seconds, then minutes + seconds, then hours + minutes. No decimals. */
export function formatElapsed(ms: number): string {
  const total = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`
}
