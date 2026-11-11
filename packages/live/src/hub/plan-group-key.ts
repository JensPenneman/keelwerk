import type { LiveView } from '@keelwerk/core';

/** The key a group of equal plans is known by in `ReaderBatch.verdicts`. */
export function planGroupKey(view: LiveView): string {
  return `${view.entity} ${view.planKey}`;
}
