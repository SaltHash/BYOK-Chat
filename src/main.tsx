import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { useS } from './store'
import { hydrateDurable, mirrorToDurable } from './storage/boot'
import { startSyncRuntime, DEVICE_SYNC_ENABLED } from './storage/syncRuntime'
import { allowPersistWritesAfterBoot, persistStorage, withoutExpiredTemps } from './persistence'
import { setProxyMode } from './net'

// Keep the provider transport in step with the saved routing preference. The
// relay itself lives in net.ts so non-React modules (engine, adapters) can use
// it without importing the store.
setProxyMode(useS.getState().prefs.proxyMode)
useS.subscribe((s) => setProxyMode(s.prefs.proxyMode))

// Capture local data before rendering: startup effects can otherwise overwrite
// the sharded index while the durable migration is still reading it.
const initial = useS.getState()

// PWA shell service worker: production builds only, so hot reload in dev is
// never served from a stale cache. Model calls still need the network; this
// only keeps the app itself openable offline.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

// Hydrate before mounting or starting sync. This prevents a slow IndexedDB
// read from replacing edits or navigation made after the UI became interactive.
void hydrateDurable((p) => useS.setState(p as Parameters<typeof useS.setState>[0]), initial)
  .then(() => {
    // Discard any migration/recovery writes queued while the saved data was
    // being inspected; then persist the fully hydrated state instead.
    persistStorage.flush()
    allowPersistWritesAfterBoot()
    useS.setState({})
    // First run with permanent statistics: adopt the attempts already saved on
    // this device, so old chats keep counting even after they are deleted.
    useS.getState().seedUsageHistory()
    let prevChats: unknown = useS.getState().chats, prevWs: unknown = useS.getState().workspaces
    useS.subscribe((s) => {
      if (s.chats !== prevChats || s.workspaces !== prevWs) {
        prevChats = s.chats; prevWs = s.workspaces
        mirrorToDurable(withoutExpiredTemps(s.chats), s.workspaces)
      }
    })
    mirrorToDurable(withoutExpiredTemps(useS.getState().chats), useS.getState().workspaces)
    if (DEVICE_SYNC_ENABLED) startSyncRuntime()
    ;(window as Window & { __byokReady?: boolean }).__byokReady = true
    window.dispatchEvent(new Event('byok:ready'))
    createRoot(document.getElementById('root')!).render(<App />)
  })
  .catch(() => {
    // Do not mount a fresh empty store or start sync after failed recovery.
    const root = document.getElementById('root')!
    const message = document.createElement('p')
    message.setAttribute('role', 'alert')
    message.textContent = 'Could not restore local data. Reload to retry; do not clear browser storage.'
    root.replaceChildren(message)
  })
