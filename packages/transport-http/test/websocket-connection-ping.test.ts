import { EventEmitter } from 'node:events';
import { pinnedLiveTimers } from '@keelwerk/testing';
import { describe, expect, test, vi } from 'vitest';
import type { WebSocket as WsSocket } from 'ws';
import { websocketConnection } from '../src/websocket-connection.ts';

const maxBufferedBytes = 1_000;

/** A socket that holds `bufferedAmount` bytes and records what is written or cut. */
function fakeSocket(bufferedAmount: number) {
  const socket = Object.assign(new EventEmitter(), {
    // biome-ignore lint/style/useNamingConvention: the readyState constants of a ws socket
    OPEN: 1,
    // biome-ignore lint/style/useNamingConvention: the readyState constants of a ws socket
    CLOSED: 3,
    readyState: 1,
    bufferedAmount,
    ping: vi.fn(),
    pong: vi.fn(),
    terminate: vi.fn(),
    close: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    send: vi.fn(),
  });
  const clock = { now: () => Temporal.Instant.from('2026-11-12T12:00:00Z') };
  const opened = websocketConnection(socket as unknown as WsSocket, {
    maxBufferedBytes,
    stallMs: 10_000,
    pongTimeoutMs: 10_000,
    maxMessageBytes: 1_000,
    maxMessagesPerWindow: 100,
    messageWindowMs: 1_000,
    clock,
    timers: pinnedLiveTimers(clock),
  });
  return { socket, opened };
}

describe('the heartbeat ping of a websocket connection', () => {
  test('a socket holding more than the bound is cut and no ping is queued on it', async () => {
    const { socket, opened } = fakeSocket(maxBufferedBytes + 1);
    expect(await opened.connection.ping?.()).toBe(false);
    expect(socket.terminate).toHaveBeenCalledOnce();
    expect(socket.ping).not.toHaveBeenCalled();
  });

  test('a socket at the bound is pinged and kept', () => {
    const { socket, opened } = fakeSocket(maxBufferedBytes);
    void opened.connection.ping?.();
    expect(socket.ping).toHaveBeenCalledOnce();
    expect(socket.terminate).not.toHaveBeenCalled();
  });
});
