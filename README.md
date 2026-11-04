# Private AI chat with your own models

A local-first chat app for the model endpoints you already use. Bring an OpenAI-compatible or Anthropic Messages endpoint, keep your keys in your browser, and use one model or route across several. Visiting [chat.icodebugs.com](https://chat.icodebugs.com/#chat) or using a small optional Node or Cloudflare backend adds web search, page reading, sharing, device sync, and a relay for providers that block browser requests.

## Why this app

- Your model keys stay in the browser. The backend does not store model credentials.
- Chats, settings, workspaces, and attachments live on your device.
- Optional device sync encrypts the payload before upload.
- Use a hosted provider, a local Ollama server, a gateway, or your own endpoint.
- Add grounded search, citations, research, files, code, images, MCP tools, and skills in one place.
- Run it as a web app, an installable PWA, or a self-hosted Node or Cloudflare deployment.

## Quick start

Requires Node 20 or newer.

```sh
npm install
npm run dev
```

Open the local URL, add an endpoint and key, and start chatting. For a production build through the Node server:

```sh
npm run build
npm start
```

For Cloudflare Workers:

```sh
npm run deploy
```

## Supported providers

### Model endpoints

Use any service that speaks one of these formats:

- OpenAI Chat Completions compatible
- Anthropic Messages compatible

Common choices include OpenAI, Anthropic, OpenRouter, Google Gemini through its OpenAI-compatible endpoint, Ollama, AIHubMix, and self-hosted gateways. Add a base URL and key by hand, or paste a cURL command to import it. The app can discover models from the endpoint and remembers working catalog URLs.

### Web search

TinyFish, You.com, Exa, Tavily, Parallel, Valyu, Firecrawl, Jina AI, Bright Data, Perplexity, Serper, Brave Search API, SerpAPI, Linkup, Octen, Google Gemini grounding, OpenAI web search, Anthropic web search, and Azure Bing.

### Page readers

Direct fetch, Jina Reader, Firecrawl, Exa Contents, TinyFish Fetch, Tavily Extract, Parallel Extract, Valyu Contents, Linkup Fetch, Octen Extract, and a custom reader API.

### Other tools

- Image generation through an OpenAI-compatible `/images/generations` endpoint.
- Any Model Context Protocol server over Streamable HTTP.
- Browser dictation and read-aloud replies.
- Local JavaScript and Python execution through a disposable Web Worker and Pyodide.

## Features

- **Chat:** streaming replies, temporary chats, folders, search, drafts, queued messages, rich copy, and read-only share links.
- **Models:** multiple endpoints, favorites, OpenRouter provider pinning, playlists with fallback, model discovery, and usage estimates.
- **Grounding:** automatic or explicit `@search`, numbered sources, inline citations, page reading, page summaries, and deep research with reviewable plans and cited reports.
- **Files and documents:** PDF, DOCX, ODT, RTF, PPTX, XLSX, ZIP, GZ, text, images, audio, and transcript pairing. Optional OCR for scanned images.
- **Workspaces:** model-created files with code, preview, diff, revisions, templates, downloads, and optional GitHub Gist sharing.
- **Tools:** calculator, time, date, JSON, Base64, hashing, UUIDs, memory, graphs, image generation, code execution, MCP servers, skills, and follow-up widgets.
- **Memory:** on-device recall with optional model-assisted saving, duplicate cleanup, and temporary-chat controls.
- **Usage:** local dashboard with model and tool breakdowns, charts, costs, token counts, and kept history.
- **Customization:** light and dark themes, custom palettes, density, fonts, chat width, reduced motion, high contrast, and configurable system prompts.
- **Sync and backup:** export or import settings, chats, and keys, or sync devices through an optional server backed by Neon Postgres.

## Local and private by design

Model and search keys are stored in browser storage. They are sent to the provider, or through the app's relay when a provider blocks browser requests. The backend does not store model keys or chat content.

Chats, workspaces, settings, and attachments stay on the device unless you enable sync or share a conversation. Sync uploads an encrypted envelope, and the server stores a hash of the sync token plus ciphertext, not readable chat data. Sharing publishes only the conversation text, title, byline, and timestamps; keys, prompts, files, and tool payloads are removed first.

The optional backend handles search, page reads, sharing, sync, and CORS relay. A static-only deployment has no backend, so those server features are unavailable, but direct model calls still work when the provider allows browser requests.

## Configuration

Local development may use a gitignored `.env`. Production hosts should use real environment variables or platform secrets.

```sh
PORT=3000
SEARCH_API_KEY=...              # shared search fallback
TINYFISH_API_KEY=...            # or another provider-specific key
EXA_API_KEY=...
READER_API_KEY=...              # optional page-reader fallback
READER_API_KEY_TINYFISH=...     # optional provider-specific reader key
SEARCH_API_ZONE=...             # Bright Data only
DATABASE_URL=postgresql://...   # persistent sync and shares
SYNC_BACKEND=neon               # or memory for local development
PROXY_ALLOWED_HOSTS=api.example.com,*.example.org
PROXY_ALLOW_PRIVATE=1           # local gateways only
TRUST_PROXY=1                   # behind a trusted reverse proxy
```

Search providers use browser keys by default. Set `SEARCH_API_KEY` as a shared server fallback, or use the provider-specific names such as `TINYFISH_API_KEY`, `EXA_API_KEY`, `TAVILY_API_KEY`, `FIRECRAWL_API_KEY`, `BRAVE_SEARCH_API_KEY`, and `BING_SEARCH_API_KEY`.

## Deployment

A Node host serves the built frontend and the same-origin API:

```sh
npm run build
npm start
```

`wrangler.jsonc` deploys one Worker that serves the frontend and handles `/api/*`:

```sh
npm run deploy
```

Store server secrets with `npx wrangler secret put <NAME>`. The same environment names work on Node and Cloudflare. Without `DATABASE_URL`, sync and shares use in-memory storage intended for development.

## Known limits

- A static-only deployment cannot use search, page reading, sharing, sync, or relay. Run the Node server or Worker for those features.
- Cloudflare rate limits and caches are approximate per isolate. The single-process Node host enforces exact limits.
- Browser storage can be cleared by the browser or the user. Export backups regularly.
- Image generation requires an OpenAI-compatible images endpoint. Anthropic endpoints do not support it.
- Code execution is an opt-in local sandbox, not a hardened security boundary. Enable Python only for code you trust.
- The native Gemini API format is not used. Gemini models work through the OpenAI-compatible Google endpoint.
- Legacy `.doc`, `.xls`, `.ppt`, `.7z`, and `.rar` files are not parsed.

## Development

```sh
npm run dev        # Vite plus the Node API
npm run build      # production frontend
npm test           # unit, integration, worker, and flow tests
npm run test:worker # Worker routing smoke test
```

Dependencies use npm. The lockfile is committed.
