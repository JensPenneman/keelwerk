import type { Carrier } from '@keelwerk/core';
import { targetingRefreshMs } from '@keelwerk/core';
import {
  freshName,
  lendCall,
  pinnedTransportClock,
  startTransportRuntime,
  transportTargetOf,
} from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { afterEach, describe, expect, test } from 'vitest';
import { restCodec } from './support/rest-codec.ts';
import { transportWithRest } from './support/transport-app.ts';

// What a tenant over a limit meets on the wire of REST: the status, the code and whether the answer
// says when to come back. The clock stands still, so a rate bucket does not refill, except for the
// second after the start and after each limit that is set, which the quota cache needs to read the
// rows again: it reloads when its feed wakes or when its rows are older than that bound, and a
// request must not depend on which of the two is first. Each case starts a deployment of its own
// whose backend configuration holds the limit, which every tenant of the backend has, except the
// limit of invocations in flight, which is set for acme alone; the other tenant counts for itself.

const origins = ['https://app.example.test'];
const stops: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(stops.splice(0).map((stop) => stop()));
});

async function start(quotas: Readonly<Record<string, string>>) {
  const pinned = pinnedTransportClock(Temporal.Instant.from('2026-11-23T08:00:00Z'));
  const runtime = await startTransportRuntime({
    app: transportWithRest,
    host: httpHost(),
    config: { rest: { docs: false, cors: origins }, core: { quotas } },
    clock: pinned.clock,
  });
  stops.push(() => runtime.stop());
  await pinned.advance(targetingRefreshMs + 1);
  const target = transportTargetOf(runtime, restCodec, origins);
  const lend = (tenant: string) =>
    restCodec.send(
      target,
      lendCall('ada', freshName('Dune'), { caller: { subject: 'ada', tenant } }),
    );
  /** `core.quota.set` for one tenant over the in-process operator. */
  const setLimit = async (tenant: string, dimension: string, limit: string) => {
    const carrier: Carrier = { transport: 'test', local: { inProcess: true } };
    const set = await runtime.runtime.invoker.invoke({
      action: 'core.quota.set',
      input: {
        dimension,
        backendId: runtime.backendId,
        tenantId: runtime.tenants[tenant],
        limit,
        reason: 'the quota test',
      },
      carrier,
      requestId: crypto.randomUUID(),
      commandId: crypto.randomUUID(),
      signal: new AbortController().signal,
    });
    await pinned.advance(targetingRefreshMs + 1);
    return set;
  };
  return { lend, setLimit };
}

describe('a tenant over a limit, over REST', () => {
  test('over the request rate: 429 core.rate_limited with Retry-After, the other tenant still served', async () => {
    const { lend } = await start({ 'core.requestRate': '2/1h' });
    expect((await lend('acme')).response.status).toBe(200);
    expect((await lend('acme')).response.status).toBe(200);
    const refused = await lend('acme');
    expect(refused.response.status).toBe(429);
    expect(refused.decoded).toMatchObject({ ok: false, code: 'core.rate_limited' });
    expect(Number(refused.response.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await lend('globex')).response.status).toBe(200);
  });

  test('over the storage quota: 429 core.quota_exceeded without Retry-After, the other tenant still served', async () => {
    const { lend } = await start({ 'core.rows': '1' });
    expect((await lend('acme')).response.status).toBe(200);
    const refused = await lend('acme');
    expect(refused.response.status).toBe(429);
    expect(refused.decoded).toMatchObject({ ok: false, code: 'core.quota_exceeded' });
    expect(refused.response.headers.get('retry-after')).toBeNull();
    expect((await lend('globex')).response.status).toBe(200);
  });

  test('over the invocations in flight: 429 core.concurrency_limited with Retry-After 1', async () => {
    const { lend, setLimit } = await start({});
    expect((await setLimit('acme', 'core.concurrentInvocations', '0')).ok).toBe(true);
    const refused = await lend('acme');
    expect(refused.response.status).toBe(429);
    expect(refused.decoded).toMatchObject({ ok: false, code: 'core.concurrency_limited' });
    expect(refused.response.headers.get('retry-after')).toBe('1');
    expect((await lend('globex')).response.status).toBe(200);
  });
});
