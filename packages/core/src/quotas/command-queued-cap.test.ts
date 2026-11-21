import { describe, expect, test } from 'vitest';
import type { Scope } from '../storage/scope.ts';
import { commandQueuedCap } from './command-queued-cap.ts';
import type { QuotaLimits } from './quota-limits.ts';

const tenant: Scope = { level: 'tenant', backendId: 'b', tenantId: 't' };
const asked: string[] = [];
const quotas: QuotaLimits = {
  limitOf: () => ({ kind: 'count', value: 0 }),
  queueOf: (_scope, queue) => {
    asked.push(queue);
    return { running: 4, queued: 12, weight: 1 };
  },
  fresh: async () => undefined,
};

describe('commandQueuedCap', () => {
  test('undefined without quotas, for a deployment scope and for a core action', () => {
    expect(commandQueuedCap({ scope: tenant }, { module: 'app' })).toBeUndefined();
    expect(
      commandQueuedCap({ quotas, scope: { level: 'deployment' } }, { module: 'app' }),
    ).toBeUndefined();
    expect(commandQueuedCap({ quotas, scope: tenant }, { module: 'core' })).toBeUndefined();
    expect(asked).toEqual([]);
  });

  test("the queue's queued limit of the scope otherwise", () => {
    expect(commandQueuedCap({ quotas, scope: tenant }, { module: 'app' })).toBe(12);
    expect(asked).toEqual(['commands']);
  });
});
