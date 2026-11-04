import { type ErrorKind, errors, KeelwerkError } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { portalSurface } from './support/portal-surface.ts';
import { call, fakeInvoker, mountRest, requestId, session } from './support/rest-kit.ts';

const kinds: readonly (readonly [ErrorKind, string, number])[] = [
  ['validation', 'accounts.bad_input', 422],
  ['unauthenticated', 'core.unauthenticated', 401],
  ['forbidden', 'core.forbidden', 403],
  ['not_found', 'core.not_found', 404],
  ['conflict', 'accounts.name_taken', 409],
  ['rate_limited', 'core.rate_limited', 429],
  ['not_implemented', 'core.not_implemented', 501],
  ['unavailable', 'core.unavailable', 503],
  ['unsupported', 'core.unsupported', 422],
  ['internal', 'core.internal', 500],
];

async function failing(error: KeelwerkError | Error) {
  const fake = fakeInvoker(() => {
    if (error instanceof KeelwerkError) {
      return { ok: false, error };
    }
    throw error;
  });
  return await mountRest(portalSurface(), fake.invoker);
}

describe('problem details (16.5.4)', () => {
  test.each(kinds)('a %s error is RFC 9457 with status %#', async (kind, code, status) => {
    const { handler } = await failing(
      new KeelwerkError({
        kind,
        code,
        message: 'The reason.',
        ...((kind === 'rate_limited' || kind === 'unavailable') && { retryAfter: 7 }),
        details: { email: 'jens@acme.example' },
      }),
    );
    const response = await call(handler, 'GET', '/api/app/health');
    expect(response.status).toBe(status);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect(response.headers.get('x-request-id')).toBe(requestId);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: `https://portal.example/api/problems/${code}`,
      status,
      instance: `urn:uuid:${requestId}`,
      kind,
      code,
      requestId,
    });
    expect(typeof body.title).toBe('string');
    if (kind === 'rate_limited' || kind === 'unavailable') {
      expect(response.headers.get('retry-after')).toBe('7');
      expect(body.retryAfter).toBe(7);
    }
    if (kind === 'unauthenticated') {
      expect(response.headers.get('www-authenticate')).toBe('Bearer');
    }
    if (kind === 'internal') {
      expect(body.detail).toBe('Internal server error.');
      expect(body).not.toHaveProperty('details');
    } else {
      expect(body.detail).toBe('The reason.');
      expect(body.details).toEqual({ email: 'jens@acme.example' });
    }
  });

  test('the special codes of 16.4.6 pick their statuses', async () => {
    const cases: readonly (readonly [ErrorKind, string, number])[] = [
      ['validation', 'core.malformed_request', 400],
      ['validation', 'core.api_version_unknown', 400],
      ['validation', 'core.payload_too_large', 413],
      ['not_found', 'core.api_version_retired', 410],
      ['conflict', 'core.state_mismatch', 412],
      ['conflict', 'core.idempotency_mismatch', 422],
    ];
    for (const [kind, code, status] of cases) {
      const { handler } = await failing(new KeelwerkError({ kind, code, message: 'x' }));
      expect((await call(handler, 'GET', '/api/app/health')).status).toBe(status);
    }
  });

  test('quota exhaustion carries no Retry-After', async () => {
    const { handler } = await failing(
      new KeelwerkError({
        kind: 'rate_limited',
        code: 'core.quota_exceeded',
        message: 'x',
        retryAfter: 60,
      }),
    );
    const response = await call(handler, 'GET', '/api/app/health');
    expect(response.status).toBe(429);
    expect(response.headers.has('retry-after')).toBe(false);
  });

  test('an unexpected failure is internal and its cause stays out of the body', async () => {
    const { handler } = await failing(new Error('database password is hunter2'));
    const response = await call(handler, 'GET', '/api/app/health');
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('hunter2');
  });

  test('operators see the unredacted internal message and the rules', async () => {
    const error = new KeelwerkError({
      kind: 'forbidden',
      code: 'core.forbidden',
      message: 'No.',
      reason: 'Members only.',
      rules: [{ id: 'accounts.members', effect: 'deny' }],
    });
    const { handler } = await failing(error);
    const publicBody = (await (await call(handler, 'GET', '/api/app/health')).json()) as Record<
      string,
      unknown
    >;
    expect(publicBody.reason).toBe('Members only.');
    expect(publicBody).not.toHaveProperty('rules');
    const operator = session({
      principal: {
        kind: 'operator',
        id: 'op',
        scope: { backend: null, tenant: null },
        claims: {},
        roles: [],
        memberships: [],
        via: 'core.operator',
        ref: null,
      },
    });
    const privileged = (await (
      await call(handler, 'GET', '/api/app/health', { session: operator })
    ).json()) as Record<string, unknown>;
    expect(privileged.rules).toEqual([{ id: 'accounts.members', effect: 'deny' }]);
    const internal = await failing(errors.internal('stack detail'));
    const anonymous = JSON.stringify(
      await (await call(internal.handler, 'GET', '/api/app/health')).json(),
    );
    expect(anonymous).not.toContain('stack detail');
  });

  test('the type URI resolves to a page generated from the surface', async () => {
    const { handler } = await failing(errors.internal('x'));
    const page = await call(handler, 'GET', '/api/problems/accounts.name_taken');
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    const html = await page.text();
    expect(html).toContain('accounts.name_taken');
    expect(html).toContain('conflict');
    expect((await call(handler, 'GET', '/api/problems/nope.nothing')).status).toBe(404);
  });
});
