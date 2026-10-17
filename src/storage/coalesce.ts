/* Write coalescing for the persisted store.
 *
 * zustand's persist middleware writes on every `set`, and the store is set
 * once per streamed provider chunk. The persisted payload is the whole chat
 * history, so an uncoalesced write re-serializes and re-writes everything
 * many times per second — the single largest cost during streaming.
 *
 * `createWriteCoalescer` bounds that: the first push arms a trailing window,
 * later pushes inside the window only replace the pending value, and one
 * write happens per window with the newest value. `flush()` forces the
 * pending write out synchronously and is wired to pagehide/visibilitychange
 * so nothing is lost when the tab closes mid-window.
 *
 * Timers are injectable, so the scheduling logic is unit-testable without a
 * DOM or a fake clock. */

import type { PersistStorage, StateStorage, StorageValue } from 'zustand/middleware'

export type TimerHandle = ReturnType<typeof setTimeout>

export type CoalescerOptions = {
  /** Trailing window in ms: at most one write per window. */
  wait?: number
  schedule?: (fn: () => void, ms: number) => TimerHandle
  cancel?: (timer: TimerHandle) => void
  /** Invoked instead of throwing when a scheduled write fails. */
  onError?: (error: unknown) => void
}

export type WriteCoalescer<T> = {
  /** Replace the pending value; arms the window if it is not already armed. */
  push: (value: T) => void
  /** Write the pending value now (no-op when nothing is pending). */
  flush: () => void
  /** The pending value, if any. Reads do not disturb the schedule. */
  peek: () => T | undefined
  /** Drop the pending value without writing it. */
  cancel: () => void
}

const defaultSchedule = (fn: () => void, ms: number) => setTimeout(fn, ms)
const defaultCancel = (timer: TimerHandle) => clearTimeout(timer)

/** Throttled trailing writer: at most one write per `wait` ms, always with
 *  the newest value. A wrapper is used so `undefined` can be a value. */
export function createWriteCoalescer<T>(write: (value: T) => void, options: CoalescerOptions = {}): WriteCoalescer<T> {
  const wait = Math.max(0, Number(options.wait ?? 400) || 0)
  const schedule = options.schedule ?? defaultSchedule
  const cancelTimer = options.cancel ?? defaultCancel
  const onError = options.onError ?? (() => {})
  let timer: TimerHandle | null = null
  let pending: { value: T } | null = null

  const run = () => {
    timer = null
    const next = pending
    pending = null
    if (!next) return
    try { write(next.value) } catch (error) { onError(error) }
  }

  return {
    push: (value) => {
      pending = { value }
      if (timer === null) timer = schedule(run, wait)
    },
    flush: () => {
      if (timer !== null) { cancelTimer(timer); timer = null }
      run()
    },
    peek: () => pending?.value,
    cancel: () => {
      if (timer !== null) { cancelTimer(timer); timer = null }
      pending = null
    },
  }
}

/** A `PersistStorage` that serializes and writes at most once per window.
 *  Coalescing happens before `JSON.stringify`, so the per-chunk cost drops
 *  from "stringify + write the whole app" to "hold a reference". */
export type CoalescedPersistStorage<S> = PersistStorage<S> & { flush: () => void }

export function createCoalescedPersistStorage<S>(storage: StateStorage, options: CoalescerOptions = {}): CoalescedPersistStorage<S> {
  type Entry = { name: string; value: StorageValue<S> }
  const coalescer = createWriteCoalescer<Entry>(({ name, value }) => {
    storage.setItem(name, JSON.stringify(value))
  }, options)

  const parse = (raw: string | null | undefined): StorageValue<S> | null => {
    if (raw == null) return null
    try { return JSON.parse(raw) as StorageValue<S> } catch { return null }
  }

  return {
    getItem: (name) => {
      const pending = coalescer.peek()
      if (pending && pending.name === name) return pending.value
      const raw = storage.getItem(name)
      return raw instanceof Promise ? raw.then(parse) : parse(raw)
    },
    setItem: (name, value) => { coalescer.push({ name, value }) },
    removeItem: (name) => {
      const pending = coalescer.peek()
      if (pending && pending.name === name) coalescer.cancel()
      return storage.removeItem(name)
    },
    flush: () => coalescer.flush(),
  }
}

/** Flush before the page can go away. Returns a detach function. No-op
 *  without a DOM, so Node tests can import this module unchanged. */
export function attachFlushOnHide(flush: () => void, target?: { addEventListener: (t: string, f: () => void) => void; removeEventListener: (t: string, f: () => void) => void }): () => void {
  const win = target ?? (typeof window === 'undefined' ? undefined : window)
  if (!win) return () => {}
  const doc = typeof document === 'undefined' ? undefined : document
  const onPageHide = () => flush()
  const onVisibility = () => { if (doc && doc.visibilityState === 'hidden') flush() }
  win.addEventListener('pagehide', onPageHide)
  doc?.addEventListener('visibilitychange', onVisibility)
  return () => {
    win.removeEventListener('pagehide', onPageHide)
    doc?.removeEventListener('visibilitychange', onVisibility)
  }
}
