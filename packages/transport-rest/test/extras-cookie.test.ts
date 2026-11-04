import { describe, expect, test } from 'vitest';
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
