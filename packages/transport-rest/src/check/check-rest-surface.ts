import type { ApiSurface, TransportProblem } from '@keelwerk/core';
import { buildRouteTable } from '../build-route-table.ts';
import type { RestStaticOptions } from '../rest-static-options.ts';
import { nameCollisions } from './name-collisions.ts';
import { unsupportedShapes } from './unsupported-shapes.ts';

/**
 * What the REST transport cannot project, as named problems (section 16.3.2): unsupported shapes
 * first, then the route table's own problems (route conflicts, reserved names, cookie names), then
 * name collisions. Pure; the order is fixed, and `mount` refuses the first of them.
 */
export function checkRestSurface(
  surface: ApiSurface,
  options: RestStaticOptions = {},
): readonly TransportProblem[] {
  return [
    ...unsupportedShapes(surface),
    ...buildRouteTable(surface, options).problems,
    ...nameCollisions(surface, options),
  ];
}
