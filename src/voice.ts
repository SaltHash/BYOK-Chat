/* Voice input and output using the browser's own APIs.
 *
 * Dictation uses SpeechRecognition (Chrome/Edge/Safari; Firefox lacks it) and
 * read-aloud uses speechSynthesis, which every current browser ships. Both are
 * free and local, matching the app's bring-your-own-key model: no audio ever
 * leaves the device for our backend. Recognition itself may be cloud-backed by
 * the browser vendor, which the Settings note makes clear. */

export type VoicePrefs = {
  /** BCP-47 language for dictation; empty follows the browser. */
  dictLang: string
  /** BCP-47 language for read-aloud; empty follows the browser. */
  speakLang: string
  /** 0.5–2× speech rate. */
  rate: number
  /** Read every new assistant reply aloud. Off by default. */
  autoRead: boolean
}

export const BLANK_VOICE: VoicePrefs = { dictLang: '', speakLang: '', rate: 1, autoRead: false }

export const VOICE_LANGS: [string, string][] = [
  ['', 'Browser default'],
  ['en-US', 'English (US)'],
  ['en-GB', 'English (UK)'],
  ['es-ES', 'Spanish (Spain)'],
  ['es-MX', 'Spanish (Mexico)'],
  ['fr-FR', 'French'],
  ['de-DE', 'German'],
  ['it-IT', 'Italian'],
  ['pt-BR', 'Portuguese (Brazil)'],
  ['nl-NL', 'Dutch'],
  ['pl-PL', 'Polish'],
  ['tr-TR', 'Turkish'],
  ['ru-RU', 'Russian'],
  ['uk-UA', 'Ukrainian'],
  ['hi-IN', 'Hindi'],
  ['ar-SA', 'Arabic'],
  ['he-IL', 'Hebrew'],
  ['ja-JP', 'Japanese'],
  ['ko-KR', 'Korean'],
  ['zh-CN', 'Chinese (Mandarin)'],
  ['zh-TW', 'Chinese (Traditional)'],
]

export const normVoice = (v: any): VoicePrefs => ({
  dictLang: typeof v?.dictLang === 'string' ? v.dictLang.slice(0, 20) : '',
  speakLang: typeof v?.speakLang === 'string' ? v.speakLang.slice(0, 20) : '',
  rate: Number.isFinite(Number(v?.rate)) ? Math.max(0.5, Math.min(2, Number(v.rate))) : 1,
  autoRead: v?.autoRead === true,
})

export const voiceOn = (s: { features?: Record<string, boolean> } | null | undefined): boolean => s?.features?.voice !== false

type Win = Window & {
  SpeechRecognition?: new () => any
  webkitSpeechRecognition?: new () => any
}

const win = (): Win | null => (typeof window === 'undefined' ? null : window as Win)

export const speechAvailable = (): boolean => {
  const w = win()
  return !!w && 'speechSynthesis' in w && typeof w.speechSynthesis?.speak === 'function'
}

export const dictationAvailable = (): boolean => {
  const w = win()
  return !!w && !!(w.SpeechRecognition || w.webkitSpeechRecognition)
}

/** Convert markdown into something worth hearing: no fences, URLs, tables, or
 *  citation markers. Pure, so it is easy to test. */
