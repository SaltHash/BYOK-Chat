/* Graph engine: expression parsing, implicit relations, inequalities, data
 * series and shapes for the `graph` tool.
 *
 * Everything here is pure and dependency-free so it can be unit tested outside
 * the browser: parsing (`compileRelation`), sampling (`sampleExplicit`,
 * `contourSegments`, `regionRuns`), view fitting (`computeGraphDomain`) and
 * argument normalization (`normalizeGraphSpec`). The React renderer in
 * `components/Graph.tsx` only turns the resulting geometry into SVG.
 *
 * Equations may be explicit (`y = x^2`, `sin(x)`), implicit
 * (`x^2 + y^2 = 1`), or inequalities (`y > x^2`, `x^2 + y^2 <= 4`). The
 * palette is deliberately small and theme-aware: every colour resolves through
 * `GRAPH_PALETTE`, and an unspecified colour is black (rendered as the theme
 * ink in dark mode so it stays visible).
 */

export type GraphColorName = 'black' | 'red' | 'green' | 'blue' | 'orange' | 'purple' | 'teal' | 'pink' | 'yellow' | 'gray'

export const GRAPH_COLORS: readonly GraphColorName[] = ['black', 'red', 'green', 'blue', 'orange', 'purple', 'teal', 'pink', 'yellow', 'gray']

/** Theme-aware palette. `black` is the default ink: near-black on light
 *  surfaces, near-white on dark ones, so an unspecified line is always
 *  readable. The other names stay recognisable in both modes. */
export const GRAPH_PALETTE: Record<GraphColorName, { light: string; dark: string }> = {
  black: { light: '#18181b', dark: '#e7e5e4' },
  red: { light: '#d93025', dark: '#ff6b6b' },
  green: { light: '#188038', dark: '#4ade80' },
  blue: { light: '#1a73e8', dark: '#60a5fa' },
  orange: { light: '#d9730d', dark: '#fb923c' },
  purple: { light: '#8430ce', dark: '#c084fc' },
  teal: { light: '#0b7c78', dark: '#2dd4bf' },
  pink: { light: '#c2185b', dark: '#f472b6' },
  yellow: { light: '#a16207', dark: '#fbbf24' },
  gray: { light: '#5f6368', dark: '#a1a1aa' },
}

export const resolveGraphColor = (name: string | undefined, dark: boolean): string => {
  const key = String(name ?? 'black').trim().toLowerCase() as GraphColorName
  const pair = GRAPH_PALETTE[key]
  if (!pair) return dark ? GRAPH_PALETTE.black.dark : GRAPH_PALETTE.black.light
  return dark ? pair.dark : pair.light
}

/* ------------------------------------------------------------------ */
/* Expressions                                                         */
/* ------------------------------------------------------------------ */

type Node =
  | { k: 'num'; v: number }
  | { k: 'var'; name: 'x' | 'y' }
  | { k: 'neg'; a: Node }
  | { k: 'bin'; op: '+' | '-' | '*' | '/' | '^' | '%'; a: Node; b: Node }
  | { k: 'call'; name: string; args: Node[] }
  | { k: 'cmp'; op: RelationOp; a: Node; b: Node }

export type RelationOp = '=' | '<' | '<=' | '>' | '>='

export class ParseError extends Error {}

const MAX_EXPR_LENGTH = 320
const MAX_TOKENS = 420
const REL_OPS = new Set(['=', '==', '<', '<=', '>', '>='])
const FUNCS: Record<string, { min: number; max: number; fn: (a: number[]) => number }> = {
  sin: { min: 1, max: 1, fn: (a) => Math.sin(a[0]) },
  cos: { min: 1, max: 1, fn: (a) => Math.cos(a[0]) },
  tan: { min: 1, max: 1, fn: (a) => Math.tan(a[0]) },
  asin: { min: 1, max: 1, fn: (a) => Math.asin(a[0]) },
  acos: { min: 1, max: 1, fn: (a) => Math.acos(a[0]) },
  atan: { min: 1, max: 1, fn: (a) => Math.atan(a[0]) },
  arcsin: { min: 1, max: 1, fn: (a) => Math.asin(a[0]) },
  arccos: { min: 1, max: 1, fn: (a) => Math.acos(a[0]) },
  arctan: { min: 1, max: 1, fn: (a) => Math.atan(a[0]) },
  sinh: { min: 1, max: 1, fn: (a) => Math.sinh(a[0]) },
  cosh: { min: 1, max: 1, fn: (a) => Math.cosh(a[0]) },
  tanh: { min: 1, max: 1, fn: (a) => Math.tanh(a[0]) },
  sqrt: { min: 1, max: 1, fn: (a) => Math.sqrt(a[0]) },
  cbrt: { min: 1, max: 1, fn: (a) => Math.cbrt(a[0]) },
  abs: { min: 1, max: 1, fn: (a) => Math.abs(a[0]) },
  exp: { min: 1, max: 1, fn: (a) => Math.exp(a[0]) },
  ln: { min: 1, max: 1, fn: (a) => Math.log(a[0]) },
  log: { min: 1, max: 1, fn: (a) => Math.log(a[0]) },
  log2: { min: 1, max: 1, fn: (a) => Math.log2(a[0]) },
  log10: { min: 1, max: 1, fn: (a) => Math.log10(a[0]) },
  floor: { min: 1, max: 1, fn: (a) => Math.floor(a[0]) },
  ceil: { min: 1, max: 1, fn: (a) => Math.ceil(a[0]) },
  round: { min: 1, max: 1, fn: (a) => Math.round(a[0]) },
  sign: { min: 1, max: 1, fn: (a) => Math.sign(a[0]) },
  min: { min: 1, max: 8, fn: (a) => Math.min(...a) },
  max: { min: 1, max: 8, fn: (a) => Math.max(...a) },
  pow: { min: 2, max: 2, fn: (a) => Math.pow(a[0], a[1]) },
  mod: { min: 2, max: 2, fn: (a) => a[0] % a[1] },
  atan2: { min: 2, max: 2, fn: (a) => Math.atan2(a[0], a[1]) },
}

