import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { useS } from './store'
import { hydrateDurable, mirrorToDurable } from './storage/boot'
import { withoutExpiredTemps } from './persistence'

createRoot(document.getElementById('root')!).render(<App />)

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
