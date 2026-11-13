/* Localhost-only test models. The endpoint is a real same-origin API route
 * (`/api/mock/chat/completions`) served by the Node host in development; the
 * browser never calls a provider. These helpers are shared by the store (to
 * offer the endpoint) and the research tool loop (to return canned evidence
 * instead of calling a search provider). */

export const LOCAL_MOCK_ENDPOINT_ID = 'local-test-models'
export const LOCAL_MOCK_MODELS = ['mock-markdown', 'mock-tools', 'mock-deep-research'] as const

export const isLocalHost = (): boolean => {
  if (typeof location === 'undefined') return false
  return location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname === '[::1]' || location.hostname === '::1'
}

export const isLocalMockEndpoint = (e: { id?: string; url?: string } | null | undefined): boolean =>
  e?.id === LOCAL_MOCK_ENDPOINT_ID || /\/api\/mock(?:\/|$)/.test(String(e?.url ?? ''))

export function localMockEndpoint() {
  const origin = typeof location !== 'undefined' ? location.origin : ''
  return {
    id: LOCAL_MOCK_ENDPOINT_ID,
    name: 'Local test models',
    type: 'openai' as const,
    url: `${origin}/api/mock`,
    key: '',
    model: LOCAL_MOCK_MODELS[0],
    models: [...LOCAL_MOCK_MODELS],
    modelsAt: Date.now(),
    modelsMode: 'separate' as const,
    modelNames: {
      'mock-markdown': 'Markdown stream',
      'mock-tools': 'Tool caller',
      'mock-deep-research': 'Deep research',
    },
    modelContext: { 'mock-markdown': 128000, 'mock-tools': 128000, 'mock-deep-research': 128000 },
    prices: {},
    preset: '',
    on: true,
  }
}

const MOCK_SOURCES = [
  {
    title: 'Mock Research Brief: Local Demonstration Dataset',
    url: 'https://example.com/mock-research/brief',
    snippet: 'A synthetic research brief used by the local test model. It reports a clear three-part finding and notes the limits of its fictional sample.',
  },
  {
    title: 'Mock Field Notes: Secondary Analysis',
    url: 'https://example.com/mock-research/field-notes',
    snippet: 'Independent secondary notes that corroborate the brief on two points and disagree on one. Useful for testing how a report handles contested evidence.',
  },
  {
    title: 'Mock Dataset Documentation',
    url: 'https://example.com/mock-research/dataset',
    snippet: 'Documentation for the fictional dataset behind the local demo. Primary-source style, with definitions, method notes and a dated revision history.',
  },
]

/** Canned search evidence for deep research while a local mock endpoint runs.
 *  It keeps the whole research flow exercised without touching a provider. */
export function mockSearchData(query: string) {
  return {
    query,
    provider: 'local test model',
    searchedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
    results: MOCK_SOURCES.map((source, i) => ({ ...source, id: `S${i + 1}` })),
  }
}
