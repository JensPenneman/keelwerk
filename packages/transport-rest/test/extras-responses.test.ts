import type { Clock } from '@keelwerk/core';
import { describe, expect, test, vi } from 'vitest';
import { portalSurface, withAction } from './support/portal-surface.ts';
import { call, fakeInvoker, mountRest } from './support/rest-kit.ts';

describe('response hints, deprecation and cancellation', () => {
  test('raw, redirect and empty hints', async () => {
    const raw = withAction(portalSurface(), 'app.health', {
      output: {
        kind: 'shape',
        optional: false,
        access: 'read-write',
        fields: { body: { kind: 'text', optional: false, access: 'read-write' } },
      },
      hints: { http: { response: { kind: 'raw', contentType: 'text/plain', from: 'body' } } },
    });
    const rawMount = await mountRest(
      raw,
      fakeInvoker(() => ({ ok: true, value: { body: 'STSv1' } })).invoker,
    );
    const rawResponse = await call(rawMount.handler, 'GET', '/api/app/health');
    expect(rawResponse.headers.get('content-type')).toBe('text/plain');
    expect(await rawResponse.text()).toBe('STSv1');

    const redirect = withAction(portalSurface(), 'app.health', {
      hints: { http: { response: { kind: 'redirect', from: 'to', status: 303 } } },
    });
    const redirectMount = await mountRest(
      redirect,
      fakeInvoker(() => ({ ok: true, value: { to: 'https://acme.example/next' } })).invoker,
    );
    const redirected = await call(redirectMount.handler, 'GET', '/api/app/health');
    expect(redirected.status).toBe(303);
    expect(redirected.headers.get('location')).toBe('https://acme.example/next');

    const empty = withAction(portalSurface(), 'app.health', {
      hints: { http: { response: { kind: 'empty' } } },
    });
    const emptyMount = await mountRest(empty, fakeInvoker(() => ({ ok: true, value: {} })).invoker);
    expect((await call(emptyMount.handler, 'GET', '/api/app/health')).status).toBe(204);
  });

  test('a deprecated action carries Deprecation, Sunset and a deprecation Link', async () => {
    const surface = withAction(portalSurface(), 'app.health', {
      deprecated: {
        reason: 'use ready',
        at: '2026-01-01T00:00:00Z',
        sunset: '2027-01-01T00:00:00Z',
      },
    });
    const { handler } = await mountRest(
      surface,
      fakeInvoker(() => ({ ok: true, value: {} })).invoker,
    );
    const response = await call(handler, 'GET', '/api/app/health');
    expect(response.headers.get('deprecation')).toBe('@1767225600');
    expect(response.headers.get('sunset')).toBe('Sat, 02 Jan 2027 00:00:00 GMT');
    expect(response.headers.get('link')).toContain('rel="deprecation"');
  });

  test('a deprecated action announces nothing before its at day and everything from it on', async () => {
    const surface = withAction(portalSurface(), 'app.health', {
      deprecated: { reason: 'use ready', at: '2026-12-01', sunset: '2027-06-01' },
    });
    let now = Temporal.Instant.from('2026-11-30T23:59:59Z');
    const clock: Clock = { now: () => now };
    const { handler } = await mountRest(
      surface,
      fakeInvoker(() => ({ ok: true, value: {} })).invoker,
      {},
      {},
      false,
      clock,
    );
    const before = await call(handler, 'GET', '/api/app/health');
    expect(before.headers.has('deprecation')).toBe(false);
    expect(before.headers.has('sunset')).toBe(false);
    expect(before.headers.get('link') ?? '').not.toContain('rel="deprecation"');
    now = Temporal.Instant.from('2026-12-01T00:00:00Z');
    const after = await call(handler, 'GET', '/api/app/health');
    expect(after.headers.get('deprecation')).toBe('@1796083200');
    expect(after.headers.get('link')).toContain('rel="deprecation"');
  });

  test('a deprecated action whose at carries a time announces from the start of that UTC day', async () => {
    const surface = withAction(portalSurface(), 'app.health', {
      deprecated: { reason: 'use ready', at: '2026-12-01T15:30:00Z', sunset: '2027-06-01' },
    });
    const clock: Clock = { now: () => Temporal.Instant.from('2026-12-01T00:00:00Z') };
    const { handler } = await mountRest(
      surface,
      fakeInvoker(() => ({ ok: true, value: {} })).invoker,
      {},
      {},
      false,
      clock,
    );
    const response = await call(handler, 'GET', '/api/app/health');
    expect(response.headers.get('deprecation')).toBe('@1796139000');
    expect(response.headers.get('sunset')).toBe('Wed, 02 Jun 2027 00:00:00 GMT');
    expect(response.headers.get('link')).toContain('rel="deprecation"');
  });

  test('Sunset names the first instant no longer served: 00:00:00 GMT of the day after the sunset date', async () => {
    const surface = withAction(portalSurface(), 'app.health', {
      deprecated: { reason: 'use ready', at: '2026-01-01', sunset: '2026-12-31' },
    });
    const { handler } = await mountRest(
      surface,
      fakeInvoker(() => ({ ok: true, value: {} })).invoker,
    );
    const response = await call(handler, 'GET', '/api/app/health');
    expect(response.headers.get('sunset')).toBe('Fri, 01 Jan 2027 00:00:00 GMT');
  });

  test('a deprecated paged query keeps both its next and its deprecation Link', async () => {
    const surface = withAction(portalSurface(), 'accounts.profile.query', {
      deprecated: { reason: 'use search', at: '2026-01-01T00:00:00Z' },
    });
    const { handler } = await mountRest(
      surface,
      fakeInvoker(() => ({
        ok: true,
        value: {
          items: [],
          pageInfo: { hasNextPage: true, hasPreviousPage: false, endCursor: 'z9' },
        },
      })).invoker,
    );
    const response = await call(handler, 'GET', '/api/accounts/profiles?first=10');
    const link = response.headers.get('link') ?? '';
    expect(link).toContain('rel="next"');
    expect(link).toContain('rel="deprecation"');
  });

  test('a deprecation without a date sends no Deprecation header', async () => {
    const surface = withAction(portalSurface(), 'app.health', {
      deprecated: { reason: 'use ready' },
    });
    const { handler } = await mountRest(
      surface,
      fakeInvoker(() => ({ ok: true, value: {} })).invoker,
    );
    const response = await call(handler, 'GET', '/api/app/health');
    expect(response.headers.has('deprecation')).toBe(false);
    expect(response.headers.get('link')).toContain('rel="deprecation"');
  });

  test('an instant with an offset and a calendar date give the same headers in every process time zone', async () => {
    const forms = [
      { at: '2026-11-01T17:30:00+02:00', sunset: '2027-11-30T23:30:00-05:00' },
      { at: '2026-11-01', sunset: '2027-11-30' },
    ];
    const answers: Record<string, string[][]> = {};
    try {
      for (const zone of ['UTC', 'Pacific/Kiritimati', 'Asia/Kolkata', 'America/Los_Angeles']) {
        vi.stubEnv('TZ', zone);
        answers[zone] = [];
        for (const form of forms) {
          const surface = withAction(portalSurface(), 'app.health', {
            deprecated: { reason: 'use ready', ...form },
          });
          const { handler } = await mountRest(
            surface,
            fakeInvoker(() => ({ ok: true, value: {} })).invoker,
            {},
            {},
            false,
            { now: () => Temporal.Instant.from('2026-12-01T00:00:00Z') },
          );
          const response = await call(handler, 'GET', '/api/app/health');
          answers[zone]?.push([
            response.headers.get('deprecation') ?? '',
            response.headers.get('sunset') ?? '',
          ]);
        }
      }
    } finally {
      vi.unstubAllEnvs();
    }
    for (const [zone, answer] of Object.entries(answers)) {
      expect(answer, zone).toEqual([
        ['@1793547000', 'Thu, 02 Dec 2027 00:00:00 GMT'],
        ['@1793491200', 'Wed, 01 Dec 2027 00:00:00 GMT'],
      ]);
    }
  });

  test('a client disconnect aborts a query but never a running command', async () => {
    const seen: AbortSignal[] = [];
    const { handler } = await mountRest(
      portalSurface(),
      fakeInvoker((inv) => {
        seen.push(inv.signal);
        return { ok: true, value: {} };
      }).invoker,
    );
    const client = new AbortController();
    await call(handler, 'GET', '/api/app/health', { signal: client.signal });
    await call(handler, 'POST', '/api/accounts/register', {
      signal: client.signal,
      body: { displayName: 'Ada', email: 'ada@acme.example' },
    });
    client.abort();
    expect(seen[0]?.aborted).toBe(true);
    expect(seen[1]?.aborted).toBe(false);
  });
});
