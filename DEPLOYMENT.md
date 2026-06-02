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
