import { settleReactions, startTransportRuntime } from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, describe, expect, test } from 'vitest';
import { portal } from '../src/app.ts';
import { credentialsOf, freshPerson, sessionCookie } from './support/people.ts';
import { portalConfig } from './support/portal-config.ts';
import { portalDispatcher } from './support/portal-event-workers.ts';
import { portalRest } from './support/portal-rest.ts';

let now = Temporal.Instant.from('2026-11-17T09:00:00Z');
const clock = { now: () => now };

describe.each(['memory', 'pglite'] as const)('the sliding cookie on %s', (adapter) => {
  const dispatcher = portalDispatcher();
  const started = startTransportRuntime({
    app: portal,
    host: httpHost(),
    config: portalConfig,
    adapter,
    clock,
    eventWorkers: [dispatcher],
  });
  afterAll(async () => (await started).stop());

  test('a browser request after six minutes renews the cookie, and the job moves the idle expiry', async () => {
    const runtime = await started;
    const rest = portalRest(runtime.fetch, runtime.domains.acme ?? '');
    const ada = freshPerson();
    await rest.send('POST', '/api/auth/sign-up', { body: ada });
    const login = await rest.send('POST', '/api/auth/login', {
      body: credentialsOf(ada),
      browser: true,
    });
    const cookie = login.cookies.find((line) => line.startsWith(`${sessionCookie}=`)) ?? '';
    expect(cookie).toContain('Expires=');
    const token = cookie.split(';')[0]?.split('=')[1] ?? '';
    const headers = { cookie: `${sessionCookie}=${token}` };

    // Within five minutes of the login nothing is renewed.
    now = now.add({ minutes: 4 });
    const early = await rest.send('GET', '/api/auth/whoami', { headers, browser: true });
    expect(early.status).toBe(200);
    expect(early.cookies.find((line) => line.startsWith(`${sessionCookie}=`))).toBeUndefined();

    now = now.add({ minutes: 2 });
    const due = await rest.send('GET', '/api/auth/whoami', { headers, browser: true });
    expect(due.status).toBe(200);
    const renewed = due.cookies.find((line) => line.startsWith(`${sessionCookie}=`));
    expect(renewed).toContain(`${sessionCookie}=${token}`);
    const expires = /Expires=([^;]+)/.exec(renewed ?? '')?.[1];
    // The idle window is twelve hours, counted from this request.
    expect(
      Temporal.Instant.fromEpochMilliseconds(Date.parse(expires ?? '')).epochMilliseconds,
    ).toBe(now.add({ hours: 12 }).epochMilliseconds);

    // The extension job of that request runs, so the next request that is due queues its own.
    await settleReactions(dispatcher, runtime.drainJobs);

    // A bearer request never gets a cookie.
    now = now.add({ minutes: 6 });
    const bearer = await rest.send('GET', '/api/auth/whoami', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(bearer.status).toBe(200);
    expect(bearer.cookies).toEqual([]);

    await settleReactions(dispatcher, runtime.drainJobs);
    // Past the idle expiry the login had (twelve hours): only the job's extension keeps the session alive.
    now = now.add({ hours: 11, minutes: 55 });
    const later = await rest.send('GET', '/api/auth/whoami', { headers, browser: true });
    expect(later.status).toBe(200);
  }, 120_000);
});
