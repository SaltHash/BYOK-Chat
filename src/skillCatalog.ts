/* The online skill catalogue.
 *
 * A skill is instruction text plus a "when to use" line, so a public folder of
 * `SKILL.md` files is already a catalogue. One small JSON index lists the
 * folders; each folder holds a `SKILL.md` whose YAML front matter carries the
 * name and the description. That is read once per session, shown in Settings →
 * Skills, and installed as an ordinary custom skill: what arrives can then be
 * edited, disabled or removed like anything the user wrote.
 *
 * The browser does the fetching (`raw.githubusercontent.com` and the GitHub API
 * both send `Access-Control-Allow-Origin: *`), so this works on a static
 * deployment and no key is involved. Two index shapes are accepted — the Claude
 * Code plugin marketplace (`.claude-plugin/marketplace.json`, `plugins[].skills[]`)
 * and a plain `{ skills: [...] }` list — so a fork or a self-hosted index is one
 * `SKILL_SOURCES` entry away.
 *
 * Only public instructions are fetched, nothing about the user or the project,
 * and only when the reader opens the catalogue.
 */
import { BUILTIN_SKILLS, RETIRED_SKILL_IDS, SKILL_INSTRUCTIONS_MAX, slugifySkillId, validateCustomSkill, type SkillState } from './skills'

export type SkillSource = {
  id: string
  /** Name shown beside the search field. */
  label: string
  /** JSON index that lists the skill folders. */
  index: string
  /** Prefix relative folder paths from the index are resolved against. */
  files: string
  /** Recorded on an installed skill as where it came from. */
  origin: string
  /** Human page for the collection, offered as a link. */
  home: string
}

export const SKILL_SOURCES: SkillSource[] = [
  {
    id: 'anthropic',
    label: 'Anthropic Agent Skills',
    index: 'https://raw.githubusercontent.com/anthropics/skills/main/.claude-plugin/marketplace.json',
    files: 'https://raw.githubusercontent.com/anthropics/skills/main/',
    origin: 'github.com/anthropics/skills',
    home: 'https://github.com/anthropics/skills',
  },
]

export const SKILL_INDEX_TIMEOUT_MS = 15000
export const SKILL_DOC_TIMEOUT_MS = 15000
/** The index changes when a repository does, not between openings of the same
 *  settings pane, so a session cache spares the network; Refresh forces it. */
export const SKILL_CATALOG_TTL_MS = 30 * 60_000
/** One SKILL.md bigger than this is a documentation site in disguise; it would
 *  be cut down to nothing useful at the instruction cap. */
export const SKILL_DOC_MAX = 400_000
/** Parallel SKILL.md reads. Enough to finish a catalogue in one round trip. */
const DOC_CONCURRENCY = 6

/** One installable skill as the catalogue lists it. */
export type SkillListing = {
  /** Id proposed for the installed skill, before de-duplication. */
  id: string
  name: string
  description: string
  /** Collection the skill belongs to ("Example skills"). */
  group: string
  /** Where it came from, recorded on the installed skill. */
  origin: string
  /** Absolute URL of the SKILL.md that is installed. */
  url: string
  /** Human page for this one skill. */
  page: string
  /** Body of the SKILL.md; empty when it could not be read yet. */
  instructions: string
  /** The body was longer than a skill may hold and was cut to fit. */
  truncated: boolean
}

export type SkillCatalogResult = {
  listings: SkillListing[]
  /** Set when the catalogue as a whole could not be read. */
  error?: string
  /** Individual skills that failed; the rest are still usable. */
  warnings: string[]
}

/* ---------- parsing (pure) ---------- */

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, max: number): string => typeof v === 'string' ? v.trim().slice(0, max) : ''

/** A YAML scalar: the value, or '' for a block marker (`>`, `|-`). */
const scalar = (raw: string): string => {
  const t = raw.trim()
  if (/^[|>][-+0-9]*$/.test(t)) return ''
  if (t.length > 1 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) return t.slice(1, -1).trim()
  return t
}

