/* The base URL a custom OpenAI-compatible endpoint needs.
 *
 * A provider that has no preset is asked for its base URL, and nearly every
 * one of them lives at https://api.<company>.com/v1. Asking for the company
 * and showing the rest of the URL around it is the difference between "figure
 * out the exact string" and "type your provider's name", while still allowing
 * a full URL for localhost ports and gateway paths. Pure + unit-testable. */

/** The `https://api.<company>.com/v1` shape, with an optional trailing slash. */
const SHAPE = /^https?:\/\/api\.([a-z0-9][a-z0-9.-]*)\.com\/v1\/?$/i

/** The company slug when the URL fits that shape, else null. */
export function apiCompanyOf(url: string): string | null {
  const hit = SHAPE.exec(String(url ?? '').trim())
  return hit ? hit[1].toLowerCase() : null
}

/** A company a user typed, reduced to what a hostname label can hold: pasting
 *  a full URL, typing "api.acme.com" or "Acme" all give `acme`. */
export function companySlug(input: string): string {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^api\./, '')
    .replace(/\.com.*$/, '')
    .replace(/[^a-z0-9.-]+/g, '')
    .replace(/^[.-]+|[.-]+$/g, '')
}

/** The base URL for a company slug; empty when nothing usable was typed. */
export function apiUrlFor(company: string): string {
  const slug = companySlug(company)
  return slug ? `https://api.${slug}.com/v1` : ''
}