type Token = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string }

const cleanSource = (raw: string) => String(raw ?? '')
  .replace(/```[a-z]*/gi, '')
  .replace(/`/g, '')
  .replace(/\\left|\\right|\\,|\\;/gi, '')
  .replace(/[−–]/g, '-')
  .replace(/[×·]/g, '*')
  .replace(/÷/g, '/')
  .replace(/π/g, 'pi')
  .replace(/≤/g, '<=')
  .replace(/≥/g, '>=')
  .replace(/²/g, '^2')
  .replace(/³/g, '^3')
  .replace(/\*\*/g, '^')
  .trim()

function tokenize(raw: string): Token[] {
  const s = cleanSource(raw)
  if (!s) throw new ParseError('the expression is empty')
  if (s.length > MAX_EXPR_LENGTH) throw new ParseError(`the expression is longer than ${MAX_EXPR_LENGTH} characters`)
  const out: Token[] = []
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (/\s/.test(ch)) { i++; continue }
    const num = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(s.slice(i))
    if (num) {
      const value = Number(num[0])
      if (!Number.isFinite(value)) throw new ParseError(`“${num[0]}” is not a finite number`)
      out.push({ t: 'num', v: value })
      i += num[0].length
      continue
    }
    const id = /^[A-Za-z]+/.exec(s.slice(i))
    if (id) { out.push({ t: 'id', v: id[0].toLowerCase() }); i += id[0].length; continue }
    const op = /^(<=|>=|==|!=|[-+*/^%=<>(),])/.exec(s.slice(i))
    if (op) { out.push({ t: 'op', v: op[1] }); i += op[1].length; continue }
    throw new ParseError(`unexpected character “${ch}”`)
  }
  if (out.length > MAX_TOKENS) throw new ParseError('the expression is too long')
  return out
}

class Parser {
  private pos = 0
  private depth = 0
  constructor(private readonly tokens: Token[]) {}

  private peek = () => this.tokens[this.pos]
  private eat = () => this.tokens[this.pos++]

  parse(): Node {
    if (!this.tokens.length) throw new ParseError('the expression is empty')
    const node = this.parseComparison()
    if (this.pos !== this.tokens.length) throw new ParseError('unexpected text after the expression')
    return node
  }

  private parseComparison(): Node {
    const left = this.parseAdditive()
    const t = this.peek()
    if (t?.t === 'op' && REL_OPS.has(t.v)) {
      this.pos++
      const right = this.parseAdditive()
      const after = this.peek()
      if (after?.t === 'op' && REL_OPS.has(after.v)) throw new ParseError('use one comparison per equation')
      return { k: 'cmp', op: (t.v === '==' ? '=' : t.v) as RelationOp, a: left, b: right }
    }
    return left
  }

  private parseAdditive(): Node {
    let v = this.parseMultiplicative()
    for (;;) {
      const t = this.peek()
      if (t?.t === 'op' && (t.v === '+' || t.v === '-')) {
        this.pos++
        v = { k: 'bin', op: t.v, a: v, b: this.parseMultiplicative() }
      } else return v
    }
  }

  private parseMultiplicative(): Node {
    let v = this.parseUnary()
    for (;;) {
      const t = this.peek()
      if (t?.t === 'op' && (t.v === '*' || t.v === '/')) {
        this.pos++
        v = { k: 'bin', op: t.v, a: v, b: this.parseUnary() }
        continue
      }
      // Implicit multiplication: 2x, 3(x+1), (x+1)(x-1), 2sin(x).
      if (t && (t.t === 'num' || t.t === 'id' || (t.t === 'op' && t.v === '('))) {
        v = { k: 'bin', op: '*', a: v, b: this.parseUnary() }
        continue
      }
      return v
    }
  }

  private parseUnary(): Node {
    const t = this.peek()
    if (t?.t === 'op' && (t.v === '+' || t.v === '-')) {
      this.pos++
      const a = this.parseUnary()
      return t.v === '-' ? { k: 'neg', a } : a
    }
    return this.parsePower()
  }

  private parsePower(): Node {
    const base = this.parsePrimary()
    const t = this.peek()
    if (t?.t === 'op' && t.v === '^') {
      this.pos++
      return { k: 'bin', op: '^', a: base, b: this.parseUnary() }
    }
    return base
  }

  private parsePrimary(): Node {
    const t = this.eat()
    if (!t) throw new ParseError('the expression ended unexpectedly')
    if (t.t === 'num') return { k: 'num', v: t.v }
    if (t.t === 'id') {
      if (t.v === 'pi' || t.v === 'tau') return { k: 'num', v: t.v === 'pi' ? Math.PI : Math.PI * 2 }
      if (t.v === 'e') return { k: 'num', v: Math.E }
      const next = this.peek()
      if (next?.t === 'op' && next.v === '(') {
        const fn = FUNCS[t.v]
        if (!fn) throw new ParseError(`unknown function “${t.v}”`)
        this.pos++
        this.depth++
        if (this.depth > 40) throw new ParseError('the expression is nested too deeply')
        const args: Node[] = []
        if (!(this.peek()?.t === 'op' && this.peek()?.v === ')')) {
          for (;;) {
            args.push(this.parseAdditive())
            const sep = this.peek()
            if (sep?.t === 'op' && sep.v === ',') { this.pos++; continue }
            break
          }
        }
        const close = this.eat()
        this.depth--
        if (!close || close.t !== 'op' || close.v !== ')') throw new ParseError(`missing “)” after ${t.v}(`)
        if (args.length < fn.min || args.length > fn.max) throw new ParseError(`${t.v} takes ${fn.min === fn.max ? fn.min : `${fn.min}-${fn.max}`} argument${fn.max === 1 ? '' : 's'}`)
        return { k: 'call', name: t.v, args }
      }
      if (t.v === 'x' || t.v === 'y') return { k: 'var', name: t.v }
      throw new ParseError(`unknown name “${t.v}” (only x and y are allowed)`)
    }
    if (t.t === 'op' && t.v === '(') {
      this.depth++
      if (this.depth > 40) throw new ParseError('the expression is nested too deeply')
      const v = this.parseAdditive()
      const close = this.eat()
      this.depth--
      if (!close || close.t !== 'op' || close.v !== ')') throw new ParseError('missing “)”')
      return v
    }
    throw new ParseError(`unexpected “${t.v}”`)
  }
}

