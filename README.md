# BYOK Chat

A highly customizable, browser-based chat client supporting custom endpoints. Model provider keys are saved in the browser and sent directly to the configured provider. The included Node service handles web search and does not store model credentials.

## Run locally

Run SearXNG through Podman Compose with its HTTP port bound to `127.0.0.1:8080` and JSON search enabled. Then install dependencies and start the app:

```sh
npm install
npm run dev
```

The backend defaults to `SEARXNG_BASE_URL=http://127.0.0.1:8080`. Set that variable in the server environment to use another reachable SearXNG URL. No search API key is needed for SearXNG mode. Keep SearXNG bound to loopback; when the app backend itself runs in a container, configure a private host/container route to SearXNG rather than exposing its port publicly.

Optional server limits can be configured with `SEARCH_TIMEOUT_MS` (default 8000), `SEARCH_MAX_RESULTS` (default 8), `SEARCH_MAX_SNIPPET_CHARS` (default 1800), and `SEARCH_EVIDENCE_BUDGET` (default 12000). Result and evidence limits are capped at 8 results, 3000 characters per snippet, and 16000 total evidence characters.

## AI search providers

Search is bring-your-own-key: paste a provider key in Settings → Tools → Web search and grounding. It is stored only in the browser (like model keys) and sent with each search request; the server never stores browser keys. Server-side keys remain supported as a shared fallback when the browser sends none. Providers: TinyFish, You.com, Exa, Firecrawl, or Bright Data (plus SearXNG). Choose the mode in Settings → Tools:

- `API`: use the selected API provider with your own key.
- `SearXNG`: use your self-hosted instance.

Enable `Fall back onto the other` to retry with the other search when the primary is missing its key or fails.

Server configuration:

```sh
SEARCH_MODE=api
SEARCH_FALLBACK=true
SEARCH_API_PROVIDER=tinyfish
# optional shared server keys (used only when the browser sends none):
SEARCH_API_KEY=...
# or provider-specific keys:
TINYFISH_API_KEY=...
YOU_API_KEY=...
EXA_API_KEY=...
FIRECRAWL_API_KEY=...
BRIGHTDATA_API_KEY=...
SEARCH_API_ZONE=your-serp-zone  # Bright Data only
# optional endpoint override:
SEARCH_API_URL=
```

`/api/search` accepts `{ query, mode, provider, fallback, apiKey, zone }` and returns `{ query, results, searchedAt, provider, mode }`. `/api/health` reports the configured mode, fallback default, default provider, and which providers have server keys.

Failures return structured JSON `{ error, code, provider, retryable }` with a matching HTTP status instead of a blanket 503:

- `400 missing_key` / `missing_zone`: no browser or server key (or Bright Data zone) is configured. Not retried.
- `429 rate_limited`: the provider is throttling; includes a `retry-after` hint. Retried with backoff, then reported.
- `502 upstream_auth`: the provider rejected the key (HTTP 401/403). Check the key; not retried.
- `502 billing`: the provider reported a billing problem (HTTP 402, e.g. depleted You.com credits). Not retried.
- `502 bad_request` / `bad_response`: the provider rejected the request or returned something unusable. Not retried.
- `503 upstream_unavailable`, `timeout`, or `network`: the provider or SearXNG could not be reached after bounded retries (`SEARCH_MAX_RETRIES`, default 2, plus `SEARCH_RETRY_BASE_MS`). Only these are genuine outages.

Transient failures (HTTP 429/502/503/504, timeouts, connection errors) are retried with exponential backoff; permanent errors (other 4xx, missing keys) are never retried. The server logs provider, mode, error code, and upstream status for diagnostics, and never logs API keys, zones, or authorization headers.

Provider request details (verified against each provider's official documentation):

- TinyFish: `GET https://api.search.tinyfish.ai?query=…` with an `X-API-Key` header ([docs](https://docs.tinyfish.ai/search-api/reference)).
- You.com: `POST https://ydc-index.io/v1/search` with an `X-API-Key` header and `{ query, count }` ([docs](https://you.com/docs/api-reference/search)).
- Exa: `POST https://api.exa.ai/search` with an `X-API-Key` header and `{ query, type: "auto", numResults, contents: { highlights: true } }` ([docs](https://exa.ai/docs/reference/search)).
- Firecrawl: `POST https://api.firecrawl.dev/v2/search` with an optional `Authorization: Bearer` header and `{ query, limit }`. The key is optional: search works keyless at lower limits ([docs](https://docs.firecrawl.dev/api-reference/endpoint/search)).
- Bright Data: `POST https://api.brightdata.com/request` with an `Authorization: Bearer` header and `{ zone, url, format: "raw", data_format: "parsed_light" }`; a SERP zone is required ([docs](https://docs.brightdata.com/products/serp-api/introduction)).

Without any keys, You.com and Exa answer with HTTP 402 (billing/payment required) and Bright Data/TinyFish with HTTP 401, which the backend surfaces as `billing` / `upstream_auth` rather than an outage.

## Skills

Skills are reusable instruction packs the model loads itself. Each skill has an id, name, when-to-use description, and instructions. Open Settings → Skills to enable, disable, reset, edit, add, or remove skills.

- The system prompt lists each enabled skill's id and description; the model calls the hidden `use_skill` tool with an id to load the full instructions before answering. There is no keyword matching, and `use_skill` never appears under Tools.
- Built-ins: `frontend-design` (Anthropic's official skill, included verbatim), `software-engineering`, `debugging`, `testing`, `code-review`, and `writing`. Coding expertise lives in these skills, not in the default system prompts.
- Custom skills validate their id and instructions before they are stored; malformed stored skills are skipped with a warning instead of breaking requests.

Default system prompts are `General` (general assistant behavior: follow instructions, be clear and accurate, reason when needed), `Creativity` (original, expressive, experimental ideas without fabricating facts), and `Concise`. Pick one from the prompt menu under the chat box.

## Third-party notices

The `frontend-design` skill is Anthropic's work from https://github.com/anthropics/skills/tree/main/skills/frontend-design, included verbatim and licensed under the Apache License 2.0 © Anthropic.

## Production

```sh
npm run build
npm start
```

Set `PORT` if the host assigns a port. The Node server serves `dist/` and exposes same-origin `/api/search` and `/api/health` routes. Configure the host to run `npm run build` during deployment and `npm start` as its web process. Ensure the backend can reach SearXNG through a private route and keep the SearXNG port bound to loopback or a private container network.

The search toggle in Settings → Tools allows automatic grounding for questions that request browsing, research, verification, or current information; it does not search ordinary messages. `@search(query)` runs an explicit search. Results are deduplicated, selected across domains, capped, and sent as snippets with stable source IDs and URLs. Retrieved text is marked as untrusted evidence in the prompt. The model is asked to cite sources using Markdown links. Full-page extraction is not implemented. Other tools are local browser helpers and remain individually permissioned. The browser does not expose a shell or arbitrary server execution to models.

## Checks

Run the SearXNG search helper tests with `node --test` and create a production build with `npm run build`. Search provider tests live in `server/search.test.mjs`.
