/* Document intelligence: dependency-free text extraction for PDFs, Office
 * files, archives and transcripts. Only fflate (already a dependency) is
 * used: PDFs are parsed for Tj/TJ text operators (FlateDecode via fflate),
 * OOXML formats are unzipped and their XML text nodes collected.
 * Pure + unit-testable: no DOM, no store imports. */

import { unzipSync, gunzipSync, inflateSync } from 'fflate'

export type OcrMode = 'off' | 'auto' | 'always'
export type DocPrefs = {
  pdfText: boolean
  office: boolean
  archives: boolean
  ocr: OcrMode
  ocrEp: string
  ocrModel: string
  perFileChars: number
}
export const BLANK_DOCS: DocPrefs = {
  pdfText: true,
  office: true,
  archives: true,
  ocr: 'auto',
  ocrEp: '',
  ocrModel: '',
  perFileChars: 60000,
}
export const normDocs = (v: any): DocPrefs => ({
  pdfText: v?.pdfText !== false,
  office: v?.office !== false,
  archives: v?.archives !== false,
  ocr: v?.ocr === 'always' ? 'always' : v?.ocr === 'off' ? 'off' : 'auto',
  ocrEp: typeof v?.ocrEp === 'string' ? v.ocrEp : '',
  ocrModel: typeof v?.ocrModel === 'string' ? v.ocrModel : '',
  perFileChars: Math.min(200000, Math.max(5000, Math.floor(Number(v?.perFileChars) || 60000))),
})

export const DOC_MAX_ENTRIES = 25
export const DOC_MAX_ENTRY_BYTES = 5_000_000
export const DOC_MAX_TOTAL_BYTES = 20_000_000

const latin1 = (b: Uint8Array): string => {
  let s = ''
  const CH = 32768
  for (let i = 0; i < b.length; i += CH) s += String.fromCharCode(...b.subarray(i, i + CH))
  return s
}

/* Windows-1252 code points 0x80–0x9F in Unicode order. */
const WIN1252 = '€\u201Aƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'

const winChar = (b: number): string => (b < 0x80 ? String.fromCharCode(b) : b < 0xa0 ? WIN1252[b - 0x80] : b === 0xad ? '' : String.fromCharCode(b))

/** Decode a PDF literal/hex string body to Unicode. Handles \( \) \\ \n
 *  \r \t \b \f octal escapes, <hex> bodies and UTF-16BE BOMs. */
export function decodePdfString(raw: string, hex: boolean): string {
  if (hex) {
    const h = raw.replace(/\s+/g, '')
    const bytes: number[] = []
    for (let i = 0; i < h.length; i += 2) bytes.push(parseInt(h.slice(i, i + 2).padEnd(2, '0'), 16))
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      let s = ''
      for (let i = 2; i + 1 < bytes.length; i += 2) s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1])
      return s
    }
    return bytes.map(winChar).join('')
  }
  if (raw.charCodeAt(0) === 0xfe && raw.charCodeAt(1) === 0xff) {
    let s = ''
    for (let i = 2; i + 1 < raw.length; i += 2) s += String.fromCharCode((raw.charCodeAt(i) << 8) | raw.charCodeAt(i + 1))
    return s
  }
  return raw
}

/** Extract text-show operations from one content-stream string. Returns the
 *  visible strings in paint order (kerning gaps ≥150 units become spaces). */
