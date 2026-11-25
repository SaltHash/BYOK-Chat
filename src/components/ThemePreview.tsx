import { cx } from './ui'

/** The colours a preview needs. Every palette carries them, built-in or
 *  generated, so the same miniature paints any theme. */
export type PreviewColors = { bg: string; side: string; surf: string; hov: string; tx: string; mu: string; ac: string }

/** A miniature of the app painted in a theme's own colours: sidebar, a card
 *  with two lines of text, and a raised row with an accent mark. Showing the
 *  real surface ladder is what lets two themes be compared at a glance; the
 *  old three-bar swatch only said which colour is the accent.
 *
 *  Plain spans, no interactivity, so the whole preview can sit inside the
 *  button that selects the theme. */
export function ThemePreview({ colors, className }: { colors: PreviewColors; className?: string }) {
  return (
    <span aria-hidden="true" className={cx('flex h-14 w-full overflow-hidden rounded-md', className)} style={{ background: colors.bg }}>
      <span className="flex w-[26%] shrink-0 flex-col gap-1 p-1.5" style={{ background: colors.side }}>
        <span className="h-1.5 w-full rounded-full" style={{ background: colors.ac }} />
        <span className="h-1 w-3/4 rounded-full" style={{ background: colors.mu }} />
        <span className="h-1 w-2/3 rounded-full opacity-60" style={{ background: colors.mu }} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-1 p-1.5">
        <span className="rounded-sm px-1 py-1" style={{ background: colors.surf }}>
          <span className="block h-1 w-4/5 rounded-full" style={{ background: colors.tx }} />
          <span className="mt-1 block h-1 w-3/5 rounded-full" style={{ background: colors.mu }} />
        </span>
        <span className="ml-auto rounded-sm px-1 py-0.5" style={{ background: colors.hov }}>
          <span className="block h-1 w-7 rounded-full" style={{ background: colors.tx }} />
        </span>
      </span>
    </span>
  )
}
