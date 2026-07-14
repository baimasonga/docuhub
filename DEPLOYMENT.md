# Deploying Chore Box DMS

Chore Box DMS is a single Express server (`server.ts`) that serves both the API
and the compiled React SPA. It runs in two environments:

- **Cloudflare Workers** (current production): `worker/index.ts` bridges
  requests into the Express app via `cloudflare:node`; static SPA assets are
  served from the Workers ASSETS binding (`dist-pages`).
- **Plain node** (Railway or any container host): `node dist/server.mjs`.

Data persists to **Supabase Postgres** (one table per entity — see
`supabase/migrations/`) with file binaries in **Supabase Storage**. Without
Supabase configured, the server falls back to an in-memory store with a local
JSON file (local development only — not durable and not safe for multiple
instances).

## How the build works

| Step | What happens |
|------|-------------|
| `npm run build` | Vite compiles the SPA into `dist/` and `dist-pages/`, esbuild bundles the server into `dist/server.mjs` |
| `npm start` | Runs `NODE_ENV=production node dist/server.mjs` (node hosting) |
| `npx wrangler deploy` | Deploys the Worker + static assets (Cloudflare) |
| `npm test` | API integration tests against the in-memory store |

## One-time setup

### 1. Supabase

1. Create (or restore) a Supabase project.
2. Apply the schema: paste `supabase/migrations/0001_relational_schema.sql`
   into the SQL editor and run it (or `supabase db push` with the CLI), then
   do the same for `0002_secure_legacy_state_table.sql`.
3. Copy the **Project URL** and the **service_role key** from
   Project Settings → API.

On first boot against an empty schema the server automatically imports the
legacy single-JSONB datastore (`docuhub_state`) if one exists, otherwise it
seeds the default institution and admin account.

### 2. Environment variables / secrets

Set these on the host (Cloudflare: `wrangler secret put NAME` or the
dashboard; Railway: service variables):

| Variable | Required | Notes |
|---|---|---|
| `SUPABASE_URL` | yes (prod) | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | yes (prod) | Server-side only; never expose to clients |
| `SESSION_SECRET` | recommended | HMAC key for login cookies. Defaults to the service-role key |
| `INITIAL_ADMIN_PASSWORD` | recommended | First-boot password for the seeded admin. Defaults to `ChangeMe!2026` (a change is forced at first login) |
| `RESEND_API_KEY` | optional | Enables email (invites, approvals, shares, password resets) via [Resend](https://resend.com). Without it, emails are logged and skipped |
| `EMAIL_FROM` | optional | Sender, e.g. `DocuHub <docs@yourdomain.com>`. Defaults to Resend's shared onboarding sender |
| `APP_URL` | optional | Base URL used in email links, e.g. `https://docuhub.example.workers.dev`. Defaults to the request host |
| `GEMINI_API_KEY` | optional | AI OCR/tagging; falls back to local heuristics |
| `ALLOWED_EMAIL_DOMAIN` | optional | Restrict user emails to one domain, e.g. `avdp.org.sl`. Unset = any valid email |

### 3. First login

Sign in with the seeded admin (`mohamedbangura@avdp.org.sl`) and the
`INITIAL_ADMIN_PASSWORD`. You'll be asked to choose your own password, then
create the rest of your users from **User Management** — each new user gets a
one-time temporary password (shown once, and emailed when email is enabled).

Users imported from the legacy datastore have no password; use the
**Reset password** button in User Management to issue them temp passwords.

## Cloudflare Workers (production)

`wrangler.toml` is already configured (Worker entry `worker/index.ts`, assets
from `dist-pages`, `nodejs_compat`). Deploys run:

```bash
npm run build && npx wrangler deploy
```

The Workers build integration does this automatically on pushes to `main`.

## Railway / node hosting

1. **New project** → *Deploy from GitHub repo* → `baimasonga/docuhub`, branch `main`
2. Set the environment variables above (do **not** set `PORT`; Railway injects it)
3. Railway builds via Nixpacks (`npm run build`, `node dist/server.mjs`)
4. Verify: `curl https://<your-app>/api/health`

## Local development

```bash
npm install
npm run dev        # Express + Vite dev server on :3000 (in-memory store)
npm test           # API integration tests
```

Sign in locally with the seeded admin and `ChangeMe!2026` (or set
`INITIAL_ADMIN_PASSWORD` in `.env`).

## Architecture notes

- **Datastore**: one Postgres table per entity with a weighted full-text
  search index (`search_tsv`) over title/description/tags/OCR text. Safe for
  concurrent server instances / Workers isolates.
- **File storage**: binaries live in a private Supabase Storage bucket
  (`documents`). Small uploads (<2.5 MB) travel inline as base64 and are
  offloaded server-side; larger files upload straight from the browser to
  Storage via short-lived signed upload URLs (`POST /api/uploads/sign`).
  Downloads/previews redirect to short-lived signed CDN URLs.
- **Auth**: email + password (PBKDF2-SHA256), stateless HMAC-signed session
  cookies (survive redeploys, no server-side session store), forced password
  change on first login, self-serve reset links by email, admin resets, and a
  per-process login rate limiter.
- **Email**: transactional notifications (invite, approval requested/decided,
  document shared, password reset) via Resend; best-effort with timeouts.
- **PWA**: installable manifest + a minimal service worker that caches only
  immutable build assets. The upload dialog includes a camera capture path
  for scanning paper documents on phones.

## Remaining limitations

- **Storage cleanup**: permanently deleting a document removes its rows (FK
  cascade) but not its Storage objects yet (orphans are harmless but
  accumulate).
- **Login rate limiting** is per-process/per-isolate; a durable limiter is a
  SaaS-version item.
- **Multi-tenancy**: the schema keeps `institution_id` throughout, but the
  app currently serves a single institution; SaaS-grade tenancy (signup,
  per-org isolation, billing) is the next milestone.
