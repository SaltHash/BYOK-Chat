/* User-facing prompt variables: the {variable} placeholders a system prompt
 * can use, plus the date context every request carries.
 * Pure + unit-testable (no store imports, no DOM). */

export type PromptVarDef = { id: string; label: string; desc: string }

/** Placeholders offered in Settings → Prompts. */
export const PROMPT_VARS: PromptVarDef[] = [
  { id: 'date', label: 'Date', desc: 'Current date in UTC (YYYY-MM-DD)' },
  { id: 'time', label: 'Time', desc: 'Current time in UTC (HH:MM:SS UTC)' },
  { id: 'datetime', label: 'Date and time', desc: 'Current date and time in UTC' },
  { id: 'weekday', label: 'Weekday', desc: 'Current weekday in UTC' },
  { id: 'iso', label: 'ISO timestamp', desc: 'Current UTC timestamp in ISO 8601' },
]

const pad = (n: number) => String(n).padStart(2, '0')
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Values of every known placeholder, computed in UTC. */
export function promptVarValues(now: Date = new Date()): Record<string, string> {
  const year = now.getUTCFullYear()
  const month = pad(now.getUTCMonth() + 1)
  const day = pad(now.getUTCDate())
  const hour = pad(now.getUTCHours())
  const minute = pad(now.getUTCMinutes())
  const second = pad(now.getUTCSeconds())
  const date = `${year}-${month}-${day}`
  const time = `${hour}:${minute}:${second} UTC`
  return {
    date,
    time,
    datetime: `${date} ${time}`,
    weekday: WEEKDAYS[now.getUTCDay()] ?? '',
    iso: `${date}T${hour}:${minute}:${second}Z`,
  }
}

/**
 * Replace {variable} placeholders with their values. Unknown names are left
 * untouched, and double-braced text ({date}, {{input}}) is never rewritten.
 */
export function applyPromptVars(text: string, now: Date = new Date()): string {
  const src = typeof text === 'string' ? text : ''
  if (!src.includes('{')) return src
  const values = promptVarValues(now)
  return src.replace(/(?<!\{)\{([a-z_][a-z0-9_]*)\}(?!\})/gi, (whole, id: string) => {
    const key = id.toLowerCase()
    return key in values ? values[key] : whole
  })
}

/**
 * The date/time line every request carries, so the model never has to guess
 * which day it is. Kept in the user-facing system prompt next to the
 * {date}-style variables it is derived from.
 */
export function dateContext(now: Date = new Date()): string {
  const v = promptVarValues(now)
  return `Current date and time (UTC): ${v.datetime} (${v.weekday}).`
}