export function pdfContentText(content: string): string {
  const out: string[] = []
  let i = 0
  const n = content.length
  const pending: string[] = []
  const flushArray = (items: (string | number)[]) => {
    let s = ''
    for (const it of items) {
      if (typeof it === 'number') { if (it <= -150 && s && !/\s$/.test(s)) s += ' ' }
      else s += it
    }
    if (s) out.push(s)
  }
  const readString = (): string => {
    // content[i] === '('
    let depth = 0, s = ''
    i++
    while (i < n) {
      const c = content[i]
      if (c === '\\') {
        const nx = content[i + 1] ?? ''
        if (nx === 'n') { s += '\n'; i += 2 }
        else if (nx === 'r') { s += '\r'; i += 2 }
        else if (nx === 't') { s += '\t'; i += 2 }
        else if (nx === 'b') { s += '\b'; i += 2 }
        else if (nx === 'f') { s += '\f'; i += 2 }
        else if (nx === '(' || nx === ')' || nx === '\\') { s += nx; i += 2 }
        else if (/[0-7]/.test(nx)) {
          const m = /^[0-7]{1,3}/.exec(content.slice(i + 1))!
          s += String.fromCharCode(parseInt(m[0], 8) & 0xff)
          i += 1 + m[0].length
        } else if (nx === '\r' || nx === '\n') { i += nx === '\r' && content[i + 2] === '\n' ? 3 : 2 }
        else { s += nx; i += 2 }
      } else if (c === '(') { depth++; s += c; i++ }
      else if (c === ')') { if (!depth) { i++; break }; depth--; s += c; i++ }
      else { s += c; i++ }
    }
    return decodePdfString(s, false)
  }
  const readHex = (): string => {
    // content[i] === '<' (not '<<')
    i++
    let h = ''
    while (i < n && content[i] !== '>') { h += content[i]; i++ }
    i++
    return decodePdfString(h, true)
  }
  const skipSpace = () => { while (i < n && /[\s,]/y.test(content[i])) i++ }
  while (i < n) {
    const c = content[i]
    if (c === '(') { pending.push(readString()); continue }
    if (c === '<' && content[i + 1] !== '<') { pending.push(readHex()); continue }
    if (c === '[') {
      i++
      const items: (string | number)[] = []
      for (;;) {
        skipSpace()
        if (i >= n) break
        if (content[i] === ']') { i++; break }
        if (content[i] === '(') { items.push(readString()); continue }
        if (content[i] === '<' && content[i + 1] !== '<') { items.push(readHex()); continue }
        const m = /^[+-]?(?:\d+\.?\d*|\.\d+)/.exec(content.slice(i))
        if (m) { items.push(parseFloat(m[0])); i += m[0].length; continue }
        i++
      }
      // A [...] array is text only when followed by TJ.
      const save = i
      skipSpace()
      if (content.startsWith('TJ', i)) { i += 2; flushArray(items); pending.length = 0 }
      else { i = save; for (const it of items) if (typeof it === 'string') pending.push(it) }
      continue
    }
    if (/[A-Za-z'"]/.test(c)) {
      const m = /^[A-Za-z'"]+/.exec(content.slice(i))!
      const op = m[0]
      i += op.length
      if (op === 'Tj' || op === "'" || op === '"') {
        const s = pending.pop()
        if (s != null) out.push(s)
        pending.length = 0
      } else if (op === 'TJ') {
        // Bare TJ without array: ignore.
        pending.length = 0
      }
      continue
    }
    i++
  }
  return out.join(' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()
}

/** Extract text from a whole PDF file. Counts pages via /Type /Page markers;
 *  stream order is used as paint order. Never throws (returns '' on garbage). */
export function extractPdfText(bytes: Uint8Array): { text: string; pages: number } {
  try {
    const bin = latin1(bytes)
    if (!bin.startsWith('%PDF')) return { text: '', pages: 0 }
    const pages = (bin.match(/\/Type\s*\/Page[^s]/g) ?? []).length
    const parts: string[] = []
    let pos = 0
    for (;;) {
      const objAt = bin.indexOf(' obj', pos)
      if (objAt < 0) break
      const streamAt = bin.indexOf('stream', objAt)
      if (streamAt < 0) break
      const dict = bin.slice(pos, streamAt)
      void dict
      let dataStart = streamAt + 6
      if (bin[dataStart] === '\r') dataStart++
      if (bin[dataStart] === '\n') dataStart++
      const endAt = bin.indexOf('endstream', dataStart)
      if (endAt < 0) break
      const header = bin.slice(Math.max(0, objAt - 400), streamAt)
      let content = ''
      const raw = bytes.subarray(dataStart, endAt)
      if (/\/FlateDecode|\/Fl\b/.test(header)) {
        try { content = latin1(inflateSync(raw)) } catch { content = latin1(raw) }
      } else {
        content = latin1(raw)
      }
      const t = pdfContentText(content)
      if (t) parts.push(t)
      pos = endAt + 9
    }
    return { text: parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim(), pages }
  } catch { return { text: '', pages: 0 } }
}

const xmlEntities = (s: string): string =>
  s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e] ?? ' '))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))

