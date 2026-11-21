import { describe, expect, test } from 'vitest';
import { trpcWebSocket } from '../src/client/trpc-web-socket.ts';

/** A base class that records what its constructor was offered. */
const offered: unknown[] = [];
class Recording {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  constructor(_url: string | URL, offer?: unknown) {
    offered.push(offer);
  }
}
const subclass = trpcWebSocket(Recording as unknown as typeof WebSocket);
const wire = 'keelwerk.trpc.v1';

function offerOf(...args: [string | URL, unknown?]): unknown {
  offered.length = 0;
  new (subclass as unknown as new (...held: unknown[]) => object)(...args);
  return offered[0];
}

describe('trpcWebSocket', () => {
  test('offers keelwerk.trpc.v1 alone, beside one protocol, beside a list and inside a WebSocketInit, never twice', () => {
    expect(offerOf('wss://x/trpc')).toEqual([wire]);
    expect(offerOf('wss://x/trpc', 'other')).toEqual(['other', wire]);
    expect(offerOf('wss://x/trpc', ['a', 'b'])).toEqual(['a', 'b', wire]);
    expect(offerOf('wss://x/trpc', { protocols: ['a'], headers: { 'x-y': 'z' } })).toEqual({
      protocols: ['a', wire],
      headers: { 'x-y': 'z' },
    });
    expect(offerOf('wss://x/trpc', { protocols: 'a' })).toEqual({ protocols: ['a', wire] });
    expect(offerOf('wss://x/trpc', {})).toEqual({ protocols: [wire] });
    expect(offerOf('wss://x/trpc', wire)).toEqual([wire]);
    expect(offerOf('wss://x/trpc', [wire, 'a'])).toEqual([wire, 'a']);
    expect(offerOf('wss://x/trpc', { protocols: [wire] })).toEqual({ protocols: [wire] });
  });

  test('the class keeps the constants of its base', () => {
    expect(subclass.OPEN).toBe(1);
    expect(subclass.CLOSED).toBe(3);
    expect(Object.getPrototypeOf(subclass)).toBe(Recording);
  });
});
