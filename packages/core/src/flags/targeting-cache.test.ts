import { describe, expect, test, vi } from 'vitest';
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

  test('with the store unreadable a kill switch keeps its last loaded value, with STALE, where another flag serves its default', async () => {
    const closed = { enabled: true, rules: [], fallthrough: { value: false } };
    const ordinary: FlagSpec<boolean> = { ...checkoutFlag, default: true };
    const killSwitch: FlagSpec<boolean> = { ...ordinary, purpose: 'kill-switch' };
    const r = targetingRig([storedFlagRow(closed)]);
    const read = (flag: FlagSpec<boolean>) => r.cache.provider.resolve(flag, tenantContext());
    await r.cache.fresh();
    r.fail(true);
    r.advance(1_000);
    await r.cache.fresh();
    r.advance(28_999);
    expect(read(killSwitch)).toMatchObject({ value: false, reason: 'STATIC' });
    r.advance(1);
    expect(read(killSwitch)).toMatchObject({
      value: false,
      reason: 'STALE',
      provider: 'core.targeting',
      ruleVersion: 1,
    });
    expect(read(ordinary)).toMatchObject({ value: true, reason: 'STALE' });
    r.stop();
  });

  test('a kill switch last loaded open stays open past the stale bound, and the fresh value serves once the store answers', async () => {
    const killSwitch: FlagSpec<boolean> = {
      ...checkoutFlag,
      default: true,
      purpose: 'kill-switch',
    };
    const r = targetingRig([storedFlagRow(targetingOn)]);
    const read = () => r.cache.provider.resolve(killSwitch, tenantContext());
    await r.cache.fresh();
    r.fail(true);
    r.advance(30_000);
    await r.cache.fresh();
    expect(read()).toMatchObject({ value: true, reason: 'STALE' });
    r.fail(false);
    r.set([
      storedFlagRow({ enabled: true, rules: [], fallthrough: { value: false } }, { version: 2 }),
    ]);
    r.advance(1_000);
    await r.cache.fresh();
    expect(read()).toMatchObject({ value: false, reason: 'STATIC', ruleVersion: 2 });
    r.stop();
  });

  test('a stored row that cannot be read as declared serves a kill switch closed and another flag its default, both with PARSE_ERROR', async () => {
    const ordinary: FlagSpec<boolean> = { ...checkoutFlag, default: true };
    const killSwitch: FlagSpec<boolean> = { ...ordinary, purpose: 'kill-switch' };
    const r = targetingRig([
      storedFlagRow(
        { enabled: 'yes', rules: [], fallthrough: { value: true } },
        { backendId: 'b1' },
      ),
      storedFlagRow(
        { enabled: true, rules: [], fallthrough: { value: 'open' } },
        { id: 'flg-2', backendId: 'b2' },
      ),
    ]);
    await r.cache.fresh();
    for (const backendId of ['b1', 'b2']) {
      const read = (flag: FlagSpec<boolean>) =>
        r.cache.provider.resolve(flag, tenantContext(backendId));
      expect(read(killSwitch)).toMatchObject({
        value: false,
        reason: 'ERROR',
        errorCode: 'PARSE_ERROR',
      });
      expect(read(ordinary)).toMatchObject({
        value: true,
        reason: 'ERROR',
        errorCode: 'PARSE_ERROR',
      });
    }
    r.stop();
  });

  test('firstLoad rejects with the failure of the read while the store is unreadable and settles once it answers', async () => {
    const r = targetingRig([storedFlagRow(targetingOn)]);
    r.fail(true);
    await expect(r.cache.firstLoad()).rejects.toThrow('control store down');
    expect(readCheckout(r.cache)).toBeUndefined();
    r.fail(false);
    await r.cache.firstLoad();
    expect(readCheckout(r.cache)).toMatchObject({ value: true, reason: 'STATIC' });
    r.stop();
  });

  test('a first read that does not answer within the read bound makes firstLoad reject with core.unavailable', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const r = targetingRig([storedFlagRow(targetingOn)], { readMs: 20 });
      r.hold(true);
      const loading = expect(r.cache.firstLoad()).rejects.toMatchObject({
        code: 'core.unavailable',
      });
      await vi.advanceTimersByTimeAsync(20);
      await loading;
      r.hold(false);
      r.release();
      r.stop();
    } finally {
      vi.useRealTimers();
    }
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
