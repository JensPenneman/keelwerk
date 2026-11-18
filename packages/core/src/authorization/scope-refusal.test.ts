import { describe, expect, test } from 'vitest';
import { scopeRefusal } from './scope-refusal.ts';

const kinds = ['service', 'user', 'system', 'anonymous'] as const;

describe('scopeRefusal', () => {
  test('a tenant action is allowed in a tenant unit and refused in a backend and a deployment unit, with the level message', () => {
    expect(scopeRefusal({ ref: 'm.a', scope: 'tenant' }, 'tenant', 'user')).toBeUndefined();
    expect(scopeRefusal({ ref: 'm.a', scope: 'tenant' }, 'backend', 'user')).toBe(
      '"m.a" runs at the tenant level, not at backend.',
    );
    expect(scopeRefusal({ ref: 'm.a', scope: 'tenant' }, 'deployment', 'user')).toBe(
      '"m.a" runs at the tenant level, not at deployment.',
    );
  });

  test('a backend action is allowed in a backend and a tenant unit', () => {
    expect(scopeRefusal({ ref: 'm.a', scope: 'backend' }, 'backend', 'user')).toBeUndefined();
    expect(scopeRefusal({ ref: 'm.a', scope: 'backend' }, 'tenant', 'user')).toBeUndefined();
    expect(scopeRefusal({ ref: 'm.a', scope: 'backend' }, 'deployment', 'user')).toBe(
      '"m.a" runs at the backend level, not at deployment.',
    );
  });

  test('an invocation action is allowed at every level', () => {
    for (const level of ['tenant', 'backend', 'deployment'] as const) {
      expect(scopeRefusal({ ref: 'm.a', scope: 'invocation' }, level, 'user')).toBeUndefined();
    }
  });

  test('a deployment action is allowed to an operator and refused to every other kind, the system principal included', () => {
    expect(
      scopeRefusal({ ref: 'm.a', scope: 'deployment' }, 'deployment', 'operator'),
    ).toBeUndefined();
    for (const kind of kinds) {
      expect(scopeRefusal({ ref: 'm.a', scope: 'deployment' }, 'deployment', kind)).toBe(
        '"m.a" is reachable by operator principals only.',
      );
    }
  });

  test('the level check comes first: a deployment action in a tenant unit names the level', () => {
    expect(scopeRefusal({ ref: 'm.a', scope: 'deployment' }, 'tenant', 'user')).toBe(
      '"m.a" runs at the deployment level, not at tenant.',
    );
  });
});
