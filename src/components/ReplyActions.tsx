import { useMemo, useState } from 'react'
import { Check, CornerDownLeft, ListChecks } from 'lucide-react'
import { useS } from '../store'
import { Area, Btn, Input, RangeSlider, cx } from './ui'
import {
  initialPollAnswers,
  normalizePoll,
  pollAnswerText,
  pollLimits,
  pollQuestionAnswered,
  type PollAnswer,
  type PollAnswers,
  type PollOption,
  type PollQuestion,
} from '../replyWidgets'

type ToolCall = { id: string; name: string; arguments: string; error?: boolean }

const parseArgs = (raw: string): Record<string, unknown> => {
  try {
    const value = JSON.parse(raw || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

const answerFor = (answers: PollAnswers, index: number) => answers[index] ?? { choice: [], text: '', number: '' }

type AnswerChange = (index: number, patch: Partial<PollAnswer>) => void

function ChoiceQuestion({ q, qi, answer, disabled, onChange }: {
  q: PollQuestion
  qi: number
  answer: PollAnswers[number]
  disabled: boolean
  onChange: AnswerChange
}) {
  const multiple = q.multiple === true
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-sm font-medium">{q.label}</span>
        {multiple && <span className="text-xs text-mu">Choose any</span>}
      </div>
      <div role={multiple ? 'group' : 'radiogroup'} aria-label={q.label} className="grid gap-2 sm:grid-cols-2">
        {q.options.map((option: PollOption, oi) => {
          const selected = answer.choice.includes(oi)
          const pick = () => {
            const next = multiple
              ? selected ? answer.choice.filter((x) => x !== oi) : [...answer.choice, oi]
              : [oi]
            onChange(qi, { choice: next })
          }
          return (
            <div key={oi} className={cx('rounded-lg border transition-colors', selected ? 'border-ac bg-ac/10' : 'border-bor')}>
              <button
                type="button"
                role={multiple ? 'checkbox' : 'radio'}
                aria-checked={selected}
                disabled={disabled}
                onClick={pick}
                onKeyDown={(e) => {
                  if (multiple || !['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(e.key)) return
                  e.preventDefault()
                  const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1
                  const nextIndex = (oi + step + q.options.length) % q.options.length
                  onChange(qi, { choice: [nextIndex] })
                  e.currentTarget.closest('[role="radiogroup"]')?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[nextIndex]?.focus()
                }}
                className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-hov disabled:opacity-50"
              >
                <span aria-hidden="true" className={cx('grid size-4 shrink-0 place-items-center border', multiple ? 'rounded' : 'rounded-full', selected ? 'border-ac bg-ac text-acx' : 'border-mu/60')}>
                  {selected && <Check size={11} strokeWidth={3} />}
                </span>
                <span className="min-w-0">{option.label}</span>
              </button>
              {(option.fillBlank || option.prompt) && selected && (
                <div className="px-3 pb-2.5">
                  <Input
                    value={answer.text}
                    disabled={disabled}
                    autoFocus
                    set={(v) => onChange(qi, { text: v })}
                    onKeyDown={(e) => e.stopPropagation()}
                    placeholder={option.placeholder ?? option.prompt ?? `Type your answer${option.label.toLowerCase() === 'other' ? '' : ` for ${option.label.toLowerCase()}`}`}
                    aria-label={option.prompt ?? `Your answer for ${option.label}`}
                    size="xs"
                    tone="bg"
                    className="border border-bor"
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Question({ q, qi, answer, disabled, onChange }: {
  q: PollQuestion
  qi: number
  answer: PollAnswers[number]
  disabled: boolean
  onChange: AnswerChange
}) {
  if (q.type === 'choice') return <ChoiceQuestion q={q} qi={qi} answer={answer} disabled={disabled} onChange={onChange} />
  const id = `poll-${qi}`
  if (q.type === 'slider') {
    const { min, max, step } = pollLimits(q)
    const shown = Number(answer.number)
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={id} className="text-sm font-medium">{q.label}</label>
          <output htmlFor={id} className="rounded-md bg-bg px-2 py-0.5 text-sm text-mu">{answer.number}</output>
        </div>
        <RangeSlider
          id={id}
          label={q.label}
          min={min}
          max={max}
          step={step}
          value={Number.isFinite(shown) ? shown : min}
          valueText={String(Number.isFinite(shown) ? shown : min)}
          set={(n) => onChange(qi, { number: String(n) })}
          disabled={disabled}
          className="w-full"
        />
      </div>
    )
  }
  const numeric = q.type === 'number'
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium">{q.label}</label>
      {q.multiline && !numeric ? (
        <Area
          id={id}
          rows={3}
          value={answer.text}
          disabled={disabled}
          set={(v) => onChange(qi, { text: v })}
          placeholder={q.placeholder}
          tone="bg"
          className="border border-bor"
        />
      ) : (
        <Input
          id={id}
          type={numeric ? 'number' : 'text'}
          value={numeric ? answer.number : answer.text}
          disabled={disabled}
          min={numeric ? q.min : undefined}
          max={numeric ? q.max : undefined}
          step={numeric ? q.step : undefined}
          set={(v) => onChange(qi, numeric ? { number: v } : { text: v })}
          placeholder={q.placeholder}
          tone="bg"
          className="border border-bor"
        />
      )}
    </div>
  )
}

function PollCard({ call, busy, used, onSend }: {
  call: ToolCall
  busy: boolean
  used: boolean
  onSend: (key: string, text: string) => void
}) {
  const questions = useMemo(() => normalizePoll(parseArgs(call.arguments)), [call.arguments])
  const [answers, setAnswers] = useState<PollAnswers>(() => initialPollAnswers(questions))
  const answer = useMemo(() => pollAnswerText(questions, answers), [questions, answers])
  const update: AnswerChange = (index, patch) => setAnswers((prev) => ({ ...prev, [index]: { ...answerFor(prev, index), ...patch } }))
  if (!questions.length) return null
  const answered = questions.filter((q, i) => pollQuestionAnswered(q, answers[i])).length
  const disabled = busy || used
  return (
    <section aria-label="Quick questions" className="w-full max-w-xl space-y-4 rounded-xl border border-bor bg-surf p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-mu">
        <ListChecks size={14} className="text-ac" aria-hidden="true" />
        {questions.length > 1 ? `${questions.length} quick questions` : 'Quick question'}
      </div>
      {questions.map((q, qi) => (
        <Question key={`${qi}:${q.label}`} q={q} qi={qi} answer={answerFor(answers, qi)} disabled={disabled} onChange={update} />
      ))}
      <div className="flex items-center justify-between gap-3 border-t border-bor pt-3">
        <span aria-live="polite" className="text-xs text-mu">
          {used ? 'Sent' : answered ? `${answered} of ${questions.length} answered` : 'Choose or type an answer'}
        </span>
        <Btn v="solid" disabled={!answer.trim() || disabled} onClick={() => onSend(call.id, answer)}>Continue</Btn>
      </div>
    </section>
  )
}

/** Follow-up chips and inline polls attached to an assistant reply. */
export function MessageActions({ calls }: { calls: ToolCall[] }) {
  const busy = useS((s) => s.busyChats?.[s.chat] === true)
  const [used, setUsed] = useState<Record<string, boolean>>({})
  const actions = calls.filter((call) => !call.error && (call.name === 'prompt_chip' || call.name === 'inline_poll'))
  if (!actions.length) return null

  const run = async (key: string, text: string) => {
    if (!text.trim() || busy) return
    if (await useS.getState().send(text, [])) setUsed((v) => ({ ...v, [key]: true }))
  }

  const chips = actions.filter((call) => call.name === 'prompt_chip')
  const polls = actions.filter((call) => call.name === 'inline_poll')
  return (
    <div className="space-y-3 pt-1">
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((call) => {
            const args = parseArgs(call.arguments)
            const label = typeof args.label === 'string' && args.label.trim() ? args.label : 'Continue'
            const prompt = typeof args.prompt === 'string' ? args.prompt : label
            return (
              <button
                key={call.id}
                disabled={busy || used[call.id]}
                onClick={() => { void run(call.id, prompt) }}
                className="inline-flex min-h-9 items-center gap-2 rounded-full border border-bor bg-surf px-3 py-1.5 text-sm text-tx transition-colors hover:bg-hov focus-visible:ring-2 focus-visible:ring-ac disabled:opacity-50"
              >
                <CornerDownLeft size={14} className="text-ac" aria-hidden="true" />{label}
              </button>
            )
          })}
        </div>
      )}
      {polls.map((call) => (
        <PollCard key={call.id} call={call} busy={busy} used={!!used[call.id]} onSend={(key, text) => { void run(key, text) }} />
      ))}
    </div>
  )
}
