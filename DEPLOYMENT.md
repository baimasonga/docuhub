# Deploying AVDP Document Management System

AVDP Document Management System is a single Express server (`server.ts`) that
serves both the API and the compiled React SPA. The primary production target
is **Cloudflare Workers Standard (paid)**:

- **Cloudflare Workers Standard**: `worker/index.ts` bridges
  requests into the Express app via `cloudflare:node`; static SPA assets are
  served from the Workers ASSETS binding (`dist-pages`).
- **Plain node** (Railway or any container host) is retained only as an
  optional recovery target: `node dist/server.mjs`.

Do not create a Cloudflare Pages project for this repository. Pages can host
the static React build, but DocuHub also needs a stateful API execution path,
Node compatibility, and a nightly Cron Trigger. A single Worker with Static
Assets provides all three without a second origin or proxy layer.

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
| `npm run check:worker` | Builds assets and validates a Cloudflare deployment without publishing |
| `npm run deploy:worker` | Deploys the Worker + static assets to Cloudflare |
| `npm test` | API integration tests against the in-memory store |

## One-time setup

### 1. Supabase

1. Create (or restore) a Supabase project.
2. Apply every file in `supabase/migrations/` in numeric order (or run
   `supabase db push` with the CLI). Migration `0006_security_hardening.sql`
   is required by the current application and adds tenant isolation, revocable
   sessions, per-user stars, durable rate limiting and atomic link counters.
   Back up the database first. The migration deliberately stops if it detects
   duplicate version labels or shared storage paths; repair those records and
   copy shared objects to independent paths before retrying.
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
| `SESSION_SECRET` | **yes** | Independent random HMAC key of at least 32 characters |
| `INITIAL_ADMIN_PASSWORD` | first boot | Required only when the database has a seeded Admin without a password; there is no production default |
| `RESEND_API_KEY` | optional | Enables email (invites, approvals, shares, password resets) via [Resend](https://resend.com). Without it, emails are logged and skipped |
| `EMAIL_FROM` | optional | Sender, e.g. `DocuHub <docs@yourdomain.com>`. Defaults to Resend's shared onboarding sender |
| `RESEND_SHARE_TEMPLATE_ID` | optional | When set, share and share-link emails only use this Resend dashboard template instead of the built-in HTML. Other emails are unaffected |
| `APP_URL` | **yes** | Canonical HTTPS origin used for OAuth, email links and origin validation |
| `GEMINI_API_KEY` | optional | AI OCR/tagging key; ignored unless external AI is explicitly enabled |
| `ENABLE_EXTERNAL_AI` | optional | Set to `true` only after institutional approval; default is off |
| `ALLOWED_EMAIL_DOMAIN` | set (in `wrangler.toml`) | Restrict user emails to one domain. Set to `avdp.org.sl` in `wrangler.toml` `[vars]` -- unset = any valid email |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | optional | Enables "Sign in with Google" (redirect URI: `<APP_URL>/api/auth/oauth/google/callback`). Only works for accounts an Admin already created (matched by email) -- not a self-registration path |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | optional | Enables "Sign in with Microsoft" (redirect URI: `<APP_URL>/api/auth/oauth/microsoft/callback`). Same admin-created-accounts-only rule as Google |
| `MICROSOFT_TENANT_ID` | optional | Restricts Microsoft sign-in to a single Azure AD tenant. Defaults to `common` (any work/school or personal Microsoft account) |
| `IDRIVE_ACCESS_KEY_ID` / `IDRIVE_SECRET_ACCESS_KEY` | optional | S3-compatible credentials for external backups (Settings → Backup). Works with iDrive e2, Backblaze B2, Wasabi, Cloudflare R2, MinIO -- anything S3-compatible |
| `IDRIVE_ENDPOINT` | optional | e.g. `https://<id>.idrivee2-<region>.com` |
| `IDRIVE_BUCKET` | optional | Destination bucket name |
| `IDRIVE_REGION` | optional | Defaults to `us-east-1`; most S3-compatible providers ignore this |

### 3. First login

Sign in with the seeded admin (`mohamedbangura@avdp.org.sl`) and the securely
configured `INITIAL_ADMIN_PASSWORD`. You must choose your own password before any protected API can be used, then
create the rest of your users from **User Management** — each new user gets a
one-time temporary password (shown once, and emailed when email is enabled).

Users imported from the legacy datastore have no password; use the
**Reset password** button in User Management to issue them temp passwords.

## Cloudflare Workers Standard (production)

`wrangler.toml` is already configured (Worker entry `worker/index.ts`, assets
from `dist-pages`, Node compatibility, custom domain, nightly backup trigger,
observability, and a 30-second CPU safety ceiling).

### Why Standard rather than Free or Pages

| Cloudflare option | Decision | Reason |
|---|---|---|
| Workers Standard | **Use this** | Runs the React assets, Express API, security processing and Cron Trigger in one deployment |
| Workers Free | Do not use for production | The per-request CPU allowance is too small for password hashing and document-processing routes |
| Pages | Do not use | Static hosting alone cannot run the complete DocuHub backend; a proxy would introduce a second host |
| Containers | Not currently needed | The application already bundles successfully for Workers and stores durable data/files in Supabase |

### One-time Cloudflare setup

1. Add `avdpdocs.org` to the same Cloudflare account that will own the Worker.
2. Subscribe the account to the Workers Standard plan.
3. In **Workers & Pages**, import `baimasonga/docuhub` as a Worker project and
   select the `main` production branch.
4. Use repository root `/`, build command `npm ci && npm run build:pages`, and
   deploy command `npx --yes wrangler@4.128.0 deploy`.
5. Add the required secrets under the Worker's **Settings → Variables and
   Secrets**. Keep the existing non-secret values from `wrangler.toml`.
6. Confirm `avdpdocs.org` appears under the Worker's custom domains. The
   `[[routes]]` entry in `wrangler.toml` declares it during deployment.

Required production secrets:

```text
SUPABASE_SERVICE_ROLE_KEY
SESSION_SECRET
```

`INITIAL_ADMIN_PASSWORD` is required only for a new empty database. Add email,
OAuth, AI and external-backup secrets only when those features are approved and
configured. Never add `SUPABASE_SERVICE_ROLE_KEY` to Vite variables or prefix
it with `VITE_`.

### Validate and deploy from a trusted workstation

```bash
npm ci
npm run lint
npm test
npm run check:worker
npx wrangler login
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put SESSION_SECRET
npm run deploy:worker
```

For Git-connected Workers Builds, pushes to `main` deploy automatically after
the configured build succeeds. Protect `main` so the CI workflow must pass
before merge.

### Release verification

After deployment, verify:

```bash
curl --fail --show-error https://avdpdocs.org/api/health
```

Then test login/logout, forced password change, upload and preview, version
creation, confidential access, internal sharing, an expiring public link, and
the manual backup action. Check Worker logs for initialization or Supabase
errors without logging document content.

If a release fails, use **Deployments → Roll back** in Cloudflare to restore the
previous Worker version. Do not roll back migration `0006` merely to match an
older application build; it is additive and required by the hardened release.

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

Sign in locally with the seeded admin and the value of
`INITIAL_ADMIN_PASSWORD` (the local-only fallback remains `ChangeMe!2026`).

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

- **Malware scanning**: content signatures, file allowlists and size limits are
  enforced in-process. Highly regulated deployments should additionally place
  a managed antivirus/content-disarm service in the upload path.
- **SaaS lifecycle**: tenant data isolation is enforced, but self-service
  organization signup, billing and tenant administration are not implemented.
