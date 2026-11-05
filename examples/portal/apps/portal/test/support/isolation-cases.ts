import type { EntityDescriptor } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import type { LocalPortal } from './local-portal.ts';
import { credentialsOf, freshPerson, sessionCookie } from './people.ts';
import type { PortalRest } from './portal-rest.ts';

const forbidden = { kind: 'forbidden', code: 'core.forbidden' };

/** What a refused promise rejected with, as kind and code. */
async function refusal(pending: Promise<unknown>): Promise<unknown> {
  try {
    await pending;
  } catch (error) {
    const { kind, code } = error as { kind?: string; code?: string };
    return { kind, code };
  }
  return 'accepted';
}

/**
 * The isolation suite for two tenants of the portal through REST: the same person signs up in
 * both, one tenant's credentials and sessions mean nothing in the other, and a header cannot move
 * a request off the tenant of its host.
 */
export function restIsolationCases(
  tenant: (name: 'acme' | 'globex') => PortalRest,
  ids: () => Readonly<Record<string, string>>,
): void {
  describe('two tenants of the portal over REST', () => {
    test('one address signs up in each tenant, and each tenant keeps its own password', async () => {
      const ada = freshPerson();
      const other = { ...ada, password: 'another long password in globex' };
      expect((await tenant('acme').send('POST', '/api/auth/sign-up', { body: ada })).status).toBe(
        200,
      );
      expect(
        (await tenant('globex').send('POST', '/api/auth/sign-up', { body: other })).status,
      ).toBe(200);
      const own = await tenant('acme').send('POST', '/api/auth/login', {
        body: credentialsOf(ada),
      });
      const crossed = await tenant('globex').send('POST', '/api/auth/login', {
        body: credentialsOf(ada),
      });
      expect(own.status).toBe(200);
      expect(crossed.status).toBe(401);
      expect(crossed.body).toMatchObject({ code: 'auth.invalid_credentials' });
    });

    test('a person of one tenant cannot log in at the other', async () => {
      const grace = freshPerson('grace');
      await tenant('acme').send('POST', '/api/auth/sign-up', { body: grace });
      const away = await tenant('globex').send('POST', '/api/auth/login', {
        body: credentialsOf(grace),
      });
      expect(away.status).toBe(401);
    });

    test('a session of one tenant is no session in the other, by bearer token or by cookie', async () => {
      const ada = freshPerson();
      await tenant('acme').send('POST', '/api/auth/sign-up', { body: ada });
      const login = await tenant('acme').send('POST', '/api/auth/login', {
        body: credentialsOf(ada),
      });
      const token = String(login.body.sessionToken);
      const bearer = { authorization: `Bearer ${token}` };
      const home = await tenant('acme').send('GET', '/api/auth/whoami', { headers: bearer });
      const away = await tenant('globex').send('GET', '/api/auth/whoami', { headers: bearer });
      expect(home.status).toBe(200);
      expect(away.status).toBe(401);
      const cookie = { cookie: `${sessionCookie}=${token}` };
      const stale = await tenant('globex').send('GET', '/api/auth/whoami', {
        headers: cookie,
        browser: true,
      });
      expect(stale.status).toBe(401);
    });

    test('a tenant header does not move a request off its host', async () => {
      const ada = freshPerson();
      await tenant('acme').send('POST', '/api/auth/sign-up', { body: ada });
      const login = await tenant('acme').send('POST', '/api/auth/login', {
        body: credentialsOf(ada),
      });
      const bearer = `Bearer ${String(login.body.sessionToken)}`;
      const acmeOnGlobex = await tenant('globex').send('GET', '/api/auth/whoami', {
        headers: { authorization: bearer, 'x-tenant': ids().acme ?? '' },
      });
      expect(acmeOnGlobex.status).toBe(401);
      const globexOnAcme = await tenant('acme').send('GET', '/api/auth/whoami', {
        headers: { authorization: bearer, 'x-tenant': ids().globex ?? '' },
      });
      expect(globexOnAcme.status).toBe(200);
    });
  });
}

/** Tenant rows and units of the portal, read through the adapter: nothing leaks across scopes. */
export function storeIsolationCases(portal: () => LocalPortal): void {
  describe('two tenants of the portal over the store', () => {
    const credential = (): EntityDescriptor => {
      const entry = portal().runtime.app.registry.entities.get('auth.credential');
      if (entry === undefined) throw new Error('the portal has no auth.credential');
      return entry.descriptor;
    };

    test('a sign-up leaves one credential in its tenant and none in the other', async () => {
      const ada = freshPerson();
      const done = await portal().request('auth.signUp', credentialsOf(ada));
      expect(done.ok).toBe(true);
      const count = (name: 'acme' | 'globex') =>
        portal().inUnit((unit) => unit.rows.count(credential()), name);
      expect(await count('acme')).toBeGreaterThanOrEqual(1);
      const before = await count('globex');
      await portal().request('auth.signUp', credentialsOf(freshPerson()), { tenant: 'acme' });
      expect(await count('globex')).toBe(before);
    });

    test('backend and deployment units are refused on tenant entities', async () => {
      const { adapter, namespace, backendId } = portal().runtime;
      const backend = adapter.unit(namespace, { level: 'backend', backendId }, (unit) =>
        unit.rows.find(credential(), {}),
      );
      const deployment = adapter.unit(namespace, { level: 'deployment' }, (unit) =>
        unit.rows.find(credential(), {}),
      );
      expect(await refusal(backend)).toEqual(forbidden);
      expect(await refusal(deployment)).toEqual(forbidden);
    });
  });
}
