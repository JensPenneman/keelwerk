import { expect, test } from 'vitest';
import type { ScopeLookup } from '../invoker/scope-lookup.ts';
import type { ScheduleEntry } from '../registry/schedule-entry.ts';
import type { QueueSource } from '../worker/queue-source.ts';
import { scheduleScopeOf } from './schedule-scope-of.ts';

const never = (): Promise<never> => new Promise(() => undefined);
const hanging = { backend: never, tenant: never, hostname: never } as unknown as ScopeLookup;
const source = {
  namespace: { id: 'ns-app', appId: 'app' },
} as unknown as QueueSource;

test.each([['backend'], ['each-tenant']] as const)(
  'a %s schedule row stops waiting for the directory when the signal aborts',
  async (scope) => {
    const abandon = new AbortController();
    const entry = { ref: 'm.every', scope } as unknown as ScheduleEntry;
    const answer = scheduleScopeOf(hanging, source, entry, 'a1', abandon.signal);
    abandon.abort(new Error('stopped'));
    await expect(answer).rejects.toThrow('stopped');
  },
);
