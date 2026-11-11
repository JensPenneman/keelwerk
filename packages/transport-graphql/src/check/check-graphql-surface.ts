import type { ApiSurface, TransportProblem } from '@keelwerk/core';
import { inspectGraphqlSurface } from './inspect-graphql-surface.ts';

/**
 * What the GraphQL transport cannot project, as named problems (section 16.3.2): unsupported
 * shapes, unknown error codes and reserved names first and, when there are none, every name
 * collision and unfit name the real build meets. Pure and stably ordered; `mount` refuses the
 * first of them.
 */
export function checkGraphqlSurface(surface: ApiSurface): readonly TransportProblem[] {
  return inspectGraphqlSurface(surface).problems;
}
