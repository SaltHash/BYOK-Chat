import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkBreaks from 'remark-breaks'
import remarkEmoji from 'remark-emoji'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import { rehypeFade } from './src/streamFade.ts'

const proc = unified()
  .use(remarkParse)
  .use(remarkGfm, { singleTilde: false })
  .use(remarkMath)
  .use(remarkBreaks)
  .use(remarkEmoji)
  .use(remarkRehype, { clobberPrefix: '' })
  .use(rehypeRaw)
  .use(rehypeSanitize, defaultSchema)
  .use(rehypeFade)

const cls = (n) => {
  const c = n.properties?.className
  return Array.isArray(c) ? c.join('.') : typeof c === 'string' ? c : ''
}
const sum = (n) => n.type === 'element'
  ? `${n.tagName}${cls(n) ? '.' + cls(n) : ''}(${(n.children ?? []).map(sum).join('|')})`
  : n.type === 'root'
    ? `root(${(n.children ?? []).map(sum).join('|')})`
    : JSON.stringify(n.value ?? '')

for (const t of ['Hello', 'Hello world', 'Hello world and', 'Hello world and more']) {
  const tree = proc.runSync(proc.parse(t))
  console.log(JSON.stringify(t), '=>', sum(tree))
}
