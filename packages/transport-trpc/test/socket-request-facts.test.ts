import { describe, expect, test } from 'vitest';
import {
  httpContext,
  queryMessage,
  served,
  subscriptionMessage,
} from './support/served-trpc-socket.ts';
import { envelope } from './support/trpc-kit.ts';

describe('the request facts of a call over the socket', () => {
  test('a call over the socket carries the request facts an HTTP call of the same action carries: transport trpc, the user agent and the connection', async () => {
    const carrier = {
      transport: 'http',
      host: 'portal.example',
      path: '/trpc',
      headers: { 'user-agent': 'AdaAgent/1.0' },
      connection: {
        id: 'c1',
        listener: 'http',
        remote: { address: '203.0.113.7', port: 50_000 },
        local: { address: '10.0.0.1', port: 443 },
      },
    } as const;
    const { socket, mounted } = await served({ connection: { carrier } });
    socket.message(queryMessage(1));
    socket.message(subscriptionMessage(2));
    await socket.sentFor(1);
    await socket.sentFor(2, 2);
    const input = encodeURIComponent(JSON.stringify(envelope({ isbn: 'x' })));
    const over = await mounted.handler(
      new Request(`https://portal.example/trpc/library.findByIsbn?input=${input}`),
      { ...httpContext, carrier, path: '/library.findByIsbn' },
    );
    expect(over.status).toBe(200);
    // Core reads `ctx.request` (transport, user agent, connection) from this carrier; a decision record keeps what a handler read of it.
    const expected = { ...carrier, transport: 'trpc' };
    expect(mounted.calls.map((call) => call.carrier)).toEqual([expected, expected]);
    expect(mounted.subscribed.map((call) => call.carrier)).toEqual([expected]);
  });
});
