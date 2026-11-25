import type { Unit } from '@keelwerk/core';
import type { HookFailureFact, HookFailuresFact } from './deployment-facts.ts';
import { doctorReadBounds } from './doctor-read-bounds.ts';
import { hookEventTypes } from './hook-event-types.ts';
import { walkPages } from './walk-pages.ts';

/**
 * The tenant hooks that failed and have not completed since, read from the outcome events of the
 * control store's log (a deployment-scope unit). Only the newest positions of the log are read, as
 * many as the pages of the budget can hold: a log that grew past them leaves `olderUnread` true
 * and the fact stays a fact.
 */
export async function hookFailuresOf(unit: Unit): Promise<HookFailuresFact> {
  const open = new Map<string, HookFailureFact>();
  const head = await unit.events.head();
  const window = BigInt(doctorReadBounds.pageBudget * doctorReadBounds.pageSize);
  const olderUnread = head !== null && head > window;
  let after: Parameters<Unit['events']['readAll']>[0] = olderUnread ? head - window : null;
  await walkPages(async () => {
    const page = await unit.events.readAll(after, {
      limit: doctorReadBounds.pageSize,
      selector: {
        streamTypes: ['core.tenant'],
        names: [hookEventTypes.failed, hookEventTypes.completed],
      },
    });
    for (const event of page.events) {
      const hook = (event.data as { hook?: unknown } | null)?.hook;
      if (typeof hook !== 'string') continue;
      const key = `${event.stream.id}/${hook}`;
      if (event.type === hookEventTypes.failed) {
        open.set(key, { hookId: hook, tenantId: event.stream.id });
      } else {
        open.delete(key);
      }
    }
    after = page.next;
    return page.next !== null && page.events.length > 0;
  });
  return { failures: [...open.values()], olderUnread };
}
