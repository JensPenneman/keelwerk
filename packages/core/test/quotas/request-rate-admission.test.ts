import { describe, expect, test } from 'vitest';
import type { AdmissionRun } from '../../src/admission/run-admission.ts';
import { KeelwerkError } from '../../src/errors/keelwerk-error.ts';
import type { InvokerEnv } from '../../src/invoker/invoker-env.ts';
import type { QuotaLimit } from '../../src/quotas/quota-limit.ts';
import type { QuotaLimits } from '../../src/quotas/quota-limits.ts';
import { checkRequestRate } from '../../src/quotas/request-rate-admission.ts';
import { rateFake } from './rate-fake.ts';

const now = Temporal.Instant.from('2026-11-19T10:00:00Z');
const rate = (capacity: number): QuotaLimit => ({
  kind: 'rate',
  capacity,
  refillPerSecond: 1,
});

interface World {
  readonly fake: ReturnType<typeof rateFake>;
  readonly asked: string[];
  readonly events: string[];
  env(over?: { quotas?: QuotaLimits | undefined }): InvokerEnv;
  run(over?: {
    kind?: string;
    principal?: object;
    address?: string;
    job?: boolean;
    target?: 'none' | 'deployment' | 'tenant';
    dry?: boolean;
  }): AdmissionRun;
  limits(table?: Record<string, QuotaLimit>): QuotaLimits;
}

function world(): World {
  const fake = rateFake();
  const asked: string[] = [];
  const events: string[] = [];
  const keys = { derive: async () => new Uint8Array(32) };
  return {
    fake,
    asked,
    events,
    limits: (table = {}) => ({
      limitOf: (_registry, _scope, ref) => {
        events.push(`limit:${ref}`);
        asked.push(ref);
        return table[ref] ?? rate(100);
      },
      queueOf: () => ({ running: 4, queued: 1, weight: 1 }),
      fresh: async () => {
        events.push('fresh');
      },
    }),
    env: (over = {}) =>
      ({
        options: {
          clock: { now: () => now },
          keys,
          ...('quotas' in over ? { quotas: over.quotas } : {}),
        },
        appOf: () => ({ registry: {} }),
      }) as unknown as InvokerEnv,
    run: (over = {}) => {
      const target =
        over.target === 'none'
          ? null
          : over.target === 'deployment'
            ? { ...fake.target, scope: { level: 'deployment' } }
            : fake.target;
      const connection =
        over.address === undefined ? {} : { connection: { remote: { address: over.address } } };
      return {
        action: { kind: over.kind ?? 'query' },
        invocation: { carrier: connection },
        session: { principal: over.principal ?? { kind: 'user', subject: 'ada' } },
        details: {
          carrier: over.job === true ? { job: {} } : {},
          resolved: { app: 'library', target },
        },
        ...(over.dry === undefined ? {} : { dry: over.dry }),
      } as unknown as AdmissionRun;
    },
  };
}

