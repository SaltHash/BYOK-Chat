# BYOK Chat

A highly customizable, browser-based chat client supporting custom endpoints. Model provider keys are saved in the browser and sent directly to the configured provider. The included Node service handles web search and does not store model credentials.

## Run locally

Run SearXNG through Podman Compose with its HTTP port bound to `127.0.0.1:8080` and JSON search enabled. Then install dependencies and start the app:

```sh
npm install
npm run dev
```

The backend defaults to `SEARXNG_BASE_URL=http://127.0.0.1:8080`. Set that variable in the server environment to use another reachable SearXNG URL. No search API key is needed. Keep SearXNG bound to loopback; when the app backend itself runs in a container, configure a private host/container route to SearXNG rather than exposing its port publicly.

Optional server limits can be configured with `SEARCH_TIMEOUT_MS` (default 8000), `SEARCH_MAX_RESULTS` (default 8), `SEARCH_MAX_SNIPPET_CHARS` (default 1800), and `SEARCH_EVIDENCE_BUDGET` (default 12000). Result and evidence limits are capped at 8 results, 3000 characters per snippet, and 16000 total evidence characters.

## Production

```sh
npm run build
npm start
```

Set `PORT` if the host assigns a port. The Node server serves `dist/` and exposes same-origin `/api/search` and `/api/health` routes. Configure the host to run `npm run build` during deployment and `npm start` as its web process. Ensure the backend can reach SearXNG through a private route and keep the SearXNG port bound to loopback or a private container network.

The search toggle in Settings → Tools allows automatic grounding for questions that request browsing, research, verification, or current information; it does not search ordinary messages. `@search(query)` runs an explicit search. Results are deduplicated, selected across domains, capped, and sent as snippets with stable source IDs and URLs. Retrieved text is marked as untrusted evidence in the prompt. The model is asked to cite sources using Markdown links. Full-page extraction is not implemented. Other tools are local browser helpers and remain individually permissioned. The browser does not expose a shell or arbitrary server execution to models.

## Checks

Run the SearXNG search helper tests with `node --test` and create a production build with `npm run build`.
