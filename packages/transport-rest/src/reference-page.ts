import { Scalar } from '@scalar/hono-api-reference';
import { Hono } from 'hono';

/**
 * The API reference page at `{basePath}/docs` (section 16.5.6), rendered by Scalar from the
 * backend's `{basePath}/openapi.json`. The Scalar app is built once; each request finds the
 * document next to the page it asked for.
 */
export function referencePage(): (request: Request) => Promise<Response> {
  const app = new Hono();
  app.get(
    '*',
    Scalar((c) => ({ url: new URL(c.req.url).pathname.replace(/\/docs$/, '/openapi.json') })),
  );
  return async (request) => await app.fetch(request);
}
