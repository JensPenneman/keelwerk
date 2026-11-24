import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRemoteClient } from '../src/index.ts';
import { unixSocketFetch } from '../src/unix-socket/index.ts';
import type { ProbeApp } from './support/probe-app.ts';
import { probeSurface } from './support/probe-surface.ts';
import { protocolFetch } from './support/protocol-fetch.ts';

const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const step of cleanup.splice(0)) await step();
});

/** Serves the protocol-speaking fetch over a Unix socket with node:http, the way the operator socket does. */
async function listen(): Promise<{ socket: string; seen: string[] }> {
  const directory = await mkdtemp(join(tmpdir(), 'kw-client-'));
  const socket = join(directory, 'op.sock');
  const seen: string[] = [];
  const fake = protocolFetch({
    surface: probeSurface(),
    handlers: { 'shop.ping': () => ({}), 'shop.cancelAll': () => ({ value: { cancelled: 7 } }) },
  });
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      seen.push(`${request.method} ${request.url} ${request.headers['keelwerk-version']}`);
      const body = request.method === 'GET' ? undefined : Buffer.concat(chunks);
      fake
        .fetch(`http://localhost${request.url}`, {
          method: request.method ?? 'GET',
          headers: request.headers as Record<string, string>,
          ...(body !== undefined && { body }),
        })
        .then(async (answer) => {
          response.writeHead(answer.status, Object.fromEntries(answer.headers));
          response.end(Buffer.from(await answer.arrayBuffer()));
        })
        .catch((failure: unknown) =>
          response.destroy(failure instanceof Error ? failure : undefined),
        );
    });
  });
  await new Promise<void>((resolve) => server.listen(socket, resolve));
  cleanup.push(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
    () => rm(directory, { recursive: true, force: true }),
  );
  return { socket, seen };
}

describe('unixSocketFetch', () => {
  it('carries a unix:// url through the socket, surface and invocation both', async () => {
    const { socket, seen } = await listen();
    const client = createRemoteClient<ProbeApp>({
      url: `unix://${socket}`,
      apiVersion: '2026-11-01',
      fetch: unixSocketFetch(socket),
    });
    await expect(client.invoke('shop.cancelAll', {})).resolves.toEqual({ cancelled: 7 });
    expect(seen).toEqual([
      'GET /_keelwerk/v1/surface 2026-11-01',
      'POST /_keelwerk/v1/invoke 2026-11-01',
    ]);
  });

  it('rejects when nothing listens on the socket, which the client then retries as a network failure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kw-client-'));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const missing = join(directory, 'none.sock');
    const client = createRemoteClient<ProbeApp>({
      url: `unix://${missing}`,
      apiVersion: '2026-11-01',
      fetch: unixSocketFetch(missing),
      surface: probeSurface(),
      retry: { retries: 1, sleep: () => Promise.resolve() },
    });
    await expect(client.invoke('shop.ping', undefined)).rejects.toMatchObject({
      code: 'core.unavailable',
    });
  });

  it('the body streams before the response ends', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kw-client-'));
    const socket = join(directory, 'stream.sock');
    let finish: (() => void) | undefined;
    const server: Server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('data: first\n\n');
      finish = () => response.end('data: last\n\n');
    });
    await new Promise<void>((resolve) => server.listen(socket, resolve));
    cleanup.push(
      () => new Promise<void>((resolve) => server.close(() => resolve())),
      () => rm(directory, { recursive: true, force: true }),
    );
    const response = await unixSocketFetch(socket)('http://localhost/events');
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    const first = await reader?.read();
    expect(new TextDecoder().decode(first?.value)).toBe('data: first\n\n');
    finish?.();
    const rest = await reader?.read();
    expect(new TextDecoder().decode(rest?.value)).toBe('data: last\n\n');
    expect((await reader?.read())?.done).toBe(true);
  });
});
