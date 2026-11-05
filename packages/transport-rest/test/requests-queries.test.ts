import { parseTypeId } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { lastCall } from './support/last-call.ts';
import { mountedRest } from './support/mounted-rest.ts';
import { profileRow as row } from './support/profile-row.ts';
import { call, profileId, profileUuid } from './support/rest-kit.ts';

const uuid = parseTypeId(profileId, 'prof') ?? '';

describe('query requests', () => {
  test('filter JSON and compact sort reach the invoker as the object form', async () => {
    const page = {
      items: [row],
      pageInfo: { hasNextPage: true, hasPreviousPage: true, startCursor: 'a1', endCursor: 'z9' },
    };
    const { handler, calls } = await mountedRest(() => ({ ok: true, value: page }));
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
    const { handler, calls } = await mountedRest(() => ({
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
    const { handler, calls } = await mountedRest(() => ({ ok: true, value: {} }));
    const response = await call(handler, 'GET', '/api/accounts/profiles?first=ten&bogus=1&sort=-');
    expect(response.status).toBe(422);
    const problem = (await response.json()) as { issues: { path: string[] }[] };
    expect(problem.issues.map((issue) => issue.path[0]).sort()).toEqual(['bogus', 'first', 'sort']);
    expect(calls).toHaveLength(0);
  });

  test('a wrong id prefix is validation, not not_found, and never reaches the invoker', async () => {
    const { handler, calls } = await mountedRest(() => ({ ok: true, value: row }));
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
    const { handler, calls } = await mountedRest(() => ({
      ok: true,
      value: { items: [row], pageInfo: { hasNextPage: false, hasPreviousPage: false } },
    }));
    const response = await call(handler, 'GET', `/api/accounts/profiles/${profileId}?fields=name`);
    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe('"3"');
    expect(response.headers.get('keelwerk-version')).toBe('2026-11-01');
    expect(response.headers.get('x-request-id')).toBeTruthy();
    expect(await response.json()).toEqual({ id: profileId, name: 'Ada', version: 3 });
    expect(lastCall(calls).input).toEqual({ ids: [profileUuid], fields: ['name'] });

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
    const { handler } = await mountedRest(() => ({
      ok: true,
      value: { items: [], notFound: [uuid] },
    }));
    const response = await call(handler, 'GET', `/api/accounts/profiles/${profileId}`);
    expect(response.status).toBe(404);
  });
});
