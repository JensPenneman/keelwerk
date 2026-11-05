import type { Unit } from '@keelwerk/core';
import type { HookFailureFact } from './deployment-facts.ts';
import { hookEventTypes } from './hook-event-types.ts';

/** The tenant hooks that failed and have not completed since, read from the event log of a deployment-scope unit. */
export async function hookFailuresOf(unit: Unit): Promise<readonly HookFailureFact[]> {
  const open = new Map<string, HookFailureFact>();
  let after = null;
  for (;;) {
    const page = await unit.events.readAll(after, {
      limit: 500,
      selector: { streamTypes: ['core.tenant'] },
    });
    for (const event of page.events) {
      const hook = (event.data as { hook?: unknown } | null)?.hook;
      if (typeof hook !== 'string') continue;
      const key = `${event.stream.id}/${hook}`;
      if (event.type === hookEventTypes.failed) {
        open.set(key, { hookId: hook, tenantId: event.stream.id });
      } else if (event.type === hookEventTypes.completed) {
        open.delete(key);
      }
    }
    if (page.next === null || page.events.length === 0) break;
    after = page.next;
  }
  return [...open.values()];
}
