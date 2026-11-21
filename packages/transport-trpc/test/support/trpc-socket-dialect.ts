import { deriveSurface } from '@keelwerk/core';
import type { SocketDialect } from '@keelwerk/testing';
import { keelwerkSuperjson } from '../../src/transformer/keelwerk-superjson.ts';
import { trpcConformanceApp, trpcConformanceVersions } from './trpc-conformance-app.ts';
import { trpcSocketFrameOf } from './trpc-socket-frame-of.ts';

const surface = deriveSurface(trpcConformanceApp as never, trpcConformanceVersions.head).surface;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function codeOf(error: unknown): string {
  const shape: unknown =
    isRecord(error) && 'json' in error ? keelwerkSuperjson().deserialize(error as never) : error;
  const data = isRecord(shape) ? shape.data : undefined;
  const keelwerk = isRecord(data) ? data.keelwerk : undefined;
  return isRecord(keelwerk) && typeof keelwerk.code === 'string' ? keelwerk.code : 'unknown';
}

/**
 * `keelwerk.trpc.v1` on `/trpc`: tRPC has no acknowledgement, so a socket is open once its `PING` is
 * answered `PONG`; a subscription to the public ticker answers `started` and then its head (tracked),
 * or an error on its id.
 */
export const trpcSocketDialect: SocketDialect = {
  protocol: 'keelwerk.trpc.v1',
  path: '/trpc',
  async open(socket) {
    socket.send('PING');
    const answer = String(await socket.next());
    if (answer !== 'PONG') throw new Error(`Expected PONG, got ${answer}.`);
  },
  async subscribe(socket, id) {
    socket.send(
      JSON.stringify({
        id,
        method: 'subscription',
        params: { path: 'loans.loanTicker', input: keelwerkSuperjson().serialize(undefined) },
      }),
    );
    for (;;) {
      const answer: unknown = JSON.parse(String(await socket.next()));
      if (!isRecord(answer) || answer.id !== id) {
        return { kind: 'other', frame: JSON.stringify(answer) };
      }
      if (isRecord(answer.error)) return { kind: 'refused', code: codeOf(answer.error) };
      const result = answer.result;
      if (isRecord(result) && result.type === 'started') continue;
      if (isRecord(result) && result.type === 'data') {
        const frame = trpcSocketFrameOf(answer, surface, 'loans.loanTicker');
        return frame?.event === 'head'
          ? { kind: 'head' }
          : { kind: 'other', frame: JSON.stringify(frame) };
      }
      return { kind: 'other', frame: JSON.stringify(answer) };
    }
  },
};
