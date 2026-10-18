/* Text-to-image generation through the user's own OpenAI-compatible endpoint.
 *
 * There is no text-to-image path in the chat API itself, so this is a separate
 * `/images/generations` request. Only the prompt and small metadata ever reach
 * the model: binary results are written to durable local storage and referenced
 * by id, so a generated image never bloats the chat or the context window. */
import type { Ep } from './store'

export type ImageGenPrefs = {
  on: boolean
  /** Endpoint id; empty means the first usable OpenAI-compatible endpoint. */
  ep: string
  /** Model id; empty means the endpoint's default model. */
  model: string
  size: string
  count: number
}

export const BLANK_IMAGE_GEN: ImageGenPrefs = { on: false, ep: '', model: '', size: '1024x1024', count: 1 }

export const IMAGE_SIZES: [string, string][] = [
  ['1024x1024', 'Square · 1024 × 1024'],
  ['1024x1536', 'Portrait · 1024 × 1536'],
  ['1536x1024', 'Landscape · 1536 × 1024'],
  ['1024x1792', 'Tall · 1024 × 1792'],
  ['1792x1024', 'Wide · 1792 × 1024'],
  ['512x512', 'Small square · 512 × 512'],
  ['256x256', 'Thumbnail · 256 × 256'],
]

export const normImageGen = (v: any): ImageGenPrefs => ({
  on: v?.on === true,
  ep: typeof v?.ep === 'string' ? v.ep : '',
  model: typeof v?.model === 'string' ? v.model : '',
  size: IMAGE_SIZES.some(([s]) => s === v?.size) ? v.size : BLANK_IMAGE_GEN.size,
  count: Number.isInteger(v?.count) ? Math.max(1, Math.min(4, v.count)) : 1,
})

/** `/images/generations` sits beside `/chat/completions` on the same base URL. */
export const buildImagesUrl = (base: string): string => `${String(base ?? '').trim().replace(/\/+$/, '')}/images/generations`

export type GeneratedImage = { b64?: string; url?: string; mime?: string; revised?: string }

const MIME_BY_PREFIX: [string, string][] = [
  ['/9j/', 'image/jpeg'],
  ['iVBOR', 'image/png'],
  ['R0lGOD', 'image/gif'],
  ['UklGR', 'image/webp'],
]

/** Best-effort MIME from the first base64 characters. */
export const mimeOfB64 = (b64: string): string =>
  MIME_BY_PREFIX.find(([prefix]) => String(b64 ?? '').startsWith(prefix))?.[1] ?? 'image/png'

export const imageSrc = (img: GeneratedImage): string =>
  img.b64 ? `data:${img.mime || mimeOfB64(img.b64)};base64,${img.b64}` : String(img.url ?? '')

/** Reference tokens inside a tool result or reply. */
export const imageRefsFrom = (text: string): string[] => {
  const out: string[] = []
  for (const m of String(text ?? '').matchAll(/\[image:(img-[a-zA-Z0-9_-]{1,80})\]/g)) {
    if (!out.includes(m[1])) out.push(m[1])
  }
  return out
}

/** Image ids referenced by a message's tool rounds. */
export const imageRefsFromRounds = (rounds?: { calls: { result?: string }[] }[] | null): string[] => {
  const out: string[] = []
  for (const round of rounds ?? []) for (const call of round.calls ?? []) {
    for (const id of imageRefsFrom(call?.result ?? '')) if (!out.includes(id)) out.push(id)
  }
  return out
}

/** Reject obvious HTML error pages early so the user gets the provider's text. */
const errorDetail = (bodyText: string, fallback: string): string => {
  try {
    const j = JSON.parse(bodyText)
    const msg = j?.error?.message ?? j?.error ?? j?.message ?? j?.detail
    if (typeof msg === 'string' && msg.trim()) return msg.trim().slice(0, 400)
  } catch { /* plain text body */ }
  const text = String(bodyText ?? '').replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, 400) : fallback
}

export type GenerateOpts = { size?: string; count?: number; timeoutMs?: number }

/** One image-generation call. Never logs the key or the prompt. */
export async function generateImages(
  ep: Ep,
  model: string,
  prompt: string,
  opts: GenerateOpts = {},
  fetchFn: typeof fetch = fetch,
): Promise<GeneratedImage[]> {
  if (ep.type !== 'openai') throw Error('Image generation needs an OpenAI-compatible endpoint: the Anthropic Messages API has no image model.')
  const p = String(prompt ?? '').trim().slice(0, 4000)
  if (!p) throw Error('Provide a prompt for the image.')
  if (!/^https?:\/\//i.test(ep.url.trim())) throw Error('The image endpoint has no base URL.')
  const body: Record<string, unknown> = {
    model: model || ep.model,
    prompt: p,
    n: Math.max(1, Math.min(4, Number(opts.count) || 1)),
    size: opts.size || BLANK_IMAGE_GEN.size,
    response_format: 'b64_json',
  }
  const timeoutMs = Math.max(10_000, Math.min(300_000, Number(opts.timeoutMs) || 180_000))
  const call = async (payload: Record<string, unknown>) => {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeoutMs)
    try {
      return await fetchFn(buildImagesUrl(ep.url), {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(ep.key ? { authorization: `Bearer ${ep.key}` } : {}) },
        body: JSON.stringify(payload),
        signal: ac.signal,
      })
    } catch (e: any) {
      if (e?.name === 'AbortError') throw Error(`The image request timed out after ${Math.round(timeoutMs / 1000)}s.`)
      throw Error(`Could not reach the image endpoint (${String(e?.message ?? e)}).`)
    } finally {
      clearTimeout(timer)
    }
  }
  let res = await call(body)
  let text = await res.text().catch(() => '')
  // Some compatible servers reject `response_format`; retry once without it
  // rather than failing a request that would otherwise work.
  if ((res.status === 400 || res.status === 422) && /response_?format/i.test(text)) {
    const fallback = { ...body }
    delete fallback.response_format
    res = await call(fallback)
    text = await res.text().catch(() => '')
  }
  if (!res.ok) throw Error(`Image generation failed (HTTP ${res.status}): ${errorDetail(text, res.statusText || 'request failed')}`)
  let data: any
  try { data = JSON.parse(text) } catch { throw Error('The image endpoint returned something that was not JSON.') }
  const items = Array.isArray(data?.data) ? data.data : []
  const images: GeneratedImage[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const b64 = typeof item.b64_json === 'string' ? item.b64_json : typeof item.b64 === 'string' ? item.b64 : ''
    const url = typeof item.url === 'string' ? item.url : ''
    if (!b64 && !url) continue
    images.push({
      ...(b64 ? { b64, mime: mimeOfB64(b64) } : { url }),
      ...(typeof item.revised_prompt === 'string' && item.revised_prompt ? { revised: item.revised_prompt.slice(0, 1000) } : {}),
    })
  }
  if (!images.length) throw Error('The image endpoint returned no images. Check that the model supports image generation.')
  return images
}

/** Short, model-facing description of a finished batch (binary stays local). */
export const imageSummary = (images: GeneratedImage[], size: string): string =>
  `Generated ${images.length} image${images.length === 1 ? '' : 's'} at ${size}. They are shown to the user beside the reply. Do not describe them from memory; refer to them only as the generated image${images.length === 1 ? '' : 's'}.`
