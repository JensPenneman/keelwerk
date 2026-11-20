import {
  type ApiSurface,
  deriveSurface,
  errors,
  type MountContext,
  versionProjection,
} from '@keelwerk/core';
import { startTransportRuntime } from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, describe, expect, test } from 'vitest';
import { mountOrpc } from '../src/mount/mount-orpc.ts';
import { orpcVersionMounts } from '../src/mount/orpc-version-mounts.ts';
import type { OrpcConfig } from '../src/orpc-config.ts';
import { buildOrpcRouter } from '../src/router/build-orpc-router.ts';
import { orpcPathOf } from '../src/router/orpc-path-of.ts';
import { orpcConformanceApp, orpcConformanceVersions } from './support/orpc-conformance-app.ts';

const head: ApiSurface = deriveSurface(
  orpcConformanceApp as never,
  orpcConformanceVersions.head,
).surface;
const older: ApiSurface = deriveSurface(
  orpcConformanceApp as never,
  orpcConformanceVersions.older,
).surface;

function isProcedure(value: unknown): boolean {
  return typeof value === 'object' && value !== null && '~orpc' in value;
}

function proceduresIn(tree: unknown, path: readonly string[] = []): string[] {
  if (isProcedure(tree)) return [path.join('.')];
  if (typeof tree !== 'object' || tree === null) return [];
  return Object.entries(tree).flatMap(([name, member]) => proceduresIn(member, [...path, name]));
}

describe('orpcPathOf', () => {
  test('orpcPathOf camel-cases a hyphenated module id and nests entity actions', () => {
    expect(orpcPathOf({ mount: 'module', module: 'api-keys', name: 'revokeAll' })).toEqual([
      'apiKeys',
      'revokeAll',
    ]);
    expect(
      orpcPathOf({ mount: 'entity', module: 'library', entity: 'library.book', name: 'create' }),
    ).toEqual(['library', 'book', 'create']);
    expect(orpcPathOf({ mount: 'app', module: 'app', name: 'ping' })).toEqual(['app', 'ping']);
  });
});

describe('buildOrpcRouter', () => {
  test('one procedure per surface action', () => {
    const procedures = proceduresIn(buildOrpcRouter(head));
    expect(procedures).toHaveLength(head.actions.length);
    expect(new Set(procedures)).toEqual(
      new Set(head.actions.map((action) => orpcPathOf(action).join('.'))),
    );
    expect(procedures).toContain('library.book.query');
    expect(procedures).toContain('loans.lend');
  });
});

function mountContext(surfaces: ApiSurface[]): MountContext<OrpcConfig> {
  return {
    app: 'orpc-conformance',
    surface: surfaces.at(-1),
    surfaces: versionProjection(
      surfaces.map((surface) => surface.apiVersion),
      (version) => {
        const found = surfaces.find((surface) => surface.apiVersion === version);
        if (found === undefined) throw new RangeError(version);
        return found;
      },
    ),
  } as unknown as MountContext<OrpcConfig>;
}

describe('the version mounts', () => {
  test('an older API version is served with its own surface', () => {
    const mounts = orpcVersionMounts(mountContext([older, head]), {});
    expect(mounts.versions).toEqual([older.apiVersion, head.apiVersion]);
    expect(mounts.at(older.apiVersion).surface).toBe(older);
    expect(mounts.at(head.apiVersion).surface).toBe(head);
    expect(older.hash).not.toBe(head.hash);
  });
});

const runtime = await startTransportRuntime({
  app: orpcConformanceApp,
  host: httpHost(),
  config: { orpc: { cors: [] } },
  tenants: ['acme', 'legacy'],
  tenantApiVersions: { legacy: orpcConformanceVersions.older },
});
afterAll(() => runtime.stop());

describe('over the host', () => {
  test('a tenant on the older API version is answered at that version with its notice', async () => {
    const answer = await runtime.fetch(
      new Request(`https://${runtime.domains.legacy}/orpc/loans/about`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ json: {} }),
      }),
    );
    expect(answer.status).toBe(200);
    expect(answer.headers.get('keelwerk-version')).toBe(orpcConformanceVersions.older);
    expect(answer.headers.get('deprecation')).not.toBeNull();
  });
});

describe('close', () => {
  const session = { apiVersion: head.apiVersion, principal: { kind: 'user' } };
  const request = () =>
    new Request('https://acme.example.test/orpc/loans/about', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: {} }),
    });
  const httpContext = (signal: AbortSignal) =>
    ({
      session,
      carrier: { transport: 'http', headers: {} },
      requestId: '0192a000-0000-7000-8000-000000000001',
      signal,
      path: '/loans/about',
      basePath: '/orpc',
    }) as never;

  test('close answers unavailable and waits for the request in flight', async () => {
    const release = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    const routes: { handler: (request: Request, context: never) => Promise<Response> }[] = [];
    const ctx = {
      ...mountContext([head]),
      invoker: {
        invoke: async () => {
          entered.resolve();
          await release.promise;
          return { ok: true, value: { module: 'loans' } };
        },
      },
      host: { route: (_spec: unknown, handler: never) => routes.push({ handler }) },
      log: { error: () => undefined },
    } as unknown as MountContext<OrpcConfig>;
    const handle = await mountOrpc(ctx, {});
    const route = routes[0];
    if (route === undefined) throw new Error('The transport registered no route.');
    const signal = new AbortController().signal;
    const inFlight = route.handler(request(), httpContext(signal));
    await entered.promise;
    const closed = handle.close(new AbortController().signal);
    const refused = await route.handler(request(), httpContext(signal));
    expect(refused.status).toBe(503);
    expect(refused.headers.get('retry-after')).toBe('1');
    expect(((await refused.json()) as { json: { code: string } }).json.code).toBe(
      errors.unavailable('x').code,
    );
    // A close that waits is still pending a moment after the request was refused.
    const stillWaiting = await Promise.race([
      closed.then(() => 'closed'),
      new Promise((resolve) => setTimeout(() => resolve('waiting'), 50)),
    ]);
    expect(stillWaiting).toBe('waiting');
    release.resolve();
    expect((await inFlight).status).toBe(200);
    await closed;
  });
});
