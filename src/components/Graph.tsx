import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Download, Maximize2, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useS } from '../store'
import { cx, Modal, type Ic } from './ui'
import {
  computeGraphDomain,
  contourSegments,
  formatTick,
  graphItemCount,
  graphSummaryBits,
  graphTitle,
  isSingleValuedGraph,
  niceTicks,
  normalizeGraphSpec,
  regionRuns,
  resolveGraphColor,
  sampleExplicit,
  snapTo,
  type GraphMark,
  type GraphPattern,
  type GraphPoint,
  type GraphSeries,
  type GraphPlacement,
  type GraphShape,
  type GraphSpec,
  type Pt,
  type SnapAnchor,
  type SnapHit,
  type SnapLine,
} from '../graph'

type CallLike = { id: string; name: string; arguments: string; error?: boolean }

const parseArgs = (raw: string): Record<string, unknown> => {
  try {
    const value = JSON.parse(raw || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const px = (n: number) => Math.round(n * 100) / 100
const coord = (n: number) => {
  const a = Math.abs(n)
  if (a >= 1000 || (a > 0 && a < 0.01)) return n.toPrecision(3)
  return String(Math.round(n * 1000) / 1000)
}

/** Stroke dash array per pattern. Dotted uses a round cap so the tiny dashes
 *  read as dots at both sizes. */
const DASH: Record<GraphPattern, string | undefined> = {
  solid: undefined,
  dashed: '7 5',
  dotted: '1.5 4',
  dashdot: '9 4 1.5 4',
}

/** Polyline path for a list of math points. */
const linePath = (pts: Pt[], sx: (x: number) => number, sy: (y: number) => number) => {
  let d = ''
  let pen = false
  for (const p of pts) {
    d += `${pen ? 'L' : 'M'}${px(sx(p.x))} ${px(sy(p.y))}`
    pen = true
  }
  return d
}

/** One path containing many disjoint segments (implicit contours). */
const segmentPath = (segments: [Pt, Pt][], sx: (x: number) => number, sy: (y: number) => number) =>
  segments.map(([a, b]) => `M${px(sx(a.x))} ${px(sy(a.y))}L${px(sx(b.x))} ${px(sy(b.y))}`).join('')

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'graph'

/** Resolve CSS custom properties so a downloaded SVG keeps the app theme. */
function themedSvg(clone: SVGSVGElement): string {
  const root = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string) => {
    if (name === '--bor') return root.getPropertyValue('--mu').trim() || fallback
    return root.getPropertyValue(name).trim() || fallback
  }
  const resolve = (value: string) => value.replace(/var\((--[a-z0-9-]+)\)/gi, (_, name: string) => read(name, '#888888'))
  for (const el of [clone, ...Array.from(clone.querySelectorAll('*'))]) {
    for (const attr of ['fill', 'stroke', 'stop-color', 'color', 'style']) {
      const value = el.getAttribute(attr)
      if (value && value.includes('var(')) el.setAttribute(attr, resolve(value))
    }
  }
  const ns = 'http://www.w3.org/2000/svg'
  const bg = document.createElementNS(ns, 'rect')
  bg.setAttribute('x', '0')
  bg.setAttribute('y', '0')
  bg.setAttribute('width', '100%')
  bg.setAttribute('height', '100%')
  bg.setAttribute('fill', read('--bg', '#ffffff'))
  clone.insertBefore(bg, clone.firstChild)
  clone.setAttribute('xmlns', ns)
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  return new XMLSerializer().serializeToString(clone)
}

function PlotBtn({ icon: I, title, onClick }: { icon: Ic; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="grid size-7 place-items-center rounded-md bg-surf/90 text-mu ring-1 ring-bor/60 backdrop-blur-sm transition-colors hover:bg-surf hover:text-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ac/60"
    >
      <I size={14} />
    </button>
  )
}

function ShapeView({ shape, sx, sy, dark, top, left, right }: {
  shape: GraphShape
  sx: (x: number) => number
  sy: (y: number) => number
  dark: boolean
  top: number
  left: number
  right: number
}) {
  if (shape.type === 'label') {
    const color = resolveGraphColor(shape.color, dark)
    return (
      <text x={clamp(sx(shape.at.x), left + 4, right - 4)} y={Math.max(top + 10, sy(shape.at.y))} textAnchor="middle" fontSize={12} fontWeight={500} fill={color}
        stroke="var(--surf)" strokeWidth={3} paintOrder="stroke" strokeLinejoin="round">
        {shape.text}
      </text>
    )
  }
  const color = resolveGraphColor(shape.color, dark)
  const fillColor = 'fill' in shape && shape.fill
    ? resolveGraphColor(('fillColor' in shape && shape.fillColor) || shape.color, dark)
    : 'none'
  const common = {
    stroke: color,
    strokeWidth: shape.width,
    strokeDasharray: DASH[shape.pattern],
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
    opacity: shape.opacity,
    fill: fillColor,
    fillOpacity: fillColor === 'none' ? undefined : 0.14,
  }
  let body: ReactNode = null
  if (shape.type === 'segment' || shape.type === 'vector') {
    const x1 = sx(shape.from.x), y1 = sy(shape.from.y)
    const x2 = sx(shape.to.x), y2 = sy(shape.to.y)
    if (shape.type === 'segment') {
      body = <line x1={x1} y1={y1} x2={x2} y2={y2} {...common} />
    } else {
      // Draw the arrowhead in screen space so it stays proportional and uses
      // the shape's own colour rather than a shared gray marker.
      const angle = Math.atan2(y2 - y1, x2 - x1)
      const length = Math.hypot(x2 - x1, y2 - y1)
      const head = Math.min(13, Math.max(6, length * 0.18))
      const bx = x2 - Math.cos(angle) * head
      const by = y2 - Math.sin(angle) * head
      const spread = head * 0.55
      const p1 = `${x2},${y2}`
      const p2 = `${bx - Math.sin(angle) * spread},${by + Math.cos(angle) * spread}`
      const p3 = `${bx + Math.sin(angle) * spread},${by - Math.cos(angle) * spread}`
      body = (
        <g>
          <line x1={x1} y1={y1} x2={bx} y2={by} {...common} fill="none" />
          <polygon points={`${p1} ${p2} ${p3}`} fill={color} stroke={color} strokeWidth={1} strokeLinejoin="round" opacity={shape.opacity} />
        </g>
      )
    }
  } else if (shape.type === 'circle') {
    body = (
      <ellipse cx={sx(shape.center.x)} cy={sy(shape.center.y)}
        rx={Math.abs(sx(shape.center.x + shape.radius) - sx(shape.center.x))}
        ry={Math.abs(sy(shape.center.y + shape.radius) - sy(shape.center.y))} {...common} />
    )
  } else if (shape.type === 'rect') {
    const x1 = Math.min(sx(shape.from.x), sx(shape.to.x)), x2 = Math.max(sx(shape.from.x), sx(shape.to.x))
    const y1 = Math.min(sy(shape.from.y), sy(shape.to.y)), y2 = Math.max(sy(shape.from.y), sy(shape.to.y))
    body = <rect x={x1} y={y1} width={Math.max(0.5, x2 - x1)} height={Math.max(0.5, y2 - y1)} rx={2} {...common} />
  } else if (shape.type === 'polygon') {
    body = <polygon points={shape.points.map((p) => `${px(sx(p.x))},${px(sy(p.y))}`).join(' ')} {...common} />
  }
  if (!body) return null
  if (!shape.label) return body
  const at = shape.type === 'circle' ? shape.center : 'points' in shape
    ? { x: shape.points.reduce((n, p) => n + p.x, 0) / shape.points.length, y: shape.points.reduce((n, p) => n + p.y, 0) / shape.points.length }
    : { x: (shape.from.x + shape.to.x) / 2, y: (shape.from.y + shape.to.y) / 2 }
  return (
    <>
      {body}
      <text x={clamp(sx(at.x), left + 6, right - 6)} y={Math.max(top + 10, sy(at.y) - 9)} textAnchor="middle" fontSize={11} fill={color}
        stroke="var(--surf)" strokeWidth={3} paintOrder="stroke" strokeLinejoin="round">
        {shape.label}
      </text>
    </>
  )
}

function PointView({ point, sx, sy, dark, top, left, right }: {
  point: GraphPoint
  sx: (x: number) => number
  sy: (y: number) => number
  dark: boolean
  top: number
  left: number
  right: number
}) {
  const color = resolveGraphColor('black', dark)
  return (
    <g>
      <circle cx={sx(point.x)} cy={sy(point.y)} r={4} fill={color} stroke="var(--surf)" strokeWidth={1.6} />
      {point.label && (
        <text x={clamp(sx(point.x), left + 6, right - 6)} y={Math.max(top + 10, sy(point.y) - 9)} textAnchor="middle" fontSize={11} fill={color}
          stroke="var(--surf)" strokeWidth={3} paintOrder="stroke" strokeLinejoin="round">
          {point.label}
        </text>
      )}
    </g>
  )
}

/** A labeled point pinned to a curve. The halo makes it stand out from the
 *  curve it belongs to, and the label pill flips below the dot when there is no
 *  room above it. */
function MarkView({ mark, sx, sy, dark, top, bottom, left, right }: {
  mark: GraphMark
  sx: (x: number) => number
  sy: (y: number) => number
  dark: boolean
  top: number
  bottom: number
  left: number
  right: number
}) {
  const color = resolveGraphColor(mark.color, dark)
  const x = sx(mark.x), y = sy(mark.y)
  const label = mark.label
  return (
    <g>
      <circle cx={x} cy={y} r={8} fill="none" stroke={color} strokeWidth={1.1} opacity={0.4} />
      <circle cx={x} cy={y} r={4.4} fill={color} stroke="var(--surf)" strokeWidth={1.8} />
      {label && (() => {
        const w = Math.min(Math.max(24, label.length * 6.2 + 12), Math.max(24, right - left - 8))
        const cx0 = clamp(x, left + w / 2 + 2, right - w / 2 - 2)
        const above = y - 16
        const belowDot = above - 14 < top + 2
        const cy0 = belowDot ? Math.min(y + 16, bottom - 10) : clamp(above, top + 10, bottom - 6)
        return (
          <>
            <rect x={cx0 - w / 2} y={cy0 - 11} width={w} height={16} rx={8} fill="var(--surf)" fillOpacity={0.94} stroke={color} strokeOpacity={0.55} />
            <text x={cx0} y={cy0 + 0.5} textAnchor="middle" fontSize={10.5} fontWeight={600} fill={color}>{label}</text>
          </>
        )
      })()}
    </g>
  )
}

type View = { x: [number, number]; y: [number, number] }
type HoverState = { x: number; y: number; px: number; py: number; snap: SnapHit | null }

export function GraphView({ spec, dark, width = 760, height = 430, expanded = false, compact = false }: {
  spec: GraphSpec
  dark: boolean
  width?: number
  height?: number
  expanded?: boolean
  /** Inline mode: no card chrome, full-bleed plot, and one expand control. */
  compact?: boolean
}) {
  // Inline figures are narrow, so they spend as little of that width on
  // margins as the tick labels allow and skip the plot frame entirely.
  const margins = compact
    ? { left: spec.yLabel ? 46 : 32, right: 8, top: 8, bottom: spec.xLabel ? 30 : 22 }
    : { left: spec.yLabel ? 76 : 58, right: 22, top: 20, bottom: spec.xLabel ? 58 : 44 }
  const plot = { x: margins.left, y: margins.top, w: width - margins.left - margins.right, h: height - margins.top - margins.bottom }
  const base = useMemo(() => computeGraphDomain(spec, plot.w / plot.h), [spec, plot.w, plot.h])
  const [view, setView] = useState<View>(base)
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const [hover, setHover] = useState<HoverState | null>(null)
  const [dragging, setDragging] = useState(false)
  const [full, setFull] = useState(false)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragRef = useRef<{ x: number; y: number; view: View } | null>(null)
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const clipId = `graph-clip-${uid}`
  const titleId = `graph-title-${uid}`

  useEffect(() => { setView(base) }, [base])
  useEffect(() => { setHidden(new Set()) }, [spec])

  const sx = (x: number) => plot.x + ((x - view.x[0]) / (view.x[1] - view.x[0])) * plot.w
  const sy = (y: number) => plot.y + plot.h - ((y - view.y[0]) / (view.y[1] - view.y[0])) * plot.h
  const spanX = view.x[1] - view.x[0], spanY = view.y[1] - view.y[0]
  const mathX = (x: number) => view.x[0] + ((x - plot.x) / plot.w) * spanX
  const mathY = (y: number) => view.y[1] - ((y - plot.y) / plot.h) * spanY
  const xt = niceTicks(view.x[0], view.x[1], 8)
  const yt = niceTicks(view.y[0], view.y[1], 6)
  const cols = Math.round(Math.min(320, Math.max(80, plot.w / 2.6)))
  const rows = Math.round(Math.min(240, Math.max(70, plot.h / 2.6)))
  const xAxis = view.y[0] <= 0 && view.y[1] >= 0
  const yAxis = view.x[0] <= 0 && view.x[1] >= 0
  const xAxisY = clamp(sy(0), plot.y + 1, plot.y + plot.h - 1)
  const yAxisX = clamp(sx(0), plot.x + 1, plot.x + plot.w - 1)
  const plotCenter = { x: mathX(plot.x + plot.w / 2), y: mathY(plot.y + plot.h / 2) }

  /** Keep the view inside sensible zoom and pan limits. Returning `current`
   *  for an invalid step makes fast wheel bursts settle instead of jumping. */
  const clampView = (next: View, current: View): View => {
    const baseSpanX = base.x[1] - base.x[0], baseSpanY = base.y[1] - base.y[0]
    const nextSpanX = next.x[1] - next.x[0], nextSpanY = next.y[1] - next.y[0]
    if (!(nextSpanX > 0) || !(nextSpanY > 0)) return current
    if (nextSpanX < baseSpanX * 0.02 || nextSpanX > baseSpanX * 60) return current
    if (nextSpanY < baseSpanY * 0.02 || nextSpanY > baseSpanY * 60) return current
    const centerX = (next.x[0] + next.x[1]) / 2, centerY = (next.y[0] + next.y[1]) / 2
    const baseCenterX = (base.x[0] + base.x[1]) / 2, baseCenterY = (base.y[0] + base.y[1]) / 2
    const cx0 = clamp(centerX, baseCenterX - baseSpanX * 1.5, baseCenterX + baseSpanX * 1.5)
    const cy0 = clamp(centerY, baseCenterY - baseSpanY * 1.5, baseCenterY + baseSpanY * 1.5)
    return { x: [cx0 - nextSpanX / 2, cx0 + nextSpanX / 2], y: [cy0 - nextSpanY / 2, cy0 + nextSpanY / 2] }
  }

  const zoomAt = (factor: number, atX: number, atY: number) => {
    setView((current) => {
      const next: View = {
        x: [atX - (atX - current.x[0]) * factor, atX + (current.x[1] - atX) * factor],
        y: [atY - (atY - current.y[0]) * factor, atY + (current.y[1] - atY) * factor],
      }
      return clampView(next, current)
    })
  }
  const reset = () => { setView(base); setHover(null) }

  // The wheel listener must be non-passive to stop the chat from scrolling
  // while the pointer is over the plot, so it is attached directly.
  const live = useRef({ view, plot, base })
  live.current = { view, plot, base }
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (event: WheelEvent) => {
      const state = live.current
      const ctm = svg.getScreenCTM()
      if (!ctm) return
      const point = svg.createSVGPoint()
      point.x = event.clientX
      point.y = event.clientY
      const local = point.matrixTransform(ctm.inverse())
      const { plot, view, base } = state
      if (local.x < plot.x || local.x > plot.x + plot.w || local.y < plot.y || local.y > plot.y + plot.h) return
      event.preventDefault()
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1
      const factor = Math.exp(clamp(event.deltaY * unit * 0.0016, -0.6, 0.6))
      const spanX = view.x[1] - view.x[0], spanY = view.y[1] - view.y[0]
      const baseSpanX = base.x[1] - base.x[0], baseSpanY = base.y[1] - base.y[0]
      if (spanX * factor < baseSpanX * 0.02 || spanX * factor > baseSpanX * 60) return
      if (spanY * factor < baseSpanY * 0.02 || spanY * factor > baseSpanY * 60) return
      const atX = view.x[0] + ((local.x - plot.x) / plot.w) * spanX
      const atY = view.y[1] - ((local.y - plot.y) / plot.h) * spanY
      setView({
        x: [atX - (atX - view.x[0]) * factor, atX + (view.x[1] - atX) * factor],
        y: [atY - (atY - view.y[0]) * factor, atY + (view.y[1] - atY) * factor],
      })
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [])

  const fills = useMemo(() => spec.curves.map((curve, i) => {
    if (hidden.has(`c${i}`) || curve.compiled.relation === '=') return null
    const runs = regionRuns(curve.compiled.test, view.x, view.y, cols, rows)
    let d = ''
    for (const r of runs) {
      const x1 = px(sx(r.x)), x2 = px(sx(r.x + r.w))
      const y1 = px(sy(r.y + r.h)), y2 = px(sy(r.y))
      if (Math.abs(x2 - x1) < 0.2 || Math.abs(y2 - y1) < 0.2) continue
      d += `M${x1} ${y1}H${x2}V${y2}H${x1}Z`
    }
    return d ? { key: `fill-${i}`, d, color: resolveGraphColor(curve.color, dark), solid: curve.compiled.relation === '<=' || curve.compiled.relation === '>=', opacity: curve.opacity } : null
  }), [spec, view, hidden, dark, cols, rows, plot.w, plot.h])

  type DrawnCurve = {
    key: string
    d: string
    color: string
    width: number
    pattern: GraphPattern
    opacity: number
    /** Screen-space polylines used for hover snapping. */
    snapLines: SnapLine[]
    snapAnchors: SnapAnchor[]
  }
  const curves = useMemo(() => spec.curves.map((curve, i): DrawnCurve | null => {
    if (hidden.has(`c${i}`)) return null
    const color = resolveGraphColor(curve.color, dark)
    if (curve.compiled.kind === 'explicit' && curve.compiled.f) {
      const segments = sampleExplicit(curve.compiled.f, view.x, view.y, 620)
      const d = segments.map((seg) => linePath(seg, sx, sy)).join('')
      if (!d) return null
      return {
        key: `curve-${i}`,
        d,
        color,
        width: curve.width,
        pattern: curve.pattern,
        opacity: curve.opacity,
        snapLines: segments.map((seg) => ({ points: seg.map((p) => ({ x: sx(p.x), y: sy(p.y) })), label: curve.label })),
        snapAnchors: [],
      }
    }
    const segments = contourSegments(curve.compiled.residual, view.x, view.y, cols, rows)
    const d = segmentPath(segments, sx, sy)
    if (!d) return null
    const strict = curve.compiled.relation === '<' || curve.compiled.relation === '>'
    const snapAnchors: SnapAnchor[] = []
    for (let k = 0; k < segments.length; k += 3) {
      const [a] = segments[k]
      snapAnchors.push({ x: sx(a.x), y: sy(a.y), kind: 'curve', label: curve.label })
    }
    return {
      key: `curve-${i}`,
      d,
      color,
      width: curve.width,
      pattern: strict && curve.pattern === 'solid' ? 'dashed' : curve.pattern,
      opacity: curve.opacity,
      snapLines: [],
      snapAnchors,
    }
  }), [spec, view, hidden, dark, cols, rows, plot.w, plot.h])

  type DrawnSeries =
    | { key: string; kind: 'bars'; d: string; labels: GraphPoint[]; color: string; width: number; opacity: number }
    | { key: string; kind: 'line'; line: string; area: string; labels: GraphPoint[]; color: string; width: number; pattern: GraphPattern; opacity: number }
    | { key: string; kind: 'scatter'; dots: GraphPoint[]; labels: GraphPoint[]; color: string; width: number; opacity: number }
  const drawnSeries = useMemo(() => {
    const out: DrawnSeries[] = []
    spec.series.forEach((series, i) => {
      if (hidden.has(`s${i}`)) return
      const color = resolveGraphColor(series.color, dark)
      const pts = series.points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
      if (!pts.length) return
      if (series.kind === 'bar') {
        const xs = [...new Set(pts.map((p) => p.x))].sort((a, b) => a - b)
        let gap = Infinity
        for (let k = 1; k < xs.length; k++) gap = Math.min(gap, xs[k] - xs[k - 1])
        const unit = series.barWidth ?? (Number.isFinite(gap) && gap > 0 ? gap * 0.7 : 0.6)
        const w = Math.max(1.5, (unit / (view.x[1] - view.x[0])) * plot.w)
        const zero = clamp(sy(0), plot.y, plot.y + plot.h)
        let d = ''
        for (const p of pts) {
          const x = sx(p.x) - w / 2
          const y = clamp(sy(p.y), plot.y, plot.y + plot.h)
          const top = Math.min(y, zero), bottom = Math.max(y, zero)
          d += `M${px(x)} ${px(top)}h${px(w)}v${px(Math.max(0.6, bottom - top))}h${px(-w)}Z`
        }
        // Bars are categorical: every bar gets a tick label, using the point
        // label when one was supplied and its x value otherwise. That keeps the
        // axis readable instead of printing half-way numbers like 1.5 and 2.5.
        out.push({ key: `series-${i}`, kind: 'bars', d, labels: pts.map((p) => ({ ...p, label: p.label || coord(p.x) })), color, width: series.width, opacity: series.opacity })
        return
      }
      const path = pts.map((p) => `${px(sx(p.x))} ${px(sy(p.y))}`)
      const line = path.length ? `M${path.join('L')}` : ''
      const zero = clamp(sy(0), plot.y, plot.y + plot.h)
      const area = series.kind === 'area'
        ? `${line}L${px(sx(pts[pts.length - 1].x))} ${px(zero)}L${px(sx(pts[0].x))} ${px(zero)}Z`
        : ''
      if (series.kind === 'scatter') {
        out.push({ key: `series-${i}`, kind: 'scatter', dots: pts, labels: pts.filter((p) => p.label), color, width: series.width, opacity: series.opacity })
        return
      }
      out.push({ key: `series-${i}`, kind: 'line', line, area, labels: pts.filter((p) => p.label), color, width: series.width, pattern: series.pattern, opacity: series.opacity })
    })
    return out
  }, [spec, view, hidden, dark, plot.w, plot.h])

  const snapLines = useMemo(() => curves.flatMap((curve) => curve?.snapLines ?? []), [curves])
  const snapAnchors = useMemo<SnapAnchor[]>(() => {
    const out: SnapAnchor[] = []
    for (const p of spec.points) out.push({ x: sx(p.x), y: sy(p.y), kind: 'point', ...(p.label ? { label: p.label } : {}) })
    for (const m of spec.marks) out.push({ x: sx(m.x), y: sy(m.y), kind: 'point', ...(m.label ? { label: m.label } : {}) })
    spec.series.forEach((series, i) => {
      if (hidden.has(`s${i}`)) return
      for (const p of series.points) out.push({ x: sx(p.x), y: sy(p.y), kind: 'point' })
    })
    for (const curve of curves) if (curve) out.push(...curve.snapAnchors)
    return out
  }, [spec, view, hidden, plot.w, plot.h, curves])

  // Category ticks for bar charts, thinned so labels never collide when a
  // series has more bars than the plot can name.
  const categorical = drawnSeries.some((series) => series.kind === 'bars')
  const categoryLabels: { x: number; text: string }[] = []
  if (categorical) {
    let lastX = -Infinity
    const all = drawnSeries.flatMap((series) => series.kind === 'bars' ? series.labels : [])
      .sort((a, b) => a.x - b.x)
    for (const point of all) {
      const x = sx(point.x)
      if (x < plot.x - 2 || x > plot.x + plot.w + 2) continue
      if (x - lastX < 30) continue
      lastX = x
      categoryLabels.push({ x, text: point.label!.slice(0, 18) })
    }
  }

  const legend = useMemo(() => [
    ...spec.curves.map((curve, i) => ({ key: `c${i}`, color: curve.color, label: curve.label || curve.source })),
    ...spec.series.map((series, i) => ({ key: `s${i}`, color: series.color, label: series.label || `Series ${i + 1}` })),
  ], [spec])

  const toggle = (key: string) => setHidden((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  const download = () => {
    const svg = svgRef.current
    if (!svg) return
    const clone = svg.cloneNode(true) as SVGSVGElement
    for (const el of Array.from(clone.querySelectorAll('[data-export-skip]'))) el.remove()
    clone.removeAttribute('style')
    const source = themedSvg(clone)
    const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${source}`], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${slug(graphTitle(spec))}.svg`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const localPoint = (event: { clientX: number; clientY: number }): Pt | null => {
    const svg = svgRef.current
    const ctm = svg?.getScreenCTM()
    if (!svg || !ctm) return null
    const point = svg.createSVGPoint()
    point.x = event.clientX
    point.y = event.clientY
    return point.matrixTransform(ctm.inverse())
  }
  const insidePlot = (p: Pt) => p.x >= plot.x && p.x <= plot.x + plot.w && p.y >= plot.y && p.y <= plot.y + plot.h

  const onPointerDown = (event: ReactPointerEvent<SVGRectElement>) => {
    if (event.button !== 0) return
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* pointer already gone */ }
    dragRef.current = { x: event.clientX, y: event.clientY, view }
    setDragging(true)
    setHover(null)
  }
  const onPointerMove = (event: ReactPointerEvent<SVGRectElement>) => {
    const drag = dragRef.current
    if (drag) {
      const svg = svgRef.current
      const rect = svg?.getBoundingClientRect()
      const scale = rect && rect.width ? width / rect.width : 1
      const dx = (event.clientX - drag.x) * scale
      const dy = (event.clientY - drag.y) * scale
      if (Math.abs(dx) + Math.abs(dy) < 1) return
      const dragSpanX = drag.view.x[1] - drag.view.x[0]
      const dragSpanY = drag.view.y[1] - drag.view.y[0]
      setView(clampView({
        x: [drag.view.x[0] - (dx / plot.w) * dragSpanX, drag.view.x[1] - (dx / plot.w) * dragSpanX],
        y: [drag.view.y[0] + (dy / plot.h) * dragSpanY, drag.view.y[1] + (dy / plot.h) * dragSpanY],
      }, drag.view))
      return
    }
    const local = localPoint(event)
    if (!local || !insidePlot(local)) {
      if (hover) setHover(null)
      return
    }
    // The tolerance is in CSS pixels, so it feels the same on a small inline
    // figure as in the expanded view even though the viewBox is scaled.
    const rect = svgRef.current?.getBoundingClientRect()
    const tolerance = 14 * (rect && rect.width ? width / rect.width : 1)
    const hit = snapTo(snapAnchors, snapLines, local, tolerance)
    setHover(hit
      ? { x: mathX(hit.x), y: mathY(hit.y), px: hit.x, py: hit.y, snap: hit }
      : { x: mathX(local.x), y: mathY(local.y), px: local.x, py: local.y, snap: null })
  }
  const endDrag = (event: ReactPointerEvent<SVGRectElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    setDragging(false)
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    } catch { /* capture was already released */ }
  }

  const bits = graphSummaryBits(spec)
  const aria = `${graphTitle(spec)}. ${bits.join(', ') || 'Plot'}. ${spec.errors.length ? 'Some items were skipped. ' : ''}Drag to pan, scroll to zoom, and hover over a curve or point to snap to it. Double-click to reset the view.`
  const tickFont = { fontVariantNumeric: 'tabular-nums' as const }
  const singleValued = isSingleValuedGraph(spec, (i) => !hidden.has(`c${i}`))
  const guideX = singleValued && hover ? hover.x : null
  const guideScreenX = guideX != null ? sx(guideX) : 0
  const readout = hover ? `${hover.snap?.label ? `${hover.snap.label.slice(0, 22)} · ` : ''}${coord(hover.x)}, ${coord(hover.y)}` : ''
  const readoutW = Math.min(plot.w - 16, Math.max(88, readout.length * 6.1 + 16))

  return (
    <div className={compact ? 'space-y-1' : 'space-y-1.5'}>
      {/* The plot is a canvas: drag pans, the wheel zooms about the pointer,
          and hovering snaps to the nearest labeled point or curve. */}
      <div className="relative overflow-hidden rounded-lg bg-surf/40 ring-1 ring-bor/70 transition-colors hover:bg-surf/60 hover:ring-bor">
        <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} className="block w-full select-none" role="img" aria-label={aria}>
          <defs>
            <clipPath id={clipId}><rect x={plot.x} y={plot.y} width={plot.w} height={plot.h} rx={8} /></clipPath>
          </defs>
          {!compact && <rect x={plot.x} y={plot.y} width={plot.w} height={plot.h} rx={8} fill="var(--bg)" stroke="var(--bor)" />}

          <g clipPath={`url(#${clipId})`}>
            {spec.grid && !categorical && xt.ticks.map((tick) => (
              <line key={`gx-${tick}`} x1={sx(tick)} y1={plot.y} x2={sx(tick)} y2={plot.y + plot.h} stroke="var(--bor)" strokeWidth={1} opacity={0.45} />
            ))}
            {spec.grid && yt.ticks.map((tick) => (
              <line key={`gy-${tick}`} x1={plot.x} y1={sy(tick)} x2={plot.x + plot.w} y2={sy(tick)} stroke="var(--bor)" strokeWidth={1} opacity={0.45} />
            ))}

            {fills.map((fill) => fill && <path key={fill.key} d={fill.d} fill={fill.color} fillOpacity={(fill.solid ? 0.17 : 0.11) * fill.opacity} stroke="none" />)}

            {xAxis && <line x1={plot.x} y1={xAxisY} x2={plot.x + plot.w} y2={xAxisY} stroke="var(--mu)" strokeWidth={1.3} opacity={0.65} />}
            {yAxis && <line x1={yAxisX} y1={plot.y} x2={yAxisX} y2={plot.y + plot.h} stroke="var(--mu)" strokeWidth={1.3} opacity={0.65} />}

            {curves.map((curve) => curve && (
              <path key={curve.key} d={curve.d} fill="none" stroke={curve.color} strokeWidth={curve.width} strokeOpacity={curve.opacity}
                strokeLinecap="round" strokeLinejoin="round" strokeDasharray={DASH[curve.pattern]} />
            ))}

            {drawnSeries.map((series) => series && series.kind === 'bars' && (
              <path key={series.key} d={series.d} fill={series.color} fillOpacity={0.72 * series.opacity} stroke={series.color} strokeOpacity={series.opacity} strokeWidth={1} strokeLinejoin="round" />
            ))}
            {drawnSeries.map((series) => series && series.kind === 'line' && (
              <g key={series.key}>
                {series.area && <path d={series.area} fill={series.color} fillOpacity={0.13 * series.opacity} stroke="none" />}
                <path d={series.line} fill="none" stroke={series.color} strokeWidth={series.width} strokeOpacity={series.opacity}
                  strokeLinecap="round" strokeLinejoin="round" strokeDasharray={DASH[series.pattern]} />
              </g>
            ))}
            {drawnSeries.map((series) => series && series.kind === 'scatter' && (
              <g key={series.key} fill={series.color} fillOpacity={series.opacity}>
                {series.dots.map((p, i) => <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={3.6} stroke="var(--surf)" strokeWidth={1.3} />)}
              </g>
            ))}
            {drawnSeries.map((series) => series && series.kind !== 'bars' && series.labels?.map((p, i) => (
              <text key={`${series.key}-label-${i}`} x={clamp(sx(p.x), plot.x + 6, plot.x + plot.w - 6)} y={Math.max(plot.y + 10, sy(p.y) - 9)} textAnchor="middle" fontSize={11}
                fill={series.color} stroke="var(--surf)" strokeWidth={3} paintOrder="stroke" strokeLinejoin="round">
                {p.label}
              </text>
            )))}

            {spec.shapes.map((shape, i) => <ShapeView key={`shape-${i}`} shape={shape} sx={sx} sy={sy} dark={dark} top={plot.y} left={plot.x} right={plot.x + plot.w} />)}
            {spec.points.map((point, i) => <PointView key={`point-${i}`} point={point} sx={sx} sy={sy} dark={dark} top={plot.y} left={plot.x} right={plot.x + plot.w} />)}
            {spec.marks.map((mark, i) => (
              <MarkView key={`mark-${i}`} mark={mark} sx={sx} sy={sy} dark={dark}
                top={plot.y} bottom={plot.y + plot.h} left={plot.x} right={plot.x + plot.w} />
            ))}

            {/* A single-valued function graph has exactly one y per x, so the
                cursor becomes a vertical guide with a dot on every curve. */}
            {guideX != null && (
              <g data-export-skip pointerEvents="none">
                <line x1={guideScreenX} y1={plot.y} x2={guideScreenX} y2={plot.y + plot.h} stroke="var(--mu)" strokeWidth={1} strokeDasharray="4 4" opacity={0.65} />
                {spec.curves.map((curve, i) => {
                  if (hidden.has(`c${i}`)) return null
                  const f = curve.compiled.f
                  if (!f) return null
                  const value = f(guideX)
                  if (!Number.isFinite(value)) return null
                  const y = sy(value)
                  if (y < plot.y - 1 || y > plot.y + plot.h + 1) return null
                  return <circle key={`guide-${i}`} cx={guideScreenX} cy={y} r={3.2} fill={resolveGraphColor(curve.color, dark)} stroke="var(--surf)" strokeWidth={1.4} />
                })}
                {(() => {
                  const text = `x = ${coord(guideX)}`
                  const w = Math.max(40, text.length * 6.2 + 14)
                  const x0 = clamp(guideScreenX - w / 2, plot.x + 2, plot.x + plot.w - w - 2)
                  return (
                    <>
                      <rect x={x0} y={plot.y + 4} width={w} height={16} rx={8} fill="var(--surf)" fillOpacity={0.94} stroke="var(--bor)" />
                      <text x={x0 + w / 2} y={plot.y + 15.5} textAnchor="middle" fontSize={10.5} fill="var(--tx)" style={tickFont}>{text}</text>
                    </>
                  )
                })()}
              </g>
            )}

            {hover && guideX == null && (
              <g data-export-skip pointerEvents="none">
                <line x1={hover.px} y1={plot.y} x2={hover.px} y2={plot.y + plot.h} stroke="var(--mu)" strokeWidth={1} strokeDasharray="4 4" opacity={0.75} />
                <line x1={plot.x} y1={hover.py} x2={plot.x + plot.w} y2={hover.py} stroke="var(--mu)" strokeWidth={1} strokeDasharray="4 4" opacity={0.75} />
              </g>
            )}

            {hover?.snap && (
              <g data-export-skip pointerEvents="none">
                <circle cx={hover.px} cy={hover.py} r={6} fill="none" stroke="var(--tx)" strokeWidth={1.4} opacity={0.75} />
                <circle cx={hover.px} cy={hover.py} r={2} fill="var(--tx)" />
              </g>
            )}

            {hover && (
              <g data-export-skip pointerEvents="none">
                <rect x={plot.x + 8} y={plot.y + plot.h - 27} width={readoutW} height={20} rx={6} fill="var(--surf)" fillOpacity={0.94} stroke="var(--bor)" />
                <text x={plot.x + 16} y={plot.y + plot.h - 13} fontSize={10.5} fill="var(--tx)" style={tickFont}>
                  {readout}
                </text>
              </g>
            )}

            <rect x={plot.x} y={plot.y} width={plot.w} height={plot.h} fill="transparent"
              style={{ cursor: dragging ? 'grabbing' : 'grab', touchAction: expanded ? 'none' : 'pan-y' }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onPointerLeave={() => { if (!dragRef.current) setHover(null) }}
              onDoubleClick={reset} />
          </g>

          {!categorical && xt.ticks.map((tick) => {
            const x = sx(tick)
            if (x < plot.x - 2 || x > plot.x + plot.w + 2) return null
            const y = xAxis ? Math.min(plot.y + plot.h - 6, xAxisY + 16) : plot.y + plot.h + 16
            return <text key={`tx-${tick}`} x={x} y={y} textAnchor="middle" fontSize={11} fill="var(--mu)" style={tickFont}>{formatTick(tick, xt.step)}</text>
          })}
          {categoryLabels.map((label, i) => {
            const y = xAxis ? Math.min(plot.y + plot.h - 6, xAxisY + 16) : plot.y + plot.h + 16
            return <text key={`cat-${i}`} x={label.x} y={y} textAnchor="middle" fontSize={11} fill="var(--mu)">{label.text}</text>
          })}
          {yt.ticks.map((tick) => {
            const y = sy(tick)
            if (y < plot.y - 2 || y > plot.y + plot.h + 2) return null
            const x = yAxis ? Math.max(plot.x + 4, yAxisX - 8) : plot.x - 8
            return <text key={`ty-${tick}`} x={x} y={y + 4} textAnchor="end" fontSize={11} fill="var(--mu)" style={tickFont}>{formatTick(tick, yt.step)}</text>
          })}
          {/* Axis titles follow the mathematical convention at the end of an
              axis that crosses the plot. A chart axis sitting on the baseline
              keeps its title under the plot, where it cannot cover the bars. */}
          {spec.xLabel && (xAxis && xAxisY < plot.y + plot.h * 0.78
            ? <text x={plot.x + plot.w - 4} y={clamp(xAxisY - 8, plot.y + 14, plot.y + plot.h - 8)} textAnchor="end" fontSize={12} fill="var(--tx)" stroke="var(--surf)" strokeWidth={3} paintOrder="stroke" strokeLinejoin="round">{spec.xLabel}</text>
            : <text x={plot.x + plot.w / 2} y={height - 12} textAnchor="middle" fontSize={12} fill="var(--tx)">{spec.xLabel}</text>)}
          {spec.yLabel && (yAxis
            ? <text x={clamp(yAxisX + 8, plot.x + 6, plot.x + plot.w - 8)} y={plot.y + 14} textAnchor="start" fontSize={12} fill="var(--tx)" stroke="var(--surf)" strokeWidth={3} paintOrder="stroke" strokeLinejoin="round">{spec.yLabel}</text>
            : <text x={16} y={plot.y + plot.h / 2} textAnchor="middle" fontSize={12} fill="var(--tx)" transform={`rotate(-90 16 ${plot.y + plot.h / 2})`}>{spec.yLabel}</text>)}
        </svg>

        <div className="pointer-events-none absolute inset-0">
          <div className={cx('pointer-events-auto flex items-center gap-0.5', expanded ? 'absolute bottom-1.5 right-1.5' : 'absolute right-1.5 top-1.5')}>
            {expanded ? (
              <>
                <PlotBtn icon={ZoomOut} title="Zoom out" onClick={() => zoomAt(1.5, plotCenter.x, plotCenter.y)} />
                <PlotBtn icon={ZoomIn} title="Zoom in" onClick={() => zoomAt(1 / 1.5, plotCenter.x, plotCenter.y)} />
                <PlotBtn icon={RotateCcw} title="Reset view" onClick={reset} />
                <PlotBtn icon={Download} title="Download SVG" onClick={download} />
              </>
            ) : (
              <>
                <PlotBtn icon={Download} title="Download SVG" onClick={download} />
                <PlotBtn icon={Maximize2} title="Expand graph" onClick={() => setFull(true)} />
              </>
            )}
          </div>
        </div>
      </div>

      {compact
        ? spec.title && (
          <div className="truncate px-0.5 text-[11px] text-mu" title={spec.title}>{spec.title}</div>
        )
        : (
          <div className="min-w-0 px-0.5">
            <div id={titleId} className="truncate text-sm font-medium">{graphTitle(spec)}</div>
            <div className="truncate text-xs text-mu">
              {bits.join(' · ') || 'Plot'}
              {spec.errors.length > 0 && <span className="text-er"> · {spec.errors.length} item{spec.errors.length === 1 ? '' : 's'} skipped</span>}
            </div>
          </div>
        )}

      {spec.legend && legend.length > 1 && (
        <div className="flex flex-wrap items-center gap-1 pt-0.5" role="group" aria-label="Graph legend">
          {legend.map((entry) => {
            const off = hidden.has(entry.key)
            return (
              <button
                key={entry.key}
                type="button"
                aria-pressed={!off}
                title={`${off ? 'Show' : 'Hide'} ${entry.label}`}
                onClick={() => toggle(entry.key)}
                className={cx(
                  'inline-flex max-w-full items-center gap-1.5 rounded-full border border-bor/70 bg-surf/70 px-2 py-0.5 text-[11px] font-medium text-tx transition hover:border-ac/50 hover:bg-hov',
                  off && 'opacity-45 line-through',
                )}
              >
                <span aria-hidden="true" className="size-2 shrink-0 rounded-full ring-1 ring-black/10" style={{ background: resolveGraphColor(entry.color, dark) }} />
                <span className="truncate">{entry.label}</span>
              </button>
            )
          })}
        </div>
      )}

      {spec.errors.length > 0 && (
        <p role="status" className="text-xs text-mu">
          Some parts of the graph could not be drawn. {spec.errors.slice(0, 2).join(' · ')}
        </p>
      )}

      {full && (
        <Modal close={() => setFull(false)}>
          <div className="modal-panel relative w-[min(96vw,1120px)] rounded-2xl border border-bor bg-bg p-4">
            <button
              type="button"
              aria-label="Close graph"
              title="Close"
              onClick={() => setFull(false)}
              className="absolute right-2 top-2 z-10 grid size-8 place-items-center rounded-lg bg-surf/90 text-mu ring-1 ring-bor/70 transition hover:text-tx"
            >
              <X size={15} />
            </button>
            <GraphView spec={spec} dark={dark} width={1040} height={620} expanded compact />
          </div>
        </Modal>
      )}
    </div>
  )
}

function GraphCard({ call, dark, compact }: { call: CallLike; dark: boolean; compact?: boolean }) {
  const spec = useMemo(() => normalizeGraphSpec(parseArgs(call.arguments)), [call.arguments])
  if (!graphItemCount(spec)) return null
  if (compact) {
    return (
      <figure aria-label={`Graph: ${graphTitle(spec)}`} className="m-0 w-full">
        <GraphView spec={spec} dark={dark} compact />
      </figure>
    )
  }
  return (
    <section aria-label={`Graph: ${graphTitle(spec)}`} className="w-full overflow-hidden rounded-xl border border-bor bg-surf p-3">
      <GraphView spec={spec} dark={dark} />
    </section>
  )
}

/** Whether this reply has any figure placed on that side. The chat uses it so
 *  an unused inline slot never takes width away from the prose. */
export function hasPlacedGraphs(rounds: { calls: CallLike[] }[] | undefined, placement: GraphPlacement): boolean {
  return (rounds ?? []).some((round) => round.calls.some((call) =>
    call.name === 'graph' && !call.error && normalizeGraphSpec(parseArgs(call.arguments)).placement === placement))
}

/** Graphs attached to an assistant reply, filtered by where the model placed
 *  them. Tool arguments are the source of truth, so the plotted picture
 *  survives a reload without storing pixels. */
export function GraphCards({ rounds, placement = 'below', compact = false }: {
  rounds?: { calls: CallLike[] }[]
  placement?: GraphPlacement
  compact?: boolean
}) {
  const dark = useS((s) => s.themeMode !== 'light')
  const calls = (rounds ?? []).flatMap((round) => round.calls).filter((call) => call.name === 'graph' && !call.error)
  const placed = calls.filter((call) => normalizeGraphSpec(parseArgs(call.arguments)).placement === placement)
  if (!placed.length) return null
  return <div className={compact ? 'space-y-2' : 'space-y-3'}>{placed.map((call) => <GraphCard key={call.id} call={call} dark={dark} compact={compact} />)}</div>
}

export type { GraphSeries }
