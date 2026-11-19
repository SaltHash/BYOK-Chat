import { useRef, useState } from 'react'
import { Trash2, Trophy, Swords, TriangleAlert, CircleCheck } from 'lucide-react'
import {
  ARENA_BENCHMARKS, ARENA_JUDGE_SYSTEM, ARENA_HISTORY_MAX, arenaBenchmarkOf, arenaUrlFor, arenaWebQuestion,
  contestantLabel, generalTask, judgeAsk, longContextTask, normArena, pageSummaryTask, parseVerdict, customTask, webTask,
  verdictWinner, type ArenaAnswer, type ArenaRun, type ArenaState, type ArenaTask,
} from '../arena'
import { fetchPage, formatSearch, searchWeb, stream } from '../engine'
import { fetchOptsOf, helperRef, modelsOf, modelNameOf, normSearch, searchOptsOf, splitHelperRef, uid, usable, useS, useSConfig, type Ep } from '../store'
import { Anchor, Section, SettingRow } from './settingsPrimitives'
import { Area, Btn, Checkbox, Field, Sel } from './ui'

/** Resolve a `endpoint::model` ref against the saved endpoints. */
function epOf(eps: Ep[], ref: string): Ep | undefined {
  const [id, model] = splitHelperRef(ref)
  const found = eps.find((e) => e.id === id && usable(e))
  if (!found) return undefined
  return { ...found, model: model && modelsOf(found).includes(model) ? model : found.model }
}

const msgOf = (e: unknown) => String((e as Error)?.message ?? e)

/** The Arena: one benchmark, two or more contestant models, one judge that
 *  grades them side by side. Runs stay local; nothing here touches chats. */
