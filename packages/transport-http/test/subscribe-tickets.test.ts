import { lendCall, readEventStream } from '@keelwerk/testing';
import { describe, expect, test, vi } from 'vitest';
import { createFakeHost } from './support/create-fake-host.ts';
import { createFakeInvoker } from './support/fake-invoker.ts';
import { fakeSession } from './support/fake-session.ts';
import { fakeSurface } from './support/fake-surface.ts';
import { advancingClock, useTicketKit } from './support/use-ticket-kit.ts';

vi.setConfig({ testTimeout: 60_000 });

const { boot, closers } = useTicketKit();

describe.each(['memory', 'pglite'] as const)('stream tickets on %s', (adapter) => {
  test('a ticket opens one stream as its principal', async () => {
    const kit = await boot(adapter);
    const ticket = await kit.issue('ada', 'loans.loanEvents');
    const response = await kit.open(ticket);
    expect(response.status).toBe(200);
    const stream = readEventStream(response);
    closers.push(() => stream.close());
    await stream.until((frame) => frame.event === 'head');
    await kit.target.codec.send(kit.target, lendCall('ada', 'Dune'));
    await kit.target.codec.send(kit.target, lendCall('bob', 'Emma'));
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
    const clock = advancingClock();
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

  test('a ticket bound to one subscription and offered for another is 401 and spent at once', async () => {
    const kit = await boot(adapter);
    const ticket = await kit.issue('ada', 'loans.loanEvents');
    const wrong = await kit.open(ticket, {}, 'loans.loanTicker');
    expect(wrong.status).toBe(401);
    expect(((await wrong.json()) as { error: { code: string } }).error.code).toBe(
      'core.ticket_invalid',
    );
    // The ticket is dead for its own subscription too: whoever reads the wrong URL gets nothing.
    const own = await kit.open(ticket);
    expect(own.status).toBe(401);
    expect(((await own.json()) as { error: { code: string } }).error.code).toBe(
      'core.ticket_invalid',
    );
  });

  test('a forged secret with the public id of a ticket spends nothing', async () => {
    const kit = await boot(adapter);
    const ticket = await kit.issue('ada', 'loans.loanEvents');
    const [prefix, id, secret = ''] = ticket.split('_');
    const forged = [...secret].map((character) => (character === 'a' ? 'b' : 'a')).join('');
    expect(forged).toHaveLength(secret.length);
    expect(forged).not.toBe(secret);
    const refused = await kit.open(`${prefix}_${id}_${forged}`, {}, 'loans.loanTicker');
    expect(refused.status).toBe(401);
    // The spend verifies the secret, so nobody burns a ticket from its public id alone.
    const real = await kit.open(ticket);
    expect(real.status).toBe(200);
    closers.push(async () => void (await real.body?.cancel()));
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
    await kit.target.codec.send(kit.target, lendCall('ada', 'Hamlet'));
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