const stripXmlTags = (s: string): string => xmlEntities(s.replace(/<[^>]+>/g, '')).replace(/[ \t\u00a0]+/g, ' ')

/** DOCX → paragraphs. Tables degrade to row paragraphs (cells joined). */
export function extractDocx(bytes: Uint8Array): { text: string; paragraphs: number } {
  const files = unzipSync(bytes)
  const name = Object.keys(files).find((k) => /(^|\/)word\/document\.xml$/.test(k))
  if (!name) throw Error('Not a Word document (missing word/document.xml).')
  const xml = latin1(files[name])
  const paras = xml.split(/<w:p[ />]/)
  const out: string[] = []
  for (const p of paras) {
    const body = p.split(/<\/w:p>/)[0]
    if (!/<w:t[ >]/.test(body)) continue
    const withBreaks = body.replace(/<w:tab[^/]*\/>/g, '\t').replace(/<w:br[^/]*\/>/g, '\n')
    const texts = [...withBreaks.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => xmlEntities(m[1]))
    const line = texts.join('').replace(/[ \t\u00a0]+/g, ' ').trim()
    if (line) out.push(line)
  }
  return { text: out.join('\n\n'), paragraphs: out.length }
}

/** ODT → paragraphs + headings. */
export function extractOdt(bytes: Uint8Array): { text: string; paragraphs: number } {
  const files = unzipSync(bytes)
  const name = Object.keys(files).find((k) => /(^|\/)content\.xml$/.test(k))
  if (!name) throw Error('Not an OpenDocument file (missing content.xml).')
  let xml = latin1(files[name])
  xml = xml.replace(/<text:s(?: text:c="(\d+)")?\/>/g, (_, c: string) => ' '.repeat(Math.min(40, Number(c ?? 1) || 1)))
    .replace(/<text:tab\/>/g, '\t').replace(/<text:line-break\/>/g, '\n')
  const paras = xml.split(/<text:(?:p|h)[ >]/)
  const out: string[] = []
  for (const p of paras) {
    const body = p.split(/<\/text:(?:p|h)>/)[0]
    if (!body || /<office:body/.test(body)) continue
    const line = stripXmlTags(body).trim()
    if (line) out.push(line)
  }
  return { text: out.join('\n\n'), paragraphs: out.length }
}

