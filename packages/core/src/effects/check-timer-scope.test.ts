import { expect, test } from 'vitest';
import type { Scope } from '../storage/scope.ts';
import { checkTimerScope } from './check-timer-scope.ts';

const tenant: Scope = { level: 'tenant', backendId: 'b', tenantId: 't' };
const backend: Scope = { level: 'backend', backendId: 'b' };
const user = { kind: 'user' } as const;

test('a timer of a command of the unit own level is allowed', () => {
  expect(() => checkTimerScope(tenant, { ref: 'm.t', scope: 'tenant' }, user)).not.toThrow();
  expect(() => checkTimerScope(backend, { ref: 'm.b', scope: 'backend' }, user)).not.toThrow();
  expect(() => checkTimerScope(tenant, { ref: 'm.i', scope: 'invocation' }, user)).not.toThrow();
});

test('a timer of a backend command from a tenant unit is refused for a user and a service principal', () => {
  for (const principal of [user, { kind: 'service' }] as const) {
    expect(() => checkTimerScope(tenant, { ref: 'm.b', scope: 'backend' }, principal)).toThrow(
      expect.objectContaining({
        code: 'core.request_not_allowed',
        details: expect.objectContaining({
          reason: expect.stringContaining('a timer does not cross scopes'),
        }),
      }),
    );
  }
});

test('a system principal is refused as for every effect', () => {
  expect(() =>
    checkTimerScope(tenant, { ref: 'm.b', scope: 'backend' }, { kind: 'system' }),
  ).toThrow(expect.objectContaining({ code: 'core.request_not_allowed' }));
});

test('the pairs no effect reaches stay refused', () => {
  expect(() => checkTimerScope(backend, { ref: 'm.t', scope: 'tenant' }, user)).toThrow(
    expect.objectContaining({ code: 'core.request_not_allowed' }),
  );
});
