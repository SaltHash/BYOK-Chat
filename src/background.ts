/* Optional image background.
 *
 * Bundled wallpapers live in /public/wallpapers and use small thumbnails from
 * /public/wallpapers/thumbs in the picker. An uploaded image is written to the
 * durable blob store and only its id is kept in settings, so a multi-megabyte
 * photo never lands in localStorage or a settings sync payload. Anything else
 * (including a URL from an imported config) resolves to the bundled default
 * instead of becoming an arbitrary remote request. */

import { blobDel, blobGet, blobPut } from './storage/durable'

export type Wallpaper = { src: string; label: string }

export const WALLPAPERS: Wallpaper[] = [
  { src: '/wallpapers/ales-krivec-x4Jc4HKEHKg-unsplash.jpg', label: 'Ales Krivec' },
  { src: '/wallpapers/brendan-beale-YJsw2TfZ_F4-unsplash.jpg', label: 'Brendan Beale' },
  { src: '/wallpapers/clay-banks-u27Rrbs9Dwc-unsplash.jpg', label: 'Clay Banks' },
  { src: '/wallpapers/john-towner-JgOeRuGD_Y4-unsplash.jpg', label: 'John Towner' },
  { src: '/wallpapers/jr-korpa-9XngoIpxcEo-unsplash.jpg', label: 'JR Korpa' },
  { src: '/wallpapers/milad-fakurian-E8Ufcyxz514-unsplash.jpg', label: 'Milad Fakurian' },
  { src: '/wallpapers/nathan-anderson-iYO-EGosrCo-unsplash.jpg', label: 'Nathan Anderson' },
  { src: '/wallpapers/national-gallery-of-art-nyhZogmvelI-unsplash.jpg', label: 'National Gallery of Art' },
  { src: '/wallpapers/pawel-czerwinski-ERcQ81KaX9g-unsplash.jpg', label: 'Paweł Czerwinski' },
  { src: '/wallpapers/richard-horvath-_nWaeTF6qo0-unsplash.jpg', label: 'Richard Horváth' },
  { src: '/wallpapers/the-metropolitan-museum-of-art-9XpO8WsYNdI-unsplash.jpg', label: 'The Metropolitan Museum of Art' },
  { src: '/wallpapers/tomas-hudolin-qd9SE8we9Yo-unsplash.jpg', label: 'Tomáš Hudolín' },
]

export const DEFAULT_BG_IMAGE = '/wallpapers/clay-banks-u27Rrbs9Dwc-unsplash.jpg'
const LEGACY_DEFAULT_BG_IMAGE = '/clay-banks-u27Rrbs9Dwc-unsplash.jpg'
export const DEFAULT_BG_BLUR = 10
export const DEFAULT_BG_DIM = 35
export const DEFAULT_BG_SATURATION = 100
export const DEFAULT_BG_TINT = 0
export const BG_IMAGE_MAX_BYTES = 16 * 1024 * 1024
export const BG_BLOB_PREFIX = 'background:'

export const isCustomBg = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith(BG_BLOB_PREFIX)

/** The low-resolution companion generated for every bundled wallpaper. */
export const wallpaperThumb = (src: string): string => {
  const name = src.split('/').pop() ?? ''
  return `/wallpapers/thumbs/${name.replace(/\.[^.]+$/, '.jpg')}`
}

/** Display name for a bundled wallpaper, or a clear custom-image label. */
export const wallpaperLabel = (value: unknown): string =>
  WALLPAPERS.find((wallpaper) => wallpaper.src === value)?.label
  ?? (isCustomBg(value) ? 'Custom image' : 'Clay Banks')

/** Blur is a whole number of pixels from 0 to 100. */
export const normBgBlur = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0

/** Dim is a whole percentage from 0 to 95, so the image never goes fully black. */
export const normBgDim = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(95, Math.round(value))) : 0

/** Saturation is a whole percentage from 0 (grayscale) to 200 (vivid). */
export const normBgSaturation = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(200, Math.round(value))) : 100

/** Tint is a whole percentage from 0 to 100 of the interface colour. */
export const normBgTint = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0

/** Only the bundled assets or a path in this app. `//host` is not a local path. */
export function safeBgSource(value: unknown): string {
  if (value === LEGACY_DEFAULT_BG_IMAGE) return DEFAULT_BG_IMAGE
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