const hasVar = (n: Node, name: 'x' | 'y'): boolean => {
  switch (n.k) {
    case 'var': return n.name === name
    case 'neg': return hasVar(n.a, name)
    case 'bin': return hasVar(n.a, name) || hasVar(n.b, name)
    case 'call': return n.args.some((a) => hasVar(a, name))
    case 'cmp': return hasVar(n.a, name) || hasVar(n.b, name)
    default: return false
  }
}

const evalNode = (n: Node, x: number, y: number): number => {
  switch (n.k) {
    case 'num': return n.v
    case 'var': return n.name === 'x' ? x : y
    case 'neg': return -evalNode(n.a, x, y)
    case 'call': {
      const fn = FUNCS[n.name]
      if (!fn) return NaN
      return fn.fn(n.args.map((a) => evalNode(a, x, y)))
    }
    case 'bin': {
      const a = evalNode(n.a, x, y), b = evalNode(n.b, x, y)
      switch (n.op) {
        case '+': return a + b
        case '-': return a - b
        case '*': return a * b
        case '/': return a / b
        case '%': return a % b
        case '^': return Math.pow(a, b)
      }
      return NaN
    }
    case 'cmp': return NaN
  }
}

export type MathExpr = { source: string; uses: Set<'x' | 'y'>; evaluate: (x: number, y: number) => number }

/** Compile a plain expression (no comparison) for reuse and tests. */
export function compileExpression(raw: string): MathExpr {
  const ast = new Parser(tokenize(raw)).parse()
  if (ast.k === 'cmp') throw new ParseError('an expression cannot contain a comparison here')
  return {
    source: raw,
    uses: new Set((['x', 'y'] as const).filter((v) => hasVar(ast, v))),
    evaluate: (x, y) => evalNode(ast, x, y),
  }
}

export type CompiledRelation = {
  source: string
  kind: 'explicit' | 'implicit'
  relation: RelationOp
  /** Explicit functions only. */
  f?: (x: number) => number
  residual: (x: number, y: number) => number
  test: (x: number, y: number) => boolean
  usesY: boolean
}

const compareNum = (a: number, op: RelationOp, b: number): boolean => {
  switch (op) {
    case '=': return Math.abs(a - b) < 1e-9
    case '<': return a < b
    case '<=': return a <= b
    case '>': return a > b
    case '>=': return a >= b
  }
}

const STRIP_RHS = /^(?:y|f\s*\(\s*x\s*\)|g\s*\(\s*x\s*\)|h\s*\(\s*x\s*\))\s*=/i

/** Compile one equation-like string. Throws `ParseError` on invalid input. */
export function compileRelation(raw: string): CompiledRelation {
  let body = cleanSource(raw)
  if (!body) throw new ParseError('the expression is empty')
  const forcedExplicit = STRIP_RHS.test(body)
  if (forcedExplicit) body = body.replace(STRIP_RHS, '').trim()
  if (!body) throw new ParseError('the expression is empty')
  const ast = new Parser(tokenize(body)).parse()
  let relation: RelationOp = '='
  let left: Node, right: Node
  if (ast.k === 'cmp') {
    relation = ast.op
    left = ast.a
    right = ast.b
  } else if (forcedExplicit || !hasVar(ast, 'y')) {
    left = { k: 'var', name: 'y' }
    right = ast
  } else {
    left = ast
    right = { k: 'num', v: 0 }
  }
  const leftY = hasVar(left, 'y'), rightY = hasVar(right, 'y')
  const usesY = leftY || rightY
  const residual = (x: number, y: number) => evalNode(left, x, y) - evalNode(right, x, y)
  const test = (x: number, y: number) => compareNum(evalNode(left, x, y), relation, evalNode(right, x, y))
  let f: ((x: number) => number) | undefined
  let kind: CompiledRelation['kind'] = 'implicit'
  if (relation === '=') {
    if (left.k === 'var' && left.name === 'y' && !rightY) {
      f = (x) => evalNode(right, x, 0)
      kind = 'explicit'
    } else if (right.k === 'var' && right.name === 'y' && !leftY) {
      f = (x) => evalNode(left, x, 0)
      kind = 'explicit'
    }
  }
  return { source: raw, kind, relation, ...(f ? { f } : {}), residual, test, usesY }
}

/* ------------------------------------------------------------------ */
/* Sampling                                                            */
/* ------------------------------------------------------------------ */

export type Pt = { x: number; y: number }

/** Sample an explicit function, breaking at asymptotes and non-finite points.
 *  Values far outside the view are clamped so a single pole cannot produce a
 *  gigantic path; the plot clips the rest. */
