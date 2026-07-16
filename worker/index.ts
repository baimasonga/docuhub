// Cloudflare Workers entry-point.
//
// Static SPA assets are served from the ASSETS binding (built into ./dist-pages).
// Everything under /api/* and /s/* is handed to the existing Express app in
// ../server.ts via Cloudflare's Node HTTP compatibility bridge.
import { httpServerHandler } from 'cloudflare:node';
import { ensureRuntimeReady, runScheduledBackup } from '../server';

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

const EXPRESS_PORT = 3000;
const expressHandler = httpServerHandler({ port: EXPRESS_PORT });

function isApiPath(pathname: string): boolean {
  return pathname.startsWith('/api/') || pathname.startsWith('/s/');
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (isApiPath(url.pathname)) {
      // Load the datastore lazily inside a request context: module scope on
      // Workers can't do async I/O and doesn't see process.env. The Express
      // server itself already listens (registered at module scope in
      // server.ts). Never fail the request over init — the app falls back to
      // its in-memory seed state, which every handler can serve.
      try {
        await ensureRuntimeReady();
      } catch (err) {
        console.error('[worker] runtime init failed; serving with in-memory state.', err);
      }
      return expressHandler.fetch(request, env as unknown as Record<string, unknown>, ctx);
    }
    return env.ASSETS.fetch(request);
  },

  // Cron Trigger entry point (see wrangler.toml [triggers]). Runs the same
  // incremental backup logic as the manual "Back Up Now" button.
  async scheduled(_event: ScheduledEvent, _env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runScheduledBackup().catch(err => console.error('[worker] scheduled backup failed:', err))
    );
  },
};
