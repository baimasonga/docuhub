// Cloudflare Workers entry-point.
//
// Static SPA assets are served from the ASSETS binding (built into ./dist-pages).
// Everything under /api/* and /s/* is handed to the existing Express app in
// ../server.ts via Cloudflare's Node HTTP compatibility bridge.
import { httpServerHandler } from 'cloudflare:node';
import { ensureServerStarted } from '../server';

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
      // Boot the Express app lazily inside a request context: module scope on
      // Workers can't do async I/O and doesn't see process.env, so this is the
      // earliest point startup (Supabase state load, listen()) can happen.
      await ensureServerStarted();
      return expressHandler.fetch(request, env as unknown as Record<string, unknown>, ctx);
    }
    return env.ASSETS.fetch(request);
  },
};
