import type { InvocationSession } from '@keelwerk/core';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { fakeSession } from './support/fake-session.ts';
import { type StreamHost, streamHost } from './support/stream-host.ts';

const hosts: StreamHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((made) => made.host.stop(100)));
});

const user = (subject: string): InvocationSession =>
  fakeSession({
    principal: {
      kind: 'user',
      subject,
      subjectRef: null,
      subjectAs: () => null,
      scope: { backend: 'b1', tenant: 't1' },
      claims: {},
      roles: [],
      memberships: [],
      via: 'test',
      ref: { resolver: 'test', principalId: subject },
    } as never,
  });

/** What a quiet subscription of the hub does: it waits for a change, ends when its signal aborts, and counts while it is open. */
function quietHub(state: { open: number }) {
  return (invocation: { readonly signal?: AbortSignal }) =>
    (async function* () {
      state.open += 1;
      try {
        await new Promise<void>((resolve) =>
          invocation.signal?.addEventListener('abort', () => resolve(), { once: true }),
        );
      } finally {
        state.open -= 1;
      }
    })();
}

describe('the maximum duration of a quiet stream', () => {
  test('ends its subscription and gives the 20 stream slots of the principal back', async () => {
    const state = { open: 0 };
    const made = streamHost(quietHub(state), {
      host: { live: { maxDurationMs: 60_000, heartbeatMs: 15_000 } },
      session: user('ada'),
    });
    hosts.push(made);
    const responses: Response[] = [];
    for (let index = 0; index < 20; index += 1) responses.push(await made.open());
    expect(responses.map((response) => response.status)).toEqual(Array(20).fill(200));
    expect((await made.open()).status).toBe(429);
    await made.at(0);
    expect(state.open).toBe(20);
    await made.at(60_000);
    for (const response of responses) expect(await response.text()).toContain('"max_duration"');
    // Nothing aborted the request: the carrier closing the stream is what ends the subscription.
    await vi.waitFor(() => expect(state.open).toBe(0));
    expect(made.timers.pending()).toBe(0);
    const again = await made.open();
    expect(again.status).toBe(200);
    await again.body?.cancel();
  });
});

describe('the ticket of a stream', () => {
  test('is not in the carrier the invoker is handed to subscribe', async () => {
    const made = streamHost(quietHub({ open: 0 }));
    hosts.push(made);
    const ticket = `kwst_${'a'.repeat(26)}_${'b'.repeat(52)}`;
    const response = await made.open(`&ticket=${ticket}`);
    expect(response.status).toBe(200);
    // The session opened with it: the redeem is the one use of the ticket.
    expect(made.opened.at(-1)?.ticket?.value).toBe(ticket);
    const handed = made.subscribed[0]?.carrier;
    expect(handed).toBeDefined();
    expect(handed && 'ticket' in handed).toBe(false);
    expect(JSON.stringify(handed)).not.toContain(ticket);
    await response.body?.cancel();
  });
});

describe('the streams of anonymous callers', () => {
  test('are counted per client address, so one client cannot lock the others out', async () => {
    const made = streamHost(quietHub({ open: 0 }), {
      host: {
        listen: { port: 0 },
        trustedProxies: ['127.0.0.1'],
        live: { maxStreamsPerPrincipal: 2 },
      },
    });
    hosts.push(made);
    const { port } = await made.host.listen();
    const open = (address: string) =>
      fetch(`http://127.0.0.1:${port}/_keelwerk/v1/subscribe?action=loans.loanEvents`, {
        headers: { 'x-forwarded-for': address },
      });
    const held: Response[] = [];
    for (let index = 0; index < 2; index += 1) held.push(await open('203.0.113.7'));
    expect(held.map((response) => response.status)).toEqual([200, 200]);
    const refused = await open('203.0.113.7');
    expect(refused.status).toBe(429);
    await refused.body?.cancel();
    const other = await open('203.0.113.8');
    expect(other.status).toBe(200);
    for (const response of [...held, other]) await response.body?.cancel();
  });
});
