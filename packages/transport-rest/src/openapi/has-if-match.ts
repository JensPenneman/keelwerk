import type { SurfaceAction } from '@keelwerk/core';

const preconditioned = new Set(['update', 'archive', 'restore']);

/** Whether the action takes `If-Match`: instance commands and the generated update, archive and restore. */
export function hasIfMatch(action: SurfaceAction): boolean {
  return (
    (action.kind === 'command' && action.instance) ||
    (action.generated !== undefined && preconditioned.has(action.generated))
  );
}
