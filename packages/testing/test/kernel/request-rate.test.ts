import type { QuotaLimit, QuotaLimits } from '@keelwerk/core';
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
import { namespace, tenant } from './support/run-read-kit.ts';

const tenantOnly = (capacities: Readonly<Record<string, number>>): QuotaLimits => ({
  limitOf: (_registry, scope, ref): QuotaLimit => {
    const own = scope.level === 'tenant' && scope.tenantId === tenantId;
    const capacity = own ? (capacities[ref] ?? 100) : 100;
    return { kind: 'rate', capacity, refillPerSecond: 0.001 };
  },
  queueOf: () => ({ running: 4, queued: 10_000, weight: 1 }),
  fresh: () => Promise.resolve(),
});

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
});
