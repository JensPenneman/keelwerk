import { describe, expect, it } from 'vitest';
import { createRemoteClient } from '../../src/index.ts';
import type { ProbeApp } from '../support/probe-app.ts';
import { probeSurface } from '../support/probe-surface.ts';
import { protocolFetch } from '../support/protocol-fetch.ts';
import { fastRetry } from './support/live-fixtures.ts';

type Message = Record<string, unknown>;

const quota = {
  type: 'error',
  id: 's1',
  error: {
    kind: 'rate_limited',
    code: 'core.quota_exceeded',
    message: 'Too many open streams.',
    retryable: false,
    requestId: 'r',
  },
};

/** A socket the test scripts: what the server says to `hello` and to `subscribe`. */
class ScriptedSocket {
  readyState = 0;
  readonly sent: Message[] = [];
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>();

  private readonly answers: (message: Message, socket: ScriptedSocket) => void;

  constructor(answers: (message: Message, socket: ScriptedSocket) => void) {
    this.answers = answers;
    queueMicrotask(() => {
      this.readyState = 1;
      this.emit('open', {});
    });
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(data: string): void {
    const message = JSON.parse(data) as Message;
    this.sent.push(message);
    queueMicrotask(() => this.answers(message, this));
  }

  say(message: Message): void {
    if (this.readyState === 1) this.emit('message', { data: JSON.stringify(message) });
  }

  close(): void {
    if (this.readyState > 1) return;
    this.readyState = 3;
    this.emit('close', {});
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function surfaceWithFeed() {
  const base = probeSurface();
  const ping = base.actions.find((candidate) => candidate.ref === 'shop.ping');
  if (ping === undefined) throw new Error('The probe surface has no shop.ping.');
  const text = { optional: false, access: 'read-write', kind: 'string' } as const;
  return {
    ...base,
    actions: [
      ...base.actions,
      { ...ping, ref: 'shop.feed', name: 'feed', kind: 'subscription', output: text },
    ],
  } as typeof base;
}

describe('a socket leg whose reopen the server refuses', () => {
  it('is retried like the same refusal on the server-sent events leg, from the last token', async () => {
    const server = protocolFetch({ surface: surfaceWithFeed(), handlers: {} });
    const sockets: ScriptedSocket[] = [];
    const script = (index: number) => (message: Message, socket: ScriptedSocket) => {
      if (message.type === 'hello') socket.say({ type: 'welcome' });
      if (message.type !== 'subscribe') return;
      if (index === 0) {
        socket.say({ type: 'head', id: 's1', state: 'tok-1' });
        socket.close();
      } else if (index === 1) {
        // The host still counts the slot of the dead connection.
        socket.say(quota);
      } else {
        socket.say({ type: 'head', id: 's1', state: 'tok-2' });
      }
    };
    const client = createRemoteClient<ProbeApp>({
      url: 'https://shop.example/',
      apiVersion: '2026-11-01',
      fetch: server.fetch,
      live: 'websocket',
      webSocket: () => {
        const socket = new ScriptedSocket(script(sockets.length));
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      retry: fastRetry,
    });
    const frames = client.subscribe('shop.feed', {})[Symbol.asyncIterator]();
    try {
      expect((await frames.next()).value).toMatchObject({ control: 'head', state: 'tok-1' });
      // The refused second socket does not end the subscription: the third one carries on.
      expect((await frames.next()).value).toMatchObject({ control: 'head', state: 'tok-2' });
      expect(sockets).toHaveLength(3);
      const resumed = sockets.map((socket) => socket.sent.find((m) => m.type === 'subscribe'));
      expect(resumed[0]?.after).toBeUndefined();
      expect(resumed[1]?.after).toBe('tok-1');
      expect(resumed[2]?.after).toBe('tok-1');
    } finally {
      await frames.return?.();
    }
  });

  it('ends the subscription when the refusal is not one a reopen can outlast', async () => {
    const server = protocolFetch({ surface: surfaceWithFeed(), handlers: {} });
    const client = createRemoteClient<ProbeApp>({
      url: 'https://shop.example/',
      apiVersion: '2026-11-01',
      fetch: server.fetch,
      live: 'websocket',
      webSocket: () =>
        new ScriptedSocket((message, socket) => {
          if (message.type === 'hello') socket.say({ type: 'welcome' });
          if (message.type === 'subscribe') {
            socket.say({
              type: 'error',
              id: 's1',
              error: {
                kind: 'forbidden',
                code: 'core.forbidden',
                message: 'No.',
                retryable: false,
                requestId: 'r',
              },
            });
          }
        }) as unknown as WebSocket,
      retry: fastRetry,
    });
    const frames = client.subscribe('shop.feed', {})[Symbol.asyncIterator]();
    await expect(frames.next()).rejects.toMatchObject({ code: 'core.forbidden' });
  });
});
