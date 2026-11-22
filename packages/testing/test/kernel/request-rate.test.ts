import { errors, field, type LiveHub, shape } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { bootKeys, storedName } from './support/admission-kit.ts';
import {
  ada,
  call,
  failure,
  head,
  kit,
  otherTenantId,
  publicQuery,
  tenantId,
} from './support/invoker-kit.ts';
import { quotasOf, tenantOnly } from './support/rate-quota-kit.ts';
import { namespace, tenant, userOf } from './support/run-read-kit.ts';

async function setup(capacities: Readonly<Record<string, number>>) {
  const keys = await bootKeys();
  const probe = publicQuery(
    'rateProbe',
    // biome-ignore lint/correctness/useYield: a handler that loads nothing
    function* () {
      return {};
    },
    { input: shape({ who: field.string() }) },
  );
  const made = kit({ registry: probe.registry, keys, quotas: tenantOnly(capacities) });
  return { keys, probe, ...made };
}

const asOther = { ...ada, headers: { ...ada.headers, 'x-tenant': otherTenantId } };
const signedIn = (subject: string) => ({
  ...ada,
  headers: { ...ada.headers, authorization: `Bearer tok-${subject}` },
});
const fromAddress = (address: string) => ({
  transport: 'test',
  headers: { 'x-tenant': tenantId },
  connection: {
    id: `c-${address}`,
    listener: 'http',
    remote: { address, port: 40_000 },
    local: { address: '10.0.0.1', port: 443 },
  },
});

describe('request rate (section 12.2)', () => {
  test('tenant A over its request rate gets rate_limited with retryAfter while tenant B is served', async () => {
    const { invoker, probe } = await setup({ 'core.requestRate': 2 });
    for (let n = 0; n < 2; n++) {
      const served = await invoker.invoke(call(probe.ref, { who: 'x' }, { carrier: ada }));
      expect(served.ok).toBe(true);
    }
    const refused = failure(await invoker.invoke(call(probe.ref, { who: 'x' }, { carrier: ada })));
    expect(refused.kind).toBe('rate_limited');
    expect(refused.code).toBe('core.rate_limited');
    expect(refused.retryAfter).toBeGreaterThanOrEqual(1);
    for (let n = 0; n < 5; n++) {
      const served = await invoker.invoke(call(probe.ref, { who: 'x' }, { carrier: asOther }));
      expect(served.ok).toBe(true);
    }
  });

  test('the first request of a tenant takes one token of kw_rate_buckets under the core module', async () => {
    const { keys, adapter, invoker, probe } = await setup({});
    const served = await invoker.invoke(call(probe.ref, { who: 'x' }, { carrier: ada }));
    expect(served.ok).toBe(true);
    const stored = await storedName(keys, tenant, 'core.requestRate', 'core');
    const limits = { capacity: 100, refillPerSecond: 0.001 };
    const level = (cost: number) =>
      adapter.unit(namespace, tenant, (unit) => unit.buckets.check(stored, cost, limits));
    expect((await level(99)).ok).toBe(true);
    expect((await level(100)).ok).toBe(false);
  });

  test('a user over the principal rate spends nothing of the tenant rate, so other users are served', async () => {
    const { invoker, probe } = await setup({
      'core.principalRequestRate': 2,
      'core.requestRate': 5,
    });
    let served = 0;
    for (let n = 0; n < 20; n++) {
      const result = await invoker.invoke(call(probe.ref, { who: 'x' }, { carrier: ada }));
      if (result.ok) served += 1;
    }
    expect(served).toBe(2);
    for (const subject of ['bob', 'eve']) {
      for (let n = 0; n < 2; n++) {
        const result = await invoker.invoke(
          call(probe.ref, { who: 'x' }, { carrier: signedIn(subject) }),
        );
        expect(result.ok).toBe(n < (subject === 'bob' ? 2 : 1));
      }
    }
  });

  test('anonymous callers spend their own address share, so the users of the tenant are served', async () => {
    const { invoker, probe } = await setup({
      'core.principalRequestRate': 2,
      'core.requestRate': 5,
    });
    let served = 0;
    for (let n = 0; n < 20; n++) {
      const result = await invoker.invoke(
        call(probe.ref, { who: 'x' }, { carrier: fromAddress('203.0.113.7') }),
      );
      if (result.ok) served += 1;
    }
    expect(served).toBe(2);
    const elsewhere = await invoker.invoke(
      call(probe.ref, { who: 'x' }, { carrier: fromAddress('203.0.113.8') }),
    );
    expect(elsewhere.ok).toBe(true);
    for (let n = 0; n < 2; n++) {
      const result = await invoker.invoke(call(probe.ref, { who: 'x' }, { carrier: ada }));
      expect(result.ok).toBe(true);
    }
  });

  test('an anonymous caller that rotates addresses inside one /64 is refused at its principal capacity while another /64 is served', async () => {
    const { invoker, probe } = await setup({ 'core.principalRequestRate': 2 });
    let served = 0;
    for (let n = 1; n <= 20; n++) {
      const result = await invoker.invoke(
        call(probe.ref, { who: 'x' }, { carrier: fromAddress(`2001:db8:1:2::${n}`) }),
      );
      if (result.ok) served += 1;
    }
    expect(served).toBe(2);
    const elsewhere = await invoker.invoke(
      call(probe.ref, { who: 'x' }, { carrier: fromAddress('2001:db8:1:3::1') }),
    );
    expect(elsewhere.ok).toBe(true);
  });

  test('an IPv4-mapped address and its IPv4 address share one principal bucket', async () => {
    const { invoker, probe } = await setup({ 'core.principalRequestRate': 2 });
    const results: boolean[] = [];
    for (const address of [
      '::ffff:203.0.113.7',
      '203.0.113.7',
      '::ffff:cb00:7107',
      '203.0.113.7',
    ]) {
      const result = await invoker.invoke(
        call(probe.ref, { who: 'x' }, { carrier: fromAddress(address) }),
      );
      results.push(result.ok);
    }
    expect(results).toEqual([true, true, false, false]);
  });
});

