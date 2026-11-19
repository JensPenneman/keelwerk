import type { LiveFrame } from '@keelwerk/core';
import { readEventStream } from '@keelwerk/testing';
import { describe, expect, test } from 'vitest';
import { mountedTrpc, queryTrpc, sendTrpc, trpcConformanceSurface } from './support/trpc-kit.ts';

describe('closing the mount', () => {
  test('close ends open streams and answers new requests unavailable', async () => {
    const mounted = await mountedTrpc(
      trpcConformanceSurface(),
      () => ({ ok: true, value: undefined }),
      {
        subscribe: (inv) =>
          (async function* (): AsyncGenerator<LiveFrame<unknown>> {
            yield* [];
            await new Promise<void>((resolve) =>
              inv.signal.addEventListener('abort', () => resolve(), { once: true }),
            );
          })(),
      },
    );
    const response = await sendTrpc(mounted.handler, 'loans.loanEvents', {
      headers: { accept: 'text/event-stream' },
    });
    const reader = readEventStream(response);
    await reader.next();
    await mounted.close();
    for (;;) {
      const event = await reader.next();
      if (event === undefined) break;
    }
    const refused = await queryTrpc(mounted.handler, 'loans.about', {});
    expect(refused.status).toBe(503);
    expect(refused.headers.get('retry-after')).toBe('1');
    expect(refused.body.error.json.data.keelwerk).toMatchObject({
      kind: 'unavailable',
      retryAfter: 1,
    });
  });
});
