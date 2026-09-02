// Cloudflare Workers entry-point.
//
// Static SPA assets are served from the ASSETS binding (built into ./dist-pages).
// Everything under /api/* and /s/* is handed to the existing Express app in
// ../server.ts via Cloudflare's Node HTTP compatibility bridge.
import { httpServerHandler } from 'cloudflare:node';
import { ensureRuntimeReady, runNightlyMaintenance } from '../server';

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

const EXPRESS_PORT = 3000;
const expressHandler = httpServerHandler({ port: EXPRESS_PORT });

function isApiPath(pathname: string): boolean {
  return pathname.startsWith('/api/') || pathname.startsWith('/s/');
}

function secure(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Frame-Options', 'SAMEORIGIN');
  headers.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://*.supabase.co; frame-src 'self' https://*.supabase.co blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (isApiPath(url.pathname)) {
      try {
        await ensureRuntimeReady();
      } catch (err) {
        console.error('[worker] runtime init failed; refusing unsafe fallback.', err);
        return new Response('Service temporarily unavailable.', {
          status: 503,
          headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' }
        });
      }
      return secure(await expressHandler.fetch(request, env as unknown as Record<string, unknown>, ctx));
    }
    return secure(await env.ASSETS.fetch(request));
  },

  // Cron Trigger entry point (see wrangler.toml [triggers]). Runs the same
  // incremental backup logic as the manual "Back Up Now" button, then purges
  // documents that have outlived the Trash retention window.
  async scheduled(_event: ScheduledEvent, _env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runNightlyMaintenance().catch(err => console.error('[worker] nightly maintenance failed:', err))
    );
  },
};
