import { type ApiSurface, versionProjection } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { buildTrpcRouter } from '../src/router/build-trpc-router.ts';
import {
  findTrpcAction,
  mountedTrpc,
  mutateTrpc,
  queryTrpc,
  sendTrpc,
  trpcConformanceSurface,
  trpcSession,
} from './support/trpc-kit.ts';

const about = () => ({ ok: true as const, value: { module: 'loans' } });

describe('the router', () => {
  test('module ids are camel-cased in paths', async () => {
    const surface = trpcConformanceSurface();
    const source = findTrpcAction(surface, 'loans.about');
    const hand = { ...source, ref: 'api-keys.about', module: 'api-keys' };
    const mounted = await mountedTrpc({ ...surface, actions: [...surface.actions, hand] }, about);
    const answer = await queryTrpc(mounted.handler, 'apiKeys.about', {});
    expect(answer.status).toBe(200);
    expect(answer.body.result.data.json).toEqual({ module: 'loans' });
    expect(mounted.calls[0]?.action).toBe('api-keys.about');
  });

  test('entity actions sit under the module and the entity, app actions under app', () => {
    const router = buildTrpcRouter(trpcConformanceSurface(), {}, false);
    const procedures = Object.keys(router._def.procedures);
    expect(procedures).toContain('library.book.get');
    expect(procedures).toContain('loans.lend');
    expect(procedures).toContain('loans.loan.query');
  });

  test('each declared version has its own router', async () => {
    const older: ApiSurface = trpcConformanceSurface('2026-11-04');
    const head = trpcConformanceSurface('2026-11-11');
    // A surface of the older version that has no `loans.about`: the version of the session picks the router.
    const trimmed = {
      ...older,
      actions: older.actions.filter((action) => action.ref !== 'loans.about'),
    };
    const surfaces = versionProjection(['2026-11-04', '2026-11-11'], (version) =>
      version === '2026-11-04' ? trimmed : head,
    );
    const mounted = await mountedTrpc(head, about, { surfaces });
    const current = await queryTrpc(mounted.handler, 'loans.about', {});
    expect(current.status).toBe(200);
    const legacy = await queryTrpc(
      mounted.handler,
      'loans.about',
      {},
      {
        session: trpcSession({ apiVersion: '2026-11-04' }),
      },
    );
    expect(legacy.status).toBe(404);
  });

  test('a query runs with GET, a command with POST, and the other method is refused', async () => {
    const mounted = await mountedTrpc(trpcConformanceSurface(), about);
    const post = await sendTrpc(mounted.handler, 'loans.about', {
      method: 'POST',
      rawBody: JSON.stringify({ json: {} }),
    });
    expect(post.status).toBe(405);
    const get = await sendTrpc(mounted.handler, 'loans.lend', { search: 'input=%7B%7D' });
    expect(get.status).toBe(405);
    expect(mounted.calls).toEqual([]);
  });

  test('a batch of more than 20 calls is refused', async () => {
    const mounted = await mountedTrpc(trpcConformanceSurface(), about);
    const names = (count: number) => Array.from({ length: count }, () => 'loans.about').join(',');
    const refused = await sendTrpc(mounted.handler, names(21), { search: 'batch=1' });
    expect(refused.status).toBe(400);
    const allowed = await sendTrpc(mounted.handler, names(20), { search: 'batch=1' });
    expect(allowed.status).toBe(200);
    expect(mounted.calls).toHaveLength(20);
  });

  test('a body over the configured bound is refused as too large', async () => {
    const mounted = await mountedTrpc(trpcConformanceSurface(), about, {
      config: { maxBodyBytes: 64 },
    });
    const answer = await mutateTrpc(mounted.handler, 'loans.lend', {
      bookTitle: 'x'.repeat(200),
      dueAt: Temporal.Instant.from('2026-12-01T00:00:00Z'),
    });
    expect(answer.status).toBe(400);
    expect(answer.body.error.json.data.keelwerk).toMatchObject({ code: 'core.payload_too_large' });
    expect(mounted.calls).toEqual([]);
  });

  test('the transport registers one route under its path with a stream predicate', async () => {
    const mounted = await mountedTrpc(trpcConformanceSurface(), about, {
      options: { path: '/rpc' },
    });
    expect(mounted.registered).toHaveLength(1);
    expect(mounted.registered[0]?.prefix).toBe('/rpc');
    expect(mounted.registered[0]?.streams).toBeTypeOf('function');
  });
});