/**
 * The tokens taken so far from a bucket of `capacity` that refills 0.001 a second, read through
 * the store's own check on the pinned clock: the largest cost the bucket still allows is what is
 * left.
 */
async function tokensTakenOf(
  adapter: ReturnType<typeof kit>['adapter'],
  keys: Awaited<ReturnType<typeof bootKeys>>,
  bucket: string,
  capacity: number,
): Promise<number> {
  const stored = await storedName(keys, tenant, bucket, 'core');
  const limits = { capacity, refillPerSecond: 0.001 };
  for (let left = capacity; left >= 0; left -= 1) {
    const read = await adapter.unit(namespace, tenant, (unit) =>
      unit.buckets.check(stored, left, limits),
    );
    if (read.ok) return capacity - left;
  }
  return capacity;
}

const adaSubject = (() => {
  const principal = userOf('ada');
  return principal.kind === 'user' ? String(principal.subject) : '';
})();
const ratesOf = (capacity: number) => ({
  'core.principalRequestRate': capacity,
  'core.commandRate': capacity,
  'core.queryRate': capacity,
  'core.subscribeRate': capacity,
  'core.requestRate': capacity,
});
const buckets = [
  `core.principalRequestRate:user:${adaSubject}`,
  'core.commandRate',
  'core.queryRate',
  'core.subscribeRate',
  'core.requestRate',
] as const;

