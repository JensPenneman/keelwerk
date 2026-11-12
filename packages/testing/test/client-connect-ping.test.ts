import { afterEach, describe, expect, it } from 'vitest';
import { clientConnectOf } from '../src/conformance/transport/client-connect-of.ts';
import {
  accept,
  bodies,
  frame,
  listen,
  stopServer,
  unmasked,
  upgradeRequest,
} from './support/web-socket-server.ts';

afterEach(stopServer);

describe('clientConnectOf pings and pongs', () => {
  it('sends masked frames and answers a ping with a pong of the same payload', async () => {
    let received = Buffer.alloc(0);
    const port = await listen((request, socket) => {
      accept(request, socket);
      socket.on('data', (chunk: Buffer) => {
        received = Buffer.concat([received, chunk]);
      });
      socket.write(frame(9, Buffer.from('beat')));
    });
    const upgrade = await clientConnectOf(port)(upgradeRequest());
    if (upgrade.kind !== 'open') throw new Error('The upgrade was refused.');
    upgrade.socket.send('text');
    upgrade.socket.send(new Uint8Array([7]));
    await expect.poll(() => unmasked(received).length).toBe(3);
    const frames = unmasked(received);
    expect(frames).toContainEqual({ opcode: 10, payload: 'masked:beat' });
    expect(frames).toContainEqual({ opcode: 1, payload: 'masked:text' });
    expect(frames).toContainEqual({ opcode: 2, payload: 'masked:\u0007' });
    await upgrade.socket.close();
  });

  it('pings the server and resolves with the payload of the pong; a socket that never answers rejects', async () => {
    const port = await listen((request, socket) => {
      accept(request, socket);
      socket.on('data', (chunk: Buffer) => {
        for (const entry of bodies(chunk)) {
          if (entry.opcode === 9 && entry.body.toString() !== 'silent') {
            socket.write(frame(10, entry.body));
          }
        }
      });
    });
    const upgrade = await clientConnectOf(port)(upgradeRequest());
    if (upgrade.kind !== 'open') throw new Error('The upgrade was refused.');
    expect(await upgrade.socket.ping?.(new Uint8Array([1, 2, 3]))).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect((await upgrade.socket.ping?.())?.length).toBe(8);
    await expect(upgrade.socket.ping?.(Buffer.from('silent'), 100)).rejects.toThrow(/No pong/);
    await upgrade.socket.close();
  });

  it('answers a ping only with the pong of its own payload: a late or unsolicited pong resolves nothing', async () => {
    const port = await listen((request, socket) => {
      accept(request, socket);
      let late = false;
      socket.on('data', (chunk: Buffer) => {
        for (const entry of bodies(chunk)) {
          if (entry.opcode !== 9) continue;
          if (entry.body.toString() === 'late') {
            late = true;
            socket.write(frame(10, Buffer.from('heartbeat')));
          } else {
            if (late) socket.write(frame(10, Buffer.from('late')));
            socket.write(frame(10, entry.body));
          }
        }
      });
    });
    const upgrade = await clientConnectOf(port)(upgradeRequest());
    if (upgrade.kind !== 'open') throw new Error('The upgrade was refused.');
    await expect(upgrade.socket.ping?.(Buffer.from('late'), 100)).rejects.toThrow(/No pong/);
    expect(await upgrade.socket.ping?.(Buffer.from('b'))).toEqual(new Uint8Array(Buffer.from('b')));
    await upgrade.socket.close();
  });

  it('resolves a default ping with the echoed bytes, not with an empty pong that comes first', async () => {
    const sent: Buffer[] = [];
    const port = await listen((request, socket) => {
      accept(request, socket);
      socket.on('data', (chunk: Buffer) => {
        for (const entry of bodies(chunk)) {
          if (entry.opcode !== 9) continue;
          sent.push(entry.body);
          socket.write(frame(10, Buffer.alloc(0)));
          socket.write(frame(10, entry.body));
        }
      });
    });
    const upgrade = await clientConnectOf(port)(upgradeRequest());
    if (upgrade.kind !== 'open') throw new Error('The upgrade was refused.');
    const first = await upgrade.socket.ping?.();
    const second = await upgrade.socket.ping?.();
    expect(first?.length).toBe(8);
    expect(second?.length).toBe(8);
    expect(Buffer.from(first ?? []).equals(sent[0] ?? Buffer.alloc(0))).toBe(true);
    expect(Buffer.from(second ?? []).equals(sent[1] ?? Buffer.alloc(0))).toBe(true);
    expect(Buffer.from(first ?? []).equals(Buffer.from(second ?? []))).toBe(false);
    await upgrade.socket.close();
  });

  it('leaves a server ping unanswered when told not to answer pings', async () => {
    let received = Buffer.alloc(0);
    const port = await listen((request, socket) => {
      accept(request, socket);
      socket.on('data', (chunk: Buffer) => {
        received = Buffer.concat([received, chunk]);
      });
      socket.write(frame(9, Buffer.from('beat')));
      socket.write(frame(1, Buffer.from('after')));
    });
    const upgrade = await clientConnectOf(port)(upgradeRequest(), { answerPings: false });
    if (upgrade.kind !== 'open') throw new Error('The upgrade was refused.');
    expect(await upgrade.socket.next()).toBe('after');
    upgrade.socket.send('done');
    await expect.poll(() => unmasked(received)).toEqual([{ opcode: 1, payload: 'masked:done' }]);
    await upgrade.socket.close();
  });
});
