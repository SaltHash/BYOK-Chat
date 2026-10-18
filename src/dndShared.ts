/* Shared drag-insertion math for SortableList + Sidebar cross-folder DnD.
 * Both use midpoint collision with a small hysteresis bias to avoid flicker. */

export const DND_BIAS_PX = 4

/** Direction of pointer travel (defaults to down on first move). */
export type DndDirection = 1 | -1

export function dndDirection(currentY: number, lastY: number): DndDirection {
  return currentY >= lastY ? 1 : -1
}

export function insertionBias(dir: DndDirection): number {
  return dir === 1 ? -DND_BIAS_PX : DND_BIAS_PX
}

/** Index where the placeholder belongs given row midpoints (sorted top→bottom). */
export function insertionIndex(mids: number[], pointerY: number, dir: DndDirection): number {
  const bias = insertionBias(dir)
  for (let i = 0; i < mids.length; i++) {
    if (pointerY < mids[i] + bias) return i
  }
  return mids.length
}

/** Row midpoints from bounding rects (pure, testable). */
export function rowMidpoints(rects: { top: number; height: number }[]): number[] {
  return rects.map((r) => r.top + r.height / 2)
}

/** FLIP delta for a row whose previous animation may still be in flight.
 *
 * `previous` is the layout position at the previous commit, `visual` is the
 * on-screen position at this commit *before* clearing the in-flight transform
 * (so `visual - target` is the residual translation), and `target` is the layout
 * position after clearing. The row must restart from where it actually is,
 * `previous + residual`, not from the previous layout slot — the latter snaps
 * ahead by however far the placeholder moved this commit, which is what made
 * fast drags fly off the list. */
export function flipDelta(previous: number, visual: number, target: number): number {
  return previous + (visual - target) - target
}
