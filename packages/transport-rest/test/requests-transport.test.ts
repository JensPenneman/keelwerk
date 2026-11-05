import { describe, expect, test } from 'vitest';
import { lastCall } from './support/last-call.ts';
import { mountedRest } from './support/mounted-rest.ts';
import { action, anyJson, id, list, none, shape, str } from './support/nodes.ts';
import { portalSurface } from './support/portal-surface.ts';
import { profileRow as row } from './support/profile-row.ts';
import {
  call,
  fakeInvoker,
  mountRest,
  profileId,
  profileUuid,
  session,
} from './support/rest-kit.ts';
import { withActions } from './support/with-actions.ts';

describe('request transport', () => {
  test('bodies: malformed JSON is 400, too large is 413, other media types are 400', async () => {
    const { handler } = await mountedRest(() => ({ ok: true, value: row }));
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

  test('a void-input POST never reads its body, so it cannot answer an undocumented 413', async () => {
    const surface = withActions(
      portalSurface(),
      action('app.ping', { mount: 'module', kind: 'command', input: none, output: none }),
    );
    const fake = fakeInvoker(() => ({ ok: true, value: undefined }));
    const small = await mountRest(surface, fake.invoker, {}, { maxBodyBytes: 16 });
    const response = await call(small.handler, 'POST', '/api/app/ping', {
      rawBody: 'x'.repeat(1000),
      headers: { 'content-type': 'text/plain' },
    });
    expect(response.status).not.toBe(413);
    expect(response.status).toBeLessThan(300);
    expect(lastCall(fake.calls).action).toBe('app.ping');
  });

  test('DELETE is decoded from the query string, whatever the body', async () => {
    const fake = fakeInvoker(() => ({ ok: true, value: row }));
    const small = await mountRest(portalSurface(), fake.invoker, {}, { maxBodyBytes: 16 });
    const response = await call(
      small.handler,
      'DELETE',
      `/api/accounts/profiles/${profileId}?ifVersion=3`,
      {
        rawBody: 'x'.repeat(1000),
      },
    );
    expect(response.status).not.toBe(413);
    expect(lastCall(fake.calls).input).toEqual({ id: profileUuid, ifVersion: 3 });
  });

  test('an instance query with a nested member travels as a POST body', async () => {
    const surface = withActions(
      portalSurface(),
      action('accounts.profile.inspect', {
        mount: 'entity',
        instance: true,
        kind: 'query',
        input: shape({ id: id('accounts.profile', 'prof'), where: shape({ a: str() }) }),
        output: none,
      }),
    );
    const fake = fakeInvoker(() => ({ ok: true, value: undefined }));
    const { handler } = await mountRest(surface, fake.invoker);
    const response = await call(handler, 'POST', `/api/accounts/profiles/${profileId}/inspect`, {
      body: { where: { a: 'x' } },
    });
    expect(response.status).toBeLessThan(300);
    expect(lastCall(fake.calls).input).toEqual({ where: { a: 'x' }, id: profileUuid });
    const get = await call(handler, 'GET', `/api/accounts/profiles/${profileId}/inspect`);
    expect(get.status).toBe(404);
  });

  test('a module query with filter JSON, a sort list and a scalar decodes from the query string', async () => {
    const surface = withActions(
      portalSurface(),
      action('app.search', {
        mount: 'module',
        kind: 'query',
        input: shape({
          filter: anyJson(false),
          sort: list(shape({ field: str(), direction: str() })),
          q: str(),
        }),
        output: none,
      }),
    );
    const fake = fakeInvoker(() => ({ ok: true, value: undefined }));
    const { handler } = await mountRest(surface, fake.invoker);
    const filter = encodeURIComponent('{"title":"a"}');
    await call(handler, 'GET', `/api/app/search?filter=${filter}&sort=-title&q=x`);
    expect(lastCall(fake.calls).input).toEqual({
      filter: { title: 'a' },
      sort: [{ field: 'title', direction: 'desc' }],
      q: 'x',
    });
  });

  test('unknown paths and subscriptions', async () => {
    const { handler } = await mountedRest(() => ({ ok: true, value: row }));
    expect((await call(handler, 'GET', '/api/nothing/here')).status).toBe(404);
    expect((await call(handler, 'PUT', '/api/accounts/profiles')).status).toBe(404);
    const stream = await call(handler, 'GET', '/api/auth/session-events', {
      headers: { accept: 'text/event-stream' },
    });
    expect(stream.status).toBe(503);
    expect(await stream.json()).toMatchObject({ code: 'core.live_unavailable' });
  });

  test('HEAD answers the headers of GET without a body', async () => {
    const { handler } = await mountedRest(() => ({ ok: true, value: { ok: true } }));
    const response = await call(handler, 'HEAD', '/api/app/health');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
  });

  test('the first-party mount does not resolve or evaluate anything itself', async () => {
    const { handler, calls } = await mountedRest(() => ({ ok: true, value: { ok: true } }));
    const forwarded = session({ app: 'portal' });
    await call(handler, 'GET', '/api/app/health', { session: forwarded });
    expect(lastCall(calls).session).toBe(forwarded);
  });
});
