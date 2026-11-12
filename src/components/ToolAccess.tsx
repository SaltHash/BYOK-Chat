import { useEffect, useState } from 'react'
import { Check, ListChecks, Lock, LockKeyhole, ShieldCheck, ShieldOff, X } from 'lucide-react'
import { featOn, useS, useSConfig } from '../store'
import { useQuestions } from '../questions'
import { TOOL_MODES, decideToolApproval, modeInfo, normToolMode, settleToolApprovals, useApprovals, type ToolMode } from '../toolApprovals'
import { toolLabel } from '../toolLabels'
import { Btn, Pop, Seg, cx, type Ic } from './ui'
import { Anchor } from './settingsPrimitives'

const MODE_ICONS: Record<ToolMode, Ic> = {
  full: ShieldCheck,
  standard: LockKeyhole,
  restricted: Lock,
  off: ShieldOff,
}

/** The lock in the composer: one click explains and changes the tool policy. */
export function ToolAccessButton({ cfg }: { cfg: (target: string) => void }) {
  const mode = normToolMode(useS((s) => s.toolMode))
  const features = useS((s) => s.features)
  const chatId = useS((s) => s.chat)
  const patch = useS((s) => s.patch)
  const info = modeInfo(mode)
  const Icon = MODE_ICONS[mode]
  const toolsOn = featOn({ features }, 'tools')
  return (
    <Pop
      up
      w="w-[23rem]"
      scroll={false}
      trigger={(open) => (
        <button
          type="button"
          aria-label={`Tool access: ${info.label}`}
          aria-haspopup="menu"
          aria-expanded={open}
          title={`Tool access: ${info.label}. ${info.description}`}
          className={cx('grid size-9 place-items-center rounded-full transition-colors', open ? 'bg-hov text-tx' : 'text-mu hover:bg-hov hover:text-tx')}
        >
          <Icon size={17} />
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="px-2.5 pb-1 pt-1.5">
            <div className="text-xs font-semibold uppercase tracking-wide text-mu">Tool access</div>
            <div className="mt-1 text-xs text-mu">The lock controls whether enabled tools can run without asking.</div>
          </div>
          {!toolsOn && (
            <button
              type="button"
              onClick={() => { close(); cfg('features#feature-tools') }}
              className="mx-1 mb-1 block w-[calc(100%-0.5rem)] rounded-lg bg-er/10 px-2.5 py-2 text-left text-xs text-er hover:bg-er/15"
            >
              The Tools feature is off. Turn it on in Features, or pick a mode below to enable it.
            </button>
          )}
          <div role="menu" aria-label="Tool access mode" className="space-y-0.5">
            {TOOL_MODES.map((m) => {
              const MIcon = MODE_ICONS[m.id]
              return (
                <button
                  key={m.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={mode === m.id}
                  onClick={() => {
                    patch({
                      toolMode: m.id,
                      ...(m.id === 'off' ? {} : { features: { ...features, tools: true } }),
                    })
                    if (m.id === 'off' || m.id === 'full') settleToolApprovals(chatId, m.id === 'full')
                    close()
                  }}
                  className={cx('flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-hov', mode === m.id && 'bg-hov')}
                >
                  <MIcon size={16} className={cx('mt-0.5 shrink-0', mode === m.id ? 'text-ac' : 'text-mu')} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      {m.label}
                      {mode === m.id && <Check size={14} className="text-ac" />}
                    </span>
                    <span className="mt-0.5 block text-xs leading-5 text-mu">{m.description}</span>
                  </span>
                </button>
              )
            })}
          </div>
          <button
            type="button"
            onClick={() => { close(); cfg('tools#tool-access') }}
            className="mx-1 mt-1 block w-[calc(100%-0.5rem)] rounded-lg border-t border-bor/60 px-2.5 py-2 text-left text-xs text-mu hover:bg-hov hover:text-tx"
          >
            Per-tool approval settings…
          </button>
        </>
      )}
    </Pop>
  )
}

/** Rendered above the composer whenever this chat is waiting on a decision. */
export function ToolApprovalPrompt({ chatId }: { chatId: string }) {
  const pending = useApprovals((s) => s.queue.find((a) => a.chatId === chatId))
  const mode = normToolMode(useS((s) => s.toolMode))
  if (!pending) return null
  const raw = pending.args.trim()
  let detail = raw || 'No arguments'
  try {
    const parsed = JSON.parse(raw || '{}')
    detail = Object.keys(parsed ?? {}).length ? JSON.stringify(parsed, null, 2) : 'No arguments'
  } catch { /* show the raw arguments if the model sent malformed JSON */ }
  if (detail.length > 700) detail = `${detail.slice(0, 700)}…`
  return (
    <section role="alert" aria-label="Tool approval required" className="mb-2 rounded-xl border border-ac/40 bg-surf p-3 shadow-sm">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-ac/15 text-ac"><LockKeyhole size={16} /></span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Approve {toolLabel(pending.name)}?</div>
          <p className="mt-0.5 text-xs leading-5 text-mu">This reply is paused. The tool has not run yet, and its result will go back to the model only if you allow it.</p>
          <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-bg p-2 font-mono text-xs text-tx">{detail}</pre>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <Btn v="solid" icon={Check} onClick={() => decideToolApproval(pending.id, true)}>Allow once</Btn>
            {mode === 'standard' && (
              <Btn v="soft" icon={ShieldCheck} onClick={() => { useS.getState().alwaysAllowTool(pending.name); decideToolApproval(pending.id, true) }}>Always allow {toolLabel(pending.name)}</Btn>
            )}
            <Btn v="soft" icon={X} onClick={() => decideToolApproval(pending.id, false)}>Deny</Btn>
            <span className="text-xs text-mu">Tip: change this in the lock menu or Settings → Tools.</span>
          </div>
        </div>
      </div>
    </section>
  )
}

/** Rendered above the composer while the model waits on a mid-turn question. */
export function QuestionPrompt({ chatId }: { chatId: string }) {
  const pending = useQuestions((s) => s.queue.find((q) => q.chatId === chatId))
  const answerQuestion = useS((s) => s.answerQuestion)
  const skipQuestion = useS((s) => s.skipQuestion)
  const [text, setText] = useState('')
  useEffect(() => { setText('') }, [pending?.id])
  if (!pending) return null
  const send = (value: string) => {
    const answer = value.trim()
    if (answer) answerQuestion(pending.id, answer)
  }
  return (
    <section role="group" aria-label="Question from the assistant" className="mb-2 rounded-xl border border-ac/40 bg-surf p-3 shadow-sm">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-ac/15 text-ac"><ListChecks size={16} /></span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">The assistant needs an answer</div>
          <p className="mt-0.5 text-xs leading-5 text-mu">The reply is paused mid-turn. Your answer goes straight back to the model, so it can keep working.</p>
          <p className="mt-2 text-sm">{pending.question}</p>
          {!!pending.options.length && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {pending.options.map((option) => (
                <button key={option} type="button" onClick={() => send(option)} className="rounded-full border border-bor bg-bg px-3 py-1.5 text-xs transition-colors hover:border-ac hover:text-ac">{option}</button>
              ))}
            </div>
          )}
          {pending.allowText !== false && (
            <div className="mt-2 flex gap-2">
              <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); send(text) } }} placeholder="Type your answer…" aria-label="Your answer" className="h-9 min-w-0 flex-1 rounded-lg bg-bg px-3 text-sm outline-none focus:ring-2 focus:ring-ac/40" />
              <Btn v="solid" onClick={() => send(text)}>Answer</Btn>
            </div>
          )}
          <div className="mt-2">
            <Btn v="soft" onClick={() => skipQuestion(pending.id)} title="Continue without answering; the model will state its assumption">Skip</Btn>
          </div>
        </div>
      </div>
    </section>
  )
}

