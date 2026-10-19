import { useEffect, useState } from 'react'
import { RefreshCw, Link2, Unlink, Copy, Check, GitMerge, CloudUpload, CloudDownload } from 'lucide-react'
import { generateSyncToken, parseSyncToken, maskSyncToken } from '../storage/sync'
import { syncStatus } from '../storage/syncClient'
import type { SyncData, SyncMergeMode } from '../storage/syncMerge'
import {
  getSyncToken, setSyncToken, getAutoSync, setAutoSync, getLastSync,
  fetchRemote, pushNow, pullAndMerge, linkAndMerge, startSyncRuntime,
} from '../storage/syncRuntime'
import { Btn, Checkbox, HelpTip, Input, Modal } from './ui'

const LINK_LABEL: Record<SyncMergeMode, string> = { merge: 'Merge both devices', remote: 'Use the other device', local: 'Use this device' }

export function SyncBox() {
  const [token, setToken] = useState(getSyncToken())
  const [input, setInput] = useState('')
  const [auto, setAuto] = useState(getAutoSync())
  const [status, setStatus] = useState('')
  const [backend, setBackend] = useState('…')
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  // A pasted token whose remote data is fetched and awaiting a merge choice.
  const [linked, setLinked] = useState<{ token: string; data: SyncData; updatedAt: number } | null>(null)
  useEffect(() => { void syncStatus().then((s) => setBackend(`${s.backend}${s.configured ? ' (Neon)' : ' (memory)'}`)).catch(() => setBackend('unreachable')) }, [])
  useEffect(() => { setAutoSync(auto) }, [auto])
  const last = getLastSync()

  const generate = () => {
    const t = generateSyncToken()
    setSyncToken(t); setAutoSync(true); setToken(t); setAuto(true); startSyncRuntime()
    setBusy(true); setStatus('Generating, encrypting and pushing this device…')
    void pushNow(t).then((r) => setStatus(`Token created and this device pushed at ${new Date(r.updatedAt).toLocaleTimeString()}. Copy it to your other device.`))
      .catch((e) => setStatus(`Token created, but the first push failed: ${(e as Error).message}`))
      .finally(() => setBusy(false))
  }

  const link = () => {
    let t: string
    try { parseSyncToken(input); t = input.trim() } catch (e) { setStatus((e as Error).message); return }
    setBusy(true); setStatus('Fetching the other device’s data…')
    void fetchRemote(t)
      .then(({ data, updatedAt }) => { setLinked({ token: t, data, updatedAt }) })
      .catch((e) => {
        const msg = String((e as Error).message ?? '')
        // An empty slot means the other device has not pushed yet: link and
        // seed it from here rather than blocking on a merge choice.
        if (/empty/i.test(msg)) {
          setSyncToken(t); setAutoSync(true); setToken(t); setAuto(true); startSyncRuntime()
          return pushNow(t).then((r) => setStatus(`Linked. This device seeded the slot at ${new Date(r.updatedAt).toLocaleTimeString()}.`))
        }
        setStatus(`Link failed: ${msg}`)
      })
      .finally(() => setBusy(false))
  }

  const applyMode = (mode: SyncMergeMode) => {
    if (!linked) return
    const { token: t, data } = linked
    setBusy(true); setStatus(`${LINK_LABEL[mode]}…`)
    void linkAndMerge(t, mode, data)
      .then((r) => {
        setSyncToken(t); setAutoSync(true); setToken(t); setAuto(true); startSyncRuntime(); setLinked(null)
        setStatus(`Linked and merged at ${new Date(r.updatedAt).toLocaleTimeString()} via ${r.backend}. Automatic sync is on.`)
      })
      .catch((e) => setStatus(`Merge failed: ${(e as Error).message}`))
      .finally(() => setBusy(false))
  }

  const push = () => {
    if (!token) { setStatus('Generate or paste a token first.'); return }
    setBusy(true); setStatus('Encrypting and pushing…')
    void pushNow(token).then((r) => setStatus(`Pushed ${new Date(r.updatedAt).toLocaleTimeString()} via ${r.backend}.`))
      .catch((e) => setStatus(`Push failed: ${(e as Error).message}`)).finally(() => setBusy(false))
  }

  const pull = () => {
    if (!token) { setStatus('Paste the token from your other device first.'); return }
    setBusy(true); setStatus('Pulling and merging…')
    void pullAndMerge(token).then((r) => setStatus(`Pulled and merged ${new Date(r.updatedAt).toLocaleTimeString()} via ${r.backend}.`))
      .catch((e) => setStatus(`Pull failed: ${(e as Error).message}`)).finally(() => setBusy(false))
  }

  return (
    <div className="space-y-3 rounded-xl bg-surf p-4">
      <div className="flex items-center gap-2 text-sm font-medium"><Link2 size={16} className="text-ac" /> Device sync <span className="text-xs font-normal text-mu">server: {backend}{last ? ` · last sync ${new Date(last).toLocaleTimeString()}` : ''}</span></div>
      <p className="text-xs text-mu">Generate one super-long token on device A, link it on device B. Sync then runs automatically: this device pulls and smart-merges when it opens, when you return to the tab, and every few minutes, and pushes your changes. Only someone with the token can read or change the synced data, so keep it private.</p>
      {!token ? (
        <div className="flex flex-wrap gap-2">
          <Btn v="solid" icon={Link2} disabled={busy} onClick={generate}>Generate sync token</Btn>
          <div className="flex min-w-0 flex-1 basis-full gap-2 sm:basis-auto sm:min-w-64">
            <Input value={input} set={setInput} placeholder="Paste token from other device (byok1-…)" />
            <Btn v="soft" disabled={busy || !input.trim()} onClick={link}>Link</Btn>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 rounded-lg bg-bg p-2 font-mono text-xs"><span className="min-w-0 flex-1 truncate" title="Masked for shoulder-surfing; Copy copies the full token">{maskSyncToken(token)}</span>
            <Btn sm icon={copied ? Check : Copy} title="Copy token" onClick={() => { const p = navigator.clipboard?.writeText(token); if (!p) return; void p.then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200) }).catch(() => {}) }} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!auto && (
              <>
                <Btn v="solid" icon={RefreshCw} disabled={busy} onClick={push}>Push now</Btn>
                <Btn v="soft" icon={RefreshCw} disabled={busy} onClick={pull}>Pull &amp; merge now</Btn>
              </>
            )}
            <Btn v="soft" icon={Unlink} disabled={busy} onClick={() => { setToken(''); setSyncToken(''); setAuto(false); setStatus('Unlinked on this device. The server slot is kept.') }}>Unlink</Btn>
            <Checkbox checked={auto} disabled={busy} set={(v) => { setAuto(v); startSyncRuntime() }} label="Automatic sync" className="text-mu" />
            <HelpTip label="About automatic sync" text="Pulls and smart-merges when this device opens, when the tab regains focus, and every few minutes, and pushes your changes in the background. Turn it off to sync only with the buttons." />
          </div>
        </div>
      )}
      {status && <p className="text-xs text-mu">{status}</p>}
      {linked && (
        <Modal close={() => setLinked(null)}>
          <section role="dialog" aria-modal="true" aria-labelledby="merge-title" className="w-full max-w-lg space-y-4 rounded-2xl border border-bor bg-bg p-5 shadow-2xl">
            <div>
              <h2 id="merge-title" className="text-lg font-semibold">You are linking a device</h2>
              <p className="mt-1 text-sm text-mu">Both devices already hold data. How should this device combine them? Chats and workspaces are de-duplicated either way, and folders with the same name become one folder.</p>
            </div>
            <div className="space-y-2">
              <button type="button" disabled={busy} onClick={() => applyMode('merge')} className="flex w-full items-start gap-3 rounded-xl bg-surf p-3 text-left hover:opacity-90 disabled:opacity-40">
                <GitMerge size={18} className="mt-0.5 shrink-0 text-ac" />
                <span><span className="block text-sm font-medium">Merge both devices <span className="text-xs font-normal text-ac">recommended</span></span><span className="block text-xs text-mu">Keep everything from both, remove duplicates, and combine same-named folders and workspaces.</span></span>
              </button>
              <button type="button" disabled={busy} onClick={() => applyMode('remote')} className="flex w-full items-start gap-3 rounded-xl bg-surf p-3 text-left hover:opacity-90 disabled:opacity-40">
                <CloudDownload size={18} className="mt-0.5 shrink-0 text-ac" />
                <span><span className="block text-sm font-medium">Take the other device’s data</span><span className="block text-xs text-mu">Replace this device’s chats, workspaces and settings with the other device’s copy.</span></span>
              </button>
              <button type="button" disabled={busy} onClick={() => applyMode('local')} className="flex w-full items-start gap-3 rounded-xl bg-surf p-3 text-left hover:opacity-90 disabled:opacity-40">
                <CloudUpload size={18} className="mt-0.5 shrink-0 text-ac" />
                <span><span className="block text-sm font-medium">Use this device’s data</span><span className="block text-xs text-mu">Keep this device as it is and overwrite the other device on the next sync.</span></span>
              </button>
            </div>
            <div className="flex justify-end"><Btn v="ghost" disabled={busy} onClick={() => setLinked(null)}>Cancel</Btn></div>
          </section>
        </Modal>
      )}
    </div>
  )
}

