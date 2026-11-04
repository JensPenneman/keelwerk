import type { SurfaceAction } from '@keelwerk/core';
import type { DocumentedRoute } from './documented-route.ts';

/** Whether the route is `GET /{m}/{c}/{id}` of the generated `get`. */
export function isSingleGet(action: SurfaceAction, route: DocumentedRoute): boolean {
  return action.generated === 'get' && route.method === 'get';
}