/**
 * Read the YAML front matter of a markdown file. Only a flat `key: value` map is
 * needed (`name`, `description`), so folded continuations and list items are
 * joined onto the key above them instead of growing a YAML parser.
 */
export function parseFrontmatter(markdown: string): { fields: Record<string, string>; body: string } {
  const raw = String(markdown ?? '').replace(/^\uFEFF/, '')
  const block = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(raw)
  if (!block) return { fields: {}, body: raw.trim() }
  const fields: Record<string, string> = {}
  let key = ''
  let parts: string[] = []
  const flush = () => {
    if (key && !(key in fields)) fields[key] = parts.join(' ').replace(/\s+/g, ' ').trim()
    key = ''
    parts = []
  }
  for (const line of block[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const kv = /^([A-Za-z][\w-]*)[ \t]*:[ \t]*(.*)$/.exec(line)
    if (kv) { flush(); key = kv[1].toLowerCase(); parts = [scalar(kv[2])] }
    else if (key) parts.push(scalar(line))
  }
  flush()
  return { fields, body: raw.slice(block[0].length).trim() }
}

/** Name, description and instruction body of one SKILL.md. */
export function parseSkillDoc(markdown: string): { name: string; description: string; instructions: string } {
  const { fields, body } = parseFrontmatter(markdown)
  return { name: text(fields.name, 80), description: text(fields.description, 500), instructions: body }
}

/** `skills/web-artifacts-builder/SKILL.md` → `skills/web-artifacts-builder`. */
const folderOf = (path: string): string => String(path ?? '')
  .trim()
  .replace(/[?#].*$/, '')
  .replace(/\/+$/, '')
  .replace(/\/SKILL\.md$/i, '')
  .replace(/^\.\//, '')

/** `web-artifacts-builder` → `Web artifacts builder`, for a skill whose own
 *  front matter has not been read yet (or never will be). */
export function titleFromPath(path: string): string {
  const slug = folderOf(path).split('/').filter(Boolean).pop() ?? ''
  const words = slug.replace(/[-_]+/g, ' ').trim().split(' ').filter(Boolean)
  if (!words.length) return ''
  const head = words[0].charAt(0).toUpperCase() + words[0].slice(1)
  return [head, ...words.slice(1)].join(' ').slice(0, 80)
}

type IndexEntry = { path: string; url?: string; group: string; name?: string; description?: string }

/** Pull the skill folders out of an index document. */
export function parseSkillIndex(body: unknown, source: SkillSource): IndexEntry[] {
  const out: IndexEntry[] = []
  const seen = new Set<string>()
  const push = (path: string, group: string, url?: string, name?: string, description?: string) => {
    const clean = folderOf(path)
    if (!clean) return
    const key = url ?? clean
    if (seen.has(key)) return
    seen.add(key)
    out.push({ path: clean, ...(url ? { url } : {}), group: group || 'Skills', ...(name ? { name } : {}), ...(description ? { description } : {}) })
  }
  // A plain list of skills, or of nothing but folder names.
  const list = Array.isArray(body) ? body : obj(body) && Array.isArray((body as { skills?: unknown }).skills) ? (body as { skills: unknown[] }).skills : null
  if (list) {
    for (const item of list) {
      if (typeof item === 'string') push(item, '', undefined)
      else if (obj(item)) {
        const url = text(item.url ?? item.raw ?? item.href, 500)
        const path = text(item.path ?? item.folder ?? item.skill ?? item.id ?? '', 500)
        const withDoc = path && !/SKILL\.md$/i.test(path) ? `${path}/SKILL.md` : path
        if (url) push(url, text(item.group ?? item.collection ?? '', 80), url, text(item.name, 80), text(item.description, 500))
        else if (path) push(withDoc, text(item.group ?? item.collection ?? '', 80), undefined, text(item.name, 80), text(item.description, 500))
      }
    }
    return out
  }
  // Claude Code plugin marketplace: plugins[].skills[] are folder paths.
  const plugins = obj(body) && Array.isArray((body as { plugins?: unknown }).plugins) ? (body as { plugins: unknown[] }).plugins : []
  for (const plugin of plugins) {
    if (!obj(plugin)) continue
    const group = titleFromPath(text(plugin.name, 80)) || text(plugin.name, 80) || 'Skills'
    const skills = Array.isArray(plugin.skills) ? plugin.skills : []
    for (const entry of skills) {
      if (typeof entry === 'string') push(entry, group)
      else if (obj(entry)) {
        const path = text(entry.path ?? entry.skill ?? entry.folder ?? '', 500)
        const url = text(entry.url ?? '', 500)
        if (url) push(url, group, url, text(entry.name, 80), text(entry.description, 500))
        else if (path) push(path, group, undefined, text(entry.name, 80), text(entry.description, 500))
      }
    }
  }
  return out
}

/** Absolute SKILL.md URL for an index entry. */
export function docUrlOf(entry: IndexEntry, source: SkillSource): string {
  if (entry.url) return entry.url
  return `${source.files}${folderOf(entry.path)}/SKILL.md`
}

/** Listings straight from the index, before any SKILL.md has been read. */
export function listingsFromIndex(body: unknown, source: SkillSource): SkillListing[] {
  return parseSkillIndex(body, source).flatMap((entry) => {
    const url = docUrlOf(entry, source)
    const id = slugifySkillId(folderOf(entry.path).split('/').filter(Boolean).pop() ?? '')
    if (!id || !/^https?:\/\//i.test(url)) return []
    const folder = entry.url ? entry.url.replace(/\/[^/]*$/, '') : `${source.files}${folderOf(entry.path)}`
    return [{
      id,
      name: entry.name || titleFromPath(entry.path),
      description: entry.description || '',
      group: entry.group,
      origin: `${source.origin}/${folderOf(entry.path) || id}`,
      url,
      page: entry.url ? folder : source.home,
      instructions: '',
      truncated: false,
    }]
  })
}

/** Attach a SKILL.md that has been read, cutting a body that is too long. */
export function applyDoc(listing: SkillListing, markdown: string): SkillListing {
  const doc = parseSkillDoc(markdown)
  const body = doc.instructions
  return {
    ...listing,
    name: doc.name || listing.name,
    description: doc.description || listing.description,
    instructions: body.slice(0, SKILL_INSTRUCTIONS_MAX),
    truncated: body.length > SKILL_INSTRUCTIONS_MAX,
  }
}

/** First free skill id based on `base`. A built-in's id would be refused by
 *  `validateCustomSkill`, and a retired one is dropped by `normSkills`, so both
 *  are treated as taken. */
export function uniqueSkillId(base: string, taken: Iterable<string>): string {
  const used = new Set<string>()
  for (const id of taken) used.add(String(id ?? ''))
  const reserved = (id: string) => used.has(id) || RETIRED_SKILL_IDS.includes(id) || BUILTIN_SKILLS.some((b) => b.id === id)
  const start = slugifySkillId(base) || 'skill'
  if (!reserved(start)) return start
  const stem = start.slice(0, 36).replace(/-+$/, '')
  for (let n = 2; n < 1000; n++) {
    const next = `${stem}-${n}`
    if (!reserved(next)) return next
  }
  return `${stem}-${Date.now().toString(36)}`
}

/** Search listings by name, description, id and collection. */
export function searchListings(listings: SkillListing[], query: string): SkillListing[] {
  const q = query.trim().toLowerCase()
  if (!q) return listings
  const words = q.split(/\s+/).filter(Boolean)
  return listings.filter((l) => {
    const hay = `${l.id} ${l.name} ${l.description} ${l.group}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

/** The skill state a listing installs to. Throws a readable error. */
export function skillFromListing(listing: SkillListing, taken: Iterable<string>): SkillState {
  if (!listing || !listing.instructions.trim()) throw new Error('That skill’s text could not be read. Try again, or open it at the source.')
  return validateCustomSkill({
    id: uniqueSkillId(listing.id, taken),
    name: listing.name || listing.id,
    description: listing.description || `Use for ${listing.name || listing.id} work.`,
    instructions: listing.instructions,
    source: listing.origin,
  })
}

/* ---------- fetching ---------- */

const messageOf = (e: unknown): string => {
  const raw = e instanceof Error ? e.message : String(e ?? '')
  if (/abort|timeout|timed out/i.test(raw)) return 'the request timed out'
  if (/failed to fetch|networkerror|load failed/i.test(raw)) return 'the network did not answer'
  return raw || 'unknown error'
}

async function getText(url: string, fetchFn: typeof fetch, ms: number): Promise<string> {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), ms) : null
  try {
    const res = await fetchFn(url, {
      headers: { accept: 'application/json, text/plain;q=0.9, */*;q=0.5' },
      ...(ctrl ? { signal: ctrl.signal } : {}),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = await res.text()
    if (body.length > SKILL_DOC_MAX) throw new Error('the file is too large')
    return body
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function mapLimit<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await run(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return out
}

async function buildCatalog(source: SkillSource, fetchFn: typeof fetch): Promise<SkillCatalogResult> {
  let index: unknown
  try {
    index = JSON.parse(await getText(source.index, fetchFn, SKILL_INDEX_TIMEOUT_MS))
  } catch (e) {
    return { listings: [], warnings: [], error: `The catalogue at ${source.label} could not be read: ${messageOf(e)}.` }
  }
  const listings = listingsFromIndex(index, source)
  if (!listings.length) return { listings: [], warnings: [], error: `${source.label} listed no skills.` }
  // Read each front matter so the list can show real names and descriptions.
  const docs = await mapLimit(listings, DOC_CONCURRENCY, async (l) => {
    try { return await getText(l.url, fetchFn, SKILL_DOC_TIMEOUT_MS) } catch { return '' }
  })
  let unreadable = 0
  const merged = listings.map((l, i) => {
    const doc = docs[i]
    if (!doc) { unreadable += 1; return l }
    return applyDoc(l, doc)
  })
  return {
    listings: merged.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name)),
    warnings: unreadable ? [`${unreadable} skill${unreadable === 1 ? '' : 's'} could not be read just now; they are still listed and are read again when installed.`] : [],
  }
}

const cache = new Map<string, { at: number; result: SkillCatalogResult }>()
const inflight = new Map<string, Promise<SkillCatalogResult>>()

/** Load (or reuse) the catalogue. `force` refetches for the Refresh button. */
export async function loadSkillCatalog(
  source: SkillSource = SKILL_SOURCES[0],
  opts: { force?: boolean; fetchFn?: typeof fetch } = {},
): Promise<SkillCatalogResult> {
  const hit = cache.get(source.id)
  if (!opts.force && hit && Date.now() - hit.at < SKILL_CATALOG_TTL_MS) return hit.result
  const running = inflight.get(source.id)
  if (running) return running
  const fetchFn = opts.fetchFn ?? fetch
  const p = buildCatalog(source, fetchFn)
    .then((result) => { cache.set(source.id, { at: Date.now(), result }); return result })
    .finally(() => { inflight.delete(source.id) })
  inflight.set(source.id, p)
  return p
}

/** Read one SKILL.md on demand, for a listing whose body was not fetched. */
export async function readListing(listing: SkillListing, fetchFn: typeof fetch = fetch): Promise<SkillListing> {
  if (listing.instructions) return listing
  return applyDoc(listing, await getText(listing.url, fetchFn, SKILL_DOC_TIMEOUT_MS))
}

/** Read if needed, then build the skill state. The one call the UI install button makes. */
export async function installListing(listing: SkillListing, taken: Iterable<string>, fetchFn: typeof fetch = fetch): Promise<SkillState> {
  return skillFromListing(await readListing(listing, fetchFn), taken)
}

export function clearSkillCatalogCache(): void {
  cache.clear()
}