export function ArenaTab() {
  const s = useSConfig()
  const arena = normArena(s.arena)
  const set = (p: Partial<ArenaState>) => useS.getState().patch({ arena: { ...arena, ...p } })
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [run, setRun] = useState<ArenaRun | null>(null)
  const ctl = useRef<AbortController | null>(null)
  const bench = arenaBenchmarkOf(arena.benchmark)

  const modelOpts: [string, string][] = [
    ['', 'None'],
    ...s.eps.flatMap((e) => modelsOf(e).map((m) => [helperRef(e.id, m), `${e.name} · ${modelNameOf(e, m)}`] as [string, string])),
  ]
  const judgeRef = arena.judgeEp ? helperRef(arena.judgeEp, arena.judgeModel) : ''
  const setJudge = (ref: string) => {
    const [ep, model] = splitHelperRef(ref)
    set({ judgeEp: ep, judgeModel: model })
  }
  const toggleContestant = (ref: string) => {
    const on = arena.contestants.includes(ref)
    set({ contestants: on ? arena.contestants.filter((x) => x !== ref) : [...arena.contestants, ref].slice(0, 8) })
  }

  /* Gather the benchmark material, then ask every contestant in parallel and
   * hand all the answers to the judge. */
  const start = async () => {
    const judge = epOf(s.eps, judgeRef)
    if (!judge) return setStatus('Pick a judge model first.')
    const contestants = arena.contestants.map((ref) => epOf(s.eps, ref)).filter((e): e is Ep => !!e)
    if (contestants.length < 2) return setStatus('Pick at least two contestant models.')
    const prefs = normSearch(s.search)
    ctl.current = new AbortController()
    setRun(null)
    setBusy(true)
    try {
      setStatus(bench.needs === 'none' ? 'Building the task…' : 'Gathering the benchmark material…')
      let task: ArenaTask
      if (arena.benchmark === 'long-context' || arena.benchmark === 'page-summary') {
        const url = arenaUrlFor(arena.benchmark, arena.history.length)
        const page = await fetchPage(url, { ...fetchOptsOf(prefs), cache: true })
        if (!page.text) throw Error(`the page reader returned no text for ${url}`)
        task = arena.benchmark === 'long-context' ? longContextTask(url, page.text) : pageSummaryTask(url, page.text)
      } else if (arena.benchmark === 'web') {
        const question = arenaWebQuestion(arena.history.length)
        const data = await searchWeb(question, { ...searchOptsOf(prefs), count: 6, cache: true })
        task = webTask(question, formatSearch(data, { inlineCites: false }))
      } else if (arena.benchmark === 'custom') {
        if (!arena.customPrompt.trim()) throw Error('write a prompt for the custom benchmark')
        task = customTask(arena.customPrompt)
      } else {
        task = generalTask(arena.history.length)
      }
      setStatus(`Asking ${contestants.length} model${contestants.length === 1 ? '' : 's'} the same task…`)
      const answers: ArenaAnswer[] = await Promise.all(contestants.map(async (ep, i) => {
        const label = contestantLabel(i)
        const name = `${ep.name} · ${modelNameOf(ep, ep.model)}`
        const t0 = Date.now()
        try {
          const out = await stream(ep, task.system, [{ role: 'user', content: task.prompt }], () => {}, ctl.current ?? new AbortController(), { cap: 1600 })
          return { label, ref: helperRef(ep.id, ep.model), name, text: out.text.trim(), ms: Date.now() - t0, tokens: out.tout }
        } catch (err) {
          return { label, ref: helperRef(ep.id, ep.model), name, text: '', error: msgOf(err), ms: Date.now() - t0 }
        }
      }))
      setStatus('Judging the answers…')
      let verdict
      try {
        const out = await stream(judge, ARENA_JUDGE_SYSTEM, [{ role: 'user', content: judgeAsk(task, answers) }], () => {}, ctl.current ?? new AbortController(), { cap: 1400 })
        verdict = parseVerdict(out.text, answers.map((a) => a.label))
      } catch (err) {
        verdict = { scores: [], ranking: [], verdict: '', error: msgOf(err) }
      }
      const entry: ArenaRun = { id: uid(), at: Date.now(), benchmark: arena.benchmark, prompt: task.prompt.slice(0, 4000), answers, verdict }
      setRun(entry)
      set({ history: [entry, ...arena.history].slice(0, ARENA_HISTORY_MAX) })
      setStatus('')
    } catch (err) {
      setStatus(`The run stopped: ${msgOf(err)}`)
    } finally {
      ctl.current = null
      setBusy(false)
    }
  }

  const winner = verdictWinner(run?.verdict)
  const shown = run

  return (
    <div className="space-y-6">
      <Section title="Arena">
        <p className="text-sm text-mu">Run one benchmark against several models and have a judge grade them side by side. Runs are kept on this device only — they are not chats and do not appear in Stats.</p>
        <Anchor id="arena-judge">
          <SettingRow label="Judge model">
            <div className="w-64 max-w-full"><Sel value={judgeRef} set={setJudge} opts={modelOpts} inline ariaLabel="Judge model" /></div>
          </SettingRow>
        </Anchor>
        <Anchor id="arena-benchmark">
          <SettingRow label="Benchmark">
            <div className="w-64 max-w-full"><Sel value={arena.benchmark} set={(v) => set({ benchmark: v as ArenaState['benchmark'] })} opts={ARENA_BENCHMARKS.map((b) => [b.id, b.label] as [string, string])} inline ariaLabel="Benchmark" /></div>
          </SettingRow>
        </Anchor>
        <p className="pb-2 text-xs text-mu">{bench.blurb}{bench.needs === 'search' ? ' Needs a search provider in Settings → Tools → Web search.' : bench.needs === 'page' ? ' Reads a real page through your page reader.' : ''}</p>
        {arena.benchmark === 'custom' && (
          <Anchor id="arena-prompt">
            <Field label="Custom prompt">
              <Area rows={4} value={arena.customPrompt} set={(customPrompt) => set({ customPrompt })} placeholder="What should every model answer?" aria-label="Custom arena prompt" />
            </Field>
          </Anchor>
        )}
      </Section>

      <Section title="Contestants">
        <p className="pb-2 text-xs text-mu">Pick two or more models. Each one answers the same task with its own saved reasoning level and routing.</p>
        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {s.eps.flatMap((e) => modelsOf(e).map((m) => {
            const ref = helperRef(e.id, m)
            return <Checkbox key={ref} checked={arena.contestants.includes(ref)} set={() => toggleContestant(ref)} label={`${e.name} · ${modelNameOf(e, m)}`} className="px-1 py-1.5" />
          }))}
        </div>
        {!s.eps.length && <p className="text-sm text-mu">Add an endpoint first.</p>}
      </Section>

      <div className="flex flex-wrap items-center gap-2">
        <Btn v="solid" icon={Swords} disabled={busy} onClick={() => void start()}>{busy ? 'Running…' : 'Run benchmark'}</Btn>
        {busy && <Btn v="soft" onClick={() => { ctl.current?.abort(); setStatus('Stopped.') }}>Stop</Btn>}
        {status && <p role="status" className="text-xs text-mu">{status}</p>}
      </div>

      {shown && <Section title="Result">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-surf p-3 text-sm">
            <Trophy size={16} className="text-ac" />
            {winner ? <><span className="font-medium">{winner}</span><span className="text-mu">{shown.answers.find((a) => a.label === winner)?.name}</span><span className="ml-auto text-xs text-mu">{arenaBenchmarkOf(shown.benchmark).label}</span></>
              : <span className="text-mu">No verdict — {shown.verdict?.error ?? 'the judge did not answer.'}</span>}
          </div>
          {shown.verdict?.verdict && <p className="text-sm">{shown.verdict.verdict}</p>}
          {shown.answers.map((a) => {
            const score = shown.verdict?.scores.find((x) => x.label === a.label)
            return <div key={a.label} className="rounded-xl bg-surf p-3">
              <div className="flex flex-wrap items-baseline gap-2 text-sm">
                <span className="font-medium">{a.label}</span>
                <span className="min-w-0 truncate text-mu">{a.name}</span>
                {score ? <span className="ml-auto tabular-nums">{score.score.toFixed(1)}/10</span> : a.error ? <TriangleAlert size={14} className="ml-auto text-er" /> : <span className="ml-auto text-xs text-mu">not scored</span>}
              </div>
              {score && <p className="mt-0.5 text-xs text-mu">accuracy {score.accuracy} · completeness {score.completeness} · clarity {score.clarity}{a.ms ? ` · ${(a.ms / 1000).toFixed(1)}s` : ''}</p>}
              {score?.notes && <p className="mt-1 text-xs">{score.notes}</p>}
              {a.error ? <p className="mt-1 text-xs text-er">{a.error}</p> : <details className="mt-1"><summary className="cursor-pointer text-xs text-mu">Answer</summary><pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs">{a.text}</pre></details>}
            </div>
          })}
        </div>
      </Section>}

      <Section title="History">
        {!arena.history.length ? <p className="text-sm text-mu">No runs yet. The last {ARENA_HISTORY_MAX} runs are kept on this device.</p> : <>
          <div className="space-y-1">
            {arena.history.map((r) => {
              const w = verdictWinner(r.verdict)
              const name = r.answers.find((a) => a.label === w)?.name
              return <button key={r.id} type="button" onClick={() => setRun(r)} className="flex w-full items-center gap-2 rounded-lg bg-surf px-3 py-2 text-left text-sm hover:bg-hov">
                <CircleCheck size={14} className={w ? 'shrink-0 text-ac' : 'shrink-0 text-mu'} />
                <span className="min-w-0 flex-1 truncate">{arenaBenchmarkOf(r.benchmark).label}{name ? ` · ${name}` : ''}</span>
                <span className="shrink-0 text-xs text-mu">{new Date(r.at).toLocaleDateString()} {new Date(r.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </button>
            })}
          </div>
          <div className="pt-2"><Btn v="ghost" sm icon={Trash2} onClick={() => { setRun(null); set({ history: [] }) }}>Clear history</Btn></div>
        </>}
      </Section>
    </div>
  )
}
