import type { KeelwerkError, SocketSession } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import {
  connectRegisteredSocket,
  opened,
  registeredSocketKit,
} from './support/registered-socket-kit.ts';

const { start } = registeredSocketKit();

describe('the calls of a transport socket on the host', () => {
  test('a call slot is bounded by maxPendingInvokes, given back once, and a TypeError before the open', async () => {
    const { port } = await start(
      {
        open(socket, _ctx, connection: SocketSession) {
          const held: { release(): void }[] = [];
          const attempt = (): string => {
            try {
              held.push(connection.invocation());
              return 'taken';
            } catch (failure) {
              return failure instanceof TypeError ? 'TypeError' : (failure as KeelwerkError).code;
            }
          };
          const early = attempt();
          const ready = connection.open({});
          socket.addEventListener('message', async (event) => {
            await ready;
            const command = String(event.data);
            if (command === 'early') socket.send(early);
            else if (command === 'take') socket.send(attempt());
            else {
              // The same slot given back twice frees one place, not two.
              held[0]?.release();
              held[0]?.release();
              socket.send('released');
            }
          });
        },
      },
      { liveSocket: { maxPendingInvokes: 2 } },
    );
    const client = opened(await connectRegisteredSocket(port));
    for (const [command, answer] of [
      ['early', 'TypeError'],
      ['take', 'taken'],
      ['take', 'taken'],
      ['take', 'core.quota_exceeded'],
      ['release', 'released'],
      ['take', 'taken'],
      ['take', 'core.quota_exceeded'],
    ] as const) {
      client.socket.send(command);
      expect(await client.next()).toBe(answer);
    }
  });

  test('a handler may close its socket 1011 for an internal failure', async () => {
    const { port } = await start({
      open(socket) {
        socket.addEventListener('message', () => socket.close(1011, 'internal_error'));
      },
    });
    const client = opened(await connectRegisteredSocket(port));
    client.socket.send('fail');
    expect(await client.closed).toBe(1011);
  });
});
