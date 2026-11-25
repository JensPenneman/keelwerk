import {
  originOf,
  readEventStream,
  startTransportRuntime,
  transportTargetOf,
} from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, describe, expect, test } from 'vitest';
import { trpcCodec } from './support/trpc-codec.ts';
import { trpcConformanceApp } from './support/trpc-conformance-app.ts';

const origins = ['https://app.example.test'];
const runtime = await startTransportRuntime({
  app: trpcConformanceApp,
  host: httpHost({ live: { maxStreamsPerPrincipal: 1 } }),
  config: { trpc: { cors: origins } },
  tenants: ['acme'],
});
const target = transportTargetOf(runtime, trpcCodec, origins, true);
afterAll(() => runtime.stop());

const subscription = (search: string, accept?: string): Promise<Response> =>
  target.fetch(
    new Request(`${originOf(target, {})}/trpc/loans.loanTicker${search}`, {
      headers: accept === undefined ? { 'trpc-accept': 'application/jsonl' } : { accept },
    }),
    { remoteAddress: '203.0.113.20' },
  );

describe('a subscription of tRPC', () => {
  test.each(['', '?batch=1'])(
    'is served only as text/event-stream: asked as JSON lines (%j) it is refused and holds no slot',
    async (search) => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const refused = await subscription(search);
        expect(refused.status).not.toBe(200);
        expect(refused.headers.get('content-type')).not.toContain('jsonl');
        expect(refused.headers.get('content-type')).not.toContain('text/event-stream');
        await refused.text();
      }
      // The one slot of the address is free: an event stream is admitted.
      const served = await subscription('', 'text/event-stream');
      expect(served.status).toBe(200);
      expect(served.headers.get('content-type')).toContain('text/event-stream');
      await readEventStream(served).close();
    },
  );
});
