import { startTransportRuntime } from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { describe, expect, test, vi } from 'vitest';
import { portal } from '../src/app.ts';
import { credentialsOf, freshPerson } from './support/people.ts';
import { portalConfig } from './support/portal-config.ts';
import { portalRest } from './support/portal-rest.ts';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const loginPath = '/api/auth/login';

describe('the login limit of one client address', () => {
  test('holds at its default: the eleventh attempt from one address is refused, another address is not', async () => {
    const t = await startTransportRuntime({ app: portal, host: httpHost(), config: portalConfig });
    try {
      const from = (remoteAddress: string) =>
        portalRest((request) => t.fetch(request, { remoteAddress }), t.domains.acme ?? '');
      const attempt = (remoteAddress: string) =>
        from(remoteAddress).send('POST', loginPath, { body: credentialsOf(freshPerson()) });
      for (let i = 0; i < 10; i += 1) {
        const answer = await attempt('203.0.113.7');
        expect(answer.status).toBe(401);
        expect(answer.body).toMatchObject({ code: 'auth.invalid_credentials' });
      }
      const refused = await attempt('203.0.113.7');
      expect(refused.status).toBe(429);
      expect(refused.body).toMatchObject({ code: 'core.rate_limited' });
      expect((await attempt('203.0.113.8')).status).toBe(401);
    } finally {
      await t.stop();
    }
  });

  test('a host.fetch call that names no address shares one address bucket', async () => {
    const t = await startTransportRuntime({ app: portal, host: httpHost(), config: portalConfig });
    try {
      const host = t.runtime.host;
      if (host === undefined) throw new Error('the runtime has no host');
      const rest = portalRest((request) => host.fetch(request), t.domains.acme ?? '');
      const attempt = () => rest.send('POST', loginPath, { body: credentialsOf(freshPerson()) });
      for (let i = 0; i < 10; i += 1) {
        const answer = await attempt();
        expect(answer.status).toBe(401);
        expect(answer.body).toMatchObject({ code: 'auth.invalid_credentials' });
      }
      const refused = await attempt();
      expect(refused.status).toBe(429);
      expect(refused.body).toMatchObject({ code: 'core.rate_limited' });
    } finally {
      await t.stop();
    }
  });

  test('a forwarding header a client sends does not give it another address', async () => {
    const t = await startTransportRuntime({
      app: portal,
      host: httpHost({ listen: { port: 0 } }),
      config: portalConfig,
    });
    try {
      const attempt = async (index: number) => {
        const response = await fetch(`http://127.0.0.1:${t.runtime.port}${loginPath}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-tenant': t.tenants.acme ?? '',
            'x-forwarded-for': `203.0.113.${index + 1}`,
          },
          body: JSON.stringify(credentialsOf(freshPerson())),
        });
        return { status: response.status, body: (await response.json()) as { code?: string } };
      };
      for (let i = 0; i < 10; i += 1) {
        expect((await attempt(i)).status).toBe(401);
      }
      const refused = await attempt(10);
      expect(refused.status).toBe(429);
      expect(refused.body).toMatchObject({ code: 'core.rate_limited' });
    } finally {
      await t.stop();
    }
  });
});
