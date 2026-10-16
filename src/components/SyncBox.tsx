import { useEffect, useState } from 'react'
import { RefreshCw, Link2, Unlink, Copy, Check, ShieldCheck } from 'lucide-react'
import { useS } from '../store'
import { generateSyncToken, parseSyncToken, buildSyncPayload, checkSyncCompat } from '../storage/sync'
import { syncPush, syncPull, syncStatus } from '../storage/syncClient'
import { durableGetChats, durableGetWorkspaces, stripEphemeralFromChats } from '../storage/durable'
import { encryptBackup, decryptBackup, isEncryptedBackup } from '../storage/backupCrypto'
import { Btn, Input } from './ui'

const TOKEN_KEY = 'byok.sync.token'
const LAST_KEY = 'byok.sync.last'

export const getSyncToken = (): string => { try { return localStorage.getItem(TOKEN_KEY) ?? '' } catch { return '' } }
export const setSyncToken = (t: string) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY) } catch {} }

export function SyncBox() {
  const [token, setToken] = useState(getSyncToken())
  const [input, setInput] = useState('')
  const [auto, setAuto] = useState(() => { try { return localStorage.getItem('byok.sync.auto') === '1' } catch { return false } })
  const [status, setStatus] = useState('')
  const [backend, setBackend] = useState('…')
  const [copied, setCopied] = useState(false)
  useEffect(() => { void syncStatus().then((s) => setBackend(`${s.backend}${s.configured ? ' (Neon)' : ' (memory)'}`)).catch(() => setBackend('unreachable')) }, [])
  useEffect(() => { try { localStorage.setItem('byok.sync.auto', auto ? '1' : '0') } catch {} }, [auto])

  const collect = async () => {
    const s = useS.getState()
    const dChats = await durableGetChats().catch(() => null)
    const dWs = await durableGetWorkspaces().catch(() => null)
    const { chats: _c, workspaces: _w, selectedRevision: _sr, ...settings } = s as unknown as Record<string, unknown>
    void _c; void _w; void _sr
    return buildSyncPayload({ storeVersion: 18, settings, chats: stripEphemeralFromChats((dChats ?? s.chats) as { msgs?: Array<Record<string, unknown>> }[]), workspaces: dWs ?? s.workspaces, selectedRevision: (s as unknown as { selectedRevision: unknown }).selectedRevision })
  }

  const push = async () => {
    if (!token) { setStatus('Generate or paste a token first.'); return }
    try {
      setStatus('Pushing…')
      const payload = await collect()
      const r = await syncPush(token, payload)
      try { localStorage.setItem(LAST_KEY, String(r.updatedAt)) } catch {}
      setStatus(`Pushed ${new Date(r.updatedAt).toLocaleTimeString()} via ${r.backend}.`)
    } catch (e) { setStatus(`Push failed: ${(e as Error).message}`) }
  }
  const pull = async () => {
    if (!token) { setStatus('Paste the token from your other device first.'); return }
    try {
      setStatus('Pulling…')
      const r = await syncPull(token)
      const { warning } = checkSyncCompat({ v: r.exportVersion ?? r.payload.v, storeVersion: r.storeVersion ?? r.payload.storeVersion }, 18)
      const p = r.payload
      useS.setState({ ...(p.settings as object), chats: stripEphemeralFromChats(p.chats as { msgs?: Array<Record<string, unknown>> }[]) as unknown as never, workspaces: p.workspaces as unknown as never, selectedRevision: p.selectedRevision as unknown as never } as unknown as Parameters<typeof useS.setState>[0])
      try { localStorage.setItem(LAST_KEY, String(r.updatedAt)) } catch {}
      setStatus(warning ? `Pulled with warning: ${warning}` : `Pulled ${new Date(r.updatedAt).toLocaleTimeString()} via ${r.backend}.`)
    } catch (e) { setStatus(`Pull failed: ${(e as Error).message}`) }
  }
  return (
    <div className="space-y-3 rounded-xl bg-surf p-4">
      <div className="flex items-center gap-2 text-sm font-medium"><Link2 size={16} className="text-ac" /> Device sync <span className="text-xs font-normal text-mu">server: {backend}</span></div>
      <p className="text-xs text-mu">Generate one super-long token on device A, paste it on device B. Both devices then push/pull the same slot. Payloads are versioned; newer fields are ignored by older apps. The database stores payloads unencrypted; anyone with the token has full read/write.</p>
      {!token ? (
        <div className="flex flex-wrap gap-2">
          <Btn v="solid" icon={Link2} onClick={() => { const t = generateSyncToken(); setToken(t); setSyncToken(t); setStatus('Token generated. Copy it to your other device, then Push.') }}>Generate sync token</Btn>
          <div className="flex min-w-64 flex-1 gap-2">
            <Input value={input} set={setInput} placeholder="Paste token from other device (byok1-…)" />
            <Btn v="soft" onClick={() => { try { parseSyncToken(input); setToken(input.trim()); setSyncToken(input.trim()); setStatus('Token saved. Pull to fetch, or Push to overwrite.') } catch (e) { setStatus((e as Error).message) } }}>Link</Btn>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 rounded-lg bg-bg p-2 font-mono text-xs"><span className="min-w-0 flex-1 truncate">{token}</span>
            <Btn sm icon={copied ? Check : Copy} title="Copy token" onClick={() => { void navigator.clipboard?.writeText(token).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1200) }} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Btn v="solid" icon={RefreshCw} onClick={push}>Push now</Btn>
            <Btn v="soft" icon={RefreshCw} onClick={pull}>Pull now</Btn>
            <Btn v="soft" icon={Unlink} onClick={() => { setToken(''); setSyncToken(''); setStatus('Unlinked on this device. The server slot is kept.') }}>Unlink</Btn>
            <label className="flex items-center gap-2 text-xs text-mu"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-push after each reply</label>
          </div>
        </div>
      )}
      {status && <p className="text-xs text-mu">{status}</p>}
    </div>
  )
}

