import { describe, expect, it } from 'vitest';
import { decorateResponse } from '../src/decorate-response.ts';
import type { RequestState } from '../src/request-state.ts';
import { fakeSession } from './support/fake-session.ts';

const renewed = '__Host-sid=tok; Path=/; Secure; HttpOnly; SameSite=Lax';

function decorated(
  state: Partial<RequestState>,
  response: Response = new Response('ok'),
): readonly string[] {
  const request = new Request('https://library.example/x');
  const full: RequestState = {
    requestId: 'r1',
    route: '/x',
    transport: 'http',
    setCookies: [],
    ...state,
  };
  return decorateResponse(response, request, full).headers.getSetCookie();
}

describe('the session cookie of a sliding session', () => {
  it('is appended to the response', () => {
    const cookies = decorated({ session: fakeSession({ setCookies: [renewed] }) });
    expect(cookies).toEqual([renewed]);
  });

  it('yields to a cookie the action set under the same name', () => {
    const own = '__Host-sid=fresh; Path=/; Secure; HttpOnly; SameSite=Lax';
    const cookies = decorated({
      session: fakeSession({ setCookies: [renewed] }),
      setCookies: [own],
    });
    expect(cookies).toEqual([own]);
  });

  it('yields to a cookie the response itself set', () => {
    const response = new Response('ok', { headers: { 'set-cookie': '__Host-sid=other; Path=/' } });
    const cookies = decorated({ session: fakeSession({ setCookies: [renewed] }) }, response);
    expect(cookies).toEqual(['__Host-sid=other; Path=/']);
  });

  it('is not set again under a name the response clears', () => {
    const cookies = decorated({
      session: fakeSession({ setCookies: [renewed], clearCookies: ['__Host-sid'] }),
    });
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatch(/^__Host-sid=;/);
  });
});

describe('the cache rules of a response that renews the session cookie', () => {
  const headersOf = (state: Partial<RequestState>, response: Response = new Response('ok')) => {
    const request = new Request('https://library.example/api/x');
    const full: RequestState = {
      requestId: 'r1',
      route: '/api/x',
      transport: 'http',
      setCookies: [],
      ...state,
    };
    return decorateResponse(response, request, full).headers;
  };

  it('is private and not stored by any cache', () => {
    const headers = headersOf({ session: fakeSession({ setCookies: [renewed] }) });
    expect(headers.get('cache-control')).toBe('private, no-store');
  });

  it('replaces a cache-control that lets a shared cache keep it', () => {
    const response = new Response('ok', { headers: { 'cache-control': 'public, max-age=600' } });
    const headers = headersOf({ session: fakeSession({ setCookies: [renewed] }) }, response);
    expect(headers.get('cache-control')).toBe('private, no-store');
  });

  it('keeps a cache-control that already says no-store or private', () => {
    for (const value of ['no-store', 'private, max-age=60', 'No-Store, no-cache']) {
      const response = new Response('ok', { headers: { 'cache-control': value } });
      const headers = headersOf({ session: fakeSession({ setCookies: [renewed] }) }, response);
      expect(headers.get('cache-control')).toBe(value);
    }
  });

  it('leaves a response that renews no cookie as the handler made it', () => {
    const response = new Response('ok', { headers: { 'cache-control': 'public, max-age=600' } });
    expect(headersOf({ session: fakeSession() }, response).get('cache-control')).toBe(
      'public, max-age=600',
    );
    // A cookie that yields to the response's own is not appended, so the cache rules stay too.
    const own = new Response('ok', {
      headers: { 'set-cookie': '__Host-sid=other; Path=/', 'cache-control': 'public' },
    });
    expect(
      headersOf({ session: fakeSession({ setCookies: [renewed] }) }, own).get('cache-control'),
    ).toBe('public');
  });
});
