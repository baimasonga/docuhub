// Minimal ambient types for the Cloudflare Workers runtime pieces this
// project touches, so `tsc --noEmit` passes without pulling in the full
// @cloudflare/workers-types package (which conflicts with DOM lib types).

declare module 'cloudflare:node' {
  export function httpServerHandler(options: { port: number }): {
    fetch(request: Request, env: Record<string, unknown>, ctx: ExecutionContext): Promise<Response>;
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface ScheduledEvent {
  cron: string;
  scheduledTime: number;
}
