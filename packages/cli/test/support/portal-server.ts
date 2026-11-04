import type { FakeHandler, SentRequest } from './fake-host.ts';
import { portalSurface } from './portal-surface.ts';

export interface PortalServerOptions {
  /** The answer of `/invoke`; defaults to `{ ok: true, value: null }`. */
  readonly invoke?: (body: Readonly<Record<string, unknown>>, sent: SentRequest) => Response;
  readonly etag?: string;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A scripted deployment: serves the portal surface (with 304 on a matching `If-None-Match`) and `/invoke`. */
export function portalServer(options: PortalServerOptions = {}): FakeHandler {
  return (sent) => {
    if (sent.url.endsWith('/surface')) {
      const match = sent.request.headers['if-none-match'];
      return match === `"${portalSurface.hash}"`
        ? new Response(null, { status: 304 })
        : json(portalSurface);
    }
    const body = JSON.parse(sent.request.body ?? '{}') as Record<string, unknown>;
    return options.invoke?.(body, sent) ?? json({ ok: true, value: null });
  };
}
