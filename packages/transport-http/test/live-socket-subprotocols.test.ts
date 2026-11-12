import { afterEach, describe, expect, test } from 'vitest';
import { connectLiveSocket } from './support/connect-live-socket.ts';
import { quietHub } from './support/quiet-hub.ts';
import { type SocketHost, socketHost } from './support/socket-host.ts';
import { userSession } from './support/user-session.ts';

const hosts: SocketHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((made) => made.host.stop(100)));
});

async function offered(header: string) {
  const made = await socketHost(quietHub({ open: 0 }), { session: userSession('ada') });
  hosts.push(made);
  return connectLiveSocket(made.port, 'x.example', { 'sec-websocket-protocol': header }, []);
}

describe('the Sec-WebSocket-Protocol header of an upgrade', () => {
  test.each([
    ['a name outside the token grammar', 'keelwerk.live.v1, bad name'],
    ['an empty name', 'keelwerk.live.v1,,keelwerk.live.v1'],
    ['a name twice', 'keelwerk.live.v1, other, keelwerk.live.v1'],
  ])('with %s is refused 400 core.malformed_request', async (_label, header) => {
    const refused = await offered(header);
    expect(refused).toMatchObject({
      status: 400,
      body: { error: { code: 'core.malformed_request' } },
    });
  });

  test('a well-formed list that holds the protocol among others opens the socket', async () => {
    const made = await socketHost(quietHub({ open: 0 }), { session: userSession('ada') });
    hosts.push(made);
    const client = await connectLiveSocket(made.port, 'x.example', {}, [
      'other.v2',
      'keelwerk.live.v1',
    ]);
    expect('socket' in client).toBe(true);
    if ('socket' in client) {
      expect(client.socket.protocol).toBe('keelwerk.live.v1');
      await client.close();
    }
  });
});
