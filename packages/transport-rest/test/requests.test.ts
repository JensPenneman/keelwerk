import { commandReceiptId, type Invocation, KeelwerkError, parseTypeId } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { portalSurface } from './support/portal-surface.ts';
import { call, fakeInvoker, mountRest, profileId, session } from './support/rest-kit.ts';

const uuid = parseTypeId(profileId, 'prof') ?? '';
const row = { id: uuid, name: 'Ada', version: 3 };

async function mounted(respond: Parameters<typeof fakeInvoker>[0]) {
  const fake = fakeInvoker(respond);
  const rest = await mountRest(portalSurface(), fake.invoker);
  return { ...rest, calls: fake.calls };
}

function lastCall(calls: Invocation<unknown>[]): Invocation<unknown> {
  const last = calls.at(-1);
  if (last === undefined) {
    throw new Error('the invoker was not called');
  }
  return last;
}

describe('requests', () => {
  test('filter JSON and compact sort reach the invoker as the object form', async () => {
    const page = {
      items: [row],
      pageInfo: { hasNextPage: true, hasPreviousPage: true, startCursor: 'a1', endCursor: 'z9' },
    };
    const { handler, calls } = await mounted(() => ({ ok: true, value: page }));
    const filter = encodeURIComponent(JSON.stringify({ name: { startsWith: 'A' }, bio: null }));
    const response = await call(
      handler,
      'GET',
      `/api/accounts/profiles?filter=${filter}&sort=name,-createdAt&first=10&total=true&fields=name`,
    );
    expect(response.status).toBe(200);
    expect(lastCall(calls)).toMatchObject({
      action: 'accounts.profile.query',
      carrier: { transport: 'rest' },
      input: {
        filter: { name: { startsWith: 'A' }, bio: null },
        sort: [
          { field: 'name', direction: 'asc' },
          { field: 'createdAt', direction: 'desc' },
        ],
        first: 10,
        total: true,
        fields: ['name'],
      },
    });
    const body = (await response.json()) as { items: { id: string }[] };
    expect(body.items[0]?.id).toBe(profileId);
    const link = response.headers.get('link') ?? '';
    const next = /<([^>]+)>; rel="next"/.exec(link)?.[1] ?? '';
    const prev = /<([^>]+)>; rel="prev"/.exec(link)?.[1] ?? '';
    const nextQuery = new URL(next, 'https://portal.example');
    expect(nextQuery.pathname).toBe('/api/accounts/profiles');
    expect(nextQuery.searchParams.get('after')).toBe('z9');
    expect(nextQuery.searchParams.get('first')).toBe('10');
    expect(nextQuery.searchParams.get('filter')).toBe(
      JSON.stringify({ name: { startsWith: 'A' }, bio: null }),
    );
    const prevQuery = new URL(prev, 'https://portal.example');
    expect(prevQuery.searchParams.get('before')).toBe('a1');
    expect(prevQuery.searchParams.get('last')).toBe('10');
    expect(prevQuery.searchParams.has('after')).toBe(false);
  });

  test('a POST query takes the same members as a JSON body', async () => {
    const { handler, calls } = await mounted(() => ({
      ok: true,
      value: { items: [], pageInfo: { hasNextPage: false, hasPreviousPage: false } },
    }));
    const response = await call(handler, 'POST', '/api/accounts/profiles/query', {
      body: { filter: { name: 'Ada' }, first: 5 },
    });
    expect(response.status).toBe(200);
    expect(lastCall(calls).input).toEqual({ filter: { name: 'Ada' }, first: 5 });
  });

  test('unknown or malformed query parameters are validation issues', async () => {
    const { handler, calls } = await mounted(() => ({ ok: true, value: {} }));
    const response = await call(handler, 'GET', '/api/accounts/profiles?first=ten&bogus=1&sort=-');
    expect(response.status).toBe(422);
    const problem = (await response.json()) as { issues: { path: string[] }[] };
    expect(problem.issues.map((issue) => issue.path[0]).sort()).toEqual(['bogus', 'first', 'sort']);
    expect(calls).toHaveLength(0);
  });

  test('a wrong id prefix is validation, not not_found, and never reaches the invoker', async () => {
    const { handler, calls } = await mounted(() => ({ ok: true, value: row }));
    const response = await call(
      handler,
      'GET',
      '/api/accounts/profiles/sess_01h455vb4pex5vsknk084sn02q',
    );
    expect(response.status).toBe(422);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect(await response.json()).toMatchObject({
      kind: 'validation',
      issues: [{ path: ['id'] }],
    });
    expect(calls).toHaveLength(0);
    const garbage = await call(handler, 'POST', '/api/accounts/profiles/nope/deactivate', {
      body: {},
    });
    expect(garbage.status).toBe(422);
  });

  test('a single get answers the row with its ETag, and 304 on a matching If-None-Match', async () => {
    const { handler, calls } = await mounted(() => ({
      ok: true,
      value: { items: [row], pageInfo: { hasNextPage: false, hasPreviousPage: false } },
    }));
    const response = await call(handler, 'GET', `/api/accounts/profiles/${profileId}?fields=name`);
    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe('"3"');
    expect(response.headers.get('keelwerk-version')).toBe('2026-11-01');
    expect(response.headers.get('x-request-id')).toBeTruthy();
    expect(await response.json()).toEqual({ id: profileId, name: 'Ada', version: 3 });
    expect(lastCall(calls).input).toEqual({ ids: [profileId], fields: ['name'] });

    const cached = await call(handler, 'GET', `/api/accounts/profiles/${profileId}`, {
      headers: { 'if-none-match': '"3"' },
    });
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe('');
    const stale = await call(handler, 'GET', `/api/accounts/profiles/${profileId}`, {
      headers: { 'if-none-match': '"2"' },
    });
    expect(stale.status).toBe(200);
  });

  test('a missing row is not_found', async () => {
    const { handler } = await mounted(() => ({
      ok: true,
      value: { items: [], notFound: [uuid] },
    }));
    const response = await call(handler, 'GET', `/api/accounts/profiles/${profileId}`);
    expect(response.status).toBe(404);
  });

  test('If-Match becomes ifVersion, and a failed precondition is 412', async () => {
    const { handler, calls } = await mounted(() => ({ ok: true, value: row }));
    const response = await call(handler, 'PATCH', `/api/accounts/profiles/${profileId}`, {
      headers: { 'if-match': '"3"', 'content-type': 'application/merge-patch+json' },
      body: { name: 'Grace', bio: null },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe('"3"');
    expect(lastCall(calls)).toMatchObject({
      action: 'accounts.profile.update',
      input: { id: profileId, patch: { name: 'Grace', bio: null }, ifVersion: 3 },
    });
    const conflicting = await call(handler, 'PATCH', `/api/accounts/profiles/${profileId}`, {
      headers: { 'if-match': '"3"' },
      body: { ifVersion: 2 },
    });
    expect(conflicting.status).toBe(422);
    const weak = await call(handler, 'PATCH', `/api/accounts/profiles/${profileId}`, {
      headers: { 'if-match': 'W/"3"' },
      body: {},
    });
    expect(weak.status).toBe(400);
    const badTag = await call(handler, 'PATCH', `/api/accounts/profiles/${profileId}`, {
      headers: { 'if-match': 'abc' },
      body: {},
    });
    expect(badTag.status).toBe(400);

    const failing = await mounted(() => ({
      ok: false,
      error: new KeelwerkError({
        kind: 'conflict',
        code: 'core.version_mismatch',
        message: 'The row changed since it was read.',
      }),
    }));
    const mismatch = await call(failing.handler, 'DELETE', `/api/accounts/profiles/${profileId}`, {
      headers: { 'if-match': '"1"' },
    });
    expect(mismatch.status).toBe(412);
    expect(await mismatch.json()).toMatchObject({
      code: 'core.version_mismatch',
      kind: 'conflict',
    });
  });

  test('create answers 201 with Location and ETag; archive and restore answer the row', async () => {
    const { handler, calls } = await mounted(() => ({ ok: true, value: row }));
    const created = await call(handler, 'POST', '/api/accounts/profiles', {
      body: { name: 'Ada' },
    });
    expect(created.status).toBe(201);
    expect(created.headers.get('location')).toBe(`/api/accounts/profiles/${profileId}`);
    expect(created.headers.get('etag')).toBe('"3"');
    expect(created.headers.get('keelwerk-command-id')).toMatch(/^[0-9a-f-]{36}$/);
    const archived = await call(handler, 'DELETE', `/api/accounts/profiles/${profileId}`);
    expect(archived.status).toBe(200);
    expect(lastCall(calls).input).toEqual({ id: profileId });
    const restored = await call(handler, 'POST', `/api/accounts/profiles/${profileId}/restore`);
    expect(restored.status).toBe(200);
    expect(lastCall(calls).action).toBe('accounts.profile.restore');
  });

  test('a command with void output answers 204 and lists its effects', async () => {
    const { handler, calls } = await mounted(() => ({
      ok: true,
      value: undefined,
      effects: ['eff_a', 'eff_b'],
    }));
    const response = await call(handler, 'POST', `/api/accounts/profiles/${profileId}/deactivate`, {
      body: { reason: 'left' },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('keelwerk-effects')).toBe('eff_a,eff_b');
    expect(lastCall(calls).input).toEqual({ reason: 'left', id: profileId });
  });

  test('an accepted command answers 202 with Location and the receipt (S-24)', async () => {
    const { handler, calls } = await mounted((inv) => ({
      ok: true,
      value: undefined,
      receipt: { commandId: inv.commandId ?? '', status: 'accepted' },
    }));
    const response = await call(handler, 'POST', '/api/accounts/profiles', {
      headers: { prefer: 'respond-async, wait=10', 'idempotency-key': 'order-17' },
      body: { name: 'Ada' },
    });
    expect(response.status).toBe(202);
    const location = response.headers.get('location') ?? '';
    expect(location).toBe(`/api/core/command-receipts/${commandReceiptId('t1', 'order-17')}`);
    expect(location).toMatch(/^\/api\/core\/command-receipts\/rcpt_[0-9a-hjkmnpqrstv-z]{26}$/);
    expect(response.headers.get('preference-applied')).toBe('respond-async');
    expect(response.headers.get('keelwerk-command-id')).toBe('order-17');
    expect(await response.json()).toEqual({ commandId: 'order-17', status: 'accepted' });
    expect(lastCall(calls)).toMatchObject({ prefer: 'async', commandId: 'order-17' });

    const plain = await call(handler, 'POST', '/api/accounts/profiles', { body: { name: 'Ada' } });
    expect(plain.status).toBe(202);
    expect(plain.headers.has('preference-applied')).toBe(false);
    expect(lastCall(calls).prefer).toBeUndefined();
  });

  test('Idempotency-Key is the command id, a replay says so', async () => {
    const { handler, calls } = await mounted(() => ({ ok: true, value: row, replayed: true }));
    const response = await call(handler, 'POST', '/api/accounts/profiles', {
      headers: { 'idempotency-key': 'k-1' },
      body: { name: 'Ada' },
    });
    expect(response.headers.get('idempotent-replayed')).toBe('true');
    expect(response.headers.get('keelwerk-command-id')).toBe('k-1');
    expect(lastCall(calls).commandId).toBe('k-1');
    const invalid = await call(handler, 'POST', '/api/accounts/profiles', {
      headers: { 'idempotency-key': 'has space' },
      body: { name: 'Ada' },
    });
    expect(invalid.status).toBe(400);
    const query = await call(handler, 'GET', '/api/app/health');
    expect(query.headers.has('keelwerk-command-id')).toBe(false);
    expect(lastCall(calls).commandId).toBeUndefined();
  });

  test('bodies: malformed JSON is 400, too large is 413, other media types are 400', async () => {
    const { handler } = await mounted(() => ({ ok: true, value: row }));
    const broken = await call(handler, 'POST', '/api/accounts/profiles', { rawBody: '{nope' });
    expect(broken.status).toBe(400);
    expect(await broken.json()).toMatchObject({ code: 'core.malformed_request' });
    const text = await call(handler, 'POST', '/api/accounts/profiles', {
      rawBody: 'a=b',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(text.status).toBe(400);
    const small = await mountRest(
      portalSurface(),
      fakeInvoker(() => ({ ok: true, value: row })).invoker,
      {},
      {
        maxBodyBytes: 16,
      },
    );
    const large = await call(small.handler, 'POST', '/api/accounts/profiles', {
      body: { name: 'a very long name indeed' },
    });
    expect(large.status).toBe(413);
    expect(await large.json()).toMatchObject({ code: 'core.payload_too_large' });
  });

  test('unknown paths and subscriptions', async () => {
    const { handler } = await mounted(() => ({ ok: true, value: row }));
    expect((await call(handler, 'GET', '/api/nothing/here')).status).toBe(404);
    expect((await call(handler, 'PUT', '/api/accounts/profiles')).status).toBe(404);
    const stream = await call(handler, 'GET', '/api/auth/session-events', {
      headers: { accept: 'text/event-stream' },
    });
    expect(stream.status).toBe(503);
    expect(await stream.json()).toMatchObject({ code: 'core.live_unavailable' });
  });

  test('HEAD answers the headers of GET without a body', async () => {
    const { handler } = await mounted(() => ({ ok: true, value: { ok: true } }));
    const response = await call(handler, 'HEAD', '/api/app/health');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
  });

  test('the first-party mount does not resolve or evaluate anything itself', async () => {
    const { handler, calls } = await mounted(() => ({ ok: true, value: { ok: true } }));
    const forwarded = session({ app: 'portal' });
    await call(handler, 'GET', '/api/app/health', { session: forwarded });
    expect(lastCall(calls).session).toBe(forwarded);
  });
});
