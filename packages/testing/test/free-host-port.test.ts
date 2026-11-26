import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import { freeHostPort } from '../src/postgres/free-host-port.ts';

const held: Server[] = [];

afterEach(async () => {
  await Promise.all(
    held.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))),
  );
});

type Holder = { readonly host: string; readonly ipv6Only?: boolean };

/** Listens on the port at the address; rejects when something holds it or the address is absent. */
function hold(port: number, holder: Holder = { host: '0.0.0.0' }): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(
      { port, host: holder.host, exclusive: true, ipv6Only: holder.ipv6Only === true },
      () => {
        held.push(server);
        resolve(server);
      },
    );
  });
}

function release(server: Server): Promise<void> {
  held.splice(held.indexOf(server), 1);
  return new Promise((done) => server.close(() => done()));
}

/** A port of the default range that this process holds at the address, so that no other process does. */
async function holdSomewhere(holder: Holder): Promise<number> {
  for (let port = 24_000; ; port += 1) {
    try {
      await hold(port, holder);
      return port;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EADDRNOTAVAIL' || code === 'EAFNOSUPPORT') throw error;
    }
  }
}

describe('freeHostPort', () => {
  test('answers a port from 20000 to 29999 that can be listened on', async () => {
    const port = await freeHostPort();
    expect(port).toBeGreaterThanOrEqual(20_000);
    expect(port).toBeLessThanOrEqual(29_999);
    await hold(port);
  });

  test('skips a port that is held and takes the next', async () => {
    const first = await holdSomewhere({ host: '0.0.0.0' });
    const second = await hold(first + 1);
    await release(second);
    expect(await freeHostPort({ first, last: first + 1 }, first)).toBe(first + 1);
  });

  test('goes round to the start of the range when the last port is held', async () => {
    const first = await holdSomewhere({ host: '0.0.0.0' });
    const second = await hold(first + 1);
    await release(held[0] as Server);
    expect(await freeHostPort({ first, last: first + 1 }, first + 1)).toBe(first);
    await release(second);
  });

  test('moves a start below the range into the range', async () => {
    const first = await holdSomewhere({ host: '0.0.0.0' });
    const second = await hold(first + 1);
    await release(second);
    expect(await freeHostPort({ first, last: first + 1 }, first - 5)).toBe(first + 1);
  });

  test.each<[string, Holder]>([
    ['0.0.0.0', { host: '0.0.0.0' }],
    ['dual-stack ::', { host: '::' }],
    ['IPv6-only ::', { host: '::', ipv6Only: true }],
    ['127.0.0.1', { host: '127.0.0.1' }],
    ['::1', { host: '::1' }],
  ])('does not answer a port that is held on %s', async (_name, holder) => {
    let port: number;
    try {
      port = await holdSomewhere(holder);
    } catch {
      return; // the host has no such address: nothing to hold
    }
    await expect(freeHostPort({ first: port, last: port }, port)).rejects.toThrow(
      `No host port from ${port} to ${port} can be listened on at 0.0.0.0, ::, 127.0.0.1 and ::1.`,
    );
  });
});
