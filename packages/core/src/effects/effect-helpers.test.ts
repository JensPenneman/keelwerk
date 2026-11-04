import { describe, expect, test } from 'vitest';
import { post } from '../../test/fixtures/modules/hooks/src/effects/post.ts';
import { isOwnModuleAction } from '../reactions/is-own-module-action.ts';
import { moduleServicePrincipal } from '../reactions/module-service-principal.ts';
import { deriveEffectId } from './derive-effect-id.ts';
import { durationMs } from './duration-ms.ts';
import { plannedEffectIds } from './planned-effect-ids.ts';
import { settledEffectDraft } from './settled-effect-draft.ts';

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

  test('<module>.system may invoke the actions of its own module only', () => {
    const principal = moduleServicePrincipal('library', caused);
    expect(principal).toMatchObject({ kind: 'service', id: 'library.system', via: 'core.module' });
    expect(principal.scope).toEqual({ backend: 'b-1', tenant: 't-1' });
    expect(isOwnModuleAction(principal, { module: 'library' })).toBe(true);
    expect(isOwnModuleAction(principal, { module: 'loans' })).toBe(false);
  });
});

describe('defineEffect', () => {
  test('keeps the input and the output shape on the part', () => {
    expect(Object.keys(post.input.fields)).toEqual(['url', 'signingKey', 'body']);
    expect(Object.keys(post.output.fields)).toEqual(['status']);
  });
});

describe('settledEffectDraft', () => {
  const at = Temporal.Instant.from('2026-01-01T00:00:10Z');

  test('a success stores the output, its canonical digest, one attempt and the time', () => {
    expect(settledEffectDraft('e-1', at, { ok: true, value: { ok: true } })).toEqual({
      kind: 'update',
      type: 'changed',
      target: 'core.effect',
      entity: 'core.effect',
      id: 'e-1',
      values: {
        status: 'succeeded',
        attempts: 1,
        output: { ok: true },
        outputDigest: '4062edaf750fb8074e7e83e0c9028c94e32468a8b6f1614774328ef045150f93',
        settledAt: at,
      },
    });
  });

  test('a failure stores the error, one attempt and the time', () => {
    const error = {
      code: 'core.unavailable',
      kind: 'unavailable',
      message: 'down',
      retryable: false,
    } as const;
    expect(settledEffectDraft('e-1', at, { ok: false, error })).toEqual({
      kind: 'update',
      type: 'changed',
      target: 'core.effect',
      entity: 'core.effect',
      id: 'e-1',
      values: { status: 'failed', attempts: 1, error, settledAt: at },
    });
  });
});
