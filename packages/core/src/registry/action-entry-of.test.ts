import { describe, expect, test } from 'vitest';
import { appOf, command, makeModule, widget } from '../../test/registry-kit.ts';
import { buildRegistry } from './build-registry.ts';

const registry = buildRegistry(
  appOf([
    makeModule(
      { id: 'shop', entities: { widget } },
      {
        actions: {
          plain: command(),
          backend: command({ scope: 'backend' }),
          issued: command({ scope: 'invocation' }),
        },
      },
    ),
  ]),
);

describe('the scope of an action entry (section 7.3)', () => {
  test('a command that declares nothing runs at the tenant level', () => {
    expect(registry.actions.get('shop.plain')?.scope).toBe('tenant');
  });

  test('a declared scope is the entry scope, and invocation is one of them', () => {
    expect(registry.actions.get('shop.backend')?.scope).toBe('backend');
    expect(registry.actions.get('shop.issued')?.scope).toBe('invocation');
  });
});
