import type { Carrier, InvocationSession, Invoker } from '@keelwerk/core';
import { answerExplain } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';

const session = {
  scope: { level: 'deployment' },
  app: 'core',
  principal: { kind: 'operator', subject: 'op', roles: [], scopes: [] },
  apiVersion: '2026-11-04',
  deprecation: null,
  resolvedBy: 'local',
  revalidate: () => Promise.reject(new Error('unused')),
} as unknown as InvocationSession;

const inner = {
  open: () => Promise.resolve({ ok: true, value: session }),
  invoke: () => Promise.reject(new Error('unused')),
  subscribe: () => {
    throw new Error('unused');
  },
} as unknown as Invoker;

const ask = (environment: 'development' | 'production', carrier: Carrier) =>
  answerExplain(inner, { options: { environment }, hybridClock: {} } as never).invoke({
    action: 'core.explain',
    input: { mode: 'trace', id: 'x' },
    carrier,
    requestId: 'r1',
    signal: new AbortController().signal,
  });

describe('who may explain', () => {
  test('an operator on a remote carrier is refused in production', async () => {
    const outcome = await ask('production', { transport: 'rest' });
    expect(outcome).toMatchObject({ ok: false, error: { kind: 'forbidden' } });
  });

  test('the operator socket is accepted in production, a remote carrier in development', async () => {
    // The request itself fails further on (the stub has no stores); only the gate is under test.
    for (const [environment, carrier] of [
      ['production', { transport: 'cli', local: { socket: '/run/kw.sock' } }],
      ['development', { transport: 'rest' }],
    ] as const) {
      const outcome = await ask(environment, carrier);
      expect(outcome.ok === false && outcome.error.kind).not.toBe('forbidden');
    }
  });
});
