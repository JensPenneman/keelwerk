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

describe('the remote client without a live module', () => {
  it('a 404 subscribe endpoint is core.live_unavailable, for subscribe, waitForEffects and waitEffects', async () => {
    const base = probeSurface();
    const ping = base.actions.find((candidate) => candidate.ref === 'shop.ping');
    if (ping === undefined) throw new Error('The probe surface has no shop.ping.');
    const text = { optional: false, access: 'read-write', kind: 'string' } as const;
    const surface = {
      ...base,
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
    const server = protocolFetch({
      surface,
      handlers: {
        'shop.ping': () => ({ effects: ['eff-1'] }),
        'shop.cancelAll': () => ({ value: { cancelled: 0 } }),
      },
    });
    const client = createRemoteClient<ProbeApp>({
      url: 'https://shop.example/',
      apiVersion: '2026-11-01',
      fetch: server.fetch,
      retry: noWait,
    });
    const frames = client.subscribe('shop.feed', {})[Symbol.asyncIterator]();
    await expect(frames.next()).rejects.toMatchObject({
      kind: 'unavailable',
      code: 'core.live_unavailable',
    });
    await expect(client.waitForEffects(['eff-1'])).rejects.toMatchObject({
      kind: 'unavailable',
      code: 'core.live_unavailable',
    });
    // The command commits first; the wait then fails, and an answer with no effects waits for nothing.
    await expect(
      client.invoke('shop.ping', undefined, { waitEffects: true }),
    ).rejects.toMatchObject({
      code: 'core.live_unavailable',
    });
    expect(server.requests.filter((r) => r.path.endsWith('/invoke'))).toHaveLength(1);
    await expect(client.invoke('shop.cancelAll', {}, { waitEffects: true })).resolves.toEqual({
      cancelled: 0,
    });
    await expect(client.invoke('shop.ping', undefined)).resolves.toBeUndefined();
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
