import { describe, expect, test } from 'vitest';
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
    expect(response.headers.get('deprecation')).toBe(
      `@${Date.parse('2026-01-01T00:00:00Z') / 1000}`,
    );
    expect(response.headers.get('sunset')).toBe('Fri, 01 Jan 2027 00:00:00 GMT');
    expect(response.headers.get('link')).toContain('rel="deprecation"');
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
