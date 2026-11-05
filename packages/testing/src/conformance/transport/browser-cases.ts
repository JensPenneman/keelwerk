import { describe, expect, test } from 'vitest';
import type { Call } from './call.ts';
import { freshName } from './fresh-name.ts';
import { lendCall } from './lend-call.ts';
import { loansOf } from './loans-of.ts';
import { sendCall } from './send-call.ts';
import { testCookieName } from './test-cookie-name.ts';
import type { TransportTarget } from './transport-target.ts';

const csrf = { ok: false, kind: 'forbidden', code: 'core.csrf' } as const;

function tenantOf(target: TransportTarget, name: string): { id: string; domain: string } {
  const tenant = target.tenants[name];
  if (tenant === undefined) throw new Error(`The target has no tenant '${name}'.`);
  return tenant;
}

/** A browser lend: the session cookie and the headers a browser adds on its own. */
function browserLend(subject: string, caller: NonNullable<Call['caller']>): Call {
  return lendCall(subject, freshName('Dune'), { caller: { cookie: `user:${subject}`, ...caller } });
}

/** Browser scenarios: cookies, the origin check, CORS, a scope key in the URL and a stale session. */
export function browserCases(target: TransportTarget): void {
  describe('cookies and the origin check', () => {
    test('a cookie session without an origin or a fetch-site header is refused', async () => {
      const sent = await sendCall(target, browserLend(freshName('ada'), {}));
      expect(sent.decoded).toEqual(csrf);
      expect(sent.response.status).toBe(403);
    });

    test('a same-origin request passes, by fetch metadata or by origin', async () => {
      const ada = freshName('ada');
      const own = `https://${tenantOf(target, 'acme').domain}`;
      expect(
        (await sendCall(target, browserLend(ada, { fetchSite: 'same-origin' }))).decoded.ok,
      ).toBe(true);
      expect((await sendCall(target, browserLend(ada, { origin: own }))).decoded.ok).toBe(true);
    });

    test('the origin of a sibling tenant or a stranger is refused, a configured one passes', async () => {
      const ada = freshName('ada');
      const sibling = `https://${tenantOf(target, 'globex').domain}`;
      expect((await sendCall(target, browserLend(ada, { origin: sibling }))).decoded).toEqual(csrf);
      expect(
        (await sendCall(target, browserLend(ada, { origin: 'https://evil.example' }))).decoded,
      ).toEqual(csrf);
      const allowed = target.cors[0] ?? '';
      const configured = await sendCall(target, browserLend(ada, { origin: allowed }));
      if (target.codec.configurableCors) expect(configured.decoded.ok).toBe(true);
      else expect(configured.decoded).toEqual(csrf);
    });

    test('a cookie a sibling subdomain planted without the __Host- prefix is not a session', async () => {
      const ada = freshName('ada');
      const planted = await sendCall(
        target,
        lendCall(ada, freshName('Dune'), {
          caller: {
            headers: { cookie: `${testCookieName.replace('__Host-', '')}=user:${ada}` },
            fetchSite: 'same-origin',
          },
        }),
      );
      expect(planted.decoded).toEqual({
        ok: false,
        kind: 'unauthenticated',
        code: 'core.unauthenticated',
      });
    });

    test('a bearer-style request carries no cookie, so no origin check applies', async () => {
      const sent = await sendCall(target, lendCall(freshName('ada'), freshName('Dune')));
      expect(sent.decoded.ok).toBe(true);
    });
  });

  describe('scope', () => {
    test('another tenant named in a header does not move a request off its own host', async () => {
      const ada = freshName('ada');
      await sendCall(
        target,
        lendCall(ada, freshName('Dune'), { caller: { subject: ada, tenant: 'globex' } }),
      );
      const named = await sendCall(target, {
        action: 'loans.loan.query',
        input: {},
        caller: {
          subject: ada,
          tenant: 'acme',
          headers: { 'x-tenant': tenantOf(target, 'globex').id },
        },
      });
      expect(named.decoded).toMatchObject({ ok: true, value: { items: [] } });
      expect(await loansOf(target, ada, {}, 'globex')).toHaveLength(1);
    });

    // 16.3.8 asks for this scenario, but M1 refuses the `path` and `scopeKey` tenant resolvers at
    // boot (tenant-resolver.ts), so a request cannot name another tenant in its path: the case
    // waits for the resolvers of M2 and the host strips the prefix then.
    test.skip("m2: a path that names another tenant's scope key is refused, not served", async () => {
      const sent = await sendCall(target, {
        action: 'loans.loan.query',
        input: {},
        caller: { subject: freshName('ada'), pathPrefix: `/t/${tenantOf(target, 'globex').id}` },
      });
      expect(sent.decoded).toEqual({ ok: false, kind: 'not_found', code: 'core.not_found' });
      expect(sent.response.status).toBe(404);
    });
  });

  describe('a stale session', () => {
    // The public action of the fixture: it needs no principal, so a cookie that resolves to
    // nothing must not stop it and the browser is told to drop the cookie.
    const aboutOnTheTenant = (caller: NonNullable<Call['caller']>) =>
      sendCall(target, { action: 'loans.about', input: {}, caller });

    test('a public read still works and the cookie is cleared', async () => {
      const sent = await aboutOnTheTenant({ cookie: 'expired', fetchSite: 'same-origin' });
      expect(sent.decoded).toMatchObject({ ok: true, value: { module: 'loans' } });
      const cleared = sent.response.headers
        .getSetCookie()
        .find((c) => c.startsWith(`${testCookieName}=;`));
      expect(cleared).toContain('Max-Age=0');
      expect(cleared).toContain('HttpOnly');
    });

    test('a live session is left alone', async () => {
      const sent = await aboutOnTheTenant({ cookie: 'user:ada', fetchSite: 'same-origin' });
      expect(sent.decoded).toMatchObject({ ok: true, value: { module: 'loans' } });
      expect(sent.response.headers.getSetCookie()).toEqual([]);
    });
  });

  describe('the cookie hint of an action (16.4.10)', () => {
    const openDesk = (caller: NonNullable<Call['caller']>) =>
      sendCall(target, { action: 'loans.openDesk', input: { desk: 'north' }, caller });
    const deskCookie = (sent: Awaited<ReturnType<typeof openDesk>>) =>
      sent.response.headers.getSetCookie().filter((cookie) => cookie.startsWith('__Host-kw-desk='));

    test('a browser request gets the cookie and the body without the ticket', async () => {
      for (const caller of [
        { fetchSite: 'same-origin' } as const,
        { origin: `https://${tenantOf(target, 'acme').domain}` },
      ]) {
        const sent = await openDesk(caller);
        expect(sent.decoded).toEqual({ ok: true, value: { desk: 'north' }, accepted: false });
        const [cookie, ...others] = deskCookie(sent);
        expect(others).toEqual([]);
        expect(cookie).toContain('__Host-kw-desk=ticket-north');
        expect(cookie).toContain('HttpOnly');
        expect(cookie).toContain('Secure');
        expect(cookie).toContain('SameSite=Lax');
        expect(cookie).toContain('Path=/');
        expect(cookie).not.toContain('Domain');
      }
    });

    test('a request without browser headers gets the full output and no cookie', async () => {
      const sent = await openDesk({});
      expect(sent.decoded).toEqual({
        ok: true,
        value: { ticket: 'ticket-north', desk: 'north' },
        accepted: false,
      });
      expect(deskCookie(sent)).toEqual([]);
    });
  });

  describe('cross-origin requests', () => {
    const preflight = (origin: string) =>
      target.fetch(
        new Request(`https://${tenantOf(target, 'acme').domain}${target.codec.endpoint}`, {
          method: 'OPTIONS',
          headers: { origin, 'access-control-request-method': 'POST' },
        }),
      );

    test('a configured origin gets its preflight answered with the origin echoed where the transport has a cors setting', async () => {
      const allowed = target.cors[0] ?? '';
      const response = await preflight(allowed);
      if (target.codec.configurableCors) {
        expect(response.status).toBe(204);
        expect(response.headers.get('access-control-allow-origin')).toBe(allowed);
      } else {
        expect(response.headers.get('access-control-allow-origin')).toBeNull();
      }
    });

    test('any other origin gets no CORS headers', async () => {
      const response = await preflight('https://evil.example');
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
    });
  });
}
