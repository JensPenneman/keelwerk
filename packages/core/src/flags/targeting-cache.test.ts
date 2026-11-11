import { describe, expect, test } from 'vitest';
import {
  checkoutFlag,
  readCheckout,
  storedFlagRow,
  targetingOff,
  targetingOn,
  targetingRig,
  tenantContext,
} from '../../test/targeting-cache-kit.ts';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { FlagContext } from './flag-context.ts';
import type { FlagSpec } from './flag-spec.ts';

describe('createTargetingCache', () => {
  test('the first fresh() loads and the provider answers from the rows', async () => {
    const { cache, loads, stop } = targetingRig([storedFlagRow(targetingOn)]);
    expect(readCheckout(cache)).toBeUndefined();
    await cache.fresh();
    expect(loads()).toBe(1);
    expect(readCheckout(cache)).toMatchObject({
      value: true,
      reason: 'STATIC',
      provider: 'core.targeting',
    });
    stop();
  });

  test('a wake of the feed reloads', async () => {
    const r = targetingRig([storedFlagRow(targetingOn)]);
    await r.cache.fresh();
    r.set([storedFlagRow(targetingOff, { version: 2 })]);
    r.wake();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(r.loads()).toBe(2);
    expect(readCheckout(r.cache)).toMatchObject({ reason: 'DISABLED', ruleVersion: 2 });
    r.stop();
  });

  test('with the feed down a flag turned off is served until 1 s after the last load, then DISABLED', async () => {
    const r = targetingRig([storedFlagRow(targetingOn)]);
    await r.cache.fresh();
    r.set([storedFlagRow(targetingOff, { version: 2 })]);
    r.advance(999);
    await r.cache.fresh();
    expect(r.loads()).toBe(1);
    expect(readCheckout(r.cache)).toMatchObject({ reason: 'STATIC', value: true });
    r.advance(1);
    await r.cache.fresh();
    expect(r.loads()).toBe(2);
    expect(readCheckout(r.cache)).toMatchObject({ reason: 'DISABLED' });
    r.stop();
  });

  test('with the store unreadable the rows serve until 30 s, then the default with STALE', async () => {
    const r = targetingRig([storedFlagRow(targetingOn)]);
    await r.cache.fresh();
    r.fail(true);
    r.advance(1_000);
    await r.cache.fresh();
    expect(r.errors.length).toBeGreaterThan(0);
    r.advance(28_999);
    await r.cache.fresh();
    expect(readCheckout(r.cache)).toMatchObject({ reason: 'STATIC', value: true });
    r.advance(1);
    expect(readCheckout(r.cache)).toMatchObject({
      reason: 'STALE',
      value: false,
      provider: 'core.targeting',
    });
    r.stop();
  });

  test('a second caller does not wait for a load in flight', async () => {
    const r = targetingRig([storedFlagRow(targetingOn)]);
    await r.cache.fresh();
    r.advance(1_000);
    r.hold(true);
    const first = r.cache.fresh();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await r.cache.fresh();
    expect(r.loads()).toBe(2);
    r.hold(false);
    r.release();
    await first;
    r.stop();
  });

  test("a backend's row wins over the deployment-wide one; another backend's row never answers; deployment scope reads the deployment-wide row only", async () => {
    const r = targetingRig([
      storedFlagRow(targetingOn),
      storedFlagRow(targetingOff, { id: 'flg-2', backendId: 'b1', version: 2 }),
      storedFlagRow(targetingOff, { id: 'flg-3', backendId: 'b2', version: 3 }),
    ]);
    await r.cache.fresh();
    expect(readCheckout(r.cache, 'b1')).toMatchObject({ reason: 'DISABLED', ruleVersion: 2 });
    expect(readCheckout(r.cache, 'b3')).toMatchObject({ reason: 'STATIC', ruleVersion: 1 });
    const deployment: FlagContext = { ...tenantContext(), scope: { level: 'deployment' } };
    expect(r.cache.provider.resolve(checkoutFlag, deployment)).toMatchObject({
      reason: 'STATIC',
      ruleVersion: 1,
    });
    r.stop();
  });

  test('a row that fails its check is left out and logged', async () => {
    const r = targetingRig([
      storedFlagRow({ enabled: true, rules: [], fallthrough: { value: 'x', extra: 1 } }),
    ]);
    await r.cache.fresh();
    expect(r.errors).toEqual([
      'a stored flag targeting is invalid; its flag serves the declared default',
    ]);
    expect(readCheckout(r.cache)).toMatchObject({
      reason: 'ERROR',
      errorCode: 'PARSE_ERROR',
      value: false,
    });
    await r.cache.fresh();
    r.advance(1_000);
    await r.cache.fresh();
    expect(r.errors).toHaveLength(1);
    r.stop();
  });

  test('a stored row that compiles but no longer fits the declaration serves the default with ERROR and logs once', async () => {
    const bounded: FlagSpec<number> = {
      key: 'shop.checkout',
      kind: 'number',
      level: 'tenant',
      default: 5,
      min: 1,
      max: 10,
      purpose: 'release',
    };
    const r = targetingRig([
      storedFlagRow({ enabled: true, rules: [], fallthrough: { value: 50 } }, { version: 4 }),
    ]);
    await r.cache.fresh();
    const answer = () => r.cache.provider.resolve(bounded, tenantContext());
    for (let call = 0; call < 3; call++) {
      expect(answer()).toMatchObject({
        reason: 'ERROR',
        errorCode: 'PARSE_ERROR',
        value: 5,
        ruleVersion: 4,
      });
    }
    expect(r.errors).toEqual([
      'a stored flag targeting does not fit the flag declaration; the declared default was served',
    ]);
    r.stop();
  });

  test("a json flag's schema is checked at load too", async () => {
    const document: FlagSpec<unknown> = {
      key: 'shop.checkout',
      kind: 'json',
      level: 'tenant',
      default: { size: 1 },
      schema: shape({ size: field.integer() }),
      purpose: 'release',
    };
    const r = targetingRig([
      storedFlagRow({
        enabled: true,
        rules: [],
        fallthrough: { value: { size: 'big' }, variant: 'big' },
      }),
    ]);
    await r.cache.fresh();
    expect(r.cache.provider.resolve(document, tenantContext())).toMatchObject({
      reason: 'ERROR',
      errorCode: 'PARSE_ERROR',
    });
    r.stop();
  });

  test('one deployment-wide row is checked against each declaration of the key on its own', async () => {
    const declare = (max: number): FlagSpec<number> => ({
      key: 'shop.checkout',
      kind: 'number',
      level: 'tenant',
      default: 1,
      min: 1,
      max,
      purpose: 'release',
    });
    const loose = declare(10);
    const strict = declare(5);
    const r = targetingRig([
      storedFlagRow({ enabled: true, rules: [], fallthrough: { value: 8 } }),
    ]);
    await r.cache.fresh();
    expect(r.cache.provider.resolve(loose, tenantContext())).toMatchObject({ value: 8 });
    expect(r.cache.provider.resolve(strict, tenantContext())).toMatchObject({
      reason: 'ERROR',
      errorCode: 'PARSE_ERROR',
      value: 1,
    });
    r.stop();
  });
});
