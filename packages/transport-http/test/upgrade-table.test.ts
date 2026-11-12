import { describe, expect, test, vi } from 'vitest';
import { registerUpgrade } from '../src/register-upgrade.ts';
import type { UpgradeEntry } from '../src/upgrade-entry.ts';
import type { UpgradeRegistration } from '../src/upgrade-registration.ts';
import { upgradeTable } from '../src/upgrade-table.ts';
import { quietHub } from './support/quiet-hub.ts';
import { socketHost } from './support/socket-host.ts';
import { useHosts } from './support/use-hosts.ts';
import { userSession } from './support/user-session.ts';

const { setup } = useHosts();
const handler = { open: () => undefined };
const spec = (path: string, protocols: readonly string[]) => ({
  app: 'library',
  transport: 'chat',
  path,
  protocols,
});
const served: UpgradeEntry = {
  protocol: 'chat.v1',
  serve: async () => null,
};

describe('upgrade()', () => {
  test('refuses a protocol no entry serves, a path under /_keelwerk and a repeated registration', () => {
    const { host } = setup();
    expect(() => host.upgrade(spec('/chat', ['chat.v1']), handler)).toThrow(TypeError);
    // The host's own protocol has no path-less entry, so no transport may take it to another path.
    expect(() => host.upgrade(spec('/chat', ['keelwerk.live.v1']), handler)).toThrow(TypeError);
    expect(() => host.upgrade(spec('/_keelwerk/chat', ['chat.v1']), handler)).toThrow(TypeError);
    const upgrades = new Map<string, UpgradeRegistration[]>();
    registerUpgrade(upgrades, [served], spec('/chat', ['chat.v1']), handler);
    expect(upgrades.get('library')).toHaveLength(1);
    expect(() => registerUpgrade(upgrades, [served], spec('/chat', ['chat.v1']), handler)).toThrow(
      TypeError,
    );
    registerUpgrade(upgrades, [served], spec('/other', ['chat.v1']), handler);
    expect(upgrades.get('library')).toHaveLength(2);
    expect(() =>
      registerUpgrade(upgrades, [served], spec('/_keelwerk', ['chat.v1']), handler),
    ).toThrow(TypeError);
  });

  test('an upgrade to a path with no entry is 404 and with no offered protocol core.unsupported, before accept', async () => {
    const { host } = setup({ listen: { port: 0 } }, undefined, {
      liveCarrier: () => ({ name: 'websocket', serve: async () => undefined }),
    });
    const { port } = await host.listen();
    const { WebSocket } = await import('ws');
    const result = await new Promise<number>((resolve) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/nowhere`, ['keelwerk.live.v1']);
      socket.on('unexpected-response', (_request, response) => {
        resolve(response.statusCode ?? 0);
        response.resume();
      });
      socket.on('error', () => undefined);
    });
    expect(result).toBe(404);
    const bare = await new Promise<number>((resolve) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/_keelwerk/v1/live`);
      socket.on('unexpected-response', (_request, response) => {
        resolve(response.statusCode ?? 0);
        response.resume();
      });
      socket.on('error', () => undefined);
    });
    expect(bare).toBe(422);
  });

  test('a POST upgrade is 422 core.unsupported before accept', async () => {
    const { host } = setup({ listen: { port: 0 } }, undefined, {
      liveCarrier: () => ({ name: 'websocket', serve: async () => undefined }),
    });
    const { port } = await host.listen();
    const { request } = await import('node:http');
    const answer = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const outgoing = request({
        port,
        host: '127.0.0.1',
        method: 'POST',
        path: '/_keelwerk/v1/live',
        headers: {
          connection: 'Upgrade',
          upgrade: 'websocket',
          'sec-websocket-version': '13',
          'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'sec-websocket-protocol': 'keelwerk.live.v1',
        },
      });
      outgoing.on('response', (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString() }),
        );
      });
      outgoing.on('error', reject);
      outgoing.end();
    });
    expect(answer.status).toBe(422);
    expect(answer.body).toContain('core.unsupported');
  });

  test('a client that leaves while the session opens gives its slot back and stop returns at once', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = 0;
    const made = await socketHost(quietHub({ open: 0 }), {
      session: userSession('ada'),
      open: () => {
        entered += 1;
        return gate.then(() => ({ ok: true as const, value: userSession('ada') }));
      },
    });
    const net = await import('node:net');
    for (let index = 0; index < 25; index += 1) {
      const raw = net.connect(made.port, '127.0.0.1');
      await new Promise<void>((resolve) => raw.once('connect', resolve));
      raw.write(
        [
          'GET /_keelwerk/v1/live HTTP/1.1',
          'Host: x.example',
          'Connection: Upgrade',
          'Upgrade: websocket',
          'Sec-WebSocket-Version: 13',
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Protocol: keelwerk.live.v1',
          '',
          '',
        ].join('\r\n'),
      );
      await vi.waitFor(() => expect(entered).toBe(index + 1));
      raw.destroy();
    }
    release();
    // 25 abandoned upgrades are past the bound of 20 unless each gave its slot back.
    const client = await made.connect();
    expect('socket' in client).toBe(true);
    if ('socket' in client) await client.close();
    const stopped = Date.now();
    await made.host.stop(5_000);
    expect(Date.now() - stopped).toBeLessThan(2_000);
  });

  test('the upgrade table lists keelwerk.live.v1 at /_keelwerk/v1/live', () => {
    expect(upgradeTable).toContainEqual(
      expect.objectContaining({ protocol: 'keelwerk.live.v1', path: '/_keelwerk/v1/live' }),
    );
  });
});
