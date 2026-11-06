/* Optional image background.
 *
 * The default comes from /public so it costs no storage. An uploaded image is
 * written to the durable blob store and only its id is kept in settings, so a
 * multi-megabyte photo never lands in localStorage or a settings sync payload.
 * Anything else (including a URL from an imported config) resolves to the
 * bundled default instead of becoming an arbitrary remote request. */

import { blobDel, blobGet, blobPut } from './storage/durable'

export const DEFAULT_BG_IMAGE = '/clay-banks-u27Rrbs9Dwc-unsplash.jpg'
export const DEFAULT_BG_BLUR = 16
export const DEFAULT_BG_DIM = 35
export const BG_IMAGE_MAX_BYTES = 16 * 1024 * 1024
export const BG_BLOB_PREFIX = 'background:'

export const isCustomBg = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith(BG_BLOB_PREFIX)

/** Blur is a whole number of pixels from 0 to 100. */
export const normBgBlur = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0

/** Dim is a whole percentage from 0 to 95, so the image never goes fully black. */
export const normBgDim = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(95, Math.round(value))) : 0

/** Only the bundled asset or a path in this app. `//host` is not a local path. */
export function safeBgSource(value: unknown): string {
  return typeof value === 'string' && (value === DEFAULT_BG_IMAGE || (value.startsWith('/') && !value.startsWith('//')))
    ? value
    : DEFAULT_BG_IMAGE
}

/** Turn a stored preference into an actual CSS source. */
export async function resolveBgImage(value: unknown): Promise<string> {
  if (!isCustomBg(value)) return safeBgSource(value)
  const data = await blobGet(value)
  return typeof data === 'string' && data.startsWith('data:image/') ? data : DEFAULT_BG_IMAGE
}

const readAsDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => typeof reader.result === 'string'
    ? resolve(reader.result)
    : reject(new Error('That file could not be read as an image.'))
  reader.onerror = () => reject(new Error('That file could not be read as an image.'))
  reader.readAsDataURL(file)
})

const imageDecodes = (src: string): Promise<void> => new Promise((resolve, reject) => {
  // Storage helpers are also imported by Node tests, where Image is absent.
  if (typeof Image === 'undefined') { resolve(); return }
  const image = new Image()
  image.onload = () => resolve()
  image.onerror = () => reject(new Error('That file is not a readable image.'))
  image.src = src
})

/** Read, validate and store an uploaded background. Returns its durable id. */
export async function storeBackgroundFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.')
  if (file.type === 'image/svg+xml') throw new Error('SVG backgrounds are not supported; choose a PNG, JPEG, WebP, AVIF or GIF.')
  if (file.size > BG_IMAGE_MAX_BYTES) throw new Error('That image is over 16 MB. Choose a smaller image.')
  const data = await readAsDataUrl(file)
  if (!data.startsWith('data:image/')) throw new Error('That file could not be read as an image.')
  await imageDecodes(data)
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const id = `${BG_BLOB_PREFIX}${random}`
  await blobPut(id, data)
  return id
}

/** Remove a previous custom image. Best-effort: a missing blob is harmless. */
export async function deleteBackgroundImage(value: unknown): Promise<void> {
  if (isCustomBg(value)) await blobDel(value).catch(() => {})
}
