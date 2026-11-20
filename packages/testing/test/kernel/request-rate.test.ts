import { field, shape } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { bootKeys, storedName } from './support/admission-kit.ts';
import {
  ada,
  call,
  failure,
  kit,
  otherTenantId,
  publicQuery,
  tenantId,
} from './support/invoker-kit.ts';
import { tenantOnly } from './support/quota-kit.ts';
import { namespace, tenant } from './support/run-read-kit.ts';

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
