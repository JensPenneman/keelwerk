import { describe, expect, test } from 'vitest';
import { serviceModuleOf } from '../principals/service-module-of.ts';
import { principalOfActor } from './principal-of-actor.ts';

const scope = { level: 'tenant', backendId: 'b1', tenantId: 't1' } as const;

describe('principalOfActor', () => {
  test('a service actor of the module resolver is the principal the kernel mints for that module', () => {
    const principal = principalOfActor(
      { kind: 'service', id: 'loans.system', via: 'core.module' },
      scope,
    );
    expect(serviceModuleOf(principal)).toBe('loans');
    expect(principal.scope).toEqual({ backend: 'b1', tenant: 't1' });
  });

  test('any other service actor, whatever its id says, has no module', () => {
    for (const actor of [
      { kind: 'service', id: 'loans.system', via: 'explain' },
      { kind: 'service', id: 'loans.system', via: 'auth.keys' },
      { kind: 'service', id: 'loans', via: 'core.module' },
    ] as const) {
      const principal = principalOfActor(actor, scope);
      expect(principal.kind).toBe('service');
      expect(serviceModuleOf(principal)).toBeUndefined();
    }
  });
});
