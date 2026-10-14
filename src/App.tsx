import { useEffect, useState, type PointerEvent } from 'react'
import { useS, THEMES, THEME_COLOR_KEYS, exportChat, modelsOf, featOn } from './store'
import { combo, rec } from './engine'
import { Sidebar } from './components/Sidebar'
import { Chat } from './components/Chat'
import { Settings } from './components/Settings'
import { Palette } from './components/Palette'
import { Widgets } from './components/Widgets'
import { Welcome } from './components/Welcome'

export default function App() {
  const { theme, customColors, rail, widgets, prefs, setupDone, features } = useS()
  const [side, setSide] = useState(() => innerWidth >= 768)
  const [cfg, setCfg] = useState('')
  const [pal, setPal] = useState(false)
  useEffect(() => {
    const openRoute = () => {
      const route = location.hash.replace(/^#\/?/, '')
      if (route === 'chat') { setCfg(''); return }
      const match = route.match(/^settings(?:\/([a-z]+))?$/)
      if (match) setCfg(match[1] || 'eps')
    }
    openRoute()
    addEventListener('hashchange', openRoute)
    return () => removeEventListener('hashchange', openRoute)
  }, [])
  useEffect(() => {
    const hash = cfg ? `#settings/${cfg}` : '#chat'
    if (location.hash !== hash) history.replaceState(null, '', `${location.pathname}${location.search}${hash}`)
  }, [cfg])
  const resize = (key: 'sidebarWidth' | 'widgetWidth', invert = false) => (e: PointerEvent) => {
    e.preventDefault()
    const x = e.clientX, start = useS.getState().prefs[key] ?? (key === 'sidebarWidth' ? 288 : 320)
    const move = (ev: PointerEvent) => { const delta = (ev.clientX - x) * (invert ? -1 : 1), value = Math.max(220, Math.min(520, start + delta)); const s = useS.getState(); s.patch({ prefs: { ...s.prefs, [key]: value } }) }
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up) }
    addEventListener('pointermove', move); addEventListener('pointerup', up, { once: true })
  }
  useEffect(() => {
    const root = document.documentElement
    root.dataset.t = theme
    root.style.setProperty('--modal-blur', `${prefs.modalBlur ?? 12}px`)
    for (const key of THEME_COLOR_KEYS) {
      if (theme === 'custom') root.style.setProperty(`--${key}`, customColors[key])
      else root.style.removeProperty(`--${key}`)
    }
    if (theme === 'custom') {
      const hex = customColors.bg.slice(1)
      const luminance = hex.length === 6 ? (parseInt(hex.slice(0, 2), 16) * 0.299 + parseInt(hex.slice(2, 4), 16) * 0.587 + parseInt(hex.slice(4, 6), 16) * 0.114) : 40
      root.style.colorScheme = luminance > 145 ? 'light' : 'dark'
    } else root.style.removeProperty('color-scheme')
  }, [theme, customColors, prefs.modalBlur])
  useEffect(() => {
    const family = (name: string | undefined, fallback: string) => {
      if (!name || name === 'system') return fallback
      const clean = name.replace(/["\\]/g, '').trim()
      // A font already present in the document's FontFaceSet does not need a
      // second request. Otherwise load it from Google Fonts (including custom names).
      const loaded = Array.from(document.fonts).some((face) => face.family.replace(/["']/g, '') === clean)
      if (!loaded) {
        const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(clean).replace(/%20/g, '+')}:wght@400;500;600;700&display=swap`
        const exists = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).some((link) => link.href === href)
        if (!exists) {
          const link = document.createElement('link')
          link.rel = 'stylesheet'
          link.href = href
          link.dataset.googleFont = clean
          document.head.append(link)
        }
      }
      return `"${clean}", ${fallback}`
    }
    document.documentElement.style.setProperty('--font-body', family(prefs.fontBody, 'ui-sans-serif, system-ui, sans-serif'))
    document.documentElement.style.setProperty('--font-heading', family(prefs.fontHeader, 'ui-sans-serif, system-ui, sans-serif'))
    document.documentElement.style.setProperty('--font-mono-custom', family(prefs.fontMono, 'ui-monospace, monospace'))
  }, [prefs.fontBody, prefs.fontHeader, prefs.fontMono])
  useEffect(() => {
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
    addEventListener('pagehide', leave)
    return () => { clearInterval(timer); removeEventListener('pagehide', leave) }
  }, [])
  useEffect(() => {
    const f = (e: BeforeUnloadEvent) => { if (useS.getState().busy) e.preventDefault() }
    addEventListener('beforeunload', f)
    return () => removeEventListener('beforeunload', f)
  }, [])
  useEffect(() => {
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
      else if (a === 'theme') { const t = Object.keys(THEMES); s.patch({ theme: t[(t.indexOf(s.theme) + 1) % t.length] as keyof typeof THEMES }) }
      else if (a === 'export') exportChat()
      else if (a === 'nextModel' || a === 'prevModel') {
        const models = s.eps.flatMap((ep) => modelsOf(ep).map((model) => ({ k: 'ep' as const, id: ep.id, model })))
        if (models.length) {
          const at = models.findIndex((m) => m.id === s.sel?.id && m.model === s.sel?.model)
          const delta = a === 'nextModel' ? 1 : -1
          s.patch({ sel: models[(at + delta + models.length) % models.length] })
        }
      }
      else if (a === 'nextPrompt') {
        if (!featOn(s, 'prompts')) return
        const at = s.prompts.findIndex((p) => p.id === s.pr)
        s.patch({ pr: s.prompts.length ? s.prompts[(at + 1) % s.prompts.length].id : '' })
      }
      else if (a === 'tempChat') s.newChat(true)
    }
    addEventListener('keydown', f)
    return () => removeEventListener('keydown', f)
  }, [])
  return (
    <div className="flex h-dvh overflow-hidden">
      {side && <div className="fixed inset-0 z-10 bg-black/50 md:hidden" onClick={() => setSide(false)} />}
      <Sidebar open={side} toggle={() => setSide((v) => !v)} cfg={setCfg} width={prefs.sidebarWidth ?? 288} />
      {side && <div role="separator" aria-orientation="vertical" aria-label="Resize sidebar" onPointerDown={resize('sidebarWidth')} className="hidden w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-ac/50 md:block" />}
      <Chat side={side} toggle={() => setSide(true)} cfg={setCfg} pal={() => setPal(true)} />
      {rail && featOn({ features }, 'widgets') && Object.values(widgets).some(Boolean) && <><div role="separator" aria-orientation="vertical" aria-label="Resize widget panel" onPointerDown={resize('widgetWidth', true)} className="hidden w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-ac/50 lg:block" /><Widgets width={prefs.widgetWidth ?? 320} /></>}
      {pal && <Palette close={() => setPal(false)} cfg={setCfg} toggleSide={() => setSide((v) => !v)} />}
      {cfg && <Settings tab={cfg} setTab={setCfg} />}
      {!setupDone && <Welcome addEndpoint={() => setCfg('eps')} close={() => {}} />}
    </div>
  )
}