/** RTF → plain text. Skips font/color/stylesheet/info groups. */
export function extractRtf(raw: string): string {
  const SKIP = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'header', 'footer', 'headerf', 'headerl', 'header r', 'footerf', 'footerl', 'footerr', 'pict', 'shppict', 'themedata', 'colorschememapping', 'datastore'])
  let s = String(raw ?? '')
  // Strip destination groups with a balanced scanner.
  let out = '', i = 0
  const n = s.length
  while (i < n) {
    if (s[i] === '{') {
      const head = /^\\([a-z]+)/.exec(s.slice(i + 1, i + 24))
      if (head && SKIP.has(head[1])) {
        let depth = 0, j = i
        while (j < n) {
          if (s[j] === '{') depth++
          else if (s[j] === '}') { depth--; if (!depth) break }
          j++
        }
        i = j + 1
        continue
      }
      out += s[i]; i++; continue
    }
    out += s[i]; i++
  }
  s = out
    .replace(/\\par[d]?(\s|(?=[\\{}]))/g, '\n').replace(/\\line(\s|(?=[\\{}]))/g, '\n')
    .replace(/\\tab(\s|(?=[\\{}]))/g, '\t').replace(/\\emdash\s?/g, '—').replace(/\\endash\s?/g, '–')
    .replace(/\\bullet\s?/g, '•').replace(/\\lquote\s?/g, '‘').replace(/\\rquote\s?/g, '’')
    .replace(/\\ldblquote\s?/g, '“').replace(/\\rdblquote\s?/g, '”')
    .replace(/\\'([0-9a-fA-F]{2})/g, (_, h: string) => winChar(parseInt(h, 16)))
    .replace(/\\~\s?/g, ' ').replace(/\\-\s?/g, '').replace(/\\_\s?/g, '-')
    .replace(/\\[{}]\\?/g, (m) => m[1])
    .replace(/\\[a-z]+-?\d* ?/g, '')
    .replace(/[{}]/g, '')
  return s.replace(/[ \t\u00a0]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

type XlsxData = { text: string; sheets: number; rows: number }

/** XLSX → first-sheet rows (shared + inline strings). Capped at 2000 rows. */
export function extractXlsx(bytes: Uint8Array): XlsxData {
  const files = unzipSync(bytes)
  const shared: string[] = []
  const ssName = Object.keys(files).find((k) => /(^|\/)xl\/sharedStrings\.xml$/.test(k))
  if (ssName) {
    const ss = latin1(files[ssName])
    for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      shared.push([...m[1].matchAll(/<t(?: [^>]*)?>([\s\S]*?)<\/t>/g)].map((x) => xmlEntities(x[1])).join(''))
    }
  }
  const sheetNames = Object.keys(files).filter((k) => /(^|\/)xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()
  if (!sheetNames.length) throw Error('No worksheets found.')
  const sheet = latin1(files[sheetNames[0]])
  const rows = sheet.split(/<row[ >]/).slice(1)
  const out: string[] = []
  for (const r of rows.slice(0, 2000)) {
    const body = r.split(/<\/row>/)[0]
    const cells = [...body.matchAll(/<c(\s[^>]*)?>([\s\S]*?)<\/c>/g)].map((m) => {
      const attrs = m[1] ?? '', inner = m[2]
      if (/\bt="s"/.test(attrs)) {
        const idx = Number(/<v>(-?\d+)/.exec(inner)?.[1] ?? -1)
        return shared[idx] ?? ''
      }
      const inline = /<is>([\s\S]*)<\/is>/.exec(inner)
      if (inline) return [...inline[1].matchAll(/<t(?: [^>]*)?>([\s\S]*?)<\/t>/g)].map((x) => xmlEntities(x[1])).join('')
      return xmlEntities((/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '').trim())
    })
    while (cells.length && !cells[cells.length - 1]) cells.pop()
    if (cells.some(Boolean)) out.push(cells.join(', '))
  }
  return { text: out.join('\n'), sheets: sheetNames.length, rows: Math.min(rows.length, 2000) }
}

/** PPTX → slide texts in order. */
export function extractPptx(bytes: Uint8Array): { text: string; slides: number } {
  const files = unzipSync(bytes)
  const slides = Object.keys(files)
    .filter((k) => /(^|\/)ppt\/slides\/slide\d+\.xml$/.test(k))
    .sort((a, b) => Number(/slide(\d+)\.xml/.exec(a)![1]) - Number(/slide(\d+)\.xml/.exec(b)![1]))
  if (!slides.length) throw Error('No slides found.')
  const out = slides.map((k, i) => {
    const t = [...latin1(files[k]).matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => xmlEntities(m[1])).join(' ').replace(/\s+/g, ' ').trim()
    return t ? `[slide ${i + 1}]\n${t}` : ''
  }).filter(Boolean)
  return { text: out.join('\n\n'), slides: slides.length }
}

/* ---- Archive expansion ---- */

export type ZipEntry = { name: string; bytes: Uint8Array }
const JUNK = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db$|desktop\.ini$)|\.DS_Store$/i

export function unpackZip(bytes: Uint8Array): { entries: ZipEntry[]; skipped: number } {
  const files = unzipSync(bytes)
  const entries: ZipEntry[] = []
  let skipped = 0, total = 0
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith('/') || JUNK.test(name)) { skipped++; continue }
    if (entries.length >= DOC_MAX_ENTRIES || data.length > DOC_MAX_ENTRY_BYTES || total + data.length > DOC_MAX_TOTAL_BYTES) { skipped++; continue }
    entries.push({ name, bytes: data as Uint8Array })
    total += data.length
  }
  if (!entries.length) throw Error('No readable files inside the archive.')
  return { entries, skipped }
}

export function unpackGzip(bytes: Uint8Array, fallbackName: string): ZipEntry {
  const data = gunzipSync(bytes) as Uint8Array
  const inner = fallbackName.replace(/\.gz$/i, '') || 'file'
  return { name: inner, bytes: data }
}

