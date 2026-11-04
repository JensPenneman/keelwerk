import { describe, expect, it } from 'vitest';
import { createFakeInvoker } from './support/fake-invoker.ts';
import { fakeSession } from './support/fake-session.ts';
import { libraryActions } from './support/library-actions.ts';
import { postJson } from './support/post-json.ts';
import { useHosts } from './support/use-hosts.ts';

const { setup } = useHosts();
const login = { action: 'auth.login', input: { identifier: 'a@b.c', password: 'pw' } };
const own = { origin: 'https://library.example' };

describe('the http.cookie hint (S-48)', () => {
  it('gives a non-browser request the full output and no cookie', async () => {
    const { host } = setup();
    const response = await host.fetch(postJson('/_keelwerk/v1/invoke', login));
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.json()).toEqual({
      ok: true,
      value: { sessionToken: 'secret-token', expiresAt: '2030-01-01T00:00:00.000Z' },
    });
  });

  it('sets the cookie and omits the token for a browser request under host-based resolution', async () => {
    const { host } = setup();
    for (const headers of [own, { 'sec-fetch-site': 'same-origin' }]) {
      const response = await host.fetch(postJson('/_keelwerk/v1/invoke', login, headers));
      const cookie = response.headers.get('set-cookie') ?? '';
      expect(cookie).toMatch(
        /^__Host-keelwerk_session=secret-token; Path=\/; Secure; HttpOnly; SameSite=Lax; Expires=/,
      );
      expect(cookie).not.toMatch(/Domain/i);
      expect(await response.json()).toEqual({
        ok: true,
        value: { expiresAt: '2030-01-01T00:00:00.000Z' },
      });
    }
  });

  it('ignores the hint when the tenant is not resolved by host name', async () => {
    const invoker = createFakeInvoker({
      open: () => ({ ok: true, value: fakeSession({ resolvedBy: 'header' }) }),
      actions: libraryActions,
    });
    const { host } = setup({}, invoker);
    const response = await host.fetch(postJson('/_keelwerk/v1/invoke', login, own));
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(
      ((await response.json()) as { value: { sessionToken: string } }).value.sessionToken,
    ).toBe('secret-token');
  });

  it('ignores the hint on the operator endpoint', async () => {
    const invoker = createFakeInvoker({
      open: () => ({ ok: true, value: fakeSession({ resolvedBy: 'local' }) }),
      actions: libraryActions,
    });
    const { host } = setup({}, invoker);
    const response = await host.fetch(postJson('/_keelwerk/v1/invoke', login, own));
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});

describe('stale cookies', () => {
  const stale = createFakeInvoker({
    open: (carrier) =>
      carrier.headers?.cookie?.includes('__Host-keelwerk_session=stale') === true
        ? { ok: true, value: fakeSession({ clearCookies: ['__Host-keelwerk_session'] }) }
        : { ok: true, value: fakeSession() },
    actions: libraryActions,
  });

  it('answers a public action as anonymous and clears the cookie', async () => {
    const { host } = setup({}, stale);
    const response = await host.fetch(
      postJson(
        '/_keelwerk/v1/invoke',
        { action: 'library.echo' },
        { ...own, cookie: '__Host-keelwerk_session=stale' },
      ),
    );
    expect(response.status).toBe(200);
    const cleared = response.headers.get('set-cookie') ?? '';
    expect(cleared).toMatch(/^__Host-keelwerk_session=; /);
    expect(cleared).toContain('Max-Age=0');
  });

  it('lets a login set a new cookie over the stale one without clearing it afterwards', async () => {
    const { host } = setup({}, stale);
    const response = await host.fetch(
      postJson('/_keelwerk/v1/invoke', login, { ...own, cookie: '__Host-keelwerk_session=stale' }),
    );
    expect(response.headers.getSetCookie()).toHaveLength(1);
    expect(response.headers.get('set-cookie')).toContain('secret-token');
  });
});

describe('the origin check (core.csrf)', () => {
  const run = async (
    method: string,
    headers: Record<string, string>,
    deps = {},
  ): Promise<number> => {
    const { host } = setup({}, undefined, deps);
    const response = await host.fetch(
      new Request('https://library.example/_keelwerk/v1/capabilities', { method, headers }),
    );
    return response.status;
  };
  const post = async (headers: Record<string, string>, deps = {}) => {
    const { host } = setup({}, undefined, deps);
    const response = await host.fetch(
      postJson('/_keelwerk/v1/invoke', { action: 'library.echo' }, headers),
    );
    return response;
  };
  const cookie = { cookie: '__Host-keelwerk_session=abc' };

  it('refuses a cookie-authenticated unsafe request without or with a foreign origin', async () => {
    for (const headers of [
      cookie,
      { ...cookie, origin: 'https://evil.example' },
      { ...cookie, origin: 'null' },
      { ...cookie, 'sec-fetch-site': 'cross-site' },
      { ...cookie, 'sec-fetch-site': 'same-site' },
    ]) {
      const response = await post(headers);
      expect(response.status).toBe(403);
      expect(
        ((await response.json()) as { error: { code: string; kind: string } }).error,
      ).toMatchObject({
        kind: 'forbidden',
        code: 'core.csrf',
      });
    }
  });

  it('accepts the own origin, same-origin fetch metadata and the tenant allowed origins', async () => {
    expect((await post({ ...cookie, ...own })).status).toBe(200);
    expect((await post({ ...cookie, 'sec-fetch-site': 'same-origin' })).status).toBe(200);
    const allowed = { allowedOrigins: () => ['https://app.example'] };
    expect((await post({ ...cookie, origin: 'https://app.example' }, allowed)).status).toBe(200);
    expect((await post({ ...cookie, origin: 'https://other.example' }, allowed)).status).toBe(403);
  });

  it('is not skipped by a non-bearer Authorization header, a cross-scheme own host, or an OPTIONS without preflight', async () => {
    expect(
      (await post({ ...cookie, authorization: 'Basic x', origin: 'https://evil.example' })).status,
    ).toBe(403);
    expect((await post({ ...cookie, origin: 'http://library.example' })).status).toBe(403);
    expect(await run('OPTIONS', { ...cookie })).toBe(403);
  });

  it('does not check bearer requests, requests without cookies, or safe methods', async () => {
    expect(
      (await post({ ...cookie, authorization: 'Bearer t', origin: 'https://evil.example' })).status,
    ).toBe(200);
    expect((await post({ origin: 'https://evil.example' })).status).toBe(200);
    for (const method of ['GET', 'HEAD']) {
      expect(await run(method, { ...cookie, origin: 'https://evil.example' })).not.toBe(403);
    }
  });
});

describe('CORS', () => {
  const allowed = { allowedOrigins: () => ['https://app.example'] };

  it('echoes an allowed origin with credentials and Vary', async () => {
    const { host } = setup({}, undefined, allowed);
    const response = await host.fetch(
      postJson(
        '/_keelwerk/v1/invoke',
        { action: 'library.echo' },
        { origin: 'https://app.example' },
      ),
    );
    expect(response.headers.get('access-control-allow-origin')).toBe('https://app.example');
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
    expect(response.headers.get('vary')).toContain('Origin');
    expect(response.headers.get('access-control-expose-headers')).toContain('keelwerk-version');
  });

  it('adds nothing for an unknown origin', async () => {
    const { host } = setup({}, undefined, allowed);
    const response = await host.fetch(
      postJson(
        '/_keelwerk/v1/invoke',
        { action: 'library.echo' },
        { origin: 'https://evil.example' },
      ),
    );
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('answers a preflight without invoking anything', async () => {
    const { host, invoker } = setup({}, undefined, allowed);
    const preflight = (origin: string) =>
      host.fetch(
        new Request('https://library.example/_keelwerk/v1/invoke', {
          method: 'OPTIONS',
          headers: { origin, 'access-control-request-method': 'POST' },
        }),
      );
    const ok = await preflight('https://app.example');
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-headers')).toContain('keelwerk-version');
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://app.example');
    const refused = await preflight('https://evil.example');
    expect(refused.status).toBe(204);
    expect(refused.headers.get('access-control-allow-origin')).toBeNull();
    expect(invoker.invoked).toHaveLength(0);
  });
});

describe('security headers', () => {
  it('sets them on framework paths and never over a handler value', async () => {
    const { host } = setup();
    const response = await host.fetch(postJson('/_keelwerk/v1/invoke', { action: 'library.echo' }));
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('strict-transport-security')).toContain('max-age=');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
