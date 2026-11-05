import { describe, expect, test } from 'vitest';
import { credentialsOf, freshPerson, sessionCookie } from './people.ts';
import type { PortalRest } from './portal-rest.ts';

const signUpPath = '/api/auth/sign-up';
const loginPath = '/api/auth/login';
const logoutPath = '/api/auth/logout';
const whoamiPath = '/api/auth/whoami';

const cookieNamed = (cookies: readonly string[], name: string): string | undefined =>
  cookies.find((cookie) => cookie.startsWith(`${name}=`));

/** The value of a `Set-Cookie` line. */
const tokenOf = (cookie: string | undefined): string =>
  (cookie ?? '').split(';')[0]?.split('=')[1] ?? '';

const unauthenticated = { code: 'core.unauthenticated' };

/**
 * The accounts-and-auth scenario of the portal through REST on the tenant `acme`: sign-up, login
 * with the `__Host-` cookie of a browser request and with a bearer token, a stale cookie on the
 * login action, and logout. `acme` is the tenant of the REST client the caller hands over.
 */
export function scenarioCases(acme: () => PortalRest): void {
  describe('the portal over REST', () => {
    test('sign-up creates the credential and the profile, and answers the credential id', async () => {
      const ada = freshPerson();
      const up = await acme().send('POST', signUpPath, { body: ada });
      expect(up.status).toBe(200);
      expect(up.body).toEqual({ credentialId: expect.stringMatching(/^cred_/) });
      const again = await acme().send('POST', signUpPath, { body: ada });
      expect(again.status).toBe(409);
      expect(again.body).toMatchObject({ code: 'auth.identifier_taken' });
    });

    test('a browser login sets the __Host- cookie and keeps the token out of the body', async () => {
      const ada = freshPerson();
      await acme().send('POST', signUpPath, { body: ada });
      const login = await acme().send('POST', loginPath, {
        body: credentialsOf(ada),
        browser: true,
      });
      expect(login.status).toBe(200);
      expect(login.body).not.toHaveProperty('sessionToken');
      expect(login.body).toMatchObject({ sessionId: expect.stringMatching(/^sess_/) });
      const cookie = cookieNamed(login.cookies, sessionCookie);
      expect(cookie).toMatch(/^__Host-keelwerk_session=pss_/);
      for (const attribute of ['Path=/', 'Secure', 'HttpOnly', 'SameSite=Lax']) {
        expect(cookie).toContain(attribute);
      }
      expect(cookie).not.toContain('Domain');
      const who = await acme().send('GET', whoamiPath, {
        headers: { cookie: `${sessionCookie}=${tokenOf(cookie)}` },
        browser: true,
      });
      expect(who.status).toBe(200);
      expect(who.body).toMatchObject({ displayName: ada.displayName });
    });

    test('a login without browser headers answers the token and no cookie; the bearer token works', async () => {
      const ada = freshPerson();
      await acme().send('POST', signUpPath, { body: ada });
      const login = await acme().send('POST', loginPath, { body: credentialsOf(ada) });
      expect(login.status).toBe(200);
      expect(login.cookies).toEqual([]);
      const token = String(login.body.sessionToken);
      expect(token).toMatch(/^pss_/);
      const who = await acme().send('GET', whoamiPath, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(who.status).toBe(200);
      expect(who.body).toMatchObject({ displayName: ada.displayName });
      const without = await acme().send('GET', whoamiPath);
      expect(without.status).toBe(401);
      expect(without.body).toMatchObject(unauthenticated);
    });

    test('a wrong password is refused, and so is an address nobody signed up', async () => {
      const ada = freshPerson();
      await acme().send('POST', signUpPath, { body: ada });
      const wrong = await acme().send('POST', loginPath, {
        body: { ...credentialsOf(ada), password: 'not the password at all' },
      });
      const unknown = await acme().send('POST', loginPath, {
        body: credentialsOf(freshPerson('nobody')),
      });
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(wrong.body).toMatchObject({ code: 'auth.invalid_credentials' });
      expect(unknown.body.detail).toEqual(wrong.body.detail);
      expect(unknown.body.code).toEqual(wrong.body.code);
    });

    test('a stale cookie does not lock the login page: the login works and replaces the cookie', async () => {
      const ada = freshPerson();
      await acme().send('POST', signUpPath, { body: ada });
      const stale = await acme().send('POST', loginPath, {
        body: credentialsOf(ada),
        browser: true,
        headers: { cookie: `${sessionCookie}=pss_stale_nothing` },
      });
      expect(stale.status).toBe(200);
      // a response carries one Set-Cookie line for the session name (RFC 6265 4.1.1)
      const named = stale.cookies.filter((cookie) => cookie.startsWith(`${sessionCookie}=`));
      expect(named).toHaveLength(1);
      const fresh = named[0];
      expect(tokenOf(fresh)).toMatch(/^pss_/);
      expect(tokenOf(fresh)).not.toBe('pss_stale_nothing');
      const who = await acme().send('GET', whoamiPath, {
        headers: { cookie: `${sessionCookie}=${tokenOf(fresh)}` },
        browser: true,
      });
      expect(who.status).toBe(200);
    });

    test('a stale cookie on a protected action is refused and the browser is told to drop it', async () => {
      const refused = await acme().send('GET', whoamiPath, {
        headers: { cookie: `${sessionCookie}=pss_stale_nothing` },
        browser: true,
      });
      expect(refused.status).toBe(401);
      expect(cookieNamed(refused.cookies, sessionCookie)).toContain('Max-Age=0');
    });

    test('a stale bearer token fails before the action', async () => {
      const refused = await acme().send('POST', loginPath, {
        body: credentialsOf(freshPerson()),
        headers: { authorization: 'Bearer pss_stale_nothing' },
      });
      expect(refused.status).toBe(401);
    });

    test('logout revokes the session and clears the cookie', async () => {
      const ada = freshPerson();
      await acme().send('POST', signUpPath, { body: ada });
      const login = await acme().send('POST', loginPath, {
        body: credentialsOf(ada),
        browser: true,
      });
      const held = `${sessionCookie}=${tokenOf(cookieNamed(login.cookies, sessionCookie))}`;
      const out = await acme().send('POST', logoutPath, {
        body: {},
        headers: { cookie: held },
        browser: true,
      });
      expect(out.status).toBe(204);
      const cleared = cookieNamed(out.cookies, sessionCookie);
      expect(cleared).toContain('Max-Age=0');
      expect(cleared).toMatch(/^__Host-keelwerk_session=;/);
      const after = await acme().send('GET', whoamiPath, {
        headers: { cookie: held },
        browser: true,
      });
      expect(after.status).toBe(401);
    });

    test('a cookie request without browser headers is refused by the origin check', async () => {
      const ada = freshPerson();
      await acme().send('POST', signUpPath, { body: ada });
      const login = await acme().send('POST', loginPath, {
        body: credentialsOf(ada),
        browser: true,
      });
      const held = `${sessionCookie}=${tokenOf(cookieNamed(login.cookies, sessionCookie))}`;
      const forged = await acme().send('POST', logoutPath, { body: {}, headers: { cookie: held } });
      expect(forged.status).toBe(403);
      expect(forged.headers.get('content-type')).toContain('application/problem+json');
      expect(forged.body).toMatchObject({ code: 'core.csrf' });
    });
  });
}
