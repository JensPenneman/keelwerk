import { describe, expect, it } from 'vitest';
import { createRemoteClient } from '../../src/index.ts';
import type { ProbeApp } from '../support/probe-app.ts';
import { probeSurface } from '../support/probe-surface.ts';
import { type ProtocolFetchOptions, protocolFetch } from '../support/protocol-fetch.ts';

const noWait = {
  retries: 3,
  random: () => 0.5,
  sleep: () => Promise.resolve(),
} as const;

function setup(overrides: ProtocolFetchOptions['handlers'] = {}) {
  const server = protocolFetch({ surface: probeSurface(), handlers: overrides });
  const client = createRemoteClient<ProbeApp>({
    url: 'https://shop.example/',
    apiVersion: '2026-11-01',
    fetch: server.fetch,
    retry: noWait,
  });
  return { server, client };
}

function surfaceWithWatch(withLive: boolean) {
  const base = probeSurface();
  const ping = base.actions.find((candidate) => candidate.ref === 'shop.ping');
  if (ping === undefined) throw new Error('The probe surface has no shop.ping.');
  const text = { optional: false, access: 'read-write', kind: 'string' } as const;
  return {
    ...base,
    ...(withLive && { modules: [...base.modules, { id: 'live', version: '1.0.0' }] }),
    actions: [
      ...base.actions,
      { ...ping, ref: 'shop.feed', name: 'feed', kind: 'subscription', output: text },
      {
        ...ping,
        ref: 'core.effectStatusWatch',
        module: 'core',
        name: 'effectStatusWatch',
        kind: 'subscription',
        input: {
          optional: false,
          access: 'read-write',
          kind: 'shape',
          fields: { ids: { optional: false, access: 'read-write', kind: 'list', item: text } },
        },
        output: text,
      },
    ],
  } as typeof base;
}

/** A server that answers the invocation protocol and has no subscribe endpoint (404). */
function serverWithoutLive(withLiveModule: boolean) {
  const server = protocolFetch({
    surface: surfaceWithWatch(withLiveModule),
    handlers: {
      'shop.ping': () => ({ effects: ['eff-1'] }),
      'shop.cancelAll': () => ({ value: { cancelled: 0 } }),
    },
  });
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    if (new URL(request.url).pathname.endsWith('/subscribe')) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: {
            kind: 'not_found',
            code: 'core.not_found',
            message: 'There is no such endpoint.',
            retryable: false,
            requestId: 'req-1',
          },
        }),
        { status: 404, headers: { 'content-type': 'application/json' } },
      );
    }
    return server.fetch(request);
  }) as typeof globalThis.fetch;
  const client = createRemoteClient<ProbeApp>({
    url: 'https://shop.example/',
    apiVersion: '2026-11-01',
    fetch,
    retry: noWait,
  });
  const sent = () => server.requests.filter((r) => r.path.endsWith('/invoke'));
  return { client, sent };
}

describe('the remote client without a live module', () => {
  it('a 404 subscribe endpoint is core.live_unavailable, for subscribe and waitForEffects', async () => {
    const { client } = serverWithoutLive(true);
    const frames = client.subscribe('shop.feed', {})[Symbol.asyncIterator]();
    await expect(frames.next()).rejects.toMatchObject({
      kind: 'unavailable',
      code: 'core.live_unavailable',
    });
    await expect(client.waitForEffects(['eff-1'])).rejects.toMatchObject({
      kind: 'unavailable',
      code: 'core.live_unavailable',
    });
  });

  it('waitEffects on a surface without the live module is refused before anything is sent', async () => {
    const { client, sent } = serverWithoutLive(false);
    await expect(
      client.invoke('shop.ping', undefined, { waitEffects: true }),
    ).rejects.toMatchObject({ kind: 'unavailable', code: 'core.live_unavailable' });
    const attempted = await client.attempt('shop.ping', undefined, { waitEffects: true });
    expect(attempted).toMatchObject({ ok: false, error: { code: 'core.live_unavailable' } });
    expect(sent()).toHaveLength(0);
    await expect(client.invoke('shop.ping', undefined)).resolves.toBeUndefined();
  });

  it('a wait that fails after the command committed keeps its command id and is not retryable', async () => {
    const { client, sent } = serverWithoutLive(true);
    const attempted = await client.attempt('shop.ping', undefined, { waitEffects: true });
    expect(attempted.ok).toBe(false);
    if (attempted.ok) return;
    const [only] = sent();
    const commandId = ((only?.body ?? {}) as { commandId?: string }).commandId;
    expect(commandId).toBeDefined();
    expect(attempted.commandId).toBe(commandId);
    expect(attempted.effects).toEqual(['eff-1']);
    expect(attempted.error).toMatchObject({
      kind: 'unavailable',
      code: 'core.live_unavailable',
      retryable: false,
    });
    expect(attempted.error.message).toContain(commandId);
    // invoke rejects with the same error, which carries the id and the effects.
    const rejected = await client.invoke('shop.ping', undefined, { waitEffects: true }).then(
      () => undefined,
      (failure: unknown) => failure,
    );
    expect(rejected).toMatchObject({
      retryable: false,
      details: { committed: true, effects: ['eff-1'] },
    });
    expect(sent()).toHaveLength(2);
    // An answer that lists no effects waits for nothing.
    await expect(client.invoke('shop.cancelAll', {}, { waitEffects: true })).resolves.toEqual({
      cancelled: 0,
    });
  });

  it('subscribing to an action the surface does not have as a subscription is core.not_found', async () => {
    const { client, server } = setup();
    const frames = client.subscribe('shop.feed', {})[Symbol.asyncIterator]();
    await expect(frames.next()).rejects.toMatchObject({
      kind: 'not_found',
      code: 'core.not_found',
    });
    expect(server.requests.some((r) => r.path.endsWith('/subscribe'))).toBe(false);
  });
});
