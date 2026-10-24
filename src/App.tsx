import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useS, exportChat, featOn } from './store'
import { combo, rec } from './engine'
import { clampSidebarWidth, clampWidgetWidth } from './layout'
import { canUseDOM, useThemeCss, useStyleCss, useVisualPrefs, usePanelResize } from './hooks'
import { useFontCss, sanitizeFontName } from './fonts'
import { nextThemePatch, stepModelSelection, stepPromptSelection } from './selection'
import { Sidebar } from './components/Sidebar'
import { Chat } from './components/Chat'
import { Settings } from './components/Settings'
import { Palette } from './components/Palette'
import { Widgets } from './components/Widgets'
import { Welcome } from './components/Welcome'
import { ShareView } from './components/ShareView'
import { shareIdFromHash, shareHash, updateShare } from './share'

export default function App() {
  const { themeMode, themeDark, themeLight, customDarkColors, customLightColors, rail, widgets, prefs, setupDone, features } = useS(useShallow((s) => ({
    themeMode: s.themeMode, themeDark: s.themeDark, themeLight: s.themeLight,
    customDarkColors: s.customDarkColors, customLightColors: s.customLightColors,
    rail: s.rail, widgets: s.widgets, prefs: s.prefs, setupDone: s.setupDone, features: s.features,
  })))
  const [side, setSide] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1024) >= 768)
  const [cfg, setCfg] = useState('')
  const [pal, setPal] = useState(false)
  const [shareId, setShareId] = useState(() => (canUseDOM() ? shareIdFromHash(window.location.hash) : ''))
  useEffect(() => {
    if (!canUseDOM()) return
    const openRoute = () => {
      // A share link replaces the whole shell with the read-only view.
      const share = shareIdFromHash(window.location.hash)
      setShareId(share)
      if (share) return
      const route = window.location.hash.replace(/^#\/?/, '')
      if (route === 'chat') { setCfg(''); return }
      const match = route.match(/^settings(?:\/([^#]+))?(?:#(.+))?$/)
      if (match) setCfg(match[2] ? `${match[1] || 'eps'}#${match[2]}` : (match[1] || 'eps'))
    }
    openRoute()
    window.addEventListener('hashchange', openRoute)
    return () => window.removeEventListener('hashchange', openRoute)
  }, [])
  useEffect(() => {
    if (!canUseDOM() || shareId) return
    const hash = cfg ? `#settings/${cfg}` : '#chat'
    if (window.location.hash !== hash) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`)
  }, [cfg, shareId])
  const resize = usePanelResize()
  // Reduced transparency removes the modal blur entirely rather than dimming
  // it, so the overlay switch (below) is the single source of the flat look.
  useThemeCss({ themeMode, themeDark, themeLight, customDarkColors, customLightColors, modalBlur: prefs.reduceTransparency ? 0 : prefs.modalBlur ?? 12 })
  useFontCss(prefs.fontBody, prefs.fontHeader, prefs.fontMono)
  useStyleCss(prefs.stylePreset, prefs.density, prefs.uiSpacing)
  useVisualPrefs(prefs.textScale, prefs.codeWrap, prefs.reduceTransparency, prefs.highContrast)
  useEffect(() => {
    if (!canUseDOM()) return
    const purge = () => {
      const s = useS.getState(), now = Date.now()
      const expired = s.chats.filter(c => c.temporary && ((s.prefs.tempHours === 0 && c.id !== s.chat) || (c.expiresAt != null && c.expiresAt <= now)))
      if (expired.length) {
        const ids = new Set(expired.map(c => c.id)), chats = s.chats.filter(c => !ids.has(c.id))
        s.patch({ chats, chat: ids.has(s.chat) ? chats[0]?.id ?? '' : s.chat })
      }
    }
    purge()
    const timer = setInterval(purge, 15000)
    const leave = () => {
      const s = useS.getState()
      if (s.prefs.tempHours === 0) {
        const chats = s.chats.filter(c => !c.temporary)
        s.patch({ chats, chat: s.chats.find(c => c.id === s.chat)?.temporary ? chats[0]?.id ?? '' : s.chat })
      }
    }
    window.addEventListener('pagehide', leave)
    return () => { clearInterval(timer); window.removeEventListener('pagehide', leave) }
  }, [])
  // Where to open on load. Applied on mount and again once durable storage has
  // hydrated (which can replace the chat list moments later); both passes are
  // idempotent, so a wiped empty chat is simply recreated.
  useEffect(() => {
    if (!canUseDOM()) return
    const apply = () => {
      const st = useS.getState()
      const mode = st.prefs.startup ?? 'recent'
      if (mode === 'new' || mode === 'temporary') { st.newChat(mode === 'temporary'); return }
      const pick = mode === 'permanent' ? st.chats.find((c) => !c.temporary) : st.chats[0]
      if (pick && st.chat !== pick.id) st.patch({ chat: pick.id })
    }
    apply()
    window.addEventListener('byok:ready', apply)
    return () => window.removeEventListener('byok:ready', apply)
  }, [])
  // Auto-updating shares: when a chat with `auto` set changes, refresh its
  // snapshot (debounced). Best-effort; a failure keeps the old hash so the next
  // change retries.
  useEffect(() => {
    if (!canUseDOM()) return
    let timer: ReturnType<typeof setTimeout> | null = null
    let running = false
    const run = async () => {
      if (running) return
      running = true
      try {
        for (const rec of useS.getState().shares.filter((s) => s.auto)) {
          const chat = useS.getState().chats.find((c) => c.id === rec.chatId)
          if (!chat) continue
          const hash = shareHash(chat)
          if (!hash || hash === rec.hash) continue
          try {
            await updateShare(rec.id, rec.token, chat, { private: rec.private })
            useS.getState().patch({ shares: useS.getState().shares.map((x) => (x.id === rec.id ? { ...x, hash } : x)) })
          } catch { /* keep the old hash so a later change retries */ }
        }
      } finally { running = false }
    }
    const unsub = useS.subscribe((s, prev) => {
      if (s.chats === prev.chats || !s.shares.some((x) => x.auto)) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { timer = null; void run() }, 1500)
    })
    return () => { unsub(); if (timer) clearTimeout(timer) }
  }, [])
  useEffect(() => {
    if (!canUseDOM()) return
    const f = (e: BeforeUnloadEvent) => { if (useS.getState().busy) e.preventDefault() }
    window.addEventListener('beforeunload', f)
    return () => window.removeEventListener('beforeunload', f)
  }, [])
  // Opt-in local backups run lazily (boot and returning to the tab), not on a
  // timer: the snapshot is only useful once a day and never worth blocking a
  // keystroke for.
  useEffect(() => {
    if (!canUseDOM()) return
    const run = () => { void import('./storage/localBackup').then(({ maybeRunDailyBackup }) => maybeRunDailyBackup()).catch(() => {}) }
    const boot = setTimeout(run, 5000)
    const visibility = () => { if (document.visibilityState === 'visible') run() }
    document.addEventListener('visibilitychange', visibility)
    return () => { clearTimeout(boot); document.removeEventListener('visibilitychange', visibility) }
  }, [])
  useEffect(() => {
    if (!canUseDOM()) return
    const f = (e: KeyboardEvent) => {
      if (rec.on) return
      const st = useS.getState()
      if (!featOn(st, 'shortcuts')) return
      const c = combo(e); if (!c) return
      const s = st, a = Object.entries(s.keys).find(([, v]) => v === c)?.[0]
      if (!a) return
      e.preventDefault()
      if (a === 'palette') setPal((v) => !v)
      else if (a === 'newChat') s.newChat()
      else if (a === 'sidebar') setSide((v) => !v)
      else if (a === 'settings') setCfg((v) => (v ? '' : 'eps'))
      else if (a === 'focus') document.getElementById('composer')?.focus()
      else if (a === 'stop') s.stop()
      else if (a === 'regen') s.regen()
      else if (a === 'widgets') { if (!featOn(s, 'widgets')) setCfg('features'); else if (Object.values(s.widgets).some(Boolean)) s.patch({ rail: !s.rail }); else setCfg('widgets') }
      else if (a === 'theme') s.patch(nextThemePatch(useS.getState()))
      else if (a === 'export') exportChat()
      else if (a === 'nextModel' || a === 'prevModel') {
        const next = stepModelSelection(s.eps, s.sel, a === 'nextModel' ? 1 : -1)
        if (next) s.patch({ sel: next })
      }
      else if (a === 'nextPrompt') {
        if (!featOn(s, 'prompts')) return
        s.patch({ pr: stepPromptSelection(s.prompts, s.pr) })
      }
      else if (a === 'tempChat') s.newChat(true)
    }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [])
  if (shareId) return <ShareView id={shareId} />
  return (
    <div className="flex h-dvh overflow-hidden">
      {side && <div className="fixed inset-0 z-10 bg-black/50 md:hidden" onClick={() => setSide(false)} />}
      <Sidebar open={side} toggle={() => setSide((v) => !v)} cfg={setCfg} width={clampSidebarWidth(prefs.sidebarWidth)} />
      {side && <div role="separator" aria-orientation="vertical" aria-label="Resize sidebar" onPointerDown={resize('sidebarWidth')} className="hidden w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-ac/50 md:block" />}
      <Chat side={side} toggle={() => setSide(true)} cfg={setCfg} pal={() => setPal(true)} />
      {rail && featOn({ features }, 'widgets') && Object.values(widgets).some(Boolean) && (
        <>
          <div className="fixed inset-0 z-10 bg-black/50 lg:hidden" onClick={() => useS.getState().patch({ rail: false })} />
          <div role="separator" aria-orientation="vertical" aria-label="Resize widget panel" onPointerDown={resize('widgetWidth', true)} className="hidden w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-ac/50 lg:block" />
          <Widgets width={clampWidgetWidth(prefs.widgetWidth)} />
        </>
      )}
      {pal && <Palette close={() => setPal(false)} cfg={setCfg} toggleSide={() => setSide((v) => !v)} />}
      {cfg && <Settings tab={cfg} setTab={setCfg} />}
      {!setupDone && <Welcome addEndpoint={() => setCfg('eps')} close={() => {}} />}
    </div>
  )
}
export { sanitizeFontName }
