import { readEventStream } from '@keelwerk/testing';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createFakeHost } from './support/create-fake-host.ts';
import { createFakeInvoker } from './support/fake-invoker.ts';
import { fakeSession } from './support/fake-session.ts';
import { fakeSurface } from './support/fake-surface.ts';
import { type StreamRuntime, startStreamRuntime } from './support/stream-runtime.ts';

vi.setConfig({ testTimeout: 60_000 });

const running: StreamRuntime[] = [];
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
  await Promise.all(running.splice(0).map((started) => started.runtime.stop()));
});

const start = Temporal.Instant.from('2026-11-11T12:00:00Z');
/** A clock the test moves. */
function movingClock() {
  let at = start;
  return { clock: { now: () => at }, advance: (seconds: number) => (at = at.add({ seconds })) };
}

const principalHeader = (subject: string) => ({
  'x-test-principal': JSON.stringify({ subject, roles: [], claims: {} }),
});

async function boot(adapter: 'memory' | 'pglite', clock = movingClock()) {
  const made = await startStreamRuntime({}, { pglite: adapter === 'pglite', clock: clock.clock });
  running.push(made);
  const issue = async (subject: string, action?: string): Promise<string> => {
    const response = await made.target.fetch(
      new Request(`${made.origin}/_keelwerk/v1/invoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...principalHeader(subject) },
        body: JSON.stringify({
          action: 'live.ticket',
          input: action === undefined ? {} : { action },
        }),
      }),
    );
    const body = (await response.json()) as { ok: boolean; value: { ticket: string } };
    expect(body.ok).toBe(true);
    return body.value.ticket;
  };
  const open = (
    ticket: string,
    headers: Record<string, string> = {},
    action = 'loans.loanEvents',
  ) =>
    made.target.fetch(
      new Request(
        `${made.origin}/_keelwerk/v1/subscribe?action=${action}&input=%7B%7D&ticket=${ticket}`,
        { headers },
      ),
    );
  return { ...made, issue, open, clock };
}

const lend = (subject: string, title: string) => ({
  action: 'loans.lend',
  input: { bookTitle: title, dueAt: '2027-01-01T00:00:00Z' },
  caller: { subject },
});

describe.each(['memory', 'pglite'] as const)('stream tickets on %s', (adapter) => {
  test('a ticket opens one stream as its principal', async () => {
    const kit = await boot(adapter);
    const ticket = await kit.issue('ada', 'loans.loanEvents');
    const response = await kit.open(ticket);
    expect(response.status).toBe(200);
    const stream = readEventStream(response);
    closers.push(() => stream.close());
    await stream.until((frame) => frame.event === 'head');
    await kit.target.codec.send(kit.target, lend('ada', 'Dune'));
    await kit.target.codec.send(kit.target, lend('bob', 'Emma'));
    const item = await stream.next();
    // loans.loanEvents follows the loans of the principal: ada, whom the ticket stands for.
    expect(item).toMatchObject({ event: 'data', data: { kind: 'created' } });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  test('a second use is 401 core.ticket_invalid', async () => {
    const kit = await boot(adapter);
    const ticket = await kit.issue('ada');
    const first = await kit.open(ticket);
    closers.push(async () => void (await first.body?.cancel()));
    expect(first.status).toBe(200);
    const second = await kit.open(ticket);
    expect(second.status).toBe(401);
    expect(((await second.json()) as { error: { code: string } }).error.code).toBe(
      'core.ticket_invalid',
    );
  });

  test('a ticket 61 s old is 401', async () => {
    const clock = movingClock();
    const kit = await boot(adapter, clock);
    const ticket = await kit.issue('ada');
    clock.advance(61);
    const response = await kit.open(ticket);
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'core.ticket_invalid',
    );
  });

  test('a ticket on /invoke or in a POST subscribe is 401 and spent at once, a bound one too', async () => {
    const kit = await boot(adapter);
    const onInvoke = await kit.issue('ada');
    const onPost = await kit.issue('ada');
    const bound = await kit.issue('ada', 'loans.loanEvents');
    const invoke = await kit.target.fetch(
      new Request(`${kit.origin}/_keelwerk/v1/invoke?ticket=${onInvoke}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'live.ticket', input: {} }),
      }),
    );
    expect(invoke.status).toBe(401);
    const post = await kit.target.fetch(
      new Request(`${kit.origin}/_keelwerk/v1/subscribe?ticket=${onPost}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'loans.loanEvents', input: {} }),
      }),
    );
    expect(post.status).toBe(401);
    const wrongPath = await kit.target.fetch(
      new Request(`${kit.origin}/_keelwerk/v1/surface?ticket=${bound}`),
    );
    expect(wrongPath.status).toBe(401);
    for (const response of [invoke, post, wrongPath]) {
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        'core.ticket_invalid',
      );
    }
    // The refusal is the same as ever, and each ticket is dead on the endpoint it was meant for.
    for (const ticket of [onInvoke, onPost]) {
      const again = await kit.open(ticket);
      expect(again.status).toBe(401);
      expect(((await again.json()) as { error: { code: string } }).error.code).toBe(
        'core.ticket_invalid',
      );
    }
    expect((await kit.open(bound)).status).toBe(401);
  });

  test('a ticket sent on a wrong path beside a bearer is spent at once too', async () => {
    const kit = await boot(adapter);
    const ticket = await kit.issue('ada');
    const response = await kit.target.fetch(
      new Request(`${kit.origin}/_keelwerk/v1/invoke?ticket=${ticket}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer kwo_not-a-credential',
        },
        body: JSON.stringify({ action: 'live.ticket', input: {} }),
      }),
    );
    expect(response.status).toBe(401);
    // The bearer on the refused request must not keep the ticket from being redeemed.
    expect((await kit.open(ticket)).status).toBe(401);
  });

  test('a ticket sent to a REST mount path is spent at once and the request answers as without it', async () => {
    const kit = await boot(adapter);
    kit.runtime.runtime.host?.route(
      { app: 'streams', transport: 'rest', prefix: '/api' },
      async () => new Response('mounted', { status: 200 }),
    );
    const onGet = await kit.issue('ada');
    const onPost = await kit.issue('ada', 'loans.loanEvents');
    const plain = await kit.target.fetch(new Request(`${kit.origin}/api/books`));
    const withTicket = await kit.target.fetch(
      new Request(`${kit.origin}/api/books?ticket=${onGet}`),
    );
    const posted = await kit.target.fetch(
      new Request(`${kit.origin}/api/books?ticket=${onPost}`, { method: 'POST', body: '{}' }),
    );
    for (const response of [withTicket, posted]) {
      expect(response.status).toBe(plain.status);
      expect(await response.text()).toBe('mounted');
    }
    // Neither ticket is any use afterwards on the endpoint it was made for.
    for (const ticket of [onGet, onPost]) {
      const again = await kit.open(ticket);
      expect(again.status).toBe(401);
      expect(((await again.json()) as { error: { code: string } }).error.code).toBe(
        'core.ticket_invalid',
      );
    }
  });

  test('a value that is no ticket on a mount path is no credential and the request goes on', async () => {
    const kit = await boot(adapter);
    kit.runtime.runtime.host?.route(
      { app: 'streams', transport: 'rest', prefix: '/api' },
      async () => new Response('mounted', { status: 200 }),
    );
    for (const value of ['Not-A-Ticket!', 'abc_def', 'kwst_short_short']) {
      const response = await kit.target.fetch(
        new Request(`${kit.origin}/api/books?ticket=${value}`),
      );
      expect(response.status).toBe(200);
    }
  });

  test('a ticket that is not well formed is refused like any other', async () => {
    const kit = await boot(adapter);
    const response = await kit.target.fetch(
      new Request(`${kit.origin}/_keelwerk/v1/surface?ticket=Not-A-Ticket!`),
    );
    expect(response.status).toBe(401);
  });

  test('cookie and authorization beside a ticket are ignored', async () => {
    const kit = await boot(adapter);
    const ticket = await kit.issue('ada');
    const response = await kit.open(ticket, {
      authorization: 'Bearer not-a-credential',
      cookie: '__Host-kw-test=user:mallory',
    });
    // A bad bearer would be 401 and the cookie would make the stream mallory's: neither is read.
    expect(response.status).toBe(200);
    const stream = readEventStream(response);
    closers.push(() => stream.close());
    await stream.until((frame) => frame.event === 'head');
    await kit.target.codec.send(kit.target, lend('ada', 'Hamlet'));
    expect((await stream.next())?.event).toBe('data');
  });

  test('a cross-site POST of live.ticket with the cookie is 403 core.csrf', async () => {
    const kit = await boot(adapter);
    const response = await kit.target.fetch(
      new Request(`${kit.origin}/_keelwerk/v1/invoke`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: '__Host-kw-test=user:ada',
          origin: 'https://evil.example',
          'sec-fetch-site': 'cross-site',
        },
        body: JSON.stringify({ action: 'live.ticket', input: {} }),
      }),
    );
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('core.csrf');
  });

  test('no log line and no span attribute holds the ticket', async () => {
    const kit = await boot(adapter);
    const ticket = await kit.issue('ada');
    const secret = ticket.split('_')[2] ?? '';
    for (const response of [
      await kit.open(ticket),
      await kit.open(ticket),
      await kit.open(`${ticket}x`),
    ]) {
      await response.body?.cancel().catch(() => undefined);
    }
    expect(JSON.stringify(kit.lines)).not.toContain(secret);
    expect(JSON.stringify(kit.lines)).not.toContain(ticket);
    // The host's spans name the fixed route and never the URL, so the query stays out of them.
    const fake = createFakeHost(
      {},
      {
        invoker: createFakeInvoker({ open: () => ({ ok: true, value: fakeSession() }) }),
        surface: fakeSurface([]),
        deps: { liveCarrier: () => ({ name: 'sse', serve: async () => undefined }) },
      },
    );
    await fake.host.fetch(
      new Request(`https://x.example/_keelwerk/v1/subscribe?action=nothing&ticket=${ticket}`),
    );
    expect(JSON.stringify(fake.telemetry.spans)).not.toContain(secret);
    expect(JSON.stringify(fake.telemetry.spans)).not.toContain('ticket=');
    await fake.host.stop(100);
  });
});
