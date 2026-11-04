import { describe, expect, it } from 'vitest';
import { backoffDelay } from '../src/backoff-delay.ts';
import { createRetryPolicy } from '../src/create-retry-policy.ts';
import { createRemoteClient } from '../src/index.ts';
import type { ProbeApp } from './support/probe-app.ts';
import { probeSurface } from './support/probe-surface.ts';
import { protocolFetch } from './support/protocol-fetch.ts';

const instantAt = Temporal.Instant.from('2030-01-01T00:00:00Z');

interface Attempt {
  readonly url: string;
  readonly body: string;
}

/** A client over a server that drops the first `drops` invoke requests like a lost connection. */
function setup(drops: number, gateways = 0) {
  const waits: number[] = [];
  const attempts: Attempt[] = [];
  const server = protocolFetch({
    surface: probeSurface(),
    handlers: {
      'shop.ping': () => ({}),
      'shop.total': () => ({ value: { total: 1n, at: instantAt } }),
    },
    ...(gateways > 0 && { gatewayFirst: gateways }),
  });
  let dropped = 0;
  const flaky: typeof fetch = (input, init) => {
    attempts.push({ url: String(input), body: String(init?.body) });
    if (dropped < drops) {
      dropped += 1;
      return Promise.reject(new TypeError('fetch failed'));
    }
    return server.fetch(input, init);
  };
  const client = createRemoteClient<ProbeApp>({
    url: 'https://shop.example',
    apiVersion: '2026-11-01',
    fetch: flaky,
    surface: probeSurface(),
    retry: {
      random: () => 0.5,
      sleep: (milliseconds) => {
        waits.push(milliseconds);
        return Promise.resolve();
      },
    },
  });
  return { client, waits, attempts, server };
}

describe('retrying network failures', () => {
  it('retries a command three times with jittered backoff, every attempt carrying the same command id', async () => {
    const { client, waits, attempts, server } = setup(3);
    await client.invoke('shop.ping', undefined);
    expect(attempts).toHaveLength(4);
    expect(waits).toEqual([100, 200, 400]);
    const ids = attempts.map((a) => (JSON.parse(a.body) as { commandId: string }).commandId);
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Set(ids).size).toBe(1);
    expect(new Set(attempts.map((a) => a.body)).size).toBe(1);
    expect(server.requests).toHaveLength(1);
  });

  it('retries a query the same way, without a command id', async () => {
    const { client, attempts } = setup(2);
    await client.invoke('shop.total', { since: instantAt });
    expect(attempts).toHaveLength(3);
    expect(attempts.every((a) => !a.body.includes('commandId'))).toBe(true);
  });

  it('gives up after three retries with unavailable core.unavailable', async () => {
    const { client, waits, attempts } = setup(100);
    const failure = await client.invoke('shop.ping', undefined).catch((e) => e);
    expect(failure).toMatchObject({
      kind: 'unavailable',
      code: 'core.unavailable',
      retryable: true,
    });
    expect(failure.cause).toBeInstanceOf(TypeError);
    expect(attempts).toHaveLength(4);
    expect(waits).toHaveLength(3);
  });

  it('retries a gateway answer that is not the envelope', async () => {
    const { client, attempts } = setup(0, 2);
    await expect(client.invoke('shop.total', { since: instantAt })).resolves.toBeDefined();
    expect(attempts).toHaveLength(3);
  });

  it('does not retry an aborted request', async () => {
    const { client, attempts } = setup(0);
    const controller = new AbortController();
    controller.abort(new Error('stop'));
    await expect(
      client.invoke('shop.ping', undefined, { signal: controller.signal }),
    ).rejects.toThrow('stop');
    expect(attempts).toHaveLength(0);
  });
});

describe('the backoff', () => {
  it('doubles up to the cap and spreads with the random source', () => {
    const policy = createRetryPolicy({ baseDelayMs: 100, maxDelayMs: 500, random: () => 0.99 });
    expect([0, 1, 2, 3, 4].map((retry) => backoffDelay(policy, retry))).toEqual([
      99, 198, 396, 495, 495,
    ]);
    expect(backoffDelay(createRetryPolicy({ random: () => 0 }), 2)).toBe(0);
    expect(createRetryPolicy().retries).toBe(3);
  });
});
