import { create } from 'zustand'

/** How much freedom the model has to call its enabled tools.
 *
 *  full       — enabled tools run without asking.
 *  standard   — only tools marked "Require approval" ask.
 *  restricted — every enabled tool call asks.
 *  off        — no tool schemas are offered and no call can run.
 */
export type ToolMode = 'full' | 'standard' | 'restricted' | 'off'

export const DEFAULT_TOOL_MODE: ToolMode = 'standard'

/** Side-effecting or private tools ask by default, so Standard access is useful
 *  without any per-tool setup. Full access ignores these switches. */
export const DEFAULT_TOOL_APPROVAL: Record<string, boolean> = {
  location: true,
  clipboard: true,
  workspace_upsert: true,
  run_code: true,
  generate_image: true,
  memory: true,
}

export const TOOL_MODES: { id: ToolMode; label: string; short: string; description: string }[] = [
  { id: 'full', label: 'Full access', short: 'Full', description: 'Enabled tools run without asking. This is the original behaviour.' },
  { id: 'standard', label: 'Standard', short: 'Standard', description: 'Only tools marked Require approval pause for your permission.' },
  { id: 'restricted', label: 'Restricted', short: 'Restricted', description: 'Every tool call pauses for permission, including MCP and hidden capabilities.' },
  { id: 'off', label: 'Disabled', short: 'Off', description: 'No tool is offered to the model, and any in-flight call is refused.' },
]

export const modeInfo = (mode: unknown) =>
  TOOL_MODES.find((m) => m.id === mode) ?? TOOL_MODES[0]

export function normToolMode(value: unknown): ToolMode {
  return TOOL_MODES.some((m) => m.id === value) ? value as ToolMode : DEFAULT_TOOL_MODE
}

/** Keep only explicit true flags, so an imported or older store cannot make a
 *  tool ask because of a truthy string or object. */
export function normToolApproval(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, boolean> = {}
  for (const [name, on] of Object.entries(value as Record<string, unknown>)) if (on === true) out[name] = true
  return out
}

/** The one policy decision shared by the composer, Settings and the engine. */
export function needsToolApproval(mode: unknown, approvals: Record<string, boolean> | undefined, name: string): boolean {
  const m = normToolMode(mode)
  if (m === 'restricted') return true
  if (m === 'standard') return approvals?.[name] === true
  return false
}

/** Tools offered to the provider. Disabled mode removes every schema, not just
 *  the per-tool switches, so the model cannot plan around a tool it cannot run. */
export function effectiveTools(tools: Record<string, boolean>, mode: unknown): Record<string, boolean> {
  return normToolMode(mode) === 'off' ? {} : tools
}

export type ApprovalRequest = {
  id: string
  chatId: string
  name: string
  /** Raw JSON arguments, clipped for the card (the engine still sees the full
   *  call). */
  args: string
  at: number
}

type Waiter = { allow: () => void; deny: () => void }

const waiters = new Map<string, Waiter>()

/** Session-only queue. It is deliberately not part of the persisted store: a
 *  reload must not resurrect a permission prompt for a reply that is gone. */
export const useApprovals = create<{ queue: ApprovalRequest[] }>()(() => ({ queue: [] }))

const approvalId = () => globalThis.crypto?.randomUUID?.() ?? `approval-${Date.now()}-${Math.random().toString(36).slice(2)}`

const abortError = (): Error => {
  try { return new DOMException('The reply was stopped.', 'AbortError') } catch { return Object.assign(new Error('The reply was stopped.'), { name: 'AbortError' }) }
}

/** Ask the user and wait for a decision. The abort signal is the reply's own
 *  controller, so Stop clears the card and unwinds the await without leaving a
 *  dangling promise. */
export function requestToolApproval(req: { chatId: string; name: string; args: string }, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.reject(abortError())
  const id = approvalId()
  return new Promise<boolean>((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      waiters.delete(id)
      useApprovals.setState((s) => ({ queue: s.queue.filter((x) => x.id !== id) }))
      fn()
    }
    const onAbort = () => finish(() => reject(abortError()))
    waiters.set(id, {
      allow: () => finish(() => resolve(true)),
      deny: () => finish(() => resolve(false)),
    })
    signal?.addEventListener('abort', onAbort, { once: true })
    useApprovals.setState((s) => ({
      queue: [...s.queue, {
        id,
        chatId: req.chatId,
        name: req.name,
        args: String(req.args ?? '').slice(0, 1600),
        at: Date.now(),
      }],
    }))
  })
}

/** Resolve one visible request. Returns false when it was already settled (for
 *  example by Stop or by another tab of the same card). */
export function decideToolApproval(id: string, allow: boolean): boolean {
  const waiter = waiters.get(id)
  if (!waiter) return false
  if (allow) waiter.allow()
  else waiter.deny()
  return true
}

/** Refuse every pending request for a chat, e.g. when that chat is deleted. */
export function cancelToolApprovals(chatId: string): void {
  for (const req of [...useApprovals.getState().queue]) {
    if (req.chatId === chatId) decideToolApproval(req.id, false)
  }
}

/** Resolve the visible queue when the user changes access level. Full access
 *  grants what was already asked; Disabled refuses it. Standard and Restricted
 *  keep waiting for an explicit decision. */
export function settleToolApprovals(chatId: string, allow: boolean): void {
  for (const req of [...useApprovals.getState().queue]) {
    if (req.chatId === chatId) decideToolApproval(req.id, allow)
  }
}

/** Test/teardown helper; never called from the UI. */
export function resetToolApprovals(): void {
  for (const id of [...waiters.keys()]) decideToolApproval(id, false)
  useApprovals.setState({ queue: [] })
}