export function sampleExplicit(f: (x: number) => number, xRange: [number, number], yRange: [number, number], count = 480): Pt[][] {
  const [x0, x1] = xRange
  const ySpan = Math.max(1e-9, yRange[1] - yRange[0])
  const lo = yRange[0] - ySpan * 3, hi = yRange[1] + ySpan * 3
  const out: Pt[][] = []
  let cur: Pt[] = []
  let prev: Pt | null = null
  const flush = () => { if (cur.length > 1) out.push(cur); cur = [] }
  const n = Math.max(40, Math.min(2400, Math.round(count)))
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n
    const y = f(x)
    if (!Number.isFinite(y) || Math.abs(y) > 1e9) { flush(); prev = null; continue }
    // A jump between two large opposite values is an asymptote, not a line.
    if (prev && Math.abs(prev.y) > ySpan * 1.5 && Math.abs(y) > ySpan * 1.5 && Math.sign(prev.y) !== Math.sign(y)) {
      flush()
      prev = null
    }
    cur.push({ x, y: Math.max(lo, Math.min(hi, y)) })
    prev = { x, y }
  }
  flush()
  return out
}

const lerpEdge = (a: number, b: number) => {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return 0.5
  return Math.max(0, Math.min(1, (0 - a) / (b - a)))
}

/** Marching squares. Returns zero-contour segments of `residual` in the given
 *  view, which is how implicit equations and inequality boundaries are drawn. */
export function contourSegments(residual: (x: number, y: number) => number, xRange: [number, number], yRange: [number, number], cols = 200, rows = 140): [Pt, Pt][] {
  const c = Math.max(8, Math.min(420, Math.round(cols))), r = Math.max(8, Math.min(320, Math.round(rows)))
  const [x0, x1] = xRange, [y0, y1] = yRange
  const dx = (x1 - x0) / c, dy = (y1 - y0) / r
  const vals = new Float64Array((c + 1) * (r + 1))
  for (let j = 0; j <= r; j++) {
    const y = y0 + dy * j
    for (let i = 0; i <= c; i++) vals[j * (c + 1) + i] = residual(x0 + dx * i, y)
  }
  const at = (i: number, j: number) => vals[j * (c + 1) + i]
  const edge = (i: number, j: number, e: number): Pt => {
    const v0 = at(i, j), v1 = at(i + 1, j), v2 = at(i + 1, j + 1), v3 = at(i, j + 1)
    if (e === 0) return { x: x0 + (i + lerpEdge(v0, v1)) * dx, y: y0 + j * dy }
    if (e === 1) return { x: x0 + (i + 1) * dx, y: y0 + (j + lerpEdge(v1, v2)) * dy }
    if (e === 2) return { x: x0 + (i + lerpEdge(v3, v2)) * dx, y: y0 + (j + 1) * dy }
    return { x: x0 + i * dx, y: y0 + (j + lerpEdge(v0, v3)) * dy }
  }
  const out: [Pt, Pt][] = []
  const add = (i: number, j: number, a: number, b: number) => out.push([edge(i, j, a), edge(i, j, b)])
  for (let j = 0; j < r; j++) {
    for (let i = 0; i < c; i++) {
      const v0 = at(i, j), v1 = at(i + 1, j), v2 = at(i + 1, j + 1), v3 = at(i, j + 1)
      if (![v0, v1, v2, v3].every(Number.isFinite)) continue
      const mask = (v0 > 0 ? 1 : 0) | (v1 > 0 ? 2 : 0) | (v2 > 0 ? 4 : 0) | (v3 > 0 ? 8 : 0)
      switch (mask) {
        case 0: case 15: break
        case 1: add(i, j, 3, 0); break
        case 2: add(i, j, 0, 1); break
        case 3: add(i, j, 3, 1); break
        case 4: add(i, j, 1, 2); break
        case 5: add(i, j, 3, 2); add(i, j, 0, 1); break
        case 6: add(i, j, 0, 2); break
        case 7: add(i, j, 3, 2); break
        case 8: add(i, j, 2, 3); break
        case 9: add(i, j, 2, 0); break
        case 10: add(i, j, 1, 2); add(i, j, 3, 0); break
        case 11: add(i, j, 1, 2); break
        case 12: add(i, j, 1, 3); break
        case 13: add(i, j, 1, 0); break
        case 14: add(i, j, 0, 3); break
      }
    }
  }
  return out
}

export type RegionRun = { x: number; y: number; w: number; h: number }

/** Rasterise an inequality region into merged horizontal runs, which render
 *  as one filled path rather than thousands of separate rectangles. */