describe('checkRequestRate (section 12.2)', () => {
  test('skips a job carrier, a deployment scope, a missing target and an invoker without quotas', async () => {
    const w = world();
    const quotas = w.limits();
    await checkRequestRate(w.env({ quotas }), w.run({ job: true }));
    await checkRequestRate(w.env({ quotas }), w.run({ target: 'deployment' }));
    await checkRequestRate(w.env({ quotas }), w.run({ target: 'none' }));
    await checkRequestRate(w.env({}), w.run());
    expect(w.events).toEqual([]);
    expect(w.fake.units).toEqual({ readWrite: 0, readOnly: 0 });
  });

  test('takes the principal, class and tenant buckets named under the core module, in that order', async () => {
    const w = world();
    await checkRequestRate(w.env({ quotas: w.limits() }), w.run());
    expect(w.asked).toEqual(['core.principalRequestRate', 'core.queryRate', 'core.requestRate']);
    expect(w.fake.levels.size).toBe(3);
    expect([...w.fake.levels.values()]).toEqual([99, 99, 99]);
    expect(w.fake.units.readWrite).toBe(1);
  });

  test('the action kinds map to core.commandRate, core.queryRate and core.subscribeRate', async () => {
    const seen: string[] = [];
    for (const kind of ['command', 'query', 'subscription']) {
      const w = world();
      await checkRequestRate(w.env({ quotas: w.limits() }), w.run({ kind }));
      seen.push(w.asked[1] ?? '');
    }
    expect(seen).toEqual(['core.commandRate', 'core.queryRate', 'core.subscribeRate']);
  });

  test('a system principal has no principal bucket', async () => {
    const w = world();
    await checkRequestRate(
      w.env({ quotas: w.limits() }),
      w.run({ principal: { kind: 'system', reason: 'r' } }),
    );
    expect(w.asked).toEqual(['core.queryRate', 'core.requestRate']);
  });

  test('an anonymous caller has the principal bucket of its client address', async () => {
    const w = world();
    const quotas = w.limits({ 'core.principalRequestRate': rate(2) });
    const env = w.env({ quotas });
    const anonymous = { kind: 'anonymous' };
    await checkRequestRate(env, w.run({ principal: anonymous, address: '203.0.113.7' }));
    expect(w.asked).toEqual(['core.principalRequestRate', 'core.queryRate', 'core.requestRate']);
    await checkRequestRate(env, w.run({ principal: anonymous, address: '203.0.113.7' }));
    const refused = await checkRequestRate(
      env,
      w.run({ principal: anonymous, address: '203.0.113.7' }),
    ).catch((error: unknown) => error);
    expect(refused).toMatchObject({ kind: 'rate_limited', code: 'core.rate_limited' });
    // another address has a bucket of its own, and so do callers without an address
    await checkRequestRate(env, w.run({ principal: anonymous, address: '203.0.113.8' }));
    await checkRequestRate(env, w.run({ principal: anonymous }));
    await checkRequestRate(env, w.run({ principal: anonymous }));
    const shared = await checkRequestRate(env, w.run({ principal: anonymous })).catch(
      (error: unknown) => error,
    );
    expect(shared).toMatchObject({ kind: 'rate_limited' });
    // tenant, class and the three principal buckets
    expect(w.fake.levels.size).toBe(5);
  });

  test('a principal over its own rate spends nothing of the class and tenant buckets', async () => {
    const w = world();
    const env = w.env({ quotas: w.limits({ 'core.principalRequestRate': rate(1) }) });
    await checkRequestRate(env, w.run());
    const levels = () => [...w.fake.levels.values()].sort((a, b) => a - b);
    expect(levels()).toEqual([0, 99, 99]);
    for (let n = 0; n < 5; n += 1) {
      const refused = await checkRequestRate(env, w.run()).catch((error: unknown) => error);
      expect(refused).toMatchObject({ kind: 'rate_limited', code: 'core.rate_limited' });
    }
    expect(levels()).toEqual([0, 99, 99]);
  });

  test('a refusal is rate_limited core.rate_limited with retryAfter rounded up', async () => {
    const w = world();
    const env = w.env({ quotas: w.limits({ 'core.requestRate': rate(1) }) });
    await checkRequestRate(env, w.run());
    const refused = await checkRequestRate(env, w.run()).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(KeelwerkError);
    expect(refused).toMatchObject({
      kind: 'rate_limited',
      code: 'core.rate_limited',
      retryAfter: 5,
    });
  });

  test('quotas.fresh is awaited before a limit is read', async () => {
    const w = world();
    await checkRequestRate(w.env({ quotas: w.limits() }), w.run());
    expect(w.events[0]).toBe('fresh');
    expect(w.events[1]).toBe('limit:core.principalRequestRate');
  });

  test('a dry run takes nothing', async () => {
    const w = world();
    await checkRequestRate(w.env({ quotas: w.limits() }), w.run({ dry: true }));
    expect(w.fake.levels.size).toBe(0);
    expect(w.fake.units).toEqual({ readWrite: 0, readOnly: 1 });
  });

  test('a dimension whose limit is not a rate is internal', async () => {
    const w = world();
    const quotas = w.limits({ 'core.queryRate': { kind: 'count', value: 3 } });
    await expect(checkRequestRate(w.env({ quotas }), w.run())).rejects.toMatchObject({
      kind: 'internal',
    });
  });
});
