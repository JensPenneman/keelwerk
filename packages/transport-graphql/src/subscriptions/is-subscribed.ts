import type { SurfaceAction } from '@keelwerk/core';

/** Whether the schema has a subscription field for the action: a subscription (custom or the generated watch) that `graphql.expose: false` does not hide (section 16.6.5). */
export function isSubscribed(action: SurfaceAction): boolean {
  return action.kind === 'subscription' && action.hints.graphql?.expose !== false;
}