export function regionRuns(test: (x: number, y: number) => boolean, xRange: [number, number], yRange: [number, number], cols = 180, rows = 130): RegionRun[] {
  const c = Math.max(8, Math.min(360, Math.round(cols))), r = Math.max(8, Math.min(280, Math.round(rows)))
  const [x0, x1] = xRange, [y0, y1] = yRange
  const dx = (x1 - x0) / c, dy = (y1 - y0) / r
  const out: RegionRun[] = []
  for (let j = 0; j < r; j++) {
    const y = y0 + (j + 0.5) * dy
    let start = -1
    for (let i = 0; i <= c; i++) {
      const inside = i < c && test(x0 + (i + 0.5) * dx, y)
      if (inside && start < 0) start = i
      if (!inside && start >= 0) {
        out.push({ x: x0 + start * dx, y: y0 + j * dy, w: (i - start) * dx, h: dy })
        start = -1
      }
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* View fitting                                                        */
/* ------------------------------------------------------------------ */

export type GraphCurve = {
  source: string
  label: string
  color: string
  width: number
  dashed: boolean
  compiled: CompiledRelation
}

export type GraphPoint = { x: number; y: number; label?: string }

export type GraphSeries = {
  points: GraphPoint[]
  kind: 'line' | 'scatter' | 'bar' | 'area'
  color: string
  label: string
  width: number
  dashed: boolean
  barWidth?: number
}

export type GraphShape =
  | { type: 'segment' | 'vector'; from: Pt; to: Pt; color: string; width: number; dashed: boolean; label?: string }
  | { type: 'circle'; center: Pt; radius: number; color: string; width: number; dashed: boolean; fill: boolean; fillColor?: string; label?: string }
  | { type: 'rect'; from: Pt; to: Pt; color: string; width: number; dashed: boolean; fill: boolean; fillColor?: string; label?: string }
  | { type: 'polygon'; points: Pt[]; color: string; width: number; dashed: boolean; fill: boolean; fillColor?: string; label?: string }
  | { type: 'label'; at: Pt; text: string; color: string }

/** Where the figure sits relative to the reply text. Inline placements float
 *  beside the prose so the text wraps around the graph; `below` puts it after
 *  the writing. */
export type GraphPlacement = 'left' | 'right' | 'below'

export type GraphSpec = {
  title?: string
  xLabel?: string
  yLabel?: string
  curves: GraphCurve[]
  series: GraphSeries[]
  points: GraphPoint[]
  shapes: GraphShape[]
  xRange?: [number, number]
  yRange?: [number, number]
  grid: boolean
  legend: boolean
  aspect: 'equal' | 'auto'
  placement: GraphPlacement
  errors: string[]
}

const DEFAULT_COLOR = 'black'
const MAX_CURVES = 12
const MAX_SERIES = 12
const MAX_POINTS = 300
const MAX_SHAPES = 60

const text = (v: unknown, max = 120): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const finite = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}
const asList = (v: unknown): unknown[] => Array.isArray(v) ? v : v == null ? [] : [v]
const asObject = (v: unknown): Record<string, unknown> | null => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null

const parseJsonList = (v: unknown): unknown[] => {
  if (typeof v !== 'string') return asList(v)
  const s = v.trim()
  if (!/^[\[{]/.test(s)) return [v]
  try {
    const parsed = JSON.parse(s)
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch { return [v] }
}

const normalizeColor = (raw: unknown): string => {
  const k = String(raw ?? '').trim().toLowerCase().replace(/^colour$/, 'color')
  if (k === 'grey' || k === 'silver') return 'gray'
  return (GRAPH_COLORS as readonly string[]).includes(k) ? k : DEFAULT_COLOR
}

const normalizeWidth = (raw: unknown, fallback = 2.2): number => {
  const n = finite(raw)
  return n == null ? fallback : Math.max(0.5, Math.min(8, n))
}

const parsePoint = (raw: unknown): GraphPoint | null => {
  if (Array.isArray(raw) && raw.length >= 2) {
    const x = finite(raw[0]), y = finite(raw[1])
    if (x == null || y == null) return null
    const label = text(raw[2], 60)
    return { x, y, ...(label ? { label } : {}) }
  }
  const o = asObject(raw)
  if (!o) return null
  const x = finite(o.x ?? o[0] ?? o.horizontal), y = finite(o.y ?? o[1] ?? o.vertical)
  if (x == null || y == null) return null
  const label = text(o.label ?? o.name ?? o.title, 60)
  return { x, y, ...(label ? { label } : {}) }
}

const parseRange = (raw: unknown): [number, number] | undefined => {
  if (Array.isArray(raw) && raw.length >= 2) {
    const a = finite(raw[0]), b = finite(raw[1])
    if (a == null || b == null || a === b) return undefined
    return [Math.min(a, b), Math.max(a, b)]
  }
  const o = asObject(raw)
  if (!o) return undefined
  const a = finite(o.min ?? o.from ?? o.start ?? o[0])
  const b = finite(o.max ?? o.to ?? o.end ?? o[1])
  if (a == null || b == null || a === b) return undefined
  return [Math.min(a, b), Math.max(a, b)]
}

const shapePoint = (raw: unknown): Pt | null => {
  const p = parsePoint(raw)
  return p ? { x: p.x, y: p.y } : null
}

const shapeFill = (raw: unknown): { fill: boolean; fillColor?: string } => {
  if (raw === true) return { fill: true }
  const s = text(raw, 20).toLowerCase()
  if (s && (GRAPH_COLORS as readonly string[]).includes(s)) return { fill: true, fillColor: s }
  return { fill: false }
}

function parseShape(raw: unknown): GraphShape | null {
  const o = asObject(raw)
  if (!o) return null
  const type = text(o.type ?? o.kind ?? o.shape, 20).toLowerCase()
  const color = normalizeColor(o.color)
  const width = normalizeWidth(o.width ?? o.strokeWidth, 2)
  const dashed = o.dashed === true || o.dash === true
  const label = text(o.label ?? o.title, 60) || undefined
  const { fill, fillColor } = shapeFill(o.fill ?? o.filled ?? o.shade)
  if (type === 'point' || type === 'dot') {
    const p = parsePoint(o)
    if (!p) return null
    const at = { x: p.x, y: p.y }
    return label ? { type: 'label', at, text: label, color } : { type: 'circle', center: at, radius: normalizeWidth(o.radius ?? o.r, 0.15), color, width, dashed, fill: true, fillColor: color }
  }
  if (type === 'label' || type === 'text' || type === 'annotation') {
    const at = shapePoint(o.at ?? o.from ?? o.center ?? o.point)
    const t = text(o.text ?? o.label ?? o.title ?? o.content, 120)
    return at && t ? { type: 'label', at, text: t, color } : null
  }
  if (type === 'circle' || type === 'ellipse') {
    const cx = finite(o.cx ?? o.x), cy = finite(o.cy ?? o.y)
    const center = shapePoint(o.center ?? o.from ?? o.at) ?? (cx != null && cy != null ? { x: cx, y: cy } : { x: 0, y: 0 })
    const radius = finite(o.radius ?? o.r)
    if (!center || radius == null || radius <= 0) return null
    return { type: 'circle', center, radius: Math.min(1e6, radius), color, width, dashed, fill, ...(fillColor ? { fillColor } : {}), ...(label ? { label } : {}) }
  }
  if (type === 'rect' || type === 'rectangle' || type === 'square') {
    let from = shapePoint(o.from ?? o.start ?? o.a)
    let to = shapePoint(o.to ?? o.end ?? o.b)
    if (!from || !to) {
      const x = finite(o.x), y = finite(o.y), w = finite(o.width ?? o.w), h = finite(o.height ?? o.h)
      if (x != null && y != null && w != null && h != null) {
        from = { x, y }
        to = { x: x + w, y: y + h }
      }
    }
    if (!from || !to) return null
    return { type: 'rect', from, to, color, width, dashed, fill, ...(fillColor ? { fillColor } : {}), ...(label ? { label } : {}) }
  }
  if (type === 'polygon' || type === 'triangle' || type === 'quad') {
    const pts = asList(o.points).map(shapePoint).filter((p): p is Pt => !!p)
    if (pts.length < 3) return null
    return { type: 'polygon', points: pts.slice(0, 40), color, width, dashed, fill, ...(fillColor ? { fillColor } : {}), ...(label ? { label } : {}) }
  }
  if (type === 'segment' || type === 'line' || type === 'vector' || type === 'arrow') {
    const from = shapePoint(o.from ?? o.start ?? o.a)
    const to = shapePoint(o.to ?? o.end ?? o.b)
    if (!from || !to) return null
    return { type: type === 'arrow' || type === 'vector' ? 'vector' : 'segment', from, to, color, width, dashed, ...(label ? { label } : {}) }
  }
  // A bare `{from,to}` shape is treated as a segment.
  const from = shapePoint(o.from), to = shapePoint(o.to)
  if (from && to) return { type: 'segment', from, to, color, width, dashed, ...(label ? { label } : {}) }
  return null
}

/** Normalize model arguments into a renderable spec. Never throws for a
 *  single bad item: problems collect in `errors` so the rest still draws. */
export function normalizeGraphSpec(raw: unknown): GraphSpec {
  const o = asObject(raw) ?? {}
  const errors: string[] = []
  const title = text(o.title ?? o.name, 120) || undefined
  const xLabel = text(o.xLabel ?? o.xlabel ?? o.xAxis, 60) || undefined
  const yLabel = text(o.yLabel ?? o.ylabel ?? o.yAxis, 60) || undefined
  const grid = o.grid !== false
  const legend = o.legend !== false
  const aspectRequested = text(o.aspect, 10).toLowerCase()
  const side = text(o.placement ?? o.position ?? o.side, 12).toLowerCase()
  // Inline is the default: a figure should sit beside the words it belongs to,
  // never be pushed to the bottom of the reply on its own.
  const placement: GraphPlacement = side === 'right' ? 'right'
    : side === 'below' || side === 'bottom' || side === 'after' || side === 'under' ? 'below'
      : 'left'

  // Equations can arrive as strings or objects, under several familiar keys.
  const equationList = parseJsonList(o.equations ?? o.equation ?? o.expression ?? o.expressions ?? o.functions ?? o.function ?? o.curves)
  const curves: GraphCurve[] = []
  for (const item of equationList.slice(0, MAX_CURVES)) {
    const entry = asObject(item)
    const source = text(entry ? (entry.expression ?? entry.equation ?? entry.eq ?? entry.formula ?? entry.y ?? entry.fn ?? entry.value) : item, MAX_EXPR_LENGTH)
    if (!source) continue
    try {
      const compiled = compileRelation(source)
      curves.push({
        source,
        label: text(entry?.label ?? entry?.name, 80) || source,
        color: normalizeColor(entry?.color),
        width: normalizeWidth(entry?.width ?? entry?.strokeWidth),
        dashed: entry?.dashed === true || entry?.dash === true,
        compiled,
      })
    } catch (error) {
      errors.push(`“${source}”: ${(error as Error)?.message || 'could not be read'}`)
    }
  }

  const seriesList = parseJsonList(o.series)
  const series: GraphSeries[] = []
  for (const item of seriesList.slice(0, MAX_SERIES)) {
    const entry = asObject(item)
    if (!entry) continue
    let pts = parseJsonList(entry.points ?? entry.data ?? entry.values ?? entry.coords ?? entry.xy)
      .map(parsePoint)
      .filter((p): p is GraphPoint => !!p)
      .slice(0, MAX_POINTS)
    // Paired columns are a common chart shape: {x: [...], y: [...]}.
    if (!pts.length) {
      const data = asObject(entry.data)
      const xs = Array.isArray(entry.x) ? entry.x : Array.isArray(data?.x) ? data!.x as unknown[] : null
      const ys = Array.isArray(entry.y) ? entry.y : Array.isArray(data?.y) ? data!.y as unknown[] : null
      if (xs && ys) {
        pts = ys.slice(0, MAX_POINTS).flatMap((y, i) => {
          const px = finite(xs[i]), py = finite(y)
          return px == null || py == null ? [] : [{ x: px, y: py }]
        })
      }
      const labels = Array.isArray(entry.labels) ? entry.labels : []
      if (labels.length) pts = pts.map((p, i) => p.label || typeof labels[i] !== 'string' ? p : { ...p, label: text(labels[i], 60) })
    }
    if (!pts.length) continue
    const requested = text(entry.kind ?? entry.type ?? entry.mode, 12).toLowerCase()
    const kind: GraphSeries['kind'] = requested === 'bar' || requested === 'column'
      ? 'bar'
      : requested === 'scatter' || requested === 'dots'
        ? 'scatter'
        : requested === 'area' || requested === 'filled'
          ? 'area'
          : requested === 'line' || entry.connect !== false
            ? 'line'
            : 'scatter'
    // A line needs at least two points to be visible; a lone point is a dot.
    const visibleKind: GraphSeries['kind'] = kind === 'line' && pts.length < 2 ? 'scatter' : kind
    series.push({
      points: pts,
      kind: visibleKind,
      color: normalizeColor(entry.color),
      label: text(entry.label ?? entry.name, 80),
      width: normalizeWidth(entry.width ?? entry.strokeWidth),
      dashed: entry.dashed === true || entry.dash === true,
      ...(finite(entry.barWidth) != null ? { barWidth: Math.max(0.01, Math.min(1e6, finite(entry.barWidth)!)) } : {}),
    })
  }

  const points = parseJsonList(o.points)
    .map(parsePoint)
    .filter((p): p is GraphPoint => !!p)
    .slice(0, MAX_POINTS)

  const shapeList = parseJsonList(o.shapes ?? o.annotations)
  const shapes: GraphShape[] = []
  for (const item of shapeList.slice(0, MAX_SHAPES)) {
    const shape = parseShape(item)
    if (shape) shapes.push(shape)
    else errors.push('A shape was skipped because its coordinates or type were incomplete.')
  }

  // Geometry needs equal units to look right (circles stay circles); a
  // function or data chart fills the panel better with an adaptive scale.
  const geometry = shapes.length > 0 || curves.some((curve) => curve.compiled.kind === 'implicit')
  const aspect = aspectRequested === 'auto' || aspectRequested === 'equal' ? aspectRequested : geometry ? 'equal' : 'auto'
  return {
    ...(title ? { title } : {}),
    ...(xLabel ? { xLabel } : {}),
    ...(yLabel ? { yLabel } : {}),
    curves,
    series,
    points,
    shapes,
    ...(parseRange(o.xRange ?? o.xDomain ?? o.domainX ?? o.x) ? { xRange: parseRange(o.xRange ?? o.xDomain ?? o.domainX ?? o.x)! } : {}),
    ...(parseRange(o.yRange ?? o.yDomain ?? o.domainY ?? o.y) ? { yRange: parseRange(o.yRange ?? o.yDomain ?? o.domainY ?? o.y)! } : {}),
    grid,
    legend,
    aspect,
    placement,
    errors: [...new Set(errors)].slice(0, 6),
  }
}

export const graphItemCount = (spec: GraphSpec): number =>
  spec.curves.length + spec.series.length + spec.points.length + spec.shapes.length

export const graphSummaryBits = (spec: GraphSpec): string[] => {
  const bits: string[] = []
  const push = (n: number, one: string, many: string) => { if (n) bits.push(`${n} ${n === 1 ? one : many}`) }
  push(spec.curves.length, 'equation', 'equations')
  push(spec.series.length, 'series', 'series')
  push(spec.points.length, 'point', 'points')
  push(spec.shapes.length, 'shape', 'shapes')
  return bits
}

/** Text returned to the model after it plots. It confirms success without
 *  making the model repeat the data or coordinates in its reply. */
export function summarizeGraphSpec(spec: GraphSpec): string {
  const bits = graphSummaryBits(spec)
  if (!bits.length) throw new Error(`Nothing could be drawn${spec.errors.length ? `: ${spec.errors.join('; ')}` : '. Provide an equation, points, a series, or a shape.'}`)
  const title = spec.title ? ` “${spec.title}”` : ''
  const errors = spec.errors.length ? ` Some items were skipped: ${spec.errors.join('; ')}. Correct them and call graph again only if they matter.` : ''
  const where = spec.placement === 'below' ? 'below the reply text' : `to the ${spec.placement} of the reply text, with the prose wrapping beside it`
  return `Graph${title} is displayed ${where} (${bits.join(', ')}). Do not repeat the coordinates, equations, or table of values in your reply; explain the result, trend, relationship, or takeaway, and mention a specific value only when it helps.${errors}`
}

/** Round a tick step to a readable 1/2/5 × 10^n value and return every tick
 *  inside the range (inclusive). */
export function niceTicks(min: number, max: number, target = 6): { ticks: number[]; step: number } {
  const span = max - min
  if (!Number.isFinite(span) || span <= 0) return { ticks: [min], step: 1 }
  const rough = span / Math.max(2, Math.min(20, target))
  const mag = Math.pow(10, Math.floor(Math.log10(rough)))
  const norm = rough / mag
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag
  const start = Math.ceil(min / step) * step
  const ticks: number[] = []
  for (let v = start; v <= max + step * 1e-9 && ticks.length < 200; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v)
  return { ticks, step }
}

export function formatTick(value: number, step: number): string {
  if (!Number.isFinite(value)) return ''
  if (Math.abs(value) < Math.max(1e-12, Math.abs(step) * 1e-6)) return '0'
  const abs = Math.abs(value)
  if (abs >= 1e6 || (abs > 0 && abs < 1e-4)) return value.toExponential(1).replace('e+', 'e')
  const decimals = step >= 1 ? 0 : Math.min(6, Math.max(0, Math.ceil(-Math.log10(step))))
  const s = value.toFixed(decimals)
  return s === '-0' || /^-0\.0*$/.test(s) ? s.slice(1) : s
}

const padRange = (lo: number, hi: number, fraction = 0.08): [number, number] => {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [-5, 5]
  let a = lo, b = hi
  if (a === b) { a -= 1; b += 1 }
  const pad = (b - a) * fraction
  return [a - pad, b + pad]
}

const addBounds = (acc: { minX: number; maxX: number; minY: number; maxY: number }, x: number, y: number) => {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return
  acc.minX = Math.min(acc.minX, x); acc.maxX = Math.max(acc.maxX, x)
  acc.minY = Math.min(acc.minY, y); acc.maxY = Math.max(acc.maxY, y)
}

/** Fit the plotted area around the content. Equal scaling is the default so
 *  circles look round; a user-supplied range is never silently stretched. */
export function computeGraphDomain(spec: GraphSpec, aspect = 1.8): { x: [number, number]; y: [number, number] } {
  const acc = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  for (const p of spec.points) addBounds(acc, p.x, p.y)
  for (const s of spec.series) for (const p of s.points) addBounds(acc, p.x, p.y)
  let hasBars = false
  for (const s of spec.series) if (s.kind === 'bar') hasBars = true
  for (const shape of spec.shapes) {
    if (shape.type === 'segment' || shape.type === 'vector' || shape.type === 'rect') {
      addBounds(acc, shape.from.x, shape.from.y); addBounds(acc, shape.to.x, shape.to.y)
    } else if (shape.type === 'circle') {
      addBounds(acc, shape.center.x - shape.radius, shape.center.y - shape.radius)
      addBounds(acc, shape.center.x + shape.radius, shape.center.y + shape.radius)
    } else if (shape.type === 'polygon') {
      for (const p of shape.points) addBounds(acc, p.x, p.y)
    } else if (shape.type === 'label') addBounds(acc, shape.at.x, shape.at.y)
  }

  const implicitBounds: { minX: number; maxX: number; minY: number; maxY: number }[] = []
  for (const curve of spec.curves) {
    if (curve.compiled.kind !== 'implicit' || curve.compiled.relation !== '=') continue
    const segments = contourSegments(curve.compiled.residual, [-10, 10], [-10, 10], 100, 100)
    if (!segments.length) continue
    const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
    for (const [p, q] of segments) { addBounds(b, p.x, p.y); addBounds(b, q.x, q.y) }
    if (Number.isFinite(b.minX)) implicitBounds.push(b)
  }

  const explicitCurves = spec.curves.filter((c) => c.compiled.kind === 'explicit' && c.compiled.f)
  const xAuto = !spec.xRange, yAuto = !spec.yRange
  let xr = spec.xRange ? [...spec.xRange] as [number, number] : undefined
  let yr = spec.yRange ? [...spec.yRange] as [number, number] : undefined

  // Geometry and data set the window when they are present, so a circled
  // shape is not reduced to a dot by a function's default [-10, 10] window.
  // An equation-only graph keeps that familiar default.
  let geomMinX = Infinity, geomMaxX = -Infinity
  if (Number.isFinite(acc.minX)) { geomMinX = Math.min(geomMinX, acc.minX); geomMaxX = Math.max(geomMaxX, acc.maxX) }
  for (const b of implicitBounds) { geomMinX = Math.min(geomMinX, b.minX); geomMaxX = Math.max(geomMaxX, b.maxX) }
  const hasGeometryX = Number.isFinite(geomMinX) && geomMinX < geomMaxX
  if (!xr) {
    if (hasGeometryX) xr = padRange(geomMinX, geomMaxX, 0.14)
    else if (explicitCurves.length) xr = [-10, 10]
    else xr = [-5, 5]
  }

  // Geometry and data bounds are exact: a circle's edge must never be clipped
  // just because a long function sample outnumbers it. Only the function's own
  // samples are percentile-clipped, to keep one asymptote from flattening the
  // plot.
  const hardYs: number[] = []
  if (Number.isFinite(acc.minY)) hardYs.push(acc.minY, acc.maxY)
  for (const b of implicitBounds) hardYs.push(b.minY, b.maxY)
  if (hasBars) hardYs.push(0)
  const fnYs: number[] = []
  for (const curve of explicitCurves) {
    const f = curve.compiled.f!
    const n = 360
    for (let i = 0; i <= n; i++) {
      const x = xr[0] + ((xr[1] - xr[0]) * i) / n
      const y = f(x)
      if (Number.isFinite(y) && Math.abs(y) < 1e7) fnYs.push(y)
    }
  }
  if (!yr) {
    let lo = hardYs.length ? Math.min(...hardYs) : Infinity
    let hi = hardYs.length ? Math.max(...hardYs) : -Infinity
    if (fnYs.length) {
      fnYs.sort((a, b) => a - b)
      const pLo = fnYs[Math.floor(fnYs.length * 0.02)]
      const pHi = fnYs[Math.floor(fnYs.length * 0.98)]
      lo = Math.min(lo, Math.min(pLo, pHi))
      hi = Math.max(hi, Math.max(pLo, pHi))
    }
    yr = Number.isFinite(lo) && Number.isFinite(hi) ? padRange(lo, hi, 0.12) : [-5, 5]
  }

  const ensure = (r: [number, number]): [number, number] => {
    const a = Number.isFinite(r[0]) ? r[0] : -5
    const b = Number.isFinite(r[1]) ? r[1] : 5
    return a === b ? [a - 1, b + 1] : [Math.min(a, b), Math.max(a, b)]
  }
  xr = ensure(xr); yr = ensure(yr)

  if (spec.aspect !== 'auto' && Number.isFinite(aspect) && aspect > 0 && (xAuto || yAuto)) {
    const spanX = xr[1] - xr[0], spanY = yr[1] - yr[0]
    if (xAuto && yAuto) {
      if (spanX / spanY < aspect) {
        const next = spanY * aspect, mid = (xr[0] + xr[1]) / 2
        xr = [mid - next / 2, mid + next / 2]
      } else {
        const next = spanX / aspect, mid = (yr[0] + yr[1]) / 2
        yr = [mid - next / 2, mid + next / 2]
      }
    } else if (xAuto) {
      const next = spanY * aspect, mid = (xr[0] + xr[1]) / 2
      xr = [mid - next / 2, mid + next / 2]
    } else if (yAuto) {
      const next = spanX / aspect, mid = (yr[0] + yr[1]) / 2
      yr = [mid - next / 2, mid + next / 2]
    }
  }
  return { x: xr, y: yr }
}

/** Compact one-line description for the process log and card header. */
export const graphTitle = (spec: GraphSpec): string => spec.title || 'Graph'