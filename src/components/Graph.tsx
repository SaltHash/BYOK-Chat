import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Download, Maximize2, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react'
import { useS } from '../store'
import { Btn, cx, Modal } from './ui'
import {
  computeGraphDomain,
  contourSegments,
  formatTick,
  graphItemCount,
  graphSummaryBits,
  graphTitle,
  niceTicks,
  normalizeGraphSpec,
  regionRuns,
  resolveGraphColor,
  sampleExplicit,
  type GraphPoint,
  type GraphSeries,
  type GraphShape,
  type GraphSpec,
  type Pt,
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

function ShapeView({ shape, sx, sy, dark }: {
  shape: GraphShape
  sx: (x: number) => number
  sy: (y: number) => number
  dark: boolean
}) {
  if (shape.type === 'label') {
    const color = resolveGraphColor(shape.color, dark)
    return (
      <text x={sx(shape.at.x)} y={sy(shape.at.y)} textAnchor="middle" fontSize={12} fontWeight={500} fill={color}
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
    strokeDasharray: shape.dashed ? '7 5' : undefined,
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
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
          <polygon points={`${p1} ${p2} ${p3}`} fill={color} stroke={color} strokeWidth={1} strokeLinejoin="round" />
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
      <text x={sx(at.x)} y={sy(at.y) - 9} textAnchor="middle" fontSize={11} fill={color}
        stroke="var(--surf)" strokeWidth={3} paintOrder="stroke" strokeLinejoin="round">
        {shape.label}
      </text>
    </>
  )
}

function PointView({ point, sx, sy, dark }: { point: GraphPoint; sx: (x: number) => number; sy: (y: number) => number; dark: boolean }) {
  const color = resolveGraphColor('black', dark)
  return (
    <g>
      <circle cx={sx(point.x)} cy={sy(point.y)} r={4} fill={color} stroke="var(--surf)" strokeWidth={1.6} />
      {point.label && (
        <text x={sx(point.x)} y={sy(point.y) - 9} textAnchor="middle" fontSize={11} fill={color}
          stroke="var(--surf)" strokeWidth={3} paintOrder="stroke" strokeLinejoin="round">
          {point.label}
        </text>
      )}
    </g>
  )
}

export function GraphView({ spec, dark, width = 760, height = 430, expanded = false }: {
  spec: GraphSpec
  dark: boolean
  width?: number
  height?: number
  expanded?: boolean
}) {
  const margins = { left: spec.yLabel ? 76 : 58, right: 22, top: 20, bottom: spec.xLabel ? 58 : 44 }
  const plot = { x: margins.left, y: margins.top, w: width - margins.left - margins.right, h: height - margins.top - margins.bottom }
  const base = useMemo(() => computeGraphDomain(spec, plot.w / plot.h), [spec, plot.w, plot.h])
  const [view, setView] = useState(base)
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const [hover, setHover] = useState<{ x: number; y: number; px: number; py: number } | null>(null)
  const [full, setFull] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const clipId = `graph-clip-${uid}`
  const titleId = `graph-title-${uid}`

  useEffect(() => { setView(base) }, [base])
  useEffect(() => { setHidden(new Set()) }, [spec])

  const sx = (x: number) => plot.x + ((x - view.x[0]) / (view.x[1] - view.x[0])) * plot.w
  const sy = (y: number) => plot.y + plot.h - ((y - view.y[0]) / (view.y[1] - view.y[0])) * plot.h
  const xt = niceTicks(view.x[0], view.x[1], 8)
  const yt = niceTicks(view.y[0], view.y[1], 6)
  const cols = Math.round(Math.min(320, Math.max(80, plot.w / 2.6)))
  const rows = Math.round(Math.min(240, Math.max(70, plot.h / 2.6)))
  const xAxis = view.y[0] <= 0 && view.y[1] >= 0
  const yAxis = view.x[0] <= 0 && view.x[1] >= 0
  const xAxisY = clamp(sy(0), plot.y + 1, plot.y + plot.h - 1)
  const yAxisX = clamp(sx(0), plot.x + 1, plot.x + plot.w - 1)

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
    return d ? { key: `fill-${i}`, d, color: resolveGraphColor(curve.color, dark), solid: curve.compiled.relation === '<=' || curve.compiled.relation === '>=' } : null
  }), [spec, view, hidden, dark, cols, rows, plot.w, plot.h])

  const curves = useMemo(() => spec.curves.map((curve, i) => {
    if (hidden.has(`c${i}`)) return null
    const color = resolveGraphColor(curve.color, dark)
    if (curve.compiled.kind === 'explicit' && curve.compiled.f) {
      const segments = sampleExplicit(curve.compiled.f, view.x, view.y, 620)
      const d = segments.map((seg) => linePath(seg, sx, sy)).join('')
      return d ? { key: `curve-${i}`, d, color, width: curve.width, dashed: curve.dashed } : null
    }
    const segments = contourSegments(curve.compiled.residual, view.x, view.y, cols, rows)
    const d = segmentPath(segments, sx, sy)
    if (!d) return null
    const strict = curve.compiled.relation === '<' || curve.compiled.relation === '>'
    return { key: `curve-${i}`, d, color, width: curve.width, dashed: curve.dashed || strict }
  }), [spec, view, hidden, dark, cols, rows, plot.w, plot.h])

  type DrawnSeries =
    | { key: string; kind: 'bars'; d: string; labels: GraphPoint[]; color: string; width: number }
    | { key: string; kind: 'line'; line: string; area: string; labels: GraphPoint[]; color: string; width: number; dashed: boolean }
    | { key: string; kind: 'scatter'; dots: GraphPoint[]; labels: GraphPoint[]; color: string; width: number }
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
        out.push({ key: `series-${i}`, kind: 'bars', d, labels: pts.map((p) => ({ ...p, label: p.label || coord(p.x) })), color, width: series.width })
        return
      }
      const path = pts.map((p) => `${px(sx(p.x))} ${px(sy(p.y))}`)
      const line = path.length ? `M${path.join('L')}` : ''
      const zero = clamp(sy(0), plot.y, plot.y + plot.h)
      const area = series.kind === 'area'
        ? `${line}L${px(sx(pts[pts.length - 1].x))} ${px(zero)}L${px(sx(pts[0].x))} ${px(zero)}Z`
        : ''
      if (series.kind === 'scatter') {
        out.push({ key: `series-${i}`, kind: 'scatter', dots: pts, labels: pts.filter((p) => p.label), color, width: series.width })
        return
      }
      out.push({ key: `series-${i}`, kind: 'line', line, area, labels: pts.filter((p) => p.label), color, width: series.width, dashed: series.dashed })
    })
    return out
  }, [spec, view, hidden, dark, plot.w, plot.h])

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

  const spanX = view.x[1] - view.x[0], spanY = view.y[1] - view.y[0]
  const baseSpanX = base.x[1] - base.x[0]
  const zoom = (factor: number) => setView((current) => {
    const cx = (current.x[0] + current.x[1]) / 2, cy = (current.y[0] + current.y[1]) / 2
    const sxSpan = (current.x[1] - current.x[0]) * factor
    const sySpan = (current.y[1] - current.y[0]) * factor
    if (sxSpan < baseSpanX * 0.02 || sxSpan > baseSpanX * 60) return current
    return { x: [cx - sxSpan / 2, cx + sxSpan / 2], y: [cy - sySpan / 2, cy + sySpan / 2] }
  })
  const reset = () => setView(base)

  const download = () => {
    const svg = svgRef.current
    if (!svg) return
    const clone = svg.cloneNode(true) as SVGSVGElement
    for (const el of Array.from(clone.querySelectorAll('[data-export-skip]'))) el.remove()
    clone.removeAttribute('tabindex')
    const source = themedSvg(clone)
    const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${source}`], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${slug(graphTitle(spec))}.svg`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const onMove = (event: ReactPointerEvent<SVGRectElement>) => {
    const svg = svgRef.current
    const ctm = svg?.getScreenCTM()
    if (!svg || !ctm) return
    const point = svg.createSVGPoint()
    point.x = event.clientX
    point.y = event.clientY
    const local = point.matrixTransform(ctm.inverse())
    if (local.x < plot.x || local.x > plot.x + plot.w || local.y < plot.y || local.y > plot.y + plot.h) {
      setHover(null)
      return
    }
    setHover({
      x: view.x[0] + ((local.x - plot.x) / plot.w) * spanX,
      y: view.y[1] - ((local.y - plot.y) / plot.h) * spanY,
      px: local.x,
      py: local.y,
    })
  }

  const bits = graphSummaryBits(spec)
  const aria = `${graphTitle(spec)}. ${bits.map((b) => b).join(', ') || 'Plot'}. ${spec.errors.length ? 'Some items were skipped. ' : ''}Use the zoom buttons to inspect it and Download for an SVG copy.`
  const tickFont = { fontVariantNumeric: 'tabular-nums' as const }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div id={titleId} className="truncate text-sm font-medium">{graphTitle(spec)}</div>
          <div className="truncate text-xs text-mu">
            {bits.join(' · ') || 'Plot'}
            {spec.errors.length > 0 && <span className="text-er"> · {spec.errors.length} item{spec.errors.length === 1 ? '' : 's'} skipped</span>}
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <Btn sm icon={ZoomOut} title="Zoom out" onClick={() => zoom(1.5)} />
          <Btn sm icon={ZoomIn} title="Zoom in" onClick={() => zoom(1 / 1.5)} />
          <Btn sm icon={RotateCcw} title="Reset view" onClick={reset} />
          <Btn sm icon={Download} title="Download SVG" onClick={download} />
          {!expanded && <Btn sm icon={Maximize2} title="Expand graph" onClick={() => setFull(true)} />}
        </div>
      </div>

      <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} className="w-full select-none" role="img" aria-label={aria}>
        <defs>
          <clipPath id={clipId}><rect x={plot.x} y={plot.y} width={plot.w} height={plot.h} rx={8} /></clipPath>
        </defs>
        <rect x={plot.x} y={plot.y} width={plot.w} height={plot.h} rx={8} fill="var(--bg)" stroke="var(--bor)" />

        <g clipPath={`url(#${clipId})`}>
          {spec.grid && !categorical && xt.ticks.map((tick) => (
            <line key={`gx-${tick}`} x1={sx(tick)} y1={plot.y} x2={sx(tick)} y2={plot.y + plot.h} stroke="var(--bor)" strokeWidth={1} opacity={0.45} />
          ))}
          {spec.grid && yt.ticks.map((tick) => (
            <line key={`gy-${tick}`} x1={plot.x} y1={sy(tick)} x2={plot.x + plot.w} y2={sy(tick)} stroke="var(--bor)" strokeWidth={1} opacity={0.45} />
          ))}

          {fills.map((fill) => fill && <path key={fill.key} d={fill.d} fill={fill.color} fillOpacity={fill.solid ? 0.17 : 0.11} stroke="none" />)}

          {xAxis && <line x1={plot.x} y1={xAxisY} x2={plot.x + plot.w} y2={xAxisY} stroke="var(--mu)" strokeWidth={1.3} opacity={0.65} />}
          {yAxis && <line x1={yAxisX} y1={plot.y} x2={yAxisX} y2={plot.y + plot.h} stroke="var(--mu)" strokeWidth={1.3} opacity={0.65} />}

          {curves.map((curve) => curve && (
            <path key={curve.key} d={curve.d} fill="none" stroke={curve.color} strokeWidth={curve.width}
              strokeLinecap="round" strokeLinejoin="round" strokeDasharray={curve.dashed ? '7 5' : undefined} />
          ))}

          {drawnSeries.map((series) => series && series.kind === 'bars' && (
            <path key={series.key} d={series.d} fill={series.color} fillOpacity={0.72} stroke={series.color} strokeWidth={1} strokeLinejoin="round" />
          ))}
          {drawnSeries.map((series) => series && series.kind === 'line' && (
            <g key={series.key}>
              {series.area && <path d={series.area} fill={series.color} fillOpacity={0.13} stroke="none" />}
              <path d={series.line} fill="none" stroke={series.color} strokeWidth={series.width}
                strokeLinecap="round" strokeLinejoin="round" strokeDasharray={series.dashed ? '7 5' : undefined} />
            </g>
          ))}
          {drawnSeries.map((series) => series && series.kind === 'scatter' && (
            <g key={series.key} fill={series.color}>
              {series.dots.map((p, i) => <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={3.6} stroke="var(--surf)" strokeWidth={1.3} />)}
            </g>
          ))}
          {drawnSeries.map((series) => series && series.kind !== 'bars' && series.labels?.map((p, i) => (
            <text key={`${series.key}-label-${i}`} x={sx(p.x)} y={sy(p.y) - 9} textAnchor="middle" fontSize={11}
              fill={series.color} stroke="var(--surf)" strokeWidth={3} paintOrder="stroke" strokeLinejoin="round">
              {p.label}
            </text>
          )))}

          {spec.shapes.map((shape, i) => <ShapeView key={`shape-${i}`} shape={shape} sx={sx} sy={sy} dark={dark} />)}
          {spec.points.map((point, i) => <PointView key={`point-${i}`} point={point} sx={sx} sy={sy} dark={dark} />)}

          {hover && (
            <g data-export-skip>
              <line x1={hover.px} y1={plot.y} x2={hover.px} y2={plot.y + plot.h} stroke="var(--mu)" strokeWidth={1} strokeDasharray="4 4" opacity={0.8} />
              <line x1={plot.x} y1={hover.py} x2={plot.x + plot.w} y2={hover.py} stroke="var(--mu)" strokeWidth={1} strokeDasharray="4 4" opacity={0.8} />
              <rect x={plot.x + plot.w - 132} y={plot.y + 8} width={124} height={24} rx={6} fill="var(--surf)" stroke="var(--bor)" />
              <text x={plot.x + plot.w - 16} y={plot.y + 24} textAnchor="end" fontSize={11} fill="var(--tx)" style={tickFont}>
                {coord(hover.x)}, {coord(hover.y)}
              </text>
            </g>
          )}

          <rect x={plot.x} y={plot.y} width={plot.w} height={plot.h} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
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

      {spec.legend && legend.length > 1 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-0.5" role="group" aria-label="Graph legend">
          {legend.map((entry) => {
            const off = hidden.has(entry.key)
            return (
              <button
                key={entry.key}
                type="button"
                aria-pressed={!off}
                title={`${off ? 'Show' : 'Hide'} ${entry.label}`}
                onClick={() => toggle(entry.key)}
                className={cx('inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs transition-opacity hover:bg-hov', off && 'opacity-40')}
              >
                <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: resolveGraphColor(entry.color, dark) }} />
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
          <div className="modal-panel w-[min(96vw,1120px)] rounded-2xl border border-bor bg-bg p-4">
            <GraphView spec={spec} dark={dark} width={1040} height={620} expanded />
          </div>
        </Modal>
      )}
    </div>
  )
}

function GraphCard({ call, dark }: { call: CallLike; dark: boolean }) {
  const spec = useMemo(() => normalizeGraphSpec(parseArgs(call.arguments)), [call.arguments])
  if (!graphItemCount(spec)) return null
  return (
    <section aria-label={`Graph: ${graphTitle(spec)}`} className="w-full overflow-hidden rounded-xl border border-bor bg-surf p-3">
      <GraphView spec={spec} dark={dark} />
    </section>
  )
}

/** Graphs attached to an assistant reply. Tool arguments are the source of
 *  truth, so the plotted picture survives a reload without storing pixels. */
export function GraphCards({ rounds }: { rounds?: { calls: CallLike[] }[] }) {
  const dark = useS((s) => s.themeMode !== 'light')
  const calls = (rounds ?? []).flatMap((round) => round.calls).filter((call) => call.name === 'graph' && !call.error)
  if (!calls.length) return null
  return <div className="space-y-3">{calls.map((call) => <GraphCard key={call.id} call={call} dark={dark} />)}</div>
}

export type { GraphSeries }
