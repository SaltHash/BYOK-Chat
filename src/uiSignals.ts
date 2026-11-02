import { useSyncExternalStore } from 'react'

/* A tiny UI-wide signal for actions that are not chat data: the transcript
 * renders every Process-to-answer panel with its own open state, and a header
 * action has to close all of them at once. Keeping this out of the persisted
 * store means it never rides device sync or a settings export, and it costs
 * one subscription per reply instead of re-rendering the transcript. */

let logEpoch = 0
const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Close every open Process-to-answer panel in the current transcript. */
export function collapseAllProcessLogs(): void {
  logEpoch++
  for (const listener of listeners) listener()
}

/** Bumps when the collapse-all action runs; a panel closes on every change. */
export function useProcessLogEpoch(): number {
  return useSyncExternalStore(subscribe, () => logEpoch, () => 0)
}
