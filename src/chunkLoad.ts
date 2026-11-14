/* Recovery for lazily loaded chunks across a deployment.
 *
 * Chunk filenames are content-hashed and a new build replaces the whole
 * `assets` directory, so a tab still running the previous shell asks for a file
 * that no longer exists. The dynamic import 404s and surfaces as
 * "Failed to fetch dynamically imported module: …/assets/Rich-<oldhash>.js",
 * leaving that part of the UI unrendered until the page is reloaded by hand.
 *
 * One retry comes first: a request that failed mid-deploy or on a flaky
 * connection usually succeeds the second time. If it still fails the chunk is
 * really gone, so the tab reloads to pick up the current shell — at most once
 * per RELOAD_WINDOW, so a build whose own shell is broken cannot trap the page
 * in a reload loop; after that the error goes to the caller instead.
 */

const RELOAD_KEY = 'byok:chunk-reload'
const RETRY_MS = 250
/* Longer than the reload takes to unload and boot the new shell, short enough
 * that a later deployment in the same tab can still recover on its own. */
const RELOAD_WINDOW_MS = 10_000
/* How long a triggered reload is given to unload the document before the
 * caller is handed the original import failure instead. */
const RELOAD_SETTLE_MS = 1500

/* Session storage is the only place the reload can be remembered across the
 * document that triggers it. When it is unavailable (some privacy modes) the
 * page is left alone rather than risk reloading on every failed chunk. */
function reloadForFreshShell(): boolean {
  if (typeof globalThis.location?.reload !== 'function') return false
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0)
    if (Date.now() - last < RELOAD_WINDOW_MS) return false
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch {
    return false
  }
  globalThis.location.reload()
  return true
}

export async function loadChunk<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load()
  } catch {
    /* retried below */
  }
  try {
    return await new Promise<T>((resolve, reject) => {
      setTimeout(() => { load().then(resolve, reject) }, RETRY_MS)
    })
  } catch (error) {
    if (reloadForFreshShell()) {
      // Normally the document unloads here. It may not: the app asks before
      // closing while a research run is in flight, and if the user stays the
      // page survives. Settle either way, so whatever was Suspense-waiting
      // (Settings, the palette, the share view) gets an error instead of
      // waiting forever.
      return await new Promise<T>((_, reject) => {
        setTimeout(() => reject(error), RELOAD_SETTLE_MS)
      })
    }
    throw error
  }
}
