# DocuHub

DocuHub is the AVDP document-management system. It provides controlled document upload, versioning, OCR-assisted indexing, folders, approvals, audit history, internal sharing, expiring external links, and external backups.

## Architecture

- React 19 and Vite frontend
- Express and TypeScript API
- Supabase Postgres and private Supabase Storage in production
- Cloudflare Workers deployment, with Railway/Node supported as an alternative
- Optional Resend email, OAuth, Gemini-assisted OCR, and S3-compatible backup

Production fails closed when its database or required secrets are unavailable. It never falls back to temporary in-memory data.

## Local development

```bash
npm ci
npm run dev
```

Local development uses `data/db.json` when Supabase is not configured. Copy `.env.example` to `.env` and set local values as needed.

## Verification

```bash
npm run lint
node --import tsx --test tests/api.test.ts
npm run build
npm audit --audit-level=high
```

GitHub Actions runs these checks for every pull request and every push to `main`.

## Production setup

Apply every SQL migration in `supabase/migrations/` in numeric order, then configure the required environment variables described in [DEPLOYMENT.md](DEPLOYMENT.md). Never commit service-role keys, session secrets, initial passwords, email credentials, OAuth secrets, AI keys, or backup credentials.

External AI processing is off by default. Enable it only after the institution has approved the relevant data-processing and confidentiality policy.

## Security model

- Institution boundaries are enforced for users, folders and documents.
- Confidential documents require explicit access; classification changes are audited.
- Password changes and administrative resets invalidate existing sessions.
- External-link passwords use PBKDF2 and are submitted by POST, never through URLs.
- Large direct uploads use signed stateless ownership claims that work across Worker isolates.
- Active-content and executable uploads are rejected; accepted files are content-checked.
- DOCX preview HTML is sanitized before rendering.

Report security concerns privately to the repository owner rather than opening a public issue containing sensitive details.
