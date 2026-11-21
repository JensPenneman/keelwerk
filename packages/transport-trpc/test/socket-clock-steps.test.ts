import { steppedClockLiveSocket } from '@keelwerk/testing';
import type { HttpHostOptions } from '@keelwerk/transport-http';
import { afterEach, describe, expect, test } from 'vitest';
import {
  openedTrpcSocket,
  startTrpcWsRuntime,
  type TrpcWsRuntime,
  trpcWsTestClient,
} from './support/trpc-ws-kit.ts';

const kits: TrpcWsRuntime[] = [];
afterEach(async () => {
  await Promise.all(kits.splice(0).map((kit) => kit.runtime.stop()));
});

/**
 * A socket whose client never answers a ping (`answerPings: false`), on a pinned clock: how long its
 * pong takes to come cannot decide anything, since none ever does, and the clock moves only when the
 * case moves it.
 */
async function silent(liveSocket: NonNullable<HttpHostOptions['liveSocket']>) {
  const kit = await startTrpcWsRuntime({ liveSocket });
  kits.push(kit);
  const socket = openedTrpcSocket(await kit.connect({ options: { answerPings: false } }));
  return { kit, ws: trpcWsTestClient(socket) };
}

describe('a pinned clock that steps past the heartbeat, with a client that does not answer pings', () => {
  test('the default heartbeat sends a ping and the next step past its pong deadline terminates the socket 1006', async () => {
    // The runner's session check before it also set the heartbeat: `revalidateMs` alone is far away.
    const { kit, ws } = await silent({ revalidateMs: 10_000_000 });
    // The first step sends the ping; its pong deadline is 10 s after it, on the same clock.
    await kit.advance(31_000);
    await kit.advance(11_000);
    expect((await ws.socket.closed).code).toBe(1006);
  });

  test('the runner bounds send no ping across many steps of a minute: the socket stays open', async () => {
    const { kit, ws } = await silent(steppedClockLiveSocket);
    for (let step = 0; step < 6; step += 1) await kit.advance(61_000);
    // An open socket answers; a terminated one would make this reject.
    await ws.ping();
  });
});
