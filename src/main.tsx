import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { useS } from './store'
import { hydrateDurable, mirrorToDurable } from './storage/boot'
import { startSyncRuntime } from './storage/syncRuntime'
import { withoutExpiredTemps } from './persistence'

createRoot(document.getElementById('root')!).render(<App />)

// Device sync background loops: pull + smart-merge on open, on focus and on a
// slow interval; push local changes automatically. A no-op without a token.
startSyncRuntime()

// Durable overflow: settings stay in localStorage; chats/workspaces mirror to
// IndexedDB/OPFS. Hydrate once (automatic in-place migration), then mirror.
void hydrateDurable((p) => useS.setState(p as Parameters<typeof useS.setState>[0])).catch(() => {})
let prevChats: unknown = null, prevWs: unknown = null
useS.subscribe((s) => {
  if (s.chats !== prevChats || s.workspaces !== prevWs) {
    prevChats = s.chats; prevWs = s.workspaces
    mirrorToDurable(withoutExpiredTemps(s.chats), s.workspaces)
  }
})
