import { describe, expect, test } from 'vitest';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Scope } from '../storage/scope.ts';
import { checkEffectScope } from './check-effect-scope.ts';

const scopes: Record<'tenant' | 'backend' | 'deployment', Scope> = {
  tenant: { level: 'tenant', backendId: 'b', tenantId: 't' },
  backend: { level: 'backend', backendId: 'b' },
  deployment: { level: 'deployment' },
};
const user = { kind: 'user' } as const;
const action = (scope: ActionEntry['scope']) => ({ ref: 'm.act', scope });

const allowed: readonly (readonly [
  keyof typeof scopes,
  ActionEntry['scope'],
  'same' | 'backend',
])[] = [
  ['tenant', 'tenant', 'same'],
  ['backend', 'backend', 'same'],
  ['deployment', 'deployment', 'same'],
  ['tenant', 'invocation', 'same'],
  ['backend', 'invocation', 'same'],
  ['deployment', 'invocation', 'same'],
  ['tenant', 'backend', 'backend'],
];
const refused: readonly (readonly [keyof typeof scopes, ActionEntry['scope']])[] = [
  ['backend', 'tenant'],
  ['tenant', 'deployment'],
  ['backend', 'deployment'],
  ['deployment', 'backend'],
  ['deployment', 'tenant'],
];

describe('where the command of an effect runs', () => {
  test.each(allowed)('a %s unit reaches a %s command as %s', (unit, target, placement) => {
    expect(checkEffectScope(scopes[unit], action(target), 'enqueue', user)).toBe(placement);
  });

  test.each(refused)('a %s unit cannot reach a %s command', (unit, target) => {
    expect(() => checkEffectScope(scopes[unit], action(target), 'invoke', user)).toThrow(
      expect.objectContaining({ kind: 'internal', code: 'core.request_not_allowed' }),
    );
  });

  test('a timer is judged for the service principal it runs as, whatever principal decided', () => {
    expect(
      checkEffectScope(scopes.tenant, action('backend'), 'setTimer', { kind: 'service' }),
    ).toBe('backend');
  });

  test('a system principal is refused for backend', () => {
    expect(() =>
      checkEffectScope(scopes.tenant, action('backend'), 'invoke', { kind: 'system' }),
    ).toThrow(expect.objectContaining({ code: 'core.request_not_allowed' }));
    expect(checkEffectScope(scopes.tenant, action('tenant'), 'invoke', { kind: 'system' })).toBe(
      'same',
    );
  });
});