export function speechText(markdown: string): string {
  let t = String(markdown ?? '')
  // Code blocks are unreadable aloud; keep a short placeholder.
  t = t.replace(/```[\s\S]*?```/g, ' Code block. ')
  t = t.replace(/~~~[\s\S]*?~~~/g, ' Code block. ')
  t = t.replace(/`([^`]+)`/g, '$1')
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  t = t.replace(/\[S\d+(?:,\s*S\d+)*\]/gi, '')
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, '')
  t = t.replace(/^\s*>\s?/gm, '')
  t = t.replace(/^\s*[-*+]\s+/gm, '')
  t = t.replace(/^\s*\d+[.)]\s+/gm, '')
  t = t.replace(/^\s*\|.*\|\s*$/gm, '')
  t = t.replace(/[*_~]{1,3}/g, '')
  t = t.replace(/https?:\/\/\S+/g, ' link ')
  t = t.replace(/<[^>]+>/g, ' ')
  t = t.replace(/\s+/g, ' ').trim()
  return t.slice(0, 8000)
}

const chunks = (text: string, max = 1800): string[] => {
  if (text.length <= max) return [text]
  const out: string[] = []
  let rest = text
  while (rest.length > max) {
    // Prefer a sentence boundary near the limit, then a word boundary.
    const slice = rest.slice(0, max)
    const at = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '), slice.lastIndexOf('\n'))
    const cut = at > max * 0.5 ? at + 1 : Math.max(slice.lastIndexOf(' '), max)
    out.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) out.push(rest)
  return out
}

/** Read text aloud. Cancels anything already speaking. Returns false when the
 *  platform has no speech synthesis. */
export function speak(text: string, prefs: Partial<VoicePrefs> = {}): boolean {
  const w = win()
  if (!w || !speechAvailable()) return false
  const clean = speechText(text)
  if (!clean) return false
  try {
    w.speechSynthesis.cancel()
    const p = normVoice(prefs)
    const lang = p.speakLang || undefined
    let voice: SpeechSynthesisVoice | undefined
    if (lang) {
      const voices = w.speechSynthesis.getVoices?.() ?? []
      const short = lang.split('-')[0].toLowerCase()
      voice = voices.find((v) => v.lang?.toLowerCase() === lang.toLowerCase())
        ?? voices.find((v) => v.lang?.toLowerCase().startsWith(short))
    }
    for (const part of chunks(clean)) {
      const u = new SpeechSynthesisUtterance(part)
      u.rate = p.rate
      if (lang) u.lang = lang
      if (voice) u.voice = voice
      w.speechSynthesis.speak(u)
    }
    return true
  } catch { return false }
}

export function stopSpeaking(): void {
  const w = win()
  try { w?.speechSynthesis?.cancel() } catch { /* ignore */ }
}

export const isSpeaking = (): boolean => {
  const w = win()
  try { return !!w?.speechSynthesis?.speaking } catch { return false }
}

export type Dictation = { stop: () => void }

/** Start one-shot dictation. `onText` receives the whole transcript so far,
 *  including interim words, so the composer can replace its draft live. */
export function startDictation(opts: {
  lang?: string
  onText: (text: string, interim: boolean) => void
  onEnd?: () => void
  onError?: (message: string) => void
}): Dictation {
  const w = win()
  const Ctor = w && (w.SpeechRecognition || w.webkitSpeechRecognition)
  if (!Ctor) throw Error('Dictation is not supported in this browser. Chrome, Edge, and Safari support it; Firefox does not.')
  const rec = new Ctor()
  rec.lang = opts.lang || w?.navigator?.language || 'en-US'
  rec.interimResults = true
  rec.continuous = false
  rec.maxAlternatives = 1
  let finalText = ''
  let done = false
  rec.onresult = (e: any) => {
    let interim = ''
    for (let i = e.resultIndex ?? 0; i < (e.results?.length ?? 0); i++) {
      const result = e.results[i]
      const transcript = String(result?.[0]?.transcript ?? '')
      if (result?.isFinal) finalText += transcript
      else interim += transcript
    }
    opts.onText(`${finalText}${interim}`, !!interim)
  }
  rec.onerror = (e: any) => {
    done = true
    const code = String(e?.error ?? '')
    const message = code === 'not-allowed' || code === 'service-not-allowed'
      ? 'Microphone access was blocked. Allow it for this site in the browser, then try again.'
      : code === 'no-speech' ? 'No speech was heard. Press the microphone and try again.'
        : code === 'audio-capture' ? 'No microphone was found.'
          : code === 'network' ? 'Dictation needs a network connection in this browser.'
            : `Dictation stopped (${code || 'unknown error'}).`
    opts.onError?.(message)
    opts.onEnd?.()
  }
  rec.onend = () => {
    if (done) return
    done = true
    opts.onEnd?.()
  }
  try { rec.start() } catch (e: any) { throw Error(`Could not start dictation (${String(e?.message ?? e)}).`) }
  return {
    stop: () => {
      try { rec.stop() } catch { /* already stopped */ }
      try { rec.abort?.() } catch { /* ignore */ }
      if (!done) { done = true; opts.onEnd?.() }
    },
  }
}
