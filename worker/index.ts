// Cloudflare Worker entry-point for static assets plus API proxying.
//
// The Node/Express API in ../server.ts is intentionally not imported here:
// Cloudflare validates Worker modules before requests are handled and rejects
// Node-style startup side effects such as random generation, timers, and
// outbound I/O in global scope. Keep this Worker small and route API traffic to
// the deployed Node API origin instead.

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  API_ORIGIN?: string;
}

function isApiPath(pathname: string): boolean {
  return pathname.startsWith('/api/') || pathname.startsWith('/s/');
}

async function proxyToApiOrigin(request: Request, apiOrigin: string): Promise<Response> {
  const incomingUrl = new URL(request.url);
  const targetUrl = new URL(incomingUrl.pathname + incomingUrl.search, apiOrigin);
  return fetch(new Request(targetUrl, request));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (isApiPath(url.pathname)) {
      if (!env.API_ORIGIN) {
        return new Response('API_ORIGIN is not configured for this Cloudflare deployment.', { status: 500 });
      }
      return proxyToApiOrigin(request, env.API_ORIGIN);
    }

    return env.ASSETS.fetch(request);
  },
};
