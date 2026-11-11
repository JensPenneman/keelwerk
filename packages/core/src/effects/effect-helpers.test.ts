import { describe, expect, test } from 'vitest';
import { post } from '../../test/fixtures/modules/hooks/src/effects/post.ts';
import { effectiveRules } from '../authorization/effective-rules.ts';
import { moduleServicePrincipal } from '../reactions/module-service-principal.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import { authorizeInvoke } from './authorize-invoke.ts';
import { deriveEffectId } from './derive-effect-id.ts';
import { durationMs } from './duration-ms.ts';
import { plannedEffectIds } from './planned-effect-ids.ts';

const tenant = { level: 'tenant', backendId: 'b-1', tenantId: 't-1' } as const;

describe('durationMs', () => {
  test.each([
    ['45s', 45_000],
    ['2m', 120_000],
    ['500ms', 500],
    ['1h', 3_600_000],
    ['2d', 172_800_000],
    ['PT24H', 86_400_000],
    ['P30D', 2_592_000_000],
  ])('%s is %i ms', (text, ms) => {
    expect(durationMs(text)).toBe(ms);
  });

  test('refuses text that is no duration', () => {
    expect(() => durationMs('soon')).toThrowError(
      expect.objectContaining({ code: 'core.malformed_request' }),
    );
  });
});

describe('effect ids', () => {
  test('derive from the scope, the cause and the index, and from nothing else', () => {
    const first = deriveEffectId(tenant, 'c1', 0);
    expect(first).toBe(deriveEffectId(tenant, 'c1', 0));
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(
      new Set([first, deriveEffectId(tenant, 'c1', 1), deriveEffectId(tenant, 'c2', 0)]).size,
    ).toBe(3);
    expect(first).not.toBe(deriveEffectId({ ...tenant, tenantId: 't-2' }, 'c1', 0));
  });

  test('the planned ids are those of the external effects, by their index among all effects', () => {
    const effects = [
      { kind: 'cancelTimer', type: 'cancelTimer', key: 'k' },
      { kind: 'external', type: 'hooks.post', input: {} },
    ] as const;
    expect(plannedEffectIds(tenant, 'c1', effects)).toEqual([deriveEffectId(tenant, 'c1', 1)]);
  });
});

describe('module service principals', () => {
  const caused = { scope: { backend: 'b-1', tenant: 't-1' } } as never;
  const registry = {
    modules: [
      { id: 'a', flags: {} },
      { id: 'b', flags: {} },
    ],
    entities: new Map(),
    rules: new Map(),
  } as unknown as Registry;
  const action = (module: string): ActionEntry =>
    ({
      ref: `${module}.z`,
      module,
      name: 'z',
      kind: 'command',
      auth: 'policy',
      scope: 'tenant',
    }) as never;
  const invoke = (
    principal: ReturnType<typeof moduleServicePrincipal>,
    module: string,
    caller: string,
  ) =>
    authorizeInvoke({
      registry,
      rules: effectiveRules(registry),
      action: action(module),
      principal,
      scope: tenant,
      input: {},
      caller,
    });

  test('the principal is a kernel-minted object of its module, frozen', () => {
    const principal = moduleServicePrincipal('library', caused);
    expect(principal).toMatchObject({ kind: 'service', id: 'library.system', via: 'core.module' });
    expect(principal.scope).toEqual({ backend: 'b-1', tenant: 't-1' });
    expect(Object.isFrozen(principal)).toBe(true);
  });

  test('the own action passes through the default rule, and only for the own module', () => {
    const principal = moduleServicePrincipal('b', caused);
    expect(() => invoke(principal, 'b', 'b')).not.toThrow();
    expect(() => invoke(principal, 'a', 'b')).toThrowError(
      expect.objectContaining({ kind: 'forbidden' }),
    );
  });

  test("B.system invoking B.z from A's code is forbidden", () => {
    const principal = moduleServicePrincipal('b', caused);
    expect(() => invoke(principal, 'b', 'a')).toThrowError(
      expect.objectContaining({
        kind: 'forbidden',
        reason: expect.stringContaining('Only the code of b'),
      }),
    );
  });
});

describe('defineEffect', () => {
  test('keeps the input and the output shape on the part', () => {
    expect(Object.keys(post.input.fields)).toEqual(['url', 'signingKey', 'body']);
    expect(Object.keys(post.output.fields)).toEqual(['status']);
  });
});
