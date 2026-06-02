# Deploying VaultDMS to Railway

VaultDMS is a single long-running Express server that builds and serves a React
SPA. It persists its datastore to **Supabase** (durable, no disk required) when
configured, and falls back to a local JSON file otherwise.

## What's already configured

- **`railway.json`** — build (`npm run build`), start (`npm start`), and a
  health check at `/api/health`.
- **`package.json`** — `start` runs the bundled server in production mode
  (`NODE_ENV=production node dist/server.cjs`) and `engines.node` pins Node 20+.
- **`server.ts`** — binds to `process.env.PORT`. Persistence backend:
  - **Supabase** when `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set — the
    whole datastore is stored as one JSONB row in the `docuhub_state` table.
    This is the recommended production path (Railway has no persistent disk).
  - **Local JSON file** under `DATA_DIR` otherwise (used for local dev).

## One-time setup

1. **Create the project**
   - Railway → *New Project* → *Deploy from GitHub repo* → select this repo and
     the branch you want to deploy.
   - Railway auto-detects Node via Nixpacks and uses `railway.json` for the
     build/start commands. No Dockerfile needed.

2. **Set environment variables** (Service → *Variables*) — Supabase gives durable
   persistence without a Railway volume:
   | Variable | Value | Notes |
   |---|---|---|
   | `SUPABASE_URL` | `https://<ref>.supabase.co` | Supabase → Project Settings → API → Project URL. |
   | `SUPABASE_SERVICE_ROLE_KEY` | `<service_role secret>` | Same page → `service_role` secret key. **Keep secret** — server-side only. |
   | `GEMINI_API_KEY` | `<your key>` | Optional — without it, OCR/tagging falls back to local heuristics. |
   | `NODE_ENV` | `production` | Optional; `npm start` already sets it. |

   > Do **not** set `PORT` yourself — Railway injects it and the server reads it.

   The server creates/uses a single `docuhub_state` row in Supabase. If
   `SUPABASE_*` is absent it falls back to a `DATA_DIR` JSON file (set `DATA_DIR`
   and attach a volume only if you go that route instead of Supabase).

4. **Deploy** — Railway builds and starts automatically. Watch the deploy logs
   for `SmartDocs DMS Full-Stack Engine booting on port: <PORT>`.

5. **Verify** — open the generated `*.up.railway.app` URL, or:
   ```
   curl https://<your-app>.up.railway.app/api/health
   # {"status":"ok",...}
   ```

## Local production smoke test

Reproduce the Railway runtime locally before pushing:

```bash
npm install
npm run build
DATA_DIR=./data PORT=3000 npm start
# open http://localhost:3000
```

## Notes & limitations

- **Datastore**: the entire state is one JSONB row in Supabase (or one `db.json`
  file in the local fallback). Fine for a demo / small team, but it rewrites the
  whole blob on every change and isn't built for high concurrency. For real
  scale, normalize into proper Postgres tables and move sessions to a shared
  store.
- **Sessions** live in memory, so a redeploy or crash logs everyone out. That's
  acceptable for this profile-switch demo; move to a persistent/shared session
  store if that matters.
- **Scaling**: keep this to a single replica. Horizontal scaling would split the
  in-memory sessions and the file-backed datastore across instances.