/** Settings → Tools card, sharing the same mode vocabulary as the composer. */
export function ToolAccessCard() {
  const s = useSConfig()
  const chatId = useS((st) => st.chat)
  const mode = normToolMode(s.toolMode)
  const info = modeInfo(mode)
  const Icon = MODE_ICONS[mode]
  return (
    <Anchor id="tool-access">
      <div className="space-y-3 rounded-xl bg-surf p-3">
        <div className="flex items-center gap-2">
          <Icon size={16} className="shrink-0 text-ac" />
          <div className="min-w-0">
            <div className="text-sm font-medium">Tool access</div>
            <div className="text-xs text-mu">Composer lock · {info.label}</div>
          </div>
        </div>
        <p className="text-sm">{info.description}</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Seg label="Tool access mode" v={mode} set={(toolMode) => { s.patch({ toolMode, ...(toolMode === 'off' ? {} : { features: { ...s.features, tools: true } }) }); if (toolMode === 'off' || toolMode === 'full') settleToolApprovals(chatId, toolMode === 'full') }} opts={TOOL_MODES.map((m) => [m.id, m.short] as [ToolMode, string])} />
          <span className="text-xs text-mu">Same control as the lock in the composer.</span>
        </div>
        <p className="text-sm text-mu">
          Standard uses each tool's <span className="text-tx">Require approval</span> switch. Restricted asks for every call, including MCP and hidden capabilities. Disabled removes all tool schemas, so the model cannot plan around a call it cannot run.
        </p>
        {mode === 'off' && <p role="status" className="rounded-lg bg-er/10 px-3 py-2 text-xs text-er">No tool calls can run while access is Disabled. Per-tool switches are kept for when you re-enable access.</p>}
        {mode !== 'full' && <p className="text-xs text-mu">Deep research keeps its own approved plan and budget; this switch governs ordinary chat tool calls.</p>}
      </div>
    </Anchor>
  )
}
