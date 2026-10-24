/* Attachment naming helpers (pure).
 *
 * A message can carry several files, and two uploads often share a name
 * (`screenshot.png`, `document.pdf`, `transcript.vtt`). The model sees the
 * names in `[file: …]` blocks and in the attachment manifest, so every
 * uploaded file gets a distinct, stable name it can refer to unambiguously.
 */

export type NamedFile = { name: string }

const splitExt = (name: string): [string, string] => {
  const i = name.lastIndexOf('.')
  // A leading-dot file (`.env`) has no extension to split off.
  if (i <= 0 || i === name.length - 1) return [name, '']
  return [name.slice(0, i), name.slice(i)]
}

/** Make every attachment name unique within the message.
 *
 * The first file keeps its name; later collisions get ` (2)`, ` (3)`, … before
 * the extension. Names are compared case-insensitively, because two files
 * called `Report.pdf` and `report.pdf` are just as ambiguous to a reader. Any
 * surrounding whitespace is trimmed for the final name, and an empty name
 * becomes `file`. The input array is never mutated. */
export function uniqueAttachmentNames<T extends NamedFile>(atts: T[]): T[] {
  const used = new Set<string>()
  return atts.map((a) => {
    const base = String(a.name ?? '').trim() || 'file'
    const [stemRaw, ext] = splitExt(base)
    const stem = stemRaw.trim() || 'file'
    let candidate = `${stem}${ext}`
    let n = 2
    while (used.has(candidate.toLowerCase())) {
      candidate = `${stem} (${n})${ext}`
      n++
    }
    used.add(candidate.toLowerCase())
    return candidate === a.name ? a : { ...a, name: candidate }
  })
}

/** A one-line manifest naming every attachment, so even native binaries (an
 *  image sent as an image block, a PDF sent as a document block) have a name
 *  in the prompt the model can quote back. Empty when there are no files. */
export function attachmentManifest(atts: NamedFile[] | undefined): string {
  if (!atts?.length) return ''
  return `Attached files: ${atts.map((a, i) => `${i + 1}. ${a.name}`).join(', ')}.`
}
