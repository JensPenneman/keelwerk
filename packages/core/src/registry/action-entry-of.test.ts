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

describe('the dates of a deprecated action are refused where it is defined (section 18.5)', () => {
  const defined = (deprecated: object) => () =>
    buildRegistry(
      appOf([
        makeModule(
          { id: 'shop', entities: { widget } },
          { actions: { old: command({ deprecated }) } },
        ),
      ]),
    );

  test('a calendar date, an instant with an offset and no date are accepted', () => {
    expect(defined({ reason: 'x', at: '2026-12-01', sunset: '2027-01-01' })).not.toThrow();
    expect(defined({ reason: 'x', at: '2026-12-01T10:00:00+01:00' })).not.toThrow();
    expect(defined({ reason: 'x' })).not.toThrow();
  });

  test('a date-time without an offset is refused for at and for sunset', () => {
    expect(defined({ reason: 'x', at: '2026-12-01T10:00:00' })).toThrow(/invalidDeprecationDate/);
    expect(defined({ reason: 'x', sunset: '2026-12-01T10:00:00' })).toThrow(
      /invalidDeprecationDate/,
    );
  });

  test('a text such as Dec 1, 2026 is refused for at and for sunset', () => {
    expect(defined({ reason: 'x', at: 'Dec 1, 2026' })).toThrow(/shop.old.*'Dec 1, 2026'/);
    expect(defined({ reason: 'x', sunset: 'Dec 1, 2026' })).toThrow(/invalidDeprecationDate/);
  });
});
