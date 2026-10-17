import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'

/* Vendor code is split by library so editing app code does not invalidate the
 * (rarely changing) framework chunks in the browser cache:
 *   react  – react/react-dom/scheduler
 *   markdown – the lazily loaded renderer pipeline (Rich.tsx)
 *   icons  – lucide-react (large, only ever grows)
 *   state  – zustand
 * KaTeX and `lowlight`'s grammars are already split by the dynamic import and
 * the `common` language set in Rich.tsx. */
const VENDOR_CHUNKS: [RegExp, string][] = [
  [/node_modules\/(react|react-dom|scheduler)\//, 'react'],
  [/node_modules\/(react-markdown|remark-[^/]+|rehype-[^/]+|mdast-[^/]+|hast-[^/]+|micromark[^/]*|unified|lowlight|highlight\.js|devlop|property-information|space-separated-tokens|comma-separated-tokens|stringify-entities|character-entities[^/]*|decode-named-character-reference|html-url-attributes|trim-lines|bail|trough|is-plain-obj|vfile[^/]*|unist-[^/]+|zwitch|longest-streak|ccount|escape-string-regexp|markdown-table|extend|emoji-regex)\//, 'markdown'],
  // Loaded on demand by Rich.tsx (first reply that contains math).
  [/node_modules\/(katex|rehype-katex)\//, 'katex'],
  [/node_modules\/lucide-react\//, 'icons'],
  [/node_modules\/zustand\//, 'state'],
]

export default defineConfig({
  plugins: [react(), tailwind()],
  build: {
    rollupOptions: {
      output: {
        // Only eagerly shared vendor code is pinned to named chunks; everything
        // else keeps Rollup's own placement, so a dynamically imported library
        // cannot drag unrelated code onto the first-paint path.
        manualChunks: (id) => {
          for (const [re, name] of VENDOR_CHUNKS) if (re.test(id)) return name
        },
      },
    },
  },
  server: { proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true, configure: (proxy) => proxy.on('proxyReq', (request) => request.removeHeader('origin')) } } },
})
