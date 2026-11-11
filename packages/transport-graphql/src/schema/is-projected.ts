import type { SurfaceAction } from '@keelwerk/core';

/** Whether the schema has a field for the action: subscriptions and `watch` belong to the subscription root and `graphql.expose: false` hides an action. */
export function isProjected(action: SurfaceAction): boolean {
  return (
    action.kind !== 'subscription' &&
    action.generated !== 'watch' &&
    action.hints.graphql?.expose !== false
  );
}
