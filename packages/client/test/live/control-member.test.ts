import { describe, expect, it } from 'vitest';
import { createRemoteClient } from '../../src/index.ts';
import type { ProbeApp } from '../support/probe-app.ts';
import { probeSurface } from '../support/probe-surface.ts';
import { protocolFetch } from '../support/protocol-fetch.ts';
import { fastRetry } from './support/live-fixtures.ts';

const text = { optional: false, access: 'read-write', kind: 'string' } as const;

/** A surface with a subscription whose event has a member of its own called `control`. */
function surfaceWithControlEvents() {
  const base = probeSurface();
  const ping = base.actions.find((candidate) => candidate.ref === 'shop.ping');
  if (ping === undefined) throw new Error('The probe surface has no shop.ping.');
  const output = {
    optional: false,
    access: 'read-write',
    kind: 'shape',
    fields: { control: text },
  } as const;
  return {
    ...base,
    actions: [
      ...base.actions,
      { ...ping, ref: 'shop.feed', name: 'feed', kind: 'subscription', output },
    ],
  } as typeof base;
}

const token = (n: number): string => `v2.0.${n}.00000000.${'0'.repeat(32)}`;
const data = (n: number, control: string): string =>
  `id: ${token(n)}\nevent: data\ndata: ${JSON.stringify({ control })}\n\n`;

describe('an event with a member called control', () => {
  it('arrives through client.subscribe as an item, and the stream neither resets nor reopens', async () => {
    const server = protocolFetch({ surface: surfaceWithControlEvents(), handlers: {} });
    let opened = 0;
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      if (!new URL(request.url).pathname.endsWith('/subscribe')) return server.fetch(request);
      opened += 1;
      const body = [
        'event: welcome\ndata: {"protocol":1}\n\n',
        `id: ${token(1)}\nevent: head\ndata: {"state":"${token(1)}"}\n\n`,
        data(2, 'reset'),
        data(3, 'head'),
        data(4, 'gap'),
        data(5, 'end'),
        'event: end\ndata: {"reason":"complete"}\n\n',
      ].join('');
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }) as typeof globalThis.fetch;
    const client = createRemoteClient<ProbeApp>({
      url: 'https://shop.example/',
      apiVersion: '2026-11-01',
      fetch,
      retry: fastRetry,
    });
    const seen: unknown[] = [];
    for await (const frame of client.subscribe('shop.feed', {})) seen.push(frame);
    expect(seen).toEqual([
      { control: 'head', state: token(1) },
      ...['reset', 'head', 'gap', 'end'].map((control, index) => ({
        event: { control },
        state: token(index + 2),
      })),
    ]);
    // The `complete` end is the only thing that ended it, and nothing asked for a second open.
    expect(opened).toBe(1);
  });
});
