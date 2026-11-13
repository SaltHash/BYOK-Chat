/* Approximate location with a graceful fallback.
 *
 * Chromium's network location provider can fail with "Response was malformed"
 * (POSITION_UNAVAILABLE) even after the user grants permission. In that case a
 * coarse IP-based estimate is more useful than a failed tool call. A denied
 * permission is never bypassed with a network lookup. */

const BROWSER_TIMEOUT_MS = 7_000
const NETWORK_TIMEOUT_MS = 4_500
const IP_ENDPOINTS = [
  'https://ipwho.is/',
  'https://get.geojs.io/v1/ip/geo.json',
]

type GeoSuccess = { coords: { latitude: number; longitude: number } }
type GeoError = { code?: number; message?: string }
type GeoApi = {
  getCurrentPosition: (
    success: (position: GeoSuccess) => void,
    error?: (error: GeoError) => void,
    options?: PositionOptions,
  ) => void
}
type JsonResponse = { ok: boolean; json: () => Promise<unknown> }
type FetchLike = (input: string, init?: RequestInit) => Promise<JsonResponse>

export type LocationDeps = {
  /** Pass null to simulate an environment without the Geolocation API. */
  geolocation?: GeoApi | null
  fetch?: FetchLike
  browserTimeoutMs?: number
  networkTimeoutMs?: number
}

type Coordinates = { latitude: number; longitude: number; place?: string }

const numberValue = (value: unknown): number | undefined => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(n) ? n : undefined
}

const stringValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const isCoordinate = (value: number | undefined, limit: number): value is number =>
  value !== undefined && value >= -limit && value <= limit

function formatLocation({ latitude, longitude, place }: Coordinates): string {
  const coordinates = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`
  if (!place) return coordinates
  return `${coordinates} (approximate; ${place})`
}

function browserGeolocation(): GeoApi | undefined {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return undefined
  return navigator.geolocation as unknown as GeoApi
}

function browserPosition(geo: GeoApi, timeoutMs: number): Promise<Coordinates> {
  return new Promise((resolve, reject) => {
    geo.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      }),
      (error) => reject(Object.assign(new Error(error.message || 'position unavailable'), { code: error.code })),
      { enableHighAccuracy: false, maximumAge: 5 * 60_000, timeout: timeoutMs },
    )
  })
}

async function fetchWithTimeout(fetcher: FetchLike, url: string, timeoutMs: number): Promise<JsonResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetcher(url, { signal: controller.signal, headers: { accept: 'application/json' } })
  } finally {
    clearTimeout(timer)
  }
}

function placeFrom(data: Record<string, unknown>): string | undefined {
  const parts = [
    stringValue(data.city) || stringValue(data.locality),
    stringValue(data.region),
    stringValue(data.country),
  ].filter(Boolean)
  return parts.length ? Array.from(new Set(parts)).join(', ') : undefined
}

async function networkPosition(fetcher: FetchLike, timeoutMs: number): Promise<Coordinates | null> {
  for (const endpoint of IP_ENDPOINTS) {
    try {
      const response = await fetchWithTimeout(fetcher, endpoint, timeoutMs)
      if (!response.ok) continue
      const raw = await response.json()
      if (!raw || typeof raw !== 'object') continue
      const data = raw as Record<string, unknown>
      if (data.success === false) continue
      const latitude = numberValue(data.latitude)
      const longitude = numberValue(data.longitude)
      if (!isCoordinate(latitude, 90) || !isCoordinate(longitude, 180)) continue
      return { latitude, longitude, place: placeFrom(data) }
    } catch {
      // Try the next provider; the caller reports a single clear error.
    }
  }
  return null
}

/** Read approximate coordinates, falling back to a coarse IP estimate when the
 *  browser's location service is unavailable or fails. Throws only when no
 *  location can be obtained, or when the user explicitly denied permission. */
export async function readApproximateLocation(deps: LocationDeps = {}): Promise<string> {
  const geo = deps.geolocation === undefined ? browserGeolocation() : deps.geolocation
  let browserFailure = ''
  if (geo) {
    try {
      return formatLocation(await browserPosition(geo, deps.browserTimeoutMs ?? BROWSER_TIMEOUT_MS))
    } catch (error) {
      const code = (error as { code?: number }).code
      if (code === 1) {
        throw new Error('Location permission was denied. Allow location access in your browser, or share a city or neighborhood instead.')
      }
      browserFailure = error instanceof Error && error.message ? error.message : 'browser location unavailable'
    }
  } else {
    browserFailure = 'browser geolocation is not available'
  }

  const fetcher = deps.fetch ?? (typeof fetch === 'function' ? fetch : undefined)
  if (fetcher) {
    const approximate = await networkPosition(fetcher, deps.networkTimeoutMs ?? NETWORK_TIMEOUT_MS)
    if (approximate) {
      return formatLocation({ ...approximate, place: approximate.place ?? 'network location' })
    }
  }

  throw new Error(`Could not determine an approximate location${browserFailure ? `: ${browserFailure}` : ''}. Share a city or neighborhood instead.`)
}
