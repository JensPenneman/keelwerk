import { describe, expect, test } from 'vitest';
import { createRestAdapter } from '../src/create-rest-adapter.ts';
import { openApiDocuments } from '../src/openapi-documents.ts';
import { portalSurface, withAction } from './support/portal-surface.ts';
import { call, fakeInvoker, invokerWith, mountRest, session } from './support/rest-kit.ts';

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

describe('the mount', () => {
  test('a tenant prefix the host consumed sits before the base path', async () => {
    const { handler } = await mountRest(
      portalSurface(),
      fakeInvoker(() => ({ ok: true, value: {} })).invoker,
    );
    const response = await call(handler, 'GET', '/t/acme/api/app/health', {
      tenantPrefix: '/t/acme',
    });
    expect(response.status).toBe(200);
    expect(
      (await call(handler, 'GET', '/api/app/health', { tenantPrefix: '/t/acme' })).status,
    ).toBe(404);
  });

  test('artifacts() yields the OpenAPI file at generated/openapi/<app>/<version>.json', () => {
    const surface = portalSurface();
    expect(createRestAdapter().artifacts(surface)).toEqual([
      expect.objectContaining({
        kind: 'file',
        path: `generated/openapi/${surface.app}/${surface.apiVersion}.json`,
        contentType: 'application/json',
      }),
    ]);
  });

  test('a cookie hint without the __Host- prefix is a check problem', () => {
    const surface = withAction(portalSurface(), 'auth.login', {
      hints: { http: { cookie: { set: { name: 'session', from: 'token' } } } },
    });
    expect(createRestAdapter().check(surface)).toEqual([
      expect.objectContaining({ code: 'cookieName', subject: 'auth.login' }),
    ]);
  });

  test('the OpenAPI document is the artefact of the session API version', () => {
    const file = (path: string, title: string) => ({
      kind: 'file' as const,
      path,
      contentType: 'application/json',
      content: JSON.stringify({ info: { title } }),
    });
    const artifacts = [
      file('generated/openapi/portal/2026-10-01.json', 'old'),
      file('generated/openapi/portal/2026-11-01.json', 'new'),
    ];
    const documents = openApiDocuments(artifacts);
    const served = documents(
      'generated/openapi/portal/2026-11-01.json',
      'https://portal.example/api',
    );
    expect(JSON.parse(served ?? '{}')).toEqual({
      info: { title: 'new' },
      servers: [{ url: 'https://portal.example/api' }],
    });
    expect(documents('generated/openapi/portal/9999.json', 'x')).toBeUndefined();
    expect(
      documents('generated/openapi/portal/2026-11-01.json', 'https://portal.example/api'),
    ).toBe(served);
    expect(
      JSON.parse(
        documents('generated/openapi/portal/2026-11-01.json', 'https://other.example/api') ?? '{}',
      ).servers,
    ).toEqual([{ url: 'https://other.example/api' }]);
  });

  test('the document is parsed once, when the lookup is built', () => {
    let reads = 0;
    const artifact = {
      kind: 'file' as const,
      path: 'generated/openapi/portal/2026-11-01.json',
      contentType: 'application/json',
      get content() {
        reads += 1;
        return '{"info":{}}';
      },
    };
    const documents = openApiDocuments([artifact]);
    for (let n = 0; n < 5; n += 1) {
      documents(artifact.path, 'https://portal.example/api');
      documents(artifact.path, `https://host${n}.example/api`);
    }
    expect(reads).toBe(1);
  });

  test('registers one handler under the base path and honours static options', async () => {
    const { registered } = await mountRest(
      portalSurface(),
      fakeInvoker(() => ({ ok: true, value: {} })).invoker,
      {
        basePath: '/v1',
      },
    );
    expect(registered.map((entry) => entry.prefix)).toEqual(['/v1']);
  });

  test('host-root rest.path hints register their own prefix', async () => {
    const surface = withAction(portalSurface(), 'app.health', {
      hints: { rest: { path: '/.well-known/health' } },
    });
    const { registered, handler } = await mountRest(
      surface,
      fakeInvoker(() => ({ ok: true, value: { up: true } })).invoker,
    );
    expect(registered.map((entry) => entry.prefix)).toEqual(['/api', '/.well-known/health']);
    const response = await call(handler, 'GET', '/.well-known/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ up: true });
  });

  test('a surface with a route conflict refuses to mount', async () => {
    const clash = withAction(portalSurface(), 'accounts.register', {
      name: 'profiles',
      ref: 'accounts.profiles',
    });
    await expect(
      mountRest(clash, fakeInvoker(() => ({ ok: true, value: {} })).invoker),
    ).rejects.toThrow(/routeConflict/);
  });

  test('close waits for requests in flight and refuses new ones', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = invokerWith(async () => {
      await gate;
      return { ok: true, value: {} };
    });
    const { handler, close } = await mountRest(portalSurface(), slow);
    const pending = call(handler, 'GET', '/api/app/health');
    let closed = false;
    const closing = close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    expect((await call(handler, 'GET', '/api/app/health')).status).toBe(503);
    release();
    expect((await pending).status).toBe(200);
    await closing;
    expect(closed).toBe(true);
  });

  test('close gives up when the deadline aborts', async () => {
    const stuck = invokerWith(() => new Promise<never>(() => undefined));
    const { handler, close } = await mountRest(portalSurface(), stuck);
    void call(handler, 'GET', '/api/app/health');
    const deadline = new AbortController();
    const closing = close(deadline.signal);
    deadline.abort();
    await closing;
  });

  test('the reference page needs the docs setting; the OpenAPI document carries the request host', async () => {
    const fake = fakeInvoker(() => ({ ok: true, value: {} }));
    const off = await mountRest(portalSurface(), fake.invoker);
    expect((await call(off.handler, 'GET', '/api/docs')).status).toBe(404);
    const served = await call(off.handler, 'GET', '/api/openapi.json');
    expect(served.status).toBe(200);
    const document = (await served.json()) as { servers: { url: string }[] };
    expect(document.servers).toEqual([{ url: 'https://portal.example/api' }]);
    const on = await mountRest(portalSurface(), fake.invoker, {}, { docs: true });
    const page = await call(on.handler, 'GET', '/api/docs');
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(await page.text()).toContain('/api/openapi.json');
    const dev = await mountRest(portalSurface(), fake.invoker, {}, {}, true);
    expect((await call(dev.handler, 'GET', '/api/docs')).status).toBe(200);
  });
});
