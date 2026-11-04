import { describe, expect, it } from 'vitest';
import { createRemoteClient } from '../src/index.ts';
import { newCommandId } from '../src/new-command-id.ts';
import { unixSocketFetch } from '../src/unix-socket/index.ts';
import type { ProbeApp } from './support/probe-app.ts';
import { probeSurface } from './support/probe-surface.ts';
import { protocolFetch } from './support/protocol-fetch.ts';

const noWait = { retries: 3, random: () => 0.5, sleep: () => Promise.resolve() } as const;

describe('command ids', () => {
  it('are UUIDv7 with the current time in the first 48 bits', () => {
    const before = Date.now();
    const id = newCommandId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const stamp = Number.parseInt(id.replaceAll('-', '').slice(0, 12), 16);
    expect(stamp).toBeGreaterThanOrEqual(before);
    expect(stamp).toBeLessThanOrEqual(Date.now());
    expect(newCommandId()).not.toBe(id);
  });
});

describe('a body that breaks mid-stream', () => {
  function broken(): Response {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new TypeError('terminated'));
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  }

  it('is retried under the same command id and then succeeds', async () => {
    const server = protocolFetch({
      surface: probeSurface(),
      handlers: { 'shop.ping': () => ({}) },
    });
    const bodies: string[] = [];
    let breaks = 1;
    const flaky: typeof fetch = (input, init) => {
      if (String(input).endsWith('/invoke')) {
        bodies.push(String(init?.body));
        if (breaks > 0) {
          breaks -= 1;
          return Promise.resolve(broken());
        }
      }
      return server.fetch(input, init);
    };
    const client = createRemoteClient<ProbeApp>({
      url: 'https://shop.example',
      apiVersion: '2026-11-01',
      fetch: flaky,
      retry: noWait,
    });
    await expect(client.invoke('shop.ping', undefined)).resolves.toBeUndefined();
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe(bodies[1]);
  });

  it('ends as core.unavailable, which attempt returns', async () => {
    const server = protocolFetch({ surface: probeSurface(), handlers: {} });
    const flaky: typeof fetch = (input, init) =>
      String(input).endsWith('/invoke') ? Promise.resolve(broken()) : server.fetch(input, init);
    const client = createRemoteClient<ProbeApp>({
      url: 'https://shop.example',
      apiVersion: '2026-11-01',
      fetch: flaky,
      retry: noWait,
    });
    const result = await client.attempt('shop.ping', undefined);
    expect(result).toMatchObject({ ok: false, error: { code: 'core.unavailable' } });
  });
});

describe('derived clients and sockets', () => {
  it('as() shares the surface already fetched', async () => {
    const server = protocolFetch({
      surface: probeSurface(),
      handlers: { 'shop.ping': () => ({}) },
    });
    const client = createRemoteClient<ProbeApp>({
      url: 'https://shop.example',
      apiVersion: '2026-11-01',
      fetch: server.fetch,
      retry: noWait,
    });
    await client.invoke('shop.ping', undefined);
    await client.as({ tenant: 't2' }).invoke('shop.ping', undefined);
    expect(server.requests.filter((r) => r.path.endsWith('/surface'))).toHaveLength(1);
  });

  it('refuses a unix:// url whose socket differs from the fetch', () => {
    expect(() =>
      createRemoteClient<ProbeApp>({
        url: 'unix:///run/keelwerk/operator.sock',
        apiVersion: '2026-11-01',
        fetch: unixSocketFetch('/tmp/other.sock'),
      }),
    ).toThrow(TypeError);
    expect(() =>
      createRemoteClient<ProbeApp>({
        url: 'unix:///tmp/other.sock',
        apiVersion: '2026-11-01',
        fetch: unixSocketFetch('/tmp/other.sock'),
      }),
    ).not.toThrow();
  });
});
