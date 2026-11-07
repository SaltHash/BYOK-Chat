import { Component, type ErrorInfo, type ReactNode } from 'react'

/* A render error in one panel must not leave a blank page with no way back.
 * The boundary is deliberately dependency-free (native buttons, no store or
 * UI imports): the component that failed may be the store shell itself. Saved
 * data is untouched, so the recovery path is reload first, backup second. */
type State = { error: Error | null }

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the details in the console for a bug report; nothing is uploaded.
    console.error('[byok] render failed', error, info.componentStack)
  }

  render(): ReactNode {
    const error = this.state.error
    if (!error) return this.props.children
    const details = `${error.name}: ${error.message}\n${error.stack ?? ''}`
    return (
      <div role="alert" className="grid min-h-dvh place-items-center bg-bg p-6 text-tx">
        <div className="w-full max-w-lg space-y-4 rounded-2xl border border-bor bg-surf p-6">
          <h1 className="text-lg font-semibold">The conversation view could not render</h1>
          <p className="text-sm leading-6 text-mu">
            Saved chats and settings are still in this browser. Reload to try again. If this keeps happening,
            export a backup from Settings → Data controls before clearing browser storage.
          </p>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-bg p-3 font-mono text-xs text-er">{details}</pre>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => window.location.reload()} className="inline-flex h-9 items-center rounded-lg bg-ac px-3 text-sm font-medium text-acx hover:opacity-90">
              Reload
            </button>
            <button
              type="button"
              onClick={() => { void navigator.clipboard?.writeText(details).catch(() => {}) }}
              className="inline-flex h-9 items-center rounded-lg bg-hov px-3 text-sm font-medium hover:opacity-80"
            >
              Copy details
            </button>
          </div>
        </div>
      </div>
    )
  }
}
