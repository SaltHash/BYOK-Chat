/* Pure drag-and-drop math shared by SortableList and the Sidebar's cross-folder
 * drag. Nothing here touches the DOM, so every rule is unit-tested in isolation.
 */

/** Pointer must travel this far past a row midpoint before the insertion point
 *  moves across it. Stops flicker when the pointer sits right on a boundary. */
export const DND_BIAS_PX = 4

/** Insertion index for a pointer position, given row midpoints (top to bottom)
 *  and the index the placeholder currently sits at.
 *
 *  The index only changes when the pointer crosses a midpoint by DND_BIAS_PX,
 *  so it is a pure function of pointer position and the previous index:
 *  reversing direction inside the band keeps the placeholder where it is. */
export function stepInsertion(mids: number[], pointerY: number, current: number): number {
  let i = Math.max(0, Math.min(current, mids.length))
  while (i < mids.length && pointerY > mids[i] + DND_BIAS_PX) i++
  while (i > 0 && pointerY < mids[i - 1] - DND_BIAS_PX) i--
  return i
}

/** Row midpoints from rects (top to bottom). */
export function rowMidpoints(rects: { top: number; height: number }[]): number[] {
  return rects.map((r) => r.top + r.height / 2)
}

/** Translate (in px) a row must start from so it appears exactly where it is
 *  on screen, then animate to its new layout slot.
 *
 *  - `previous`: document-space layout top at the last commit (no transform).
 *  - `animOffset`: the translate still applied right now (in-flight animation).
 *  - `now`: document-space layout top after the commit (no transform).
 *
 *  The visual top before the commit was `previous + animOffset`, so the start
 *  offset is that minus the new layout top. Starting from the previous *layout*
 *  slot instead (ignoring animOffset) teleports interrupted rows, which is what
 *  made fast drags fly off their tracks. */
export function flipDelta(previous: number, animOffset: number, now: number): number {
  return previous + animOffset - now
}

/** Y component of a computed `transform` (`matrix(...)` or `matrix3d(...)`). */
export function parseTranslateY(transform: string): number {
  if (!transform || transform === 'none') return 0
  const m = /^(matrix3d|matrix)\((.+)\)$/.exec(transform.trim())
  if (!m) return 0
  const v = m[2].split(',').map((s) => parseFloat(s))
  const y = m[1] === 'matrix' ? v[5] : v[13]
  return Number.isFinite(y) ? y : 0
}
