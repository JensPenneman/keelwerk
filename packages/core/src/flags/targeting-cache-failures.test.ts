import { describe, expect, test } from 'vitest';
import {
  readCheckout,
  storedFlagRow,
  targetingOff,
  targetingOn,
  targetingRig,
  tenantContext,
} from '../../test/targeting-cache-kit.ts';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { FlagSpec } from './flag-spec.ts';

describe('createTargetingCache, when the store or the feed fails', () => {
  test('a read that never answers does not block the first snapshots; the flag passes on, and the store is read again once it answers', async () => {
    const r = targetingRig([storedFlagRow(targetingOn)], { readMs: 20 });
    r.hold(true);
    await r.cache.fresh();
    await r.cache.fresh();
    expect(readCheckout(r.cache)).toBeUndefined();
    expect(r.errors).toEqual([
      'the flag targeting could not be loaded; the last rows keep serving',
    ]);
    r.hold(false);
    r.release();
    r.advance(1_000);
    await r.cache.fresh();
    expect(r.loads()).toBe(2);
    expect(readCheckout(r.cache)).toMatchObject({ reason: 'STATIC', value: true });
    r.stop();
  });

  test('a reload that never answers does not block a snapshot or jam the cache; the last rows serve, then STALE, and a later read recovers', async () => {
    const r = targetingRig([storedFlagRow(targetingOn)], { readMs: 20 });
    await r.cache.fresh();
    r.hold(true);
    r.advance(1_000);
    await r.cache.fresh();
    expect(readCheckout(r.cache)).toMatchObject({ reason: 'STATIC', value: true });
    r.advance(28_999);
    expect(readCheckout(r.cache)).toMatchObject({ reason: 'STATIC', value: true });
    r.advance(1);
    expect(readCheckout(r.cache)).toMatchObject({ reason: 'STALE', value: false });
    r.hold(false);
    r.release();
    await r.cache.fresh();
    expect(r.loads()).toBe(3);
    expect(readCheckout(r.cache)).toMatchObject({ reason: 'STATIC', value: true });
    r.stop();
  });

  test('a feed that fails is subscribed again and the rows are loaded once after it', async () => {
    const r = targetingRig([storedFlagRow(targetingOn)], { resubscribeMs: 5 });
    r.failFeed(1);
    await r.cache.fresh();
    expect(r.subscriptions()).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(r.subscriptions()).toBe(2);
    expect(r.errors).toContain('the flag change feed failed; it is subscribed again');
    expect(r.loads()).toBe(2);
    r.set([storedFlagRow(targetingOff, { version: 2 })]);
    r.wake();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(r.loads()).toBe(3);
    expect(readCheckout(r.cache)).toMatchObject({ reason: 'DISABLED', ruleVersion: 2 });
    r.stop();
  });

  test('a stored row whose key no flag can have is ignored and never takes the slot of a backend row', async () => {
    const r = targetingRig([
      // The store reads rows in id order: the forged row comes after the real one and would win a later Map.set.
      storedFlagRow(targetingOn, { id: 'flg-2', backendId: 'b2', version: 2 }),
      storedFlagRow(targetingOff, { id: 'flg-9', key: 'shop.checkout@b2', version: 9 }),
    ]);
    await r.cache.fresh();
    expect(readCheckout(r.cache, 'b2')).toMatchObject({
      reason: 'STATIC',
      value: true,
      ruleVersion: 2,
    });
    expect(r.errors).toEqual(['a stored flag row has a key no flag can have; the row is ignored']);
    r.stop();
  });

  test('a deployment-wide row that lists principals is an error of its key; a backend row may list them', async () => {
    const listed = {
      enabled: true,
      rules: [{ id: 'r1', principals: ['u1'], serve: { value: false } }],
      fallthrough: { value: true },
    };
    const r = targetingRig([
      storedFlagRow(listed, { id: 'flg-1', backendId: null }),
      storedFlagRow(listed, { id: 'flg-2', backendId: 'b2', version: 2 }),
    ]);
    await r.cache.fresh();
    expect(readCheckout(r.cache, 'b1')).toMatchObject({
      reason: 'ERROR',
      errorCode: 'PARSE_ERROR',
    });
    expect(readCheckout(r.cache, 'b2')).toMatchObject({ reason: 'TARGETING_MATCH', ruleId: 'r1' });
    expect(r.errors).toEqual([
      'a stored flag targeting is invalid; its flag serves the declared default',
    ]);
    r.stop();
  });

  test('a stored json value that its shape converts is an error of its key', async () => {
    const document: FlagSpec = {
      key: 'shop.checkout',
      kind: 'json',
      level: 'tenant',
      purpose: 'release',
      schema: shape({ size: field.integer().default(3) }),
      default: { size: 1 },
    };
    const stored = (value: unknown) =>
      storedFlagRow({ enabled: true, rules: [], fallthrough: { value, variant: 'v' } });
    const converted = targetingRig([stored({})]);
    await converted.cache.fresh();
    expect(converted.cache.provider.resolve(document, tenantContext())).toMatchObject({
      reason: 'ERROR',
      errorCode: 'PARSE_ERROR',
    });
    const unchanged = targetingRig([stored({ size: 3 })]);
    await unchanged.cache.fresh();
    expect(unchanged.cache.provider.resolve(document, tenantContext())).toMatchObject({
      reason: 'STATIC',
      value: { size: 3 },
    });
    converted.stop();
    unchanged.stop();
  });

  test('at most two reads are outstanding: with reads that never settle no third starts, and when one settles loading resumes', async () => {
    const r = targetingRig([storedFlagRow(targetingOn)], { readMs: 20 });
    r.hold(true);
    await r.cache.fresh();
    r.advance(1_000);
    await r.cache.fresh();
    expect(r.loads()).toBe(2);
    r.advance(1_000);
    await r.cache.fresh();
    r.advance(1_000);
    await r.cache.fresh();
    r.wake();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(r.loads()).toBe(2);
    r.hold(false);
    r.release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    r.advance(1_000);
    await r.cache.fresh();
    expect(r.loads()).toBe(3);
    expect(readCheckout(r.cache)).toMatchObject({ reason: 'STATIC', value: true });
    r.stop();
  });
});
