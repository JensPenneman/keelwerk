import { Agent, get as httpGet } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createFakeInvoker } from './support/fake-invoker.ts';
import { libraryActions } from './support/library-actions.ts';
import { postJson } from './support/post-json.ts';
import { useHosts } from './support/use-hosts.ts';

const { setup } = useHosts();

describe('the carrier', () => {
  it('fills host, path, lower-case headers, token and connection from a request', async () => {
    const { host, invoker } = setup();
    await host.fetch(
      postJson(
        '/_keelwerk/v1/invoke',
        { action: 'library.lookup' },
        {
          authorization: 'Bearer abc.def',
          'x-keelwerk-tenant': 'acme',
          'keelwerk-client-id': 'dev-1',
        },
      ),
    );
    const carrier = invoker.opened[0];
    expect(carrier?.transport).toBe('http');
    expect(carrier?.host).toBe('library.example');
    expect(carrier?.path).toBe('/_keelwerk/v1/invoke');
    expect(carrier?.token).toBe('abc.def');
    expect(carrier?.headers).toMatchObject({
      authorization: 'Bearer abc.def',
      'x-keelwerk-tenant': 'acme',
      'keelwerk-client-id': 'dev-1',
      host: 'library.example',
    });
    expect(carrier?.connection).toMatchObject({
      listener: 'http',
      remote: { address: '127.0.0.1' },
    });
    expect(carrier?.local).toBeUndefined();
  });

  it('takes no token from a non-bearer authorization', async () => {
    const { host, invoker } = setup();
    await host.fetch(
      postJson(
        '/_keelwerk/v1/invoke',
        { action: 'library.lookup' },
        { authorization: 'Basic abc' },
      ),
    );
    expect(invoker.opened[0]?.token).toBeUndefined();
  });

  it('copies the version query parameter of a GET into the headers', async () => {
    const { host, invoker } = setup();
    const response = await host.fetch(
      new Request('https://library.example/_keelwerk/v1/surface?keelwerk-version=2026-02-02'),
    );
    expect(invoker.opened[0]?.headers?.['keelwerk-version']).toBe('2026-02-02');
    expect(response.headers.get('keelwerk-version')).toBe('2026-11-01');
  });

  it('lets the enrichers name a scope key before the scope is resolved', async () => {
    const invoker = createFakeInvoker({ actions: libraryActions });
    const { host } = setup({}, invoker, {
      enrichers: [
        { id: 'none', enrich: () => null },
        { id: 'receiver', enrich: (c) => ({ kind: 'webhook-endpoint', value: c.path ?? '' }) },
      ],
    });
    await host.fetch(postJson('/_keelwerk/v1/invoke', { action: 'library.lookup' }));
    expect(invoker.opened[0]?.scopeKey).toEqual({
      kind: 'webhook-endpoint',
      value: '/_keelwerk/v1/invoke',
    });
  });

  it('reads the TCP peer, and the forwarded address only from a trusted proxy', async () => {
    const trusting = setup({ listen: { port: 0 }, trustedProxies: ['127.0.0.0/8'] });
    const { port } = await trusting.host.listen();
    const send = (port: number) =>
      fetch(`http://127.0.0.1:${port}/_keelwerk/v1/invoke`, {
        method: 'POST',
        headers: { 'x-forwarded-for': '203.0.113.9, 127.0.0.1' },
        body: JSON.stringify({ action: 'library.lookup' }),
      });
    await send(port ?? 0);
    expect(trusting.invoker.opened[0]?.connection?.remote.address).toBe('203.0.113.9');
    expect(trusting.invoker.opened[0]?.connection?.local.port).toBe(port);

    const plain = setup({ listen: { port: 0 } });
    const { port: plainPort } = await plain.host.listen();
    await send(plainPort ?? 0);
    expect(plain.invoker.opened[0]?.connection?.remote.address).toBe('127.0.0.1');
  });

  it('gives the requests of one connection one connection id', async () => {
    const { host, invoker } = setup({ listen: { port: 0 } });
    const { port } = await host.listen();
    const agent = new Agent({ keepAlive: true });
    const get = () =>
      new Promise<void>((resolve) => {
        httpGet({ port, agent, path: '/_keelwerk/v1/capabilities' }, (res) => {
          res.resume();
          res.on('end', resolve);
        }).on('error', () => resolve());
      });
    await get();
    await get();
    agent.destroy();
    expect(invoker.opened).toHaveLength(2);
    const [first, second] = invoker.opened;
    expect(first?.connection?.id).toBe(second?.connection?.id);
  });
});
