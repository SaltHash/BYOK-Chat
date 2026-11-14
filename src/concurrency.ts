/* Small async helpers for UI actions that fan out over several providers.
 *
 * Testing every model used to await one endpoint after another, so a slow or
 * unresponsive provider held back every test behind it. These helpers let each
 * test start as soon as a slot is free and stop the UI from waiting on a
 * request that will never answer. */

/** Run `worker` for each item, with at most `limit` in flight at once. Each
 *  item starts as soon as a slot frees up, so one slow item cannot serialize
 *  the rest. Resolves when every item has settled; the worker owns its own
 *  error handling. */
export async function runPool<T>(items: readonly T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0
  const slots = Math.max(1, Math.min(Math.floor(limit) || 1, items.length))
  await Promise.all(Array.from({ length: slots }, async () => {
    for (;;) {
      const index = next++
      if (index >= items.length) return
      await worker(items[index], index)
    }
  }))
}

/** Reject when `promise` has not settled within `ms`. The underlying request
 *  cannot always be cancelled, but the caller's state moves on instead of
 *  waiting forever. */
export function withDeadline<T>(promise: Promise<T>, ms: number, what = 'This request'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error(`${what} did not answer within ${Math.max(1, Math.round(ms / 1000))} s.`)),
      ms,
    )
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) },
    )
  })
}
