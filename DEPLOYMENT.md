# Deploying Chore Box DMS to Railway

Chore Box DMS is a single Express server that serves both the API and the compiled
React SPA. Data persists to **Supabase** when configured, or falls back to a
local JSON file.

## How the build works

| Step | What happens |
|------|-------------|
| `npm run build` | Vite compiles the React SPA into `dist/` and esbuild bundles the server into `dist/server.mjs` |
| `npm start` | Runs `NODE_ENV=production node dist/server.mjs` — serves the SPA + API from one process |

## Files already configured

- **`railway.json`** — tells Railway to build with `npm run build` and start with `node dist/server.mjs`
- **`package.json`** — `engines.node >= 20`, `start` script for Railway
- **`server.ts`** — binds to `process.env.PORT`, serves `dist/` in production, has `/api/health` for health checks

## Railway setup (one-time)

1. **New project** → *Deploy from GitHub repo* → select `baimasonga/docuhub`, branch `main`
2. **Environment variables** (Service → Variables):

   | Variable | Value | Notes |
   |---|---|---|
   | `SUPABASE_URL` | `https://<ref>.supabase.co` | Supabase → Project Settings → API → Project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | `<service_role secret>` | Same page — keep secret, server-side only |
   | `GEMINI_API_KEY` | `<your key>` | Optional — OCR/tagging falls back to heuristics without it |

   > Do **not** set `PORT` — Railway injects it automatically.

3. **Deploy** — Railway auto-builds via Nixpacks. Watch for `VaultDMS Full-Stack Engine booting on port: <PORT>` in the logs.

4. **Verify**:
   ```
   curl https://<your-app>.up.railway.app/api/health
   # {"status":"ok",...}
   ```

## Local production smoke test

```bash
npm install
npm run build
PORT=3000 npm start
# open http://localhost:3000
```

## Architecture notes

- **File storage**: file binaries are offloaded to a private **Supabase Storage**
  bucket (`documents`, auto-created at startup) and served via short-lived signed
  CDN URLs. Inline base64 is kept only as a local-dev fallback and for legacy
  data (auto-migrated to Storage in the background on first boot).
- **Sessions** are **stateless HMAC-signed cookies** (no server store), so they
  survive redeploys and work across multiple instances. The signing key defaults
  to `SUPABASE_SERVICE_ROLE_KEY`; set `SESSION_SECRET` to rotate/override.

## Remaining limitations

- **Datastore metadata**: documents/folders/users still live in one JSONB row,
  rewritten on each change — fine for a small team; normalize into Postgres
  tables for high concurrency / large catalogs.
- **Storage cleanup**: permanently-deleting a document doesn't yet delete its
  Storage objects (orphans are harmless but accumulate).
- **In-panel preview** of offloaded files relies on the download endpoint
  (signed URL) rather than inline rendering.

---

# Deploying the frontend to Cloudflare Pages

Cloudflare Pages can host the compiled Vite React SPA from this repo. The app's
API remains the existing Node/Express server (`server.ts`), because the current
backend uses Express, filesystem fallbacks, Supabase service credentials, and
large request bodies that are better kept in a Node runtime. Pages Functions in
this repo proxy same-origin `/api/*` and `/s/*` requests from the Pages site to
that Node API origin.

## Cloudflare Pages build settings

| Setting | Value |
|---|---|
| Build command | `npm run build:pages` (or `npm run build`) |
| Build output directory | `dist-pages` |
| Deploy command | *(leave blank)* |
| Node version | `20` or newer |

> ⚠️ **Do not set a deploy command.** Cloudflare Pages auto-deploys the build
> output directory; setting a deploy command like `npx wrangler deploy` runs
> the Workers deploy flow and fails with
> `Missing entry-point to Worker script or to assets directory`. If your Pages
> project currently has a custom deploy command configured, clear it under
> **Settings → Builds & deployments → Deploy command**.

## Required Pages environment variable

Set this in **Workers & Pages → your Pages project → Settings → Environment variables**:

| Variable | Value | Notes |
|---|---|---|
| `API_ORIGIN` | `https://<your-node-api-host>` | Origin running `server.ts`, for example the Railway URL. Do not include a trailing slash. |

Keep the existing backend variables (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`GEMINI_API_KEY`, `SESSION_SECRET`) on the Node API host, not in Cloudflare Pages.
The Pages deployment only needs `API_ORIGIN`.

## Deploy from the command line

```bash
npm run deploy:pages
```

The deployment uses `wrangler.toml`, which points Pages at `dist-pages`. For local
Pages testing, run:

```bash
npm run preview:pages
```

## Routing notes

- `public/_redirects` provides the SPA fallback for client-side React routes.
- `functions/api/[[path]].ts` proxies API requests to `API_ORIGIN`.
- `functions/s/[[path]].ts` proxies public share links to `API_ORIGIN`.
