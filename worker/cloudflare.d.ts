// Minimal ambient types for the Cloudflare Workers runtime, enough for
// `tsc --noEmit` without adding @cloudflare/workers-types (wrangler is only
// used via npx). Wrangler bundles with its own types at deploy time.
declare module 'cloudflare:node' {
  export function httpServerHandler(options: { port: number }): {
    fetch: (
      request: Request,
      env: Record<string, unknown>,
      ctx: ExecutionContext,
    ) => Promise<Response>;
  };
}

declare interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}
