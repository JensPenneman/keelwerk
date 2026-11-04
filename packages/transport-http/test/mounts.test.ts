import type { HttpContext } from '@keelwerk/core';
import { describe, expect, it } from 'vitest';
import { createMountTable } from '../src/create-mount-table.ts';
import { postJson } from './support/post-json.ts';
import { useHosts } from './support/use-hosts.ts';

const { setup } = useHosts();
const noop = async () => new Response(null);

describe('mount tables', () => {
  it('matches the longest prefix and keeps / as the fallback', () => {
    const table = createMountTable('library');
    table.add({ transport: 'ui', prefix: '/' }, noop);
    table.add({ transport: 'rest', prefix: '/api' }, noop);
    table.add({ transport: 'graphql', prefix: '/graphql/' }, noop);
    expect(table.match('/api/books')?.transport).toBe('rest');
    expect(table.match('/api')?.transport).toBe('rest');
    expect(table.match('/apix')?.transport).toBe('ui');
    expect(table.match('/graphql')?.transport).toBe('graphql');
    expect(table.match('/anything')?.transport).toBe('ui');
  });

  it('refuses overlapping prefixes of one app and the reserved prefix as a routeConflict', () => {
    const table = createMountTable('library');
    table.add({ transport: 'rest', prefix: '/api' }, noop);
    expect(() => table.add({ transport: 'other', prefix: '/api' }, noop)).toThrow(/routeConflict/);
    try {
      table.add({ transport: 'other', prefix: '/api' }, noop);
    } catch (failure) {
      expect((failure as { details?: unknown }).details).toMatchObject({
        code: 'routeConflict',
        transport: 'other',
        subject: '/api',
      });
    }
    expect(() => table.add({ transport: 'other', prefix: '/api/v2' }, noop)).toThrow(
      /routeConflict/,
    );
    expect(() => table.add({ transport: 'other', prefix: '/_keelwerk/v1' }, noop)).toThrow(
      /routeConflict/,
    );
    expect(() => table.add({ transport: 'other', prefix: 'api' }, noop)).toThrow(/routeConflict/);
    expect(() => table.add({ transport: 'other', prefix: '/apix' }, noop)).not.toThrow();
  });
});

describe('transport handlers on the host', () => {
  it('hands a handler the request, its body and the context', async () => {
    const { host } = setup();
    let seen: HttpContext | undefined;
    let text = '';
    host.route({ app: 'library', transport: 'rest', prefix: '/api' }, async (request, ctx) => {
      seen = ctx;
      text = await request.text();
      return new Response('{"rest":true}', { headers: { 'content-type': 'application/json' } });
    });
    const response = await host.fetch(
      postJson('/api/books', 'hello', {
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      }),
    );
    expect(await response.json()).toEqual({ rest: true });
    expect(text).toBe('hello');
    expect(seen?.session.app).toBe('library');
    expect(seen?.requestId).toBe(response.headers.get('x-request-id'));
    expect(seen?.traceparent).toBe('00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01');
    expect(seen?.basePath).toBe('');
    expect(seen?.carrier.transport).toBe('http');
    expect(response.headers.get('keelwerk-version')).toBe('2026-11-01');
  });

  it('drops a malformed traceparent', async () => {
    const { host } = setup();
    let traceparent: string | undefined = 'unset';
    host.route({ app: 'library', transport: 'rest', prefix: '/api' }, async (_request, ctx) => {
      traceparent = ctx.traceparent;
      return new Response(null);
    });
    await host.fetch(
      postJson(
        '/api',
        {},
        { traceparent: '00-00000000000000000000000000000000-b7ad6b7169203331-01' },
      ),
    );
    expect(traceparent).toBeUndefined();
  });

  it('answers 404 for a path no mount of the session app covers, and for other apps', async () => {
    const { host } = setup();
    host.route({ app: 'other', transport: 'rest', prefix: '/api' }, noop);
    const response = await host.fetch(postJson('/api/books', {}));
    expect(response.status).toBe(404);
  });

  it('answers a handler that throws with a redacted 500', async () => {
    const { host } = setup();
    host.route({ app: 'library', transport: 'rest', prefix: '/api' }, async () => {
      throw new Error('database password is hunter2');
    });
    const response = await host.fetch(postJson('/api', {}));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('hunter2');
  });

  it('keeps the handler response headers and decorates them', async () => {
    const { host } = setup();
    host.route({ app: 'library', transport: 'rest', prefix: '/api' }, async () =>
      Response.redirect('https://elsewhere.example/', 302),
    );
    const response = await host.fetch(postJson('/api', {}));
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://elsewhere.example/');
    expect(response.headers.get('x-request-id')).not.toBeNull();
  });

  it('refuses a conflicting route() and WebSocket upgrades until M2', () => {
    const { host } = setup();
    host.route({ app: 'library', transport: 'rest', prefix: '/api' }, noop);
    expect(() => host.route({ app: 'library', transport: 'trpc', prefix: '/api' }, noop)).toThrow(
      /routeConflict/,
    );
    expect(() =>
      host.upgrade(
        { app: 'library', transport: 'live', path: '/live', protocols: [] },
        { open() {} },
      ),
    ).toThrow(expect.objectContaining({ kind: 'unavailable', code: 'core.live_unavailable' }));
  });
});
