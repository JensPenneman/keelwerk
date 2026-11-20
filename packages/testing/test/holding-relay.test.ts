import type { AddressInfo, Socket } from 'node:net';
import { connect, createServer } from 'node:net';
import { afterEach, expect, test } from 'vitest';
import { startHoldingRelay } from './support/holding-relay.ts';

const cleanups: (() => void | Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** A client connected through a relay to a server whose side of that one connection is `served`. */
async function connectThroughRelay() {
  let accepted: (socket: Socket) => void = () => undefined;
  const connection = new Promise<Socket>((resolve) => {
    accepted = resolve;
  });
  const server = createServer((socket) => {
    socket.on('error', () => undefined);
    accepted(socket);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => {
    server.close();
  });
  const relay = await startHoldingRelay(
    `postgres://u@127.0.0.1:${String((server.address() as AddressInfo).port)}/d`,
  );
  cleanups.push(() => relay.close());
  const url = new URL(relay.url);
  const client = connect(Number(url.port), url.hostname);
  cleanups.push(() => {
    client.destroy();
  });
  const events: string[] = [];
  client.on('error', () => undefined);
  client.on('data', (chunk) => events.push(`data ${chunk.toString()}`));
  client.on('end', () => events.push('end'));
  client.on('close', () => events.push('close'));
  await new Promise<void>((resolve) => client.once('connect', resolve));
  return { relay, client, events, served: await connection };
}

test('keeps back what the server said and its end until the client writes, then delivers both', async () => {
  const { relay, client, events, served } = await connectThroughRelay();

  relay.hold();
  await new Promise<void>((resolve) => served.end('ok', resolve));
  await relay.whenServerEnded();
  expect(relay.delivered()).toEqual({ bytes: 0, ended: false });

  client.write('next');
  await new Promise<void>((resolve) => client.once('close', () => resolve()));
  expect(events).toEqual(['data ok', 'end', 'close']);
});

test('delivers what it kept and ends the client when the server resets the held connection', async () => {
  const { relay, client, events, served } = await connectThroughRelay();

  relay.hold();
  await new Promise<void>((resolve) => served.write('ok', () => resolve()));
  // A reset discards what the relay has not read yet, so it resets only once the relay holds the bytes.
  await relay.whenKept(2);
  served.resetAndDestroy();
  await relay.whenServerEnded();
  expect(relay.delivered()).toEqual({ bytes: 0, ended: false });

  client.write('next');
  await new Promise<void>((resolve) => client.once('close', () => resolve()));
  expect(events).toEqual(['data ok', 'end', 'close']);
});