const MIME_BY_EXT: Record<string, string> = {
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', tsv: 'text/tab-separated-values',
  json: 'application/json', html: 'text/html', pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
}

/** Expand zip/gz members of a FileList into Files (one level, budgeted).
 *  Returns the expanded list plus human-readable notices for skipped items. */
export async function expandArchives(files: File[], prefs: Pick<DocPrefs, 'archives'>): Promise<{ files: File[]; notices: string[] }> {
  if (!prefs.archives) return { files, notices: [] }
  const out: File[] = []
  const notices: string[] = []
  for (const f of files) {
    const lower = f.name.toLowerCase()
    try {
      if (lower.endsWith('.zip')) {
        const { entries, skipped } = unpackZip(new Uint8Array(await f.arrayBuffer()))
        for (const e of entries) {
          const ext = e.name.split('.').pop()?.toLowerCase() ?? ''
          out.push(new File([e.bytes as BlobPart], e.name.split('/').pop() || 'file', { type: MIME_BY_EXT[ext] ?? '' }))
        }
        notices.push(skipped ? `${f.name}: unpacked ${entries.length} files (${skipped} skipped).` : `${f.name}: unpacked ${entries.length} files.`)
      } else if (lower.endsWith('.gz') || lower.endsWith('.tgz')) {
        const e = unpackGzip(new Uint8Array(await f.arrayBuffer()), f.name)
        const ext = e.name.split('.').pop()?.toLowerCase() ?? ''
        out.push(new File([e.bytes as BlobPart], e.name.split('/').pop() || 'file', { type: MIME_BY_EXT[ext] ?? '' }))
        notices.push(`${f.name}: decompressed to ${e.name}.`)
      } else out.push(f)
    } catch {
      out.push(f) // let readAtt report the archive problem precisely
    }
  }
  return { files: out, notices }
}

/* ---- Chunking: fit extracted text to a per-file budget ---- */

/** Truncate to maxChars, preferring markdown-header then line boundaries.
 *  Never throws; always returns a truncation marker when cutting. */
export function fitDoc(text: string, maxChars: number): { text: string; truncated: boolean } {
  const t = String(text ?? '')
  if (t.length <= maxChars) return { text: t, truncated: false }
  let cut = maxChars
  const header = t.lastIndexOf('\n#', maxChars)
  const line = t.lastIndexOf('\n', maxChars)
  if (header > maxChars * 0.4) cut = header + 1
  else if (line > maxChars * 0.5) cut = line
  const kept = t.slice(0, cut).trimEnd()
  return { text: `${kept}\n[truncated: kept ${kept.length.toLocaleString()} of ${t.length.toLocaleString()} characters]`, truncated: true }
}

/* ---- Transcript pairing ---- */

const TRANSCRIPT_LIKE = /\.(vtt|srt|lrc|sbv)$/i
const TRANSCRIPT_HINT = /(transcript|caption|subtitle|lyrics)/i

export type Pairable = { name: string; kind: string; text?: string }

export function pairTranscripts<T extends Pairable>(atts: T[]): { atts: T[]; notices: string[] } {
  const notices: string[] = []
  const base = (n: string) => n.replace(/\.[^.]+$/, '').toLowerCase()
  const used = new Set<number>()
  const out = atts.map((a) => ({ ...a }))
  const medias = out.map((a, i) => ({ a, i })).filter(({ a }) => a.kind === 'media' && !a.text)
  for (const { a, i } of medias) {
    const b = base(a.name)
    const j = out.findIndex((t, k) =>
      !used.has(k) && k !== i && t.kind === 'txt' && t.text &&
      (TRANSCRIPT_LIKE.test(t.name) || TRANSCRIPT_HINT.test(t.name)) &&
      (base(t.name).startsWith(b) || b.startsWith(base(t.name).replace(TRANSCRIPT_HINT, '').replace(/[-_. ]+$/, ''))))
    if (j >= 0) {
      used.add(j)
      out[i] = { ...a, text: `[transcript of ${a.name}]\n${out[j].text}` }
      notices.push(`Paired transcript ${out[j].name} with ${a.name}.`)
    }
  }
  return { atts: out.filter((_, k) => !used.has(k)), notices }
}
