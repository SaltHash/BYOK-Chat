# BYOK Chat: agent notes

Local-first AI chat client for user-supplied model endpoints. React 18 + Vite +
TypeScript (`strict`) frontend, a Zustand store, and Tailwind v4 tokens. An
optional Node (`server.mjs`) or Cloudflare Worker (`worker/index.mjs`) backend
serves `/api/*` (search, page reader, sharing, encrypted sync, CORS relay); the
built frontend in `dist/` is served as static assets.

## Commands

- `npm run dev`: Vite plus the Node API, both loading the gitignored `.env`.
- `npm run build`, `npm start`: production frontend, then the Node host.
- `npm test`: `node --test` with `tests/register-loader.mjs` (TypeScript loader),
  covering colocated `*.test.mjs`, `server/`, `tests/` and the Worker.
- `npm run test:worker`: Worker routing smoke test.
- `npx tsc --noEmit`: type check (there is no script for it).
- `npm run deploy`: build and deploy to Cloudflare.

## Layout

- `src/*.ts`: one module per concern, nearly every one with a colocated
  `.test.mjs`. Prefer extending an existing module over adding a parallel one.
- `src/store.ts`: the single Zustand store and chat/tool orchestration;
  persisted to `localStorage` under `byok.v1`.
- `src/engine.ts`: provider streaming, the tool loop, and the session cache.
- `src/components/`: UI. `src/storage/`: IndexedDB/OPFS durable data, sync and
  coalesced persistence.
- `server/*.mjs`: route modules shared by `server.mjs` and the Worker. Change
  behaviour in the shared module, never fork the two hosts.
- `worker/index.mjs`: Workers entry, `/api` first and then `ASSETS`.
- `index.html`: pre-paint theme script; keep its palette keys in step with
  `THEME_COLOR_KEYS`.
- `tests/`, `scripts/`: integration and smoke tests.

## Conventions that bite

- Themes exist twice: `[data-t=...]` blocks in `src/index.css` (runtime) and
  `THEME_COLORS` in `src/store.ts` (pickers, swatches, seeds). Keep their
  `bg`/`side`/`surf` values identical. `src/contrast.test.mjs` enforces
  muted-text contrast, CSS/store palette sync, and that `--side` stays lighter
  than `--bg`.
- Built-in dark and light palettes lift the sidebar above `--bg`, with panels
  above it. Custom palettes come from `customPalette()` in `src/theme.ts`,
  where 50% is the balanced anchor. Their steps are measured in OKLCH
  lightness: dark canvases lift (sidebar 0.06 L over `--bg`, then panels and
  hover), while light canvases deepen a tint below the canvas because
  near-white has almost no headroom. Keep light surfaces responsive all the
  way to 100% instead of clamping them at white, and never settle for a 3% RGB
  lift.
- Colours only through the theme tokens; style presets change radii and shadows
  only. No colour literals in components.
- Settings live in `localStorage`; chats, workspaces and blobs live in
  `src/storage/durable.ts` (IndexedDB, with OPFS and in-memory fallbacks).
  Bump `STORE_VERSION` in `src/persistence.ts` when the persisted shape changes.
- Model and search keys stay in the browser. The server must never store model
  credentials or chat content; sync only sees an encrypted envelope.
- Node tests run without a browser, so storage and DOM access needs the same
  fallbacks the existing modules already use.

## Scratch files

- `agents_storage/screenshots/`: ignored by git. Never commit captures.
- `CODEBASE_AUDIT.md`, `FEATURE_AUDIT.md` and `FEATURE_BACKLOG.md` at the root:
  tracked. Put notes meant to survive a clone in tracked paths.
