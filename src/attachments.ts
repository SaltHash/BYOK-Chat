/* Attachment naming helpers (pure).
 *
 * A message can carry several files, and two uploads often share a name
 * (`screenshot.png`, `document.pdf`, `transcript.vtt`). The model sees the
 * names in `[file: …]` blocks and in the attachment manifest, so every
 * uploaded file gets a distinct, stable name it can refer to unambiguously.
 */

export type NamedFile = { name: string }
/** Attachments may carry the name the model is shown separately from the name
 *  the user sees: file names are private and often contain client names,
 *  dates, or addresses. */
export type ModelNamedFile = NamedFile & { modelName?: string }

/** The name to put in the prompt for this attachment. */
export const promptNameOf = (a: ModelNamedFile): string => a.modelName || a.name

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

/** Give every attachment a neutral name for the model while the UI keeps the
 *  real one.
 *
 *  Uploads are numbered per kind — `image-1.png`, `image-2.jpg`, `file-1.pdf` —
 *  so the model can still refer to a specific file unambiguously without
 *  learning anything about its source. The original extension is kept so the
 *  model knows what it is looking at, and images default to `.png` when the
 *  upload had no usable one. The input array is never mutated. */
export function anonymizeAttachmentNames<T extends NamedFile & { kind?: string }>(atts: T[]): (T & { modelName: string })[] {
  let images = 0
  let files = 0
  return atts.map((a) => {
    const [, extRaw] = splitExt(String(a.name ?? ''))
    const ext = /^\.[a-z0-9]{1,6}$/i.test(extRaw) ? extRaw.toLowerCase() : ''
    const imageExt = /^\.(png|jpe?g|gif|webp|bmp|avif|svg|heic|heif|tiff?)$/i.test(ext)
    const isImage = a.kind === 'img' || (!a.kind && imageExt)
    const stem = isImage ? `image-${++images}` : `file-${++files}`
    // A date or version fragment is not an extension, so images fall back to
    // .png rather than carrying something like "image-1.22" into the prompt.
    const suffix = isImage ? (imageExt ? ext : '.png') : ext
    return { ...a, modelName: `${stem}${suffix}` }
  })
}

/** A one-line manifest naming every attachment, so even native binaries (an
 *  image sent as an image block, a PDF sent as a document block) have a name
 *  in the prompt the model can quote back. Empty when there are no files. */
export function attachmentManifest(atts: ModelNamedFile[] | undefined): string {
  if (!atts?.length) return ''
  return `Attached files: ${atts.map((a, i) => `${i + 1}. ${promptNameOf(a)}`).join(', ')}.`
}
