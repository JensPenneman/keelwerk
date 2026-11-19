import { coreApiVersions } from '@keelwerk/core';
import { freshName, startTransportRuntime } from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createRemoteClient } from '../../src/index.ts';
import type { LiveApp } from '../live-app.ts';
import {
  due,
  fastRetry,
  liveStreamsApp,
  principalHeaders,
  withHeaders,
} from './support/live-fixtures.ts';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const runtime = await startTransportRuntime({ app: liveStreamsApp, host: httpHost() });
afterAll(() => runtime.stop());

const refusal = JSON.stringify({
  ok: false,
  error: {
    kind: 'rate_limited',
    code: 'core.quota_exceeded',
    message: 'Too many open streams.',
    retryable: false,
    requestId: 'r',
  },
});

describe('a reopen the host refuses while it still holds the slot of the dead connection', () => {
  it('is retried until the host lets the subscription in again: no loan is lost', async () => {
    let opened = 0;
    const send = async (request: Request): Promise<Response> => {
      const response = await runtime.fetch(request);
      if (!new URL(request.url).pathname.endsWith('/subscribe')) return response;
      opened += 1;
      if (opened === 2 || opened === 3) {
        await response.body?.cancel();
        return new Response(refusal, {
          status: 429,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (opened > 3 || response.body === null) return response;
      // The first connection delivers up to head and then breaks, as a dropped link does.
      const reader = response.body.getReader();
      let sawHead = false;
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (sawHead) {
            await reader.cancel().catch(() => undefined);
            controller.error(new TypeError('terminated'));
            return;
          }
          const chunk = await reader.read();
          if (chunk.done) {
            controller.close();
            return;
          }
          if (new TextDecoder().decode(chunk.value).includes('event: head')) sawHead = true;
          controller.enqueue(chunk.value);
        },
      });
      return new Response(body, { status: response.status, headers: response.headers });
    };
    const ada = freshName('ada');
    const client = createRemoteClient<LiveApp>({
      url: `https://${runtime.domains.acme ?? ''}`,
      apiVersion: coreApiVersions.dates.at(-1) ?? '',
      fetch: withHeaders(send, principalHeaders(ada)),
      retry: fastRetry,
    });
    const frames = client.subscribe('loans.loanEvents', {})[Symbol.asyncIterator]();
    try {
      expect((await frames.next()).value).toMatchObject({ control: 'head' });
      // The reopen starts from the head token, so the loan lent now arrives whichever open sees it.
      await client.invoke('loans.lend', { bookTitle: freshName('Dune'), dueAt: due });
      const step = await frames.next();
      expect(step.value).toMatchObject({ event: { kind: 'created' } });
      expect(opened).toBeGreaterThanOrEqual(4);
    } finally {
      await frames.return?.();
    }
  });
});
