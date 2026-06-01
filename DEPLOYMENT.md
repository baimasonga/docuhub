# Deploying DocuHub to Railway

DocuHub is a single long-running Express server that builds and serves a React
SPA and persists data to a JSON file. Railway runs it well because it keeps a
persistent process, filesystem volume, and in-memory sessions alive between
requests.

## What's already configured

- **`railway.json`** — build (`npm run build`), start (`npm start`), and a
  health check at `/api/health`.
- **`package.json`** — `start` runs the bundled server in production mode
  (`NODE_ENV=production node dist/server.cjs`) and `engines.node` pins Node 20+.
- **`server.ts`** — binds to `process.env.PORT` and stores `db.json` under
  `DATA_DIR` (so it can live on a mounted volume).

## One-time setup

1. **Create the project**
   - Railway → *New Project* → *Deploy from GitHub repo* → select this repo and
     the branch you want to deploy.
   - Railway auto-detects Node via Nixpacks and uses `railway.json` for the
     build/start commands. No Dockerfile needed.

2. **Add a persistent volume** (so uploaded documents survive redeploys)
   - Service → *Variables/Settings* → *Volumes* → *New Volume*.
   - Mount path: `/data`.

3. **Set environment variables** (Service → *Variables*)
   | Variable | Value | Notes |
   |---|---|---|
   | `DATA_DIR` | `/data` | Must match the volume mount path. |
   | `GEMINI_API_KEY` | `<your key>` | Optional — without it, OCR/tagging falls back to local heuristics. |
   | `NODE_ENV` | `production` | Optional; `npm start` already sets it. |

   > Do **not** set `PORT` yourself — Railway injects it and the server reads it.

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

- **Datastore**: a single `db.json` on a volume. Fine for a demo / small team,
  but it serializes the whole file on every write and isn't built for high
  concurrency. For real scale, migrate to Postgres (e.g. Railway's Postgres
  plugin or the connected Supabase project) and move sessions to a shared store.
- **Sessions** live in memory, so a redeploy or crash logs everyone out. That's
  acceptable for this profile-switch demo; move to a persistent/shared session
  store if that matters.
- **Scaling**: keep this to a single replica. Horizontal scaling would split the
  in-memory sessions and the file-backed datastore across instances.
