import { describe, expect, test } from 'vitest';
import type { Scope } from '../storage/scope.ts';
import { queuedCapOf } from './queued-cap-of.ts';
import type { QuotaView } from './quota-view.ts';

const tenant: Scope = { level: 'tenant', backendId: 'b', tenantId: 't' };
const asked: [string, string][] = [];
const limits: QuotaView = {
  limitOf: () => ({ kind: 'count', value: 0 }),
  queueOf: (_scope, queue) => {
    asked.push([queue, 'queueOf']);
    return { running: 4, queued: queue === 'timers' ? 7 : 12, weight: 1 };
  },
};

describe('queuedCapOf', () => {
  test('undefined without limits, for a deployment scope and for a core module', () => {
    expect(queuedCapOf(undefined, tenant, 'commands', 'app')).toBeUndefined();
    expect(queuedCapOf(limits, { level: 'deployment' }, 'commands', 'app')).toBeUndefined();
    expect(queuedCapOf(limits, tenant, 'commands', 'core')).toBeUndefined();
    expect(asked).toEqual([]);
  });

  test("the named queue's queued limit of the scope otherwise", () => {
    expect(queuedCapOf(limits, tenant, 'commands', 'app')).toBe(12);
    expect(queuedCapOf(limits, tenant, 'timers', 'app')).toBe(7);
    expect(asked).toEqual([
      ['commands', 'queueOf'],
      ['timers', 'queueOf'],
    ]);
  });
});
