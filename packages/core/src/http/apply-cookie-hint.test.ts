import { describe, expect, it } from 'vitest';
import type { InvocationSession } from '../invoker/invocation-session.ts';
import { applyCookieHint } from './apply-cookie-hint.ts';

const session = { resolvedBy: 'hostname' } as unknown as InvocationSession;
const browser = { origin: 'https://app.example.com' };
const hint = { set: { name: '__Host-session', from: 'token', expiresFrom: 'idleExpiresAt' } };
const pinned = Temporal.Instant.from('2020-01-01T00:00:00Z');

describe('applyCookieHint and the clock', () => {
  it('counts Max-Age from the given instant, not from the system clock', () => {
    const value = { token: 'abc', idleExpiresAt: '2020-01-01T00:30:00Z' };
    const result = applyCookieHint(hint, value, session, browser, pinned);
    expect(result.setCookies).toHaveLength(1);
    expect(result.setCookies[0]).toContain('Max-Age=1800');
  });

  it('reads the system clock when no instant is given', () => {
    const expiry = Temporal.Now.instant().add({ minutes: 10 }).toString();
    const result = applyCookieHint(hint, { token: 'abc', idleExpiresAt: expiry }, session, browser);
    const maxAge = Number(/Max-Age=(\d+)/.exec(result.setCookies[0] ?? '')?.[1]);
    expect(maxAge).toBeGreaterThan(590);
    expect(maxAge).toBeLessThanOrEqual(600);
  });

  it('gives an expiry in the past a Max-Age of 0', () => {
    const value = { token: 'abc', idleExpiresAt: '2019-12-31T23:00:00Z' };
    const result = applyCookieHint(hint, value, session, browser, pinned);
    expect(result.setCookies[0]).toContain('Max-Age=0');
  });
});

describe('applyCookieHint and an action that answers nothing', () => {
  const clearing = { clear: { name: '__Host-session' } };

  it('clears the cookie of a clearing hint whatever the output', () => {
    for (const value of [undefined, null, 'done', ['a']]) {
      const result = applyCookieHint(clearing, value, session, browser, pinned);
      expect(result.value).toBe(value);
      expect(result.setCookies).toHaveLength(1);
      expect(result.setCookies[0]).toMatch(/^__Host-session=;/);
      expect(result.setCookies[0]).toContain('Max-Age=0');
    }
  });

  it('clears nothing for a request that is no browser request or not under host-based resolution', () => {
    expect(applyCookieHint(clearing, undefined, session, {}, pinned).setCookies).toEqual([]);
    const byHeader = { resolvedBy: 'header' } as unknown as InvocationSession;
    expect(applyCookieHint(clearing, undefined, byHeader, browser, pinned).setCookies).toEqual([]);
  });

  it('sets nothing for a hint that names a cookie to set when the output is no record', () => {
    expect(applyCookieHint(hint, undefined, session, browser, pinned).setCookies).toEqual([]);
  });
});
