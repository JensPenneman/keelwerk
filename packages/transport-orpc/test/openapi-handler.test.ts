import { renderTypeId } from '@keelwerk/core';
import { requestHeaders, startTransportRuntime } from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, describe, expect, test, vi } from 'vitest';
import { orpcConformanceVersions } from './support/orpc-conformance-app.ts';
import { orpcEchoApp } from './support/orpc-echo-app.ts';

const generation = vi.hoisted(() => ({ failNext: false }));
vi.mock('../src/openapi/orpc-openapi-document.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/openapi/orpc-openapi-document.ts')>();
  return {
    ...original,
    orpcOpenapiDocument: (...args: Parameters<typeof original.orpcOpenapiDocument>) => {
      if (!generation.failNext) return original.orpcOpenapiDocument(...args);
      generation.failNext = false;
      return Promise.reject(new Error('the generator failed (test)'));
    },
  };
});

const without = await startTransportRuntime({
  app: orpcEchoApp(),
  host: httpHost(),
  config: { orpc: { cors: [] } },
});
const options = { openapi: '/orpc-openapi' };
const app = orpcEchoApp(options);
const mounted = await startTransportRuntime({
  app,
  host: httpHost(),
  config: { orpc: { cors: [] } },
  tenants: ['acme', 'legacy'],
  tenantApiVersions: { legacy: orpcConformanceVersions.older },
});
afterAll(async () => {
  await without.stop();
  await mounted.stop();
});

function post(
  runtime: typeof mounted,
  tenant: string,
  path: string,
  body: unknown,
): Promise<Response> {
  const headers = requestHeaders({ subject: 'ada' });
  headers.set('content-type', 'application/json');
  return runtime.fetch(
    new Request(`https://${runtime.domains[tenant]}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
  );
}

describe('the OpenAPI handler', () => {
  test('without the option no OpenAPI route is mounted', async () => {
    const answer = await post(without, 'acme', '/orpc-openapi/library/findByIsbn', { isbn: 'x' });
    expect(answer.status).toBe(404);
    expect(answer.headers.get('content-type') ?? '').not.toContain('openapi');
  });

  test('with it a query answers plain JSON at <prefix>/<path>', async () => {
    const answer = await post(mounted, 'acme', '/orpc-openapi/echo/mirror', {
      at: '2026-11-12T10:00:00.000Z',
      on: '2026-11-12',
      big: '9007199254740993',
      bytes: 'AQID',
      tags: ['a'],
      label: 'plain',
    });
    expect(answer.status).toBe(200);
    expect(answer.headers.get('content-type')).toContain('application/json');
    expect(await answer.json()).toEqual({
      at: '2026-11-12T10:00:00.000Z',
      on: '2026-11-12',
      big: '9007199254740993',
      bytes: 'AQID',
      tags: ['a'],
      label: 'plain',
    });
  });

  test('an error answers plain JSON with the wire error as data', async () => {
    const answer = await post(mounted, 'acme', '/orpc-openapi/echo/limited', {});
    expect(answer.status).toBe(429);
    expect(await answer.json()).toMatchObject({
      defined: false,
      code: 'core.rate_limited',
      data: { kind: 'rate_limited' },
    });
  });

  test("GET <prefix>/openapi.json answers the document of the session's version", async () => {
    const hashes = new Map<string, string>();
    for (const tenant of ['acme', 'legacy'] as const) {
      const answer = await mounted.fetch(
        new Request(`https://${mounted.domains[tenant]}/orpc-openapi/openapi.json`),
      );
      expect(answer.status).toBe(200);
      const document = (await answer.json()) as {
        openapi: string;
        info: { title: string; version: string };
        paths: Record<string, unknown>;
      };
      expect(document.openapi).toMatch(/^3\.1/);
      expect(document.info.title).toBe('orpc-echo');
      expect(document.info.version).toMatch(/^sha256-/);
      expect(Object.keys(document.paths)).toContain('/echo/mirror');
      hashes.set(tenant, document.info.version);
    }
    expect(hashes.get('acme')).not.toBe(hashes.get('legacy'));
  });

  test('below the tenant path prefix the handler serves its paths and its document', async () => {
    const tenant = mounted.tenants.acme;
    if (tenant === undefined) throw new Error('The runtime has no tenant acme.');
    const prefix = `/t/${renderTypeId('tnt', tenant)}`;
    const answer = await post(mounted, 'acme', `${prefix}/orpc-openapi/echo/mirror`, {
      at: '2026-11-12T10:00:00.000Z',
      on: '2026-11-12',
      big: '9007199254740993',
      bytes: 'AQID',
      tags: ['a'],
      label: 'prefixed',
    });
    expect(answer.status).toBe(200);
    expect(await answer.json()).toMatchObject({ label: 'prefixed' });
    const document = await mounted.fetch(
      new Request(`https://${mounted.domains.acme}${prefix}/orpc-openapi/openapi.json`),
    );
    expect(document.status).toBe(200);
    expect(((await document.json()) as { openapi: string }).openapi).toMatch(/^3\.1/);
  });

  test('a generation that failed is tried again by the next request', async () => {
    // A host of its own, so no earlier request has filled the cache of the version.
    const fresh = await startTransportRuntime({
      app,
      host: httpHost(),
      config: { orpc: { cors: [] } },
    });
    generation.failNext = true;
    try {
      const get = () =>
        fresh.fetch(new Request(`https://${fresh.domains.acme}/orpc-openapi/openapi.json`));
      expect((await get()).status).toBe(500);
      const second = await get();
      expect(second.status).toBe(200);
      expect(((await second.json()) as { openapi: string }).openapi).toMatch(/^3\.1/);
      expect(generation.failNext).toBe(false);
    } finally {
      await fresh.stop();
    }
  });
});