describe('where the request rate counts: the setting up of a subscription', () => {
  test('one subscribe through the invoker takes one token of the principal, of core.subscribeRate and of the tenant, and no other', async () => {
    const keys = await bootKeys();
    const feed = publicQuery(
      'rateFeed',
      () => ({
        kind: 'liveSource',
        source: { kind: 'entity', entity: 'library.book', options: {} },
      }),
      { kind: 'subscription', input: shape({}), output: shape({}) },
    );
    // A hub whose stream ends at once: only the setting up is under test.
    const hub = {
      entity: () => ({
        [Symbol.asyncIterator]: () => ({
          next: async () => ({ done: true as const, value: undefined }),
          return: async () => ({ done: true as const, value: undefined }),
        }),
      }),
    } as unknown as LiveHub;
    const { adapter, invoker } = kit({
      registry: feed.registry,
      keys,
      // Capacities under 20: a draw is 1 token, so the allowance holds nothing beyond the one it spends.
      quotas: tenantOnly(ratesOf(15)),
      apps: new Map([
        ['library', { registry: feed.registry, head, liveHub: hub }],
        ['core', { registry: feed.registry, head, liveHub: hub }],
      ]),
    });
    const frames = invoker.subscribe(call(feed.ref, {}, { carrier: ada }));
    for await (const _frame of frames) {
      // the stream ends at once
    }
    const taken = await Promise.all(
      buckets.map((bucket) => tokensTakenOf(adapter, keys, bucket, 15)),
    );
    expect(taken).toEqual([1, 0, 0, 1, 1]);
    // A second subscribe takes one more of each of the same three.
    for await (const _frame of invoker.subscribe(call(feed.ref, {}, { carrier: ada }))) {
      // the stream ends at once
    }
    expect(
      await Promise.all(buckets.map((bucket) => tokensTakenOf(adapter, keys, bucket, 15))),
    ).toEqual([2, 0, 0, 2, 2]);
  });
});

describe('what a caller is told by the request rate', () => {
  test('a refusal tells the wait in whole seconds, rounded up', async () => {
    const keys = await bootKeys();
    const probe = publicQuery(
      'rateWait',
      // biome-ignore lint/correctness/useYield: a handler that loads nothing
      function* () {
        return {};
      },
      { input: shape({ who: field.string() }) },
    );
    // The tenant's bucket holds 1 token and refills 3 a second: once it is empty the next token is
    // a third of a second away, which the caller is told as 1.
    const { invoker } = kit({
      registry: probe.registry,
      keys,
      quotas: quotasOf({
        limitOf: () => ({ kind: 'rate', capacity: 1, refillPerSecond: 3 }),
        queueOf: () => ({ running: 4, queued: 10_000, weight: 1 }),
      }),
    });
    expect((await invoker.invoke(call(probe.ref, { who: 'x' }, { carrier: ada }))).ok).toBe(true);
    const refused = failure(await invoker.invoke(call(probe.ref, { who: 'x' }, { carrier: ada })));
    expect(refused).toMatchObject({ kind: 'rate_limited', code: 'core.rate_limited' });
    expect(refused.retryAfter).toBe(1);
  });
});

describe('the order of the admission checks', () => {
  test('a tenant held by a restore is refused before the rate, so the request takes no token', async () => {
    const keys = await bootKeys();
    const probe = publicQuery(
      'rateHeld',
      // biome-ignore lint/correctness/useYield: a handler that loads nothing
      function* () {
        return {};
      },
      { input: shape({ who: field.string() }) },
    );
    let held = true;
    const { adapter, invoker } = kit({
      registry: probe.registry,
      keys,
      quotas: tenantOnly(ratesOf(15)),
      restoreHold: {
        held: () => new Set(held ? [tenantId] : []),
        check: async () => {
          if (held) throw errors.unavailable('The tenant is held by a restore.');
        },
      },
    });
    for (let n = 0; n < 3; n += 1) {
      const refused = failure(
        await invoker.invoke(call(probe.ref, { who: 'x' }, { carrier: ada })),
      );
      expect(refused).toMatchObject({ kind: 'unavailable', code: 'core.unavailable' });
    }
    expect(
      await Promise.all(buckets.map((bucket) => tokensTakenOf(adapter, keys, bucket, 15))),
    ).toEqual([0, 0, 0, 0, 0]);
    // The hold lifts: the same request is served and takes one token of each of its three buckets.
    held = false;
    expect((await invoker.invoke(call(probe.ref, { who: 'x' }, { carrier: ada }))).ok).toBe(true);
    expect(
      await Promise.all(buckets.map((bucket) => tokensTakenOf(adapter, keys, bucket, 15))),
    ).toEqual([1, 0, 1, 0, 1]);
  });
});
