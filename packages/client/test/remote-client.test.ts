import { isKeelwerkError } from '@keelwerk/core';
import { describe, expect, it } from 'vitest';
import { ClientError, createRemoteClient, isReceipt } from '../src/index.ts';
import type { ProbeApp } from './support/probe-app.ts';
import { probeSurface } from './support/probe-surface.ts';
import { type ProtocolFetchOptions, protocolFetch } from './support/protocol-fetch.ts';

const instantAt = Temporal.Instant.from('2030-01-02T03:04:05.678Z');
const huge = 9007199254740993n;

const noWait = {
  retries: 3,
  random: () => 0.5,
  sleep: () => Promise.resolve(),
} as const;

function setup(
  overrides: Partial<ProtocolFetchOptions['handlers']> = {},
  extra: Partial<ProtocolFetchOptions> = {},
) {
  const server = protocolFetch({
    surface: probeSurface(),
    handlers: {
      'shop.total': (input) => {
        void input;
        return { value: { total: huge, at: instantAt } };
      },
      'shop.place': () => ({ value: { orderId: 'o-1', placedAt: instantAt } }),
      'shop.cancelAll': () => ({ value: { cancelled: 2 } }),
      'shop.ping': () => ({}),
      ...overrides,
    },
    ...extra,
  });
  const client = createRemoteClient<ProbeApp>({
    url: 'https://shop.example/',
    apiVersion: '2026-11-01',
    fetch: server.fetch,
    retry: noWait,
  });
  return { server, client };
}