export function EncryptedBackupBox({ buildJson }: { buildJson: () => string }) {
  const [pw, setPw] = useState('')
  const [msg, setMsg] = useState('')
  return (
    <div className="space-y-3 rounded-xl bg-surf p-4">
      <div className="flex items-center gap-2 text-sm font-medium"><ShieldCheck size={16} className="text-ac" /> Encrypted backup (optional password)</div>
      <p className="text-xs text-mu">AES-GCM-256 with PBKDF2-SHA256 (250k iterations). Without a password the export is plain JSON.</p>
      <div className="flex flex-wrap gap-2">
        <Input type="password" value={pw} set={setPw} placeholder="Backup password (optional)" />
        <Btn v="soft" onClick={() => {
          const json = buildJson()
          if (!pw) {
            const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' })); a.download = 'chat-config.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 999)
            return
          }
          void encryptBackup(json, pw).then((enc) => {
            const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([enc], { type: 'application/json' })); a.download = 'chat-config.encrypted.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 999)
            setMsg('Exported encrypted backup.')
          }).catch((e) => setMsg((e as Error).message))
        }}>Export backup</Btn>
        <label className="inline-flex h-9 cursor-pointer items-center rounded-lg bg-hov px-3 text-sm font-medium hover:opacity-80">
          <input type="file" accept=".json,application/json" hidden onChange={async (e) => {
            const f = e.target.files?.[0]; e.target.value = ''
            if (!f) return
            try {
              let text = await f.text()
              if (isEncryptedBackup(text)) text = await decryptBackup(text, pw)
              const j = JSON.parse(text)
              window.dispatchEvent(new CustomEvent('byok:import-backup', { detail: j }))
              setMsg('Backup loaded. Use Import below to apply it.')
            } catch (err) { setMsg(`Import failed: ${(err as Error).message}`) }
          }} />Import backup file
        </label>
      </div>
      {msg && <p className="text-xs text-mu">{msg}</p>}
      <p className="text-xs text-mu">Encryption is per-export via the password field. Leave it empty for plain JSON.</p>
    </div>
  )
}
