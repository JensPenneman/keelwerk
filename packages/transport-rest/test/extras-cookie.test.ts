import { describe, expect, test } from 'vitest';
import { none } from './support/nodes.ts';
import { portalSurface, withAction } from './support/portal-surface.ts';
import { call, fakeInvoker, mountRest, session } from './support/rest-kit.ts';

const cookieHint = {
  http: {
    cookie: {
      set: { name: '__Host-keelwerk_session', from: 'token' },
      omitFromBody: ['token'],
    },
  },
};

async function login(resolvedBy: 'hostname' | 'header', headers: Record<string, string>) {
  const surface = withAction(portalSurface(), 'auth.login', { hints: cookieHint });
  const fake = fakeInvoker(() => ({ ok: true, value: { token: 'secret-token' } }));
  const { handler } = await mountRest(surface, fake.invoker);
  return await call(handler, 'POST', '/api/auth/login', {
    headers,
    body: { email: 'jens@acme.example', password: 'pw' },
    session: session({ resolvedBy }),
  });
}

describe('the http.cookie hint under S-48', () => {
  test('a browser request under host-based resolution gets the cookie and no token in the body', async () => {
    const response = await login('hostname', { origin: 'https://portal.example' });
    expect(response.headers.get('set-cookie')).toMatch(
      /^__Host-keelwerk_session=secret-token; Path=\/; Secure; HttpOnly; SameSite=Lax$/,
    );
    expect(await response.json()).toEqual({});
  });

  test('Sec-Fetch-Site also marks a browser request', async () => {
    const response = await login('hostname', { 'sec-fetch-site': 'same-origin' });
    expect(response.headers.get('set-cookie')).not.toBeNull();
  });

  test('a client without Origin gets the full output and no cookie', async () => {
    const response = await login('hostname', {});
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.json()).toEqual({ token: 'secret-token' });
  });

  test('under any other resolver the hint is ignored even for a browser', async () => {
    const response = await login('header', { origin: 'https://portal.example' });
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.json()).toEqual({ token: 'secret-token' });
  });
});

describe('the http.cookie hint with a json response hint', () => {
  test('sends one Set-Cookie per name', async () => {
    const surface = withAction(portalSurface(), 'auth.login', {
      hints: { http: { response: { kind: 'json' }, ...cookieHint.http } },
    });
    const fake = fakeInvoker(() => ({ ok: true, value: { token: 'secret-token' } }));
    const { handler } = await mountRest(surface, fake.invoker);
    const response = await call(handler, 'POST', '/api/auth/login', {
      headers: { origin: 'https://portal.example' },
      body: { email: 'jens@acme.example', password: 'pw' },
      session: session({ resolvedBy: 'hostname' }),
    });
    expect(response.headers.getSetCookie()).toEqual([
      expect.stringMatching(/^__Host-keelwerk_session=secret-token; /),
    ]);
  });
});

describe('the http.cookie hint on a void output (16.4.10)', () => {
  test('a logout answers 204 and clears the cookie for a browser request', async () => {
    const surface = withAction(portalSurface(), 'auth.login', {
      output: none,
      hints: { http: { cookie: { clear: { name: '__Host-keelwerk_session' } } } },
    });
    const fake = fakeInvoker(() => ({ ok: true, value: undefined }));
    const { handler } = await mountRest(surface, fake.invoker);
    const response = await call(handler, 'POST', '/api/auth/login', {
      headers: { origin: 'https://portal.example' },
      body: { email: 'jens@acme.example', password: 'pw' },
      session: session({ resolvedBy: 'hostname' }),
    });
    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie()).toEqual([
      expect.stringMatching(/^__Host-keelwerk_session=; .*Max-Age=0/),
    ]);
  });
});