describe('the remote client', () => {
  it('gives Temporal and bigint values in process form and sends them as plain JSON', async () => {
    const seen: unknown[] = [];
    const { server, client } = setup({
      'shop.total': (input) => {
        seen.push(input);
        return { value: { total: huge, at: instantAt } };
      },
    });
    const result = await client.invoke('shop.total', { since: instantAt });
    expect(result.total).toBe(huge);
    expect(result.at).toBeInstanceOf(Temporal.Instant);
    expect(result.at.equals(instantAt)).toBe(true);
    expect((seen[0] as { since: Temporal.Instant }).since.equals(instantAt)).toBe(true);
    const sent = server.requests.find((r) => r.path.endsWith('/invoke'));
    expect(sent?.body).toEqual({ action: 'shop.total', input: { since: instantAt.toString() } });
    await client.invoke('shop.place', { sku: 'a', quantity: huge });
    expect(server.requests.at(-1)?.body).toMatchObject({
      input: { sku: 'a', quantity: '9007199254740993' },
    });
  });

  it('sends the version, the client name, the credential and the selectors, and as() rebinds them', async () => {
    const { server, client } = setup();
    const bound = createRemoteClient<ProbeApp>({
      url: 'https://shop.example',
      apiVersion: '2026-11-01',
      token: 't0',
      backend: 'eu',
      tenant: 'acme',
      deviceId: 'dev-1',
      fetch: server.fetch,
      retry: noWait,
    });
    await bound.invoke('shop.ping', undefined);
    const first = server.requests.at(-1)?.headers;
    expect(first?.get('keelwerk-version')).toBe('2026-11-01');
    expect(first?.get('keelwerk-client')).toMatch(/^keelwerk-client\/\d/);
    expect(first?.get('authorization')).toBe('Bearer t0');
    expect(first?.get('x-keelwerk-backend')).toBe('eu');
    expect(first?.get('x-keelwerk-tenant')).toBe('acme');
    expect(first?.get('keelwerk-client-id')).toBe('dev-1');
    await bound.as({ tenant: 'globex', token: 't1' }).invoke('shop.ping', undefined);
    const second = server.requests.at(-1)?.headers;
    expect(second?.get('x-keelwerk-tenant')).toBe('globex');
    expect(second?.get('x-keelwerk-backend')).toBe('eu');
    expect(second?.get('authorization')).toBe('Bearer t1');
    await client.invoke('shop.ping', undefined);
    expect(server.requests.at(-1)?.headers.get('authorization')).toBeNull();
  });

  it('generates one command id per command, none for a query, and keeps a given one', async () => {
    const ids: (string | undefined)[] = [];
    const { client } = setup({
      'shop.total': (_input, commandId) => {
        ids.push(commandId);
        return { value: { total: 1n, at: instantAt } };
      },
      'shop.ping': (_input, commandId) => {
        ids.push(commandId);
        return {};
      },
    });
    await client.invoke('shop.total', { since: instantAt });
    await client.invoke('shop.ping', undefined);
    await client.invoke('shop.ping', undefined);
    await client.invoke('shop.ping', undefined, { commandId: 'mine' });
    expect(ids[0]).toBeUndefined();
    expect(ids[1]).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids[2]).not.toBe(ids[1]);
    expect(ids[3]).toBe('mine');
  });

  it('exposes the command id and the effects on a command result, and neither on a query', async () => {
    const { client } = setup({
      'shop.ping': () => ({ effects: ['eff-1', 'eff-2'] }),
      'shop.total': () => ({ value: { total: 1n, at: instantAt } }),
    });
    const command = await client.attempt('shop.ping', undefined);
    expect(command.ok).toBe(true);
    if (command.ok) {
      expect(command.commandId).toMatch(/^[0-9a-f-]{36}$/);
      expect(command.effects).toEqual(['eff-1', 'eff-2']);
    }
    const query = await client.attempt('shop.total', { since: instantAt });
    expect(query.ok).toBe(true);
    expect(query).not.toHaveProperty('commandId');
    expect(query).not.toHaveProperty('effects');
  });

  it('answers a receipt for an async command and for an either command that prefers async', async () => {
    const { server, client } = setup({
      'shop.cancelAll': (_input, commandId) => ({
        receipt: { commandId: commandId ?? '', status: 'accepted' },
      }),
      'shop.place': (_input, commandId) => ({
        receipt: { commandId: commandId ?? '', status: 'accepted' },
      }),
    });
    const closed = await client.invoke('shop.cancelAll', {});
    expect(isReceipt(closed)).toBe(true);
    const placed = await client.invoke(
      'shop.place',
      { sku: 'a', quantity: 1n },
      { prefer: 'async' },
    );
    expect(isReceipt(placed)).toBe(true);
    expect(server.requests.at(-1)?.body).toMatchObject({ prefer: 'async' });
    expect(isReceipt({ commandId: 1 })).toBe(false);
  });

  it('rejects with a KeelwerkError and attempt returns the declared error with decoded details', async () => {
    const soldOut = {
      error: {
        kind: 'conflict' as const,
        code: 'shop.sold_out',
        message: 'Sold out.',
        retryable: false,
        details: { sku: 'a', left: '3' },
      },
      status: 409,
    };
    const { client } = setup({ 'shop.place': () => soldOut });
    const outcome = await client.attempt('shop.place', { sku: 'a', quantity: 5n });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok && outcome.error.code === 'shop.sold_out') {
      expect(outcome.error.details).toEqual({ sku: 'a', left: 3n });
      expect(outcome.error.kind).toBe('conflict');
    }
    const failure = await client.invoke('shop.place', { sku: 'a', quantity: 5n }).catch((e) => e);
    expect(failure).toBeInstanceOf(ClientError);
    expect(isKeelwerkError(failure)).toBe(true);
    expect(failure).toMatchObject({ code: 'shop.sold_out', requestId: 'req-1', retryable: false });
  });

  it('returns taxonomy errors from attempt, and does not retry an error envelope', async () => {
    const { server, client } = setup({
      'shop.ping': () => ({
        error: { kind: 'unavailable', code: 'core.unavailable', message: 'Busy.', retryable: true },
        status: 503,
      }),
    });
    const outcome = await client.attempt('shop.ping', undefined);
    expect(outcome).toMatchObject({
      ok: false,
      error: { code: 'core.unavailable', retryable: true },
    });
    expect(server.requests.filter((r) => r.path.endsWith('/invoke'))).toHaveLength(1);
  });

  it('fetches the surface once, or takes the committed one', async () => {
    const { server, client } = setup();
    await client.invoke('shop.ping', undefined);
    await client.invoke('shop.ping', undefined);
    expect((await client.surface()).app).toBe('shop');
    expect(server.requests.filter((r) => r.method === 'GET')).toHaveLength(1);
    const committed = protocolFetch({
      surface: probeSurface(),
      handlers: { 'shop.ping': () => ({}) },
    });
    const offline = createRemoteClient<ProbeApp>({
      url: 'https://shop.example',
      apiVersion: '2026-11-01',
      fetch: committed.fetch,
      surface: probeSurface(),
    });
    await offline.invoke('shop.ping', undefined);
    expect(committed.requests.map((r) => r.method)).toEqual(['POST']);
  });

  it('refuses a surface of another API version and an action the surface lacks', async () => {
    const other = protocolFetch({ surface: probeSurface('2027-01-01'), handlers: {} });
    const mismatched = createRemoteClient<ProbeApp>({
      url: 'https://shop.example',
      apiVersion: '2026-11-01',
      fetch: other.fetch,
      retry: noWait,
    });
    await expect(mismatched.invoke('shop.ping', undefined)).rejects.toMatchObject({
      code: 'core.internal',
    });
    const { server, client } = setup();
    await expect(client.invoke('shop.feed' as never, {} as never)).rejects.toMatchObject({
      code: 'core.not_found',
    });
    expect(server.requests.some((r) => r.path.endsWith('/invoke'))).toBe(false);
  });

  it('rejects an input that does not fit the surface before sending it', async () => {
    const { server, client } = setup();
    const outcome = await client.attempt('shop.total', { since: 'yesterday' as never });
    expect(outcome).toMatchObject({
      ok: false,
      error: { code: 'core.validation', kind: 'validation' },
    });
    expect(server.requests.some((r) => r.path.endsWith('/invoke'))).toBe(false);
  });

  it('rejects subscribe, waitForEffects and waitEffects with core.live_unavailable', async () => {
    const { client, server } = setup({
      'shop.ping': () => ({ effects: ['eff-1'] }),
      'shop.cancelAll': () => ({ value: { cancelled: 0 } }),
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
    const before = server.requests.length;
    await expect(
      client.invoke('shop.ping', undefined, { waitEffects: true }),
    ).rejects.toMatchObject({
      code: 'core.live_unavailable',
    });
    await expect(client.invoke('shop.cancelAll', {}, { waitEffects: true })).rejects.toMatchObject({
      code: 'core.live_unavailable',
    });
    expect(server.requests).toHaveLength(before);
    expect(server.requests.some((r) => r.path.endsWith('/invoke'))).toBe(false);
    await expect(client.invoke('shop.ping', undefined)).resolves.toBeUndefined();
  });

  it('checks the url', () => {
    const fetchStub = protocolFetch({ surface: probeSurface(), handlers: {} }).fetch;
    expect(() =>
      createRemoteClient<ProbeApp>({ url: 'ftp://x', apiVersion: 'v', fetch: fetchStub }),
    ).toThrow(TypeError);
    expect(() =>
      createRemoteClient<ProbeApp>({ url: 'unix:///run/op.sock', apiVersion: 'v' }),
    ).toThrow(/unixSocketFetch/);
    expect(() =>
      createRemoteClient<ProbeApp>({
        url: 'unix:///run/op.sock',
        apiVersion: 'v',
        fetch: fetchStub,
      }),
    ).not.toThrow();
  });
});
