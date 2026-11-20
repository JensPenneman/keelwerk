import type { ApiSurface, RouteSpec } from '@keelwerk/core';
import { asksForEventStream } from '@keelwerk/core/http';
import { orpcPathOf } from '../router/orpc-path-of.ts';

/**
 * Which requests of an oRPC route open a stream (section 16.3.3): a request to the path of a
 * subscription of any API version, and, as the host's default decides, any request that asks for
 * `text/event-stream`. A declared predicate replaces the host's default, so the second part keeps
 * the host's own cross-site check of an unasked event stream. The path is compared the way oRPC
 * matches it: without a leading slash and without any trailing slash, so `/loans/loanEvents/` and
 * `/loans/loanEvents///` are the subscription too (oRPC's handlers serve up to three).
 */
export function orpcStreams(surfaces: readonly ApiSurface[]): NonNullable<RouteSpec['streams']> {
  const paths = new Set(
    surfaces.flatMap((surface) =>
      surface.actions
        .filter((action) => action.kind === 'subscription')
        .map((action) => `/${orpcPathOf(action).join('/')}`),
    ),
  );
  return (request, path) =>
    paths.has(`/${path.replace(/^\/+|\/+$/g, '')}`) || asksForEventStream(request);
}
