import { KeelwerkError } from '@keelwerk/core';
import { describe, expect, it } from 'vitest';
import { createFakeInvoker } from './support/fake-invoker.ts';
import { fakeSession } from './support/fake-session.ts';
import { fakeAction, fakeSurface, stringNode } from './support/fake-surface.ts';
import { libraryActions } from './support/library-actions.ts';
import { postJson } from './support/post-json.ts';
import { useHosts } from './support/use-hosts.ts';

const { setup } = useHosts();

function invokerWith(tenantPrefix: string | undefined) {
  return createFakeInvoker({
    actions: libraryActions,
    open: () => ({
      ok: true,
      value:
        tenantPrefix === undefined
          ? fakeSession()
          : fakeSession({ resolvedBy: 'path', tenantPrefix }),
    }),
  });
}

function failingOpen() {
  return createFakeInvoker({
    open: () => ({
      ok: false,
      error: new KeelwerkError({
        kind: 'not_found',
        code: 'core.not_found',
        message: 'no such tenant',
      }),
    }),
  });
}

describe('a tenant path prefix', () => {
  it("serves the invocation protocol below the session's tenant prefix", async () => {
    const { host } = setup({}, invokerWith('/t/acme'));
    const response = await host.fetch(
      postJson('/t/acme/_keelwerk/v1/invoke', { action: 'library.echo', input: { a: 1 } }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, value: 'echo:{"a":1}' });
  });

  it('hands a mount the path below both prefixes and basePath with both', async () => {
    const { host } = setup({}, invokerWith('/t/acme'));
    const seen: string[] = [];
    host.route({ app: 'library', transport: 'rest', prefix: '/api' }, async (_request, ctx) => {
      seen.push(`${ctx.basePath}|${ctx.path}`);
      return new Response(null);
    });
    host.route({ app: 'library', transport: 'other', prefix: '/' }, async (_request, ctx) => {
      seen.push(`${ctx.basePath}|${ctx.path}`);
      return new Response(null);
    });
    await host.fetch(postJson('/t/acme/api/books', ''));
    await host.fetch(postJson('/t/acme/x', ''));
    expect(seen).toEqual(['/t/acme/api|/books', '/t/acme|/x']);
  });

  it("a reserved path below the tenant prefix stays the framework's", async () => {
    const { host } = setup({}, invokerWith('/t/acme'));
    host.route({ app: 'library', transport: 'other', prefix: '/' }, async () => new Response(null));
    const response = await host.fetch(postJson('/t/acme/_keelwerk/other', ''));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'core.not_found' } });
  });

  it('a session without a tenant prefix routes the whole path', async () => {
    const { host } = setup({}, invokerWith(undefined));
    host.route(
      { app: 'library', transport: 'rest', prefix: '/api' },
      async () => new Response(null),
    );
    const response = await host.fetch(postJson('/t/acme/api/books', ''));
    expect(response.status).toBe(404);
  });

  it('keeps the framework security headers below the tenant prefix', async () => {
    const { host } = setup({}, invokerWith('/t/acme'));
    const response = await host.fetch(
      postJson('/t/acme/_keelwerk/v1/invoke', { action: 'library.echo', input: {} }),
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
  });

  it('keeps the security headers on a reserved path when no session opens below the prefix', async () => {
    const invoker = createFakeInvoker({
      open: () => ({
        ok: false,
        error: new KeelwerkError({
          kind: 'not_found',
          code: 'core.not_found',
          message: 'no such tenant',
        }),
      }),
    });
    const { host } = setup({}, invoker);
    const response = await host.fetch(
      new Request('https://shared.example/t/acme/_keelwerk/v1/surface'),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
  });

  it('answers a failure before the session opens below the prefix as a problem document', async () => {
    const invoker = createFakeInvoker({
      open: () => ({
        ok: false,
        error: new KeelwerkError({
          kind: 'not_found',
          code: 'core.not_found',
          message: 'no such tenant',
        }),
      }),
    });
    const { host } = setup({}, invoker);
    host.route({ app: 'library', transport: 'rest', prefix: '/api' }, async () => new Response());
    const response = await host.fetch(new Request('https://library.example/t/acme/api/books'));
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    expect(await response.json()).toMatchObject({
      type: 'https://library.example/t/acme/api/problems/core.not_found',
    });
  });

  it('names the prefix in the problem type of a failure before the session below a root REST mount', async () => {
    const { host } = setup({}, failingOpen());
    host.route({ app: 'library', transport: 'rest', prefix: '/' }, async () => new Response());
    const response = await host.fetch(new Request('https://library.example/t/acme/books'));
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    expect(await response.json()).toMatchObject({
      type: 'https://library.example/t/acme/problems/core.not_found',
    });
  });

  it('answers the envelope for a reserved remainder before the session below a root REST mount', async () => {
    const { host } = setup({}, failingOpen());
    host.route({ app: 'library', transport: 'rest', prefix: '/' }, async () => new Response());
    const response = await host.fetch(
      postJson('/t/acme/_keelwerk/v1/invoke', { action: 'library.echo', input: {} }),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toMatch(/^application\/json(;|$)/);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'core.not_found' } });
  });

  it('refuses a ticket on a reserved endpoint below the tenant prefix', async () => {
    const { host } = setup({}, invokerWith('/t/acme'));
    const ticket = `kwst_${'a'.repeat(26)}_${'b'.repeat(52)}`;
    for (const path of ['surface', 'capabilities']) {
      const response = await host.fetch(
        new Request(`https://shared.example/t/acme/_keelwerk/v1/${path}?ticket=${ticket}`),
      );
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: { code: 'core.ticket_invalid' } });
    }
    const subscribe = await host.fetch(
      new Request(
        `https://shared.example/t/acme/_keelwerk/v1/subscribe?action=library.echo&ticket=${ticket}`,
      ),
    );
    expect(subscribe.status).toBe(401);
    expect(await subscribe.json()).toMatchObject({ error: { code: 'core.ticket_invalid' } });
  });

  it('points the deprecation link below the tenant prefix', async () => {
    const invoker = createFakeInvoker({
      actions: libraryActions,
      open: () => ({
        ok: true,
        value: fakeSession({
          resolvedBy: 'path',
          tenantPrefix: '/t/acme',
          deprecation: { at: '2026-11-01T00:00:00Z', sunset: '2027-11-01T00:00:00Z' },
        }),
      }),
    });
    const { host } = setup({}, invoker);
    const response = await host.fetch(
      postJson('/t/acme/_keelwerk/v1/invoke', { action: 'library.echo', input: {} }),
    );
    expect(response.headers.get('link')).toBe(
      '</t/acme/_keelwerk/v1/capabilities>; rel="deprecation"',
    );
  });

  it('points the link of a deprecated action below the tenant prefix', async () => {
    const surface = fakeSurface([
      fakeAction('library.echo', {
        output: stringNode,
        deprecated: { reason: 'gone', at: '2026-11-01T00:00:00Z', sunset: '2027-11-01T00:00:00Z' },
      }),
    ]);
    const { host } = setup({}, invokerWith('/t/acme'), { surface: () => surface });
    const response = await host.fetch(
      postJson('/t/acme/_keelwerk/v1/invoke', { action: 'library.echo', input: {} }),
    );
    expect(response.headers.get('deprecation')).toBe('@1793491200');
    expect(response.headers.get('link')).toBe('</t/acme/_keelwerk/v1/surface>; rel="deprecation"');
  });

  it('answers a host error on a REST route with the prefix in the problem type', async () => {
    const { host } = setup({}, invokerWith('/t/acme'));
    host.route({ app: 'library', transport: 'rest', prefix: '/api' }, async () => new Response());
    const response = await host.fetch(
      new Request('https://library.example/t/acme/api/books', {
        method: 'POST',
        headers: { cookie: 'a=b' },
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: 'core.csrf',
      type: 'https://library.example/t/acme/api/problems/core.csrf',
    });
  });
});
